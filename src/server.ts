import { env } from './config/env';
import { connectDB } from './config/db';
import { createApp } from './app';

async function main(): Promise<void> {
  const t0 = Date.now();
  /* eslint-disable no-console */
  console.log('[grAIn API] Starting grAIn backend (ESP32 + DHT22 only)...');

  // Connect to MongoDB. On failure the server still boots (health stays up)
  // and retries in the background — friendly to Render free-tier cold starts.
  await connectDB();

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
