/**
 * E2E walkthrough driver — verifies admin + ownership + session-default
 * against a LIVE backend (in-process local MongoDB) via exact HTTP calls.
 */
import { MongoMemoryServer } from 'mongodb-memory-server';
import bcrypt from 'bcryptjs';
import { connectDB, disconnectDB } from '../src/config/db';
import { createApp } from '../src/app';
import { User } from '../src/models/User';
import { Device } from '../src/models/Device';
import { DryingSession } from '../src/models/DryingSession';
import { Prediction } from '../src/models/Prediction';
import { signAccessToken } from '../src/utils/tokens';

const HR = '─'.repeat(60);
function log(msg: string) { console.log(msg); }
function assert(cond: unknown, msg: string, failures: { n: number }) {
  if (cond) { log(`  PASS  ${msg}`); } else { failures.n++; log(`  FAIL  ${msg}`); }
}
async function j(res: Response): Promise<any> { return res.json(); }

async function main() {
  const mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri('grain-e2e-' + Date.now());
  process.env.JWT_SECRET = 'e2e-walkthrough-secret-e2e-walkthrough-secret';
  process.env.PORT = '8099';

  await connectDB();
  const app = createApp();
  const server = app.listen(process.env.PORT);
  const base = `http://localhost:${process.env.PORT}/api`;
  const failures = { n: 0 };

  log(HR);
  log('SETUP: seed admin directly (registration forces farmer)');
  log(HR);
  await User.deleteMany({ email: { $in: ['admin@e2e.local', 'farmer@e2e.local'] } });
  await Device.deleteMany({ deviceId: 'GR-SIM' });
  await DryingSession.deleteMany({ deviceId: 'GR-SIM' });
  await Prediction.deleteMany({ deviceId: 'GR-SIM' });
  const admin = await User.create({
    name: 'E2E Admin', email: 'admin@e2e.local',
    passwordHash: await bcrypt.hash('adminpass123', 10), role: 'admin', emailVerified: true,
  });
  const adminToken = signAccessToken(String(admin._id));
  log(`  Admin: admin@e2e.local / adminpass123 (id=${admin._id})`);
log(HR);
  log('STEP: register non-admin farmer (sends role=admin to test escalation)');
  log(HR);
  const reg = await fetch(`${base}/auth/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'E2E Farmer', email: 'farmer@e2e.local', password: 'farmerpass123', role: 'admin' }),
  });
  const regBody = await j(reg);
  assert(reg.status === 201, `register -> 201 (got ${reg.status})`, failures);
  assert(!('accessToken' in (regBody.data || {})), 'register returns NO accessToken', failures);
  assert(typeof regBody.data?.message === 'string', 'register returns a message', failures);
  const farmerDoc = await User.findOne({ email: 'farmer@e2e.local' }).lean();
  assert(farmerDoc?.role === 'farmer', 'client role=admin ignored (stayed farmer)', failures);

  const farmerLogin = await fetch(`${base}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'farmer@e2e.local', password: 'farmerpass123' }),
  });
  const farmerLoginBody = await j(farmerLogin);
  const farmerToken = farmerLoginBody.data?.accessToken as string;
  const farmerId = farmerLoginBody.data?.user?._id as string;
  assert(farmerLogin.status === 200 && !!farmerToken, 'farmer login -> token', failures);
  log(`  Farmer: farmer@e2e.local / farmerpass123 (id=${farmerId})`);
log(HR);
  log('STEP 6: create simulated device GR-SIM (admin)');
  log(HR);
  const devRes = await fetch(`${base}/devices`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ deviceId: 'GR-SIM', location: 'Test Bay', isSimulated: true }),
  });
  const devBody = await j(devRes);
  log(`  create status=${devRes.status} body=${JSON.stringify(devBody.data)}`);
  assert(devRes.status === 200 || devRes.status === 201, `create device (got ${devRes.status})`, failures);
  assert(devBody.data?.isSimulated === true, 'isSimulated persisted true', failures);
  assert(devBody.data?.status === 'online' && devBody.data?.isOnline === true, 'simulated device created online', failures);

  log(HR);
  log('STEP 6: admin devices list - owner at creation');
  log(HR);
  const admDevList = await j(await fetch(`${base}/admin/devices`, { headers: { Authorization: `Bearer ${adminToken}` } }));
  const grSimAdmin = admDevList.data?.find((d: any) => d.deviceId === 'GR-SIM');
  log(`  GR-SIM ownerId=${String(grSimAdmin?.ownerId)} owner=${JSON.stringify(grSimAdmin?.owner)}`);
  assert(!!grSimAdmin, 'GR-SIM appears in admin device list', failures);
  assert(String(grSimAdmin?.ownerId) === String(admin._id), 'owner auto-assigned to creator (admin)', failures);
log(HR);
  log('STEP 9-pre: non-owner farmer cannot see/access GR-SIM before reassign');
  log(HR);
  const farmerDevList = await j(await fetch(`${base}/devices`, { headers: { Authorization: `Bearer ${farmerToken}` } }));
  const farmerSeesSim = (farmerDevList.data || []).some((d: any) => d.deviceId === 'GR-SIM');
  assert(!farmerSeesSim, 'farmer does NOT see GR-SIM before reassign', failures);
  const farmerGetSim = await fetch(`${base}/devices/GR-SIM`, { headers: { Authorization: `Bearer ${farmerToken}` } });
  assert(farmerGetSim.status === 403, `farmer GET GR-SIM -> 403 (got ${farmerGetSim.status})`, failures);

  log(HR);
  log('STEP 7-8: reassign GR-SIM to farmer (admin)');
  log(HR);
  const transfer = await fetch(`${base}/admin/devices/GR-SIM/owner`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ ownerId: farmerId }),
  });
  const transferBody = await j(transfer);
  log(`  transfer status=${transfer.status} newOwner=${String(transferBody.data?.device?.ownerId)}`);
  assert(transfer.status === 200, `transfer -> 200 (got ${transfer.status})`, failures);
  assert(String(transferBody.data?.device?.ownerId) === String(farmerId), 'owner updated to farmer', failures);

  const admDevList2 = await j(await fetch(`${base}/admin/devices`, { headers: { Authorization: `Bearer ${adminToken}` } }));
  const grSimAfter = admDevList2.data?.find((d: any) => d.deviceId === 'GR-SIM');
  assert(grSimAfter?.owner?.email === 'farmer@e2e.local', 'admin list shows farmer email as owner', failures);
log(HR);
  log('STEP 9: farmer can now see/interact with GR-SIM');
  log(HR);
  const farmerDevList2 = await j(await fetch(`${base}/devices`, { headers: { Authorization: `Bearer ${farmerToken}` } }));
  const farmerSeesSim2 = (farmerDevList2.data || []).some((d: any) => d.deviceId === 'GR-SIM');
  assert(farmerSeesSim2, 'farmer NOW sees GR-SIM', failures);
  const farmerGetSim2 = await fetch(`${base}/devices/GR-SIM`, { headers: { Authorization: `Bearer ${farmerToken}` } });
  assert(farmerGetSim2.status === 200, `farmer GET GR-SIM -> 200 (got ${farmerGetSim2.status})`, failures);
  const simDoc = await j(farmerGetSim2);
  assert(simDoc.data?.device?.isOnline === true && simDoc.data?.device?.status === 'online', 'GR-SIM online for farmer', failures);

  log(HR);
  log('STEP 10: farmer starts session on GR-SIM -> 92 min immediate');
  log(HR);
  const sessRes = await fetch(`${base}/sessions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${farmerToken}` },
    body: JSON.stringify({ deviceId: 'GR-SIM', grainType: 'rice' }),
  });
  const sessBody = await j(sessRes);
  assert(sessRes.status === 201, `create session -> 201 (got ${sessRes.status})`, failures);
  const sessionId = sessBody.data?._id;
  const predRes = await fetch(`${base}/predictions/${sessionId}`, { headers: { Authorization: `Bearer ${farmerToken}` } });
  const predBody = await j(predRes);
  const latest = predBody.data?.latest;
  log(`  latest remainingMinutes=${latest?.remainingMinutes}`);
  assert(predRes.status === 200, `GET predictions -> 200 (got ${predRes.status})`, failures);
  assert(latest?.remainingMinutes === 92, 'remainingMinutes === 92 immediately', failures);

  log(HR);
  log(failures.n === 0 ? 'E2E WALKTHROUGH: ALL CHECKS PASSED ✅' : `E2E WALKTHROUGH: ${failures.n} FAILED ❌`);
  log(HR);

  server.close();
  await disconnectDB();
  await mongod.stop();
  process.exit(failures.n === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('[e2e] fatal:', err instanceof Error ? err.stack : err);
  process.exit(1);
});