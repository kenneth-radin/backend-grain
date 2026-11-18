/**
 * make-admin.ts — NON-destructive, single-document admin upsert.
 *
 * Safety guarantees:
 *  - Connects to the SAME database the live API reads (dbName: 'grain').
 *  - Touches exactly ONE user document (findOne → updateOne OR create).
 *  - Never uses deleteMany / drop / updateMany.
 *  - Reads email + password only from env; never hardcoded, never printed.
 *
 * Usage (inline env vars — nothing is committed):
 *   $env:MONGODB_URI='<your-atlas-srv>'
 *   $env:ADMIN_EMAIL='you@example.com'
 *   $env:ADMIN_PASSWORD='your-chosen-password'
 *   npx tsx scripts/make-admin.ts
 */
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { User } from '../src/models/User';

// Deliberately NO `import 'dotenv/config'` — read process.env directly so a
// local .env can never silently point this at the wrong cluster or database.
const BCRYPT_COST = 10; // same cost used by register/login (bcrypt.hash(pw, 10))

async function main(): Promise<void> {
  const uri = (process.env.MONGODB_URI || '').trim();
  const email = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD || '';
  const name = (process.env.ADMIN_NAME || '').trim() || email.split('@')[0];

  if (!uri) {
    console.error('[make-admin] MONGODB_URI is required');
    process.exit(1);
  }
  if (!/^\S+@\S+\.\S+$/.test(email)) {
    console.error('[make-admin] ADMIN_EMAIL must be a valid email');
    process.exit(1);
  }
  if (password.length < 6) {
    console.error('[make-admin] ADMIN_PASSWORD must be at least 6 characters');
    process.exit(1);
  }

  await mongoose.connect(uri, { dbName: 'grain', serverSelectionTimeoutMS: 20_000 });

  const passwordHash = await bcrypt.hash(password, BCRYPT_COST);

  const existing = await User.findOne({ email }).lean();

  if (existing) {
    // Update ONLY this one document's password and role.
    await User.updateOne(
      { _id: existing._id },
      { $set: { passwordHash, role: 'admin' } }
    );
    console.log(`updated ${email}`);
  } else {
    // Create with the exact required schema fields.
    await User.create({ name, email, passwordHash, role: 'admin' });
    console.log(`created ${email}`);
  }

  await mongoose.disconnect();
  process.exit(0);
}

main().catch(async (err) => {
  console.error('[make-admin] Fatal:', err instanceof Error ? err.message : err);
  try {
    await mongoose.disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});