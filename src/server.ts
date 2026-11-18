import { env } from './config/env';
import { connectDB } from './config/db';
import { createApp } from './app';
import { Device } from './models/Device';
import { runAutoShutoffCheck } from './services/autoShutoff';

async function main(): Promise<void> {
  const t0 = Date.now();
  /* eslint-disable no-console */
  console.log('[grAIn API] Starting grAIn backend (ESP32 + DHT22 only)...');

  // Connect to MongoDB. On failure the server still boots (health stays up)
  // and retries in the background — friendly to Render free-tier cold starts.
  await connectDB();

  // --- Ownerless-device safeguard ---
  // ownerId is now required on the Device schema. Log a loud warning at boot
  // (and every 60 minutes thereafter) if any documents are missing it, so the
  // backfill isn't accidentally skipped after a deploy.
  async function checkOwnerlessDevices(): Promise<void> {
    try {
      const count = await Device.countDocuments({
        $or: [{ ownerId: { $exists: false } }, { ownerId: null }]
      });
      if (count > 0) {
        console.warn(
          `[grAIn API] WARNING: ${count} device(s) have no ownerId. ` +
          `Run 'npm run backfill-device-owners' immediately to avoid ` +
          `validation failures on device writes.`
        );
      }
    } catch {
      // Best-effort only: if the collection doesn't exist yet, skip silently.
    }
  }

  await checkOwnerlessDevices();
  // Re-check every 60 minutes so long-running servers catch devices created
  // after the initial boot check.
  setInterval(checkOwnerlessDevices, 60 * 60 * 1000).unref();

  // --- Safety-critical auto-shutoff ---
  // Server-authoritative: every 30s, stop any active session whose predicted
  // completion time has passed. Does NOT depend on the mobile app being open.
  // (Also run once at boot so a session that completed during downtime is
  // caught immediately on startup, not 30s later.)
  const AUTO_SHUTOFF_INTERVAL_MS = 30_000;
  void runAutoShutoffCheck();
  setInterval(runAutoShutoffCheck, AUTO_SHUTOFF_INTERVAL_MS).unref();

  const app = createApp();

  const server = app.listen(env.port, () => {
    console.log(`[grAIn API] Listening on port ${env.port} — startup took ${Date.now() - t0}ms`);
    console.log(`[grAIn API] Base URL: http://localhost:${env.port}/api`);
    if (env.nodeEnv === 'development') {
      console.log('[grAIn API] Health check: GET /api/health');
    }
  });

  // Lean timeouts so hung sockets never pin a free-tier instance.
  server.keepAliveTimeout = 65_000; // > Render/ALB idle timeout
  server.headersTimeout = 70_000;

  const shutdown = (signal: string) => {
    console.log(`[grAIn API] ${signal} received — shutting down...`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  process.on('unhandledRejection', (reason) => {
    console.error('[grAIn API] Unhandled rejection:', reason);
  });
}

main().catch((err) => {
  /* eslint-disable no-console */
  console.error('[grAIn API] Fatal startup error:', err instanceof Error ? err.stack : err);
  process.exit(1);
});
