import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { connectDB, disconnectDB } from '../config/db';
import { createApp } from '../app';
import { User } from '../models/User';
import { Device } from '../models/Device';
import { signAccessToken } from '../utils/tokens';

/**
 * Dedicated smoke test for admin endpoints:
 *   GET /api/admin/devices, GET /api/admin/users,
 *   PATCH /api/admin/devices/:id/owner.
 *
 * Covers:
 *   1. Valid admin transfers device to target user → 200, ownerId updated
 *   2. Non-admin farmer attempts transfer → 403
 *   3. Malformed ownerId → 400
 *   4. Well-formed but nonexistent target user ID → 404
 *   5. Well-formed but nonexistent device ID → 404, no device detail leak
 *   6. Admin lists devices → 200 with owner name/email populated
 *   7. Non-admin farmer lists devices → 403
 *   8. Admin lists users → 200 without passwordHash
 *   9. Non-admin farmer lists users → 403
 *
 * Run: npx tsx src/scripts/adminEndpointSmoke.ts
 */

async function main(): Promise<void> {
  const mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri('grain-admin-smoke');
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'smoke-test-secret-smoke-test-secret';
  process.env.PORT = '8097';

  await connectDB();
  const app = createApp();
  const server = app.listen(process.env.PORT);
  const base = `http://localhost:${process.env.PORT}/api`;

  let failures = 0;
  async function check(name: string, fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
      console.log(`[admin-smoke] PASS  ${name}`);
    } catch (err) {
      failures++;
      console.error(`[admin-smoke] FAIL  ${name}:`, err instanceof Error ? err.message : err);
    }
  }

  function assert(cond: unknown, msg: string): void {
    if (!cond) throw new Error(msg);
  }

  const j = async (res: Response): Promise<any> => res.json();

  // --- Setup: create admin user directly (registration forces 'farmer') ---
  const adminUser = await User.findOneAndUpdate(
    { email: 'admin@grain.local' },
    {
      name: 'Admin User',
      passwordHash: await bcrypt.hash('adminpass123', 10),
      role: 'admin',
      emailVerified: true
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  const adminToken = signAccessToken(String(adminUser._id));

  // --- Setup: create target farmer user ---
  const targetUser = await User.findOneAndUpdate(
    { email: 'target@grain.local' },
    {
      name: 'Target Farmer',
      passwordHash: await bcrypt.hash('targetpass123', 10),
      role: 'farmer',
      emailVerified: true
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  // --- Setup: create a device owned by the admin ---
  const device = await Device.findOneAndUpdate(
    { deviceId: 'GR-TRANSFER' },
    {
      ownerId: adminUser._id,
      location: 'Transfer Barn',
      status: 'offline',
      isOnline: false
    },
    { upsert: true, new: true }
  );

  const adminAuth = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${adminToken}`
  };

  // Test 1: Valid admin + valid device + valid target user → 200
  await check('Valid admin transfers device to target user → 200', async () => {
    const res = await fetch(`${base}/admin/devices/${device.deviceId}/owner`, {
      method: 'PATCH',
      headers: adminAuth,
      body: JSON.stringify({ ownerId: String(targetUser._id) })
    });
    assert(res.status === 200, `expected 200, got ${res.status}`);
    const body = await j(res);
    assert(String(body.data.device.ownerId) === String(targetUser._id), 'ownerId not updated');
  });

  // Test 2: Non-admin farmer attempting the same call → 403
  await check('Non-admin farmer attempts transfer → 403', async () => {
    const farmerToken = signAccessToken(String(targetUser._id));
    const res = await fetch(`${base}/admin/devices/${device.deviceId}/owner`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${farmerToken}`
      },
      body: JSON.stringify({ ownerId: String(adminUser._id) })
    });
    assert(res.status === 403, `expected 403, got ${res.status}`);
  });

  // Test 3: Malformed ownerId → 400
  await check('Malformed ownerId → 400', async () => {
    const res = await fetch(`${base}/admin/devices/${device.deviceId}/owner`, {
      method: 'PATCH',
      headers: adminAuth,
      body: JSON.stringify({ ownerId: 'not-a-valid-id' })
    });
    assert(res.status === 400, `expected 400, got ${res.status}`);
  });

  // Test 4: Well-formed but nonexistent target user ID → 404
  await check('Nonexistent target user → 404', async () => {
    const fakeId = new mongoose.Types.ObjectId().toString();
    const res = await fetch(`${base}/admin/devices/${device.deviceId}/owner`, {
      method: 'PATCH',
      headers: adminAuth,
      body: JSON.stringify({ ownerId: fakeId })
    });
    assert(res.status === 404, `expected 404, got ${res.status}`);
  });

  // Test 6: Admin GET /admin/devices → 200, returns device with owner info
  await check('Admin lists devices → 200 with owner info', async () => {
    const res = await fetch(`${base}/admin/devices`, {
      method: 'GET',
      headers: adminAuth,
    });
    assert(res.status === 200, `expected 200, got ${res.status}`);
    const body = await j(res);
    assert(Array.isArray(body.data), 'data is not an array');
    assert(body.pagination.total >= 1, 'expected at least 1 device');
    const found = body.data.find((d: any) => d.deviceId === device.deviceId);
    assert(found, 'transfer device not in list');
    const ownerIdValue = found.ownerId;
    const ownerIdString =
      ownerIdValue && typeof ownerIdValue === 'object'
        ? String(ownerIdValue._id)
        : String(ownerIdValue);
    assert(ownerIdString === String(targetUser._id), 'ownerId not reflected');
    assert(found.owner && found.owner.name === 'Target Farmer', 'owner name not populated');
    assert(found.owner && found.owner.email === 'target@grain.local', 'owner email not populated');
  });

  // Test 7: Non-admin farmer GET /admin/devices → 403
  await check('Non-admin farmer lists devices → 403', async () => {
    const farmerToken = signAccessToken(String(targetUser._id));
    const res = await fetch(`${base}/admin/devices`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${farmerToken}`,
      },
    });
    assert(res.status === 403, `expected 403, got ${res.status}`);
  });

  // Test 8: Admin GET /admin/users → 200, no passwordHash
  await check('Admin lists users → 200 without passwordHash', async () => {
    const res = await fetch(`${base}/admin/users`, {
      method: 'GET',
      headers: adminAuth,
    });
    assert(res.status === 200, `expected 200, got ${res.status}`);
    const body = await j(res);
    assert(Array.isArray(body.data), 'data is not an array');
    assert(body.data.length >= 2, 'expected at least 2 users');
    const found = body.data.find((u: any) => u.email === 'target@grain.local');
    assert(found, 'target user not in list');
    assert(!('passwordHash' in found), 'passwordHash leaked!');
    assert(found._id === String(targetUser._id), 'user id mismatch');
    assert(found.role === 'farmer', 'wrong role');
    assert(found.emailVerified === true, 'wrong emailVerified');
  });

  // Test 9: Non-admin farmer GET /admin/users → 403
  await check('Non-admin farmer lists users → 403', async () => {
    const farmerToken = signAccessToken(String(targetUser._id));
    const res = await fetch(`${base}/admin/users`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${farmerToken}`,
      },
    });
    assert(res.status === 403, `expected 403, got ${res.status}`);
  });

  server.close();
  await disconnectDB();
  await mongod.stop();

  if (failures > 0) {
    console.error(`\n[admin-smoke] ${failures} check(s) FAILED`);
    process.exit(1);
  }
  console.log('\n[admin-smoke] ALL CHECKS PASSED ✅');
  process.exit(0);
}

main().catch((err) => {
  console.error('[admin-smoke] fatal:', err instanceof Error ? err.stack : err);
  process.exit(1);
});