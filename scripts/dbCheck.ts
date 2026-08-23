/**
 * One-shot DB connectivity check: loads .env, connects via mongoose,
 * prints result and exits. Usage: node dist/scripts/dbCheck.js
 */
import 'dotenv/config';
import mongoose from 'mongoose';

const uri = (process.env.MONGODB_URI || process.env.MONGO_URI || '').trim();

if (!uri) {
  console.error('[dbCheck] MONGODB_URI is not set');
  process.exit(1);
}
if (/<[a-z_]+>/i.test(uri)) {
  console.error('[dbCheck] MONGODB_URI still contains a placeholder like <db_password>');
  process.exit(1);
}

console.log(`[dbCheck] Connecting to: ${uri.replace(/\/\/[^@]+@/, '//***@')}`);

const timeout = setTimeout(() => {
  console.error('[dbCheck] TIMED OUT after 25s');
  process.exit(1);
}, 25_000);

async function main(): Promise<void> {
  try {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 20_000 });
    console.log('[dbCheck] CONNECTED ✅');
    const admin = mongoose.connection.db!.admin();
    const info = await admin.ping();
    console.log(`[dbCheck] ping ok: ${JSON.stringify(info)}`);
    clearTimeout(timeout);
    await mongoose.disconnect();
    process.exit(0);
  } catch (err) {
    clearTimeout(timeout);
    console.error('[dbCheck] FAILED:', err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

main();
