import mongoose from 'mongoose';
import { env } from './env';

/**
 * MongoDB connection with free-tier-friendly timeouts.
 *
 * If the first connection attempt fails (e.g. Render cold start racing Atlas,
 * or a transient network issue) the server still boots and serves
 * /api/health, and keeps retrying in the background every 30s.
 */

let connected = false;
let retryTimer: NodeJS.Timeout | null = null;

function scheduleRetry(): void {
  if (retryTimer) return;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void connectDB();
  }, 30_000);
}

export async function connectDB(): Promise<boolean> {
  mongoose.set('strictQuery', true);
  try {
    await mongoose.connect(env.mongoUri, {
      serverSelectionTimeoutMS: 10_000,
      socketTimeoutMS: 30_000,
      maxPoolSize: 10
    });
    connected = true;
    console.log('[grAIn API] MongoDB connected');

    mongoose.connection.on('disconnected', () => {
      if (connected) {
        connected = false;
        console.warn('[grAIn API] MongoDB disconnected — will rely on driver auto-reconnect');
      }
    });
    mongoose.connection.on('reconnected', () => {
      connected = true;
      console.log('[grAIn API] MongoDB reconnected');
    });

    return true;
  } catch (err) {
    connected = false;
    const message = err instanceof Error ? err.message : String(err);
    console.error('[grAIn API] MongoDB connection failed:', message);
    console.warn('[grAIn API] Booting anyway; /api/health stays available. Retrying in 30s...');
    scheduleRetry();
    return false;
  }
}

export function isDbConnected(): boolean {
  return connected;
}

/** Closes the Mongo connection cleanly (used by tests/shutdown). */
export async function disconnectDB(): Promise<void> {
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
  connected = false;
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
}
