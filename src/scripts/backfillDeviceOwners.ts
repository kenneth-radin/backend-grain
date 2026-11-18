import mongoose from 'mongoose';
import { Device } from '../models/Device';
import { env } from '../config/env';

/**
 * Backfill script: sets ownerId on all devices that currently lack one.
 *
 * Usage:
 *   ADMIN_USER_ID=<your-admin-object-id> npx tsx src/scripts/backfillDeviceOwners.ts
 *
 * Pass the admin user's MongoDB ObjectId via the ADMIN_USER_ID environment
 * variable. The script will update every device where ownerId is missing or
 * null and report how many were modified.
 */

async function main() {
  const adminId = process.env.ADMIN_USER_ID;

  if (!adminId || !mongoose.isValidObjectId(adminId)) {
    console.error('Usage: ADMIN_USER_ID=<admin-object-id> npx tsx src/scripts/backfillDeviceOwners.ts');
    process.exit(1);
  }

  await mongoose.connect(env.mongoUri);
  console.log('[backfill] Connected to MongoDB');

  const result = await Device.updateMany(
    {
      $or: [{ ownerId: { $exists: false } }, { ownerId: null }]
    },
    { $set: { ownerId: new mongoose.Types.ObjectId(adminId) } }
  );

  console.log(`[backfill] Matched ${result.matchedCount} devices, modified ${result.modifiedCount} devices.`);

  const remaining = await Device.countDocuments({
    $or: [{ ownerId: { $exists: false } }, { ownerId: null }]
  });
  console.log(`[backfill] Remaining devices without ownerId: ${remaining}`);

  await mongoose.disconnect();
  console.log('[backfill] Disconnected.');
}

main().catch((err) => {
  console.error('[backfill] Fatal error:', err);
  process.exit(1);
});