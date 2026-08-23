/**
 * One-shot end-to-end smoke test using an in-memory MongoDB.
 * Run: npm run smoke
 */
import { MongoMemoryServer } from 'mongodb-memory-server';

async function main(): Promise<void> {
  console.log('[smoke] Starting in-memory MongoDB...');
  const mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri('grain-smoke');
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'smoke-test-secret-smoke-test-secret';
  process.env.PORT = '8095';

  const { connectDB, disconnectDB } = await import('../src/config/db');
  const { createApp } = await import('../src/app');

  await connectDB();
  const app = createApp();
  const server = app.listen(process.env.PORT);
  const base = `http://localhost:${process.env.PORT}/api`;

  let failures = 0;
  async function check(name: string, fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
      console.log(`[smoke] PASS  ${name}`);
    } catch (err) {
      failures++;
      console.error(`[smoke] FAIL  ${name}:`, err instanceof Error ? err.message : err);
    }
  }

  function assert(cond: unknown, msg: string): void {
    if (!cond) throw new Error(msg);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const j = async (res: Response): Promise<any> => res.json();
  let token = '';
  let notificationId = '';

  await check('GET /api/health → 200', async () => {
    const res = await fetch(`${base}/health`);
    assert(res.status === 200, `status ${res.status}`);
    const body = await j(res);
    assert(body.success === true && body.db === 'connected', JSON.stringify(body));
  });

  await check('POST /api/auth/register → accessToken + user (no hash)', async () => {
    const res = await fetch(`${base}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Juan Farmer', email: 'juan@grain.local', password: 'secret123' })
    });
    assert(res.status === 201, `status ${res.status}`);
    const body = await j(res);
    assert(body.data.accessToken, 'no accessToken');
    assert(!('passwordHash' in body.data.user), 'passwordHash leaked!');
    assert(body.data.user.email === 'juan@grain.local', 'wrong email');
    token = body.data.accessToken;
  });

  await check('POST /api/auth/login → user', async () => {
    const res = await fetch(`${base}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'juan@grain.local', password: 'secret123' })
    });
    assert(res.status === 200, `status ${res.status}`);
    assert((await j(res)).data.user.name === 'Juan Farmer', 'bad user');
  });

  await check('POST /api/sensors/data (extra fields silently dropped)', async () => {
    const res = await fetch(`${base}/sensors/data`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deviceId: 'GR-001', temperature: 47.5, humidity: 61.2, status: 'running',
        moisture: 12.3, weight: 99, batteryVoltage: 3.7 // must be dropped
      })
    });
    assert(res.status === 200, `status ${res.status}`);
    const body = await j(res);
    assert(body.accepted === true && body.data.accepted === true, JSON.stringify(body));
  });

  await check('Device auto-provisioned online with DHT22 live values', async () => {
    const res = await fetch(`${base}/devices`, { headers: { Authorization: `Bearer ${token}` } });
    const dev = (await j(res)).data.find((d: any) => d.deviceId === 'GR-001');
    assert(dev, 'GR-001 not in device list');
    assert(dev.isOnline === true, 'device not online');
    assert(dev.runtimeState.currentTemperature === 47.5, 'temp missing');
    assert(dev.runtimeState.currentHumidity === 61.2, 'humidity missing');
  });

  await check('GET /api/sensors/GR-001 paged history', async () => {
    const res = await fetch(`${base}/sensors/GR-001?page=1&limit=10`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const body = await j(res);
    assert(body.data.length === 1 && body.pagination.total === 1, JSON.stringify(body.pagination));
    assert(body.data[0].temperature === 47.5, 'bad temperature');
  });

  let sessionId = '';
  await check('POST /api/commands START:AUTO:45:80 parses + enqueues', async () => {
    const res = await fetch(`${base}/commands`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ deviceId: 'GR-001', command: 'START:AUTO:45:80' })
    });
    assert(res.status === 201, `status ${res.status}`);
    const c = (await j(res)).data;
    assert(c.status === 'pending', 'not pending');
    assert(c.parameters.mode === 'AUTO' && c.parameters.temperature === 45 && c.parameters.fanSpeed === 80, JSON.stringify(c.parameters));
  });

  await check('GET /api/commands/GR-001 (ESP poll) marks polled', async () => {
    assert((await fetch(`${base}/commands/GR-001`)).status === 200, 'poll failed');
    const dev = (await j(await fetch(`${base}/devices`, { headers: { Authorization: `Bearer ${token}` } }))).data.find((d: any) => d.deviceId === 'GR-001');
    assert(dev.runtimeState.commandStatus === 'polled', `commandStatus=${dev.runtimeState.commandStatus}`);
  });

  await check('Dryer fallback endpoints update runtimeState', async () => {
    const auth = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
    assert((await fetch(`${base}/dryer/GR-001/start`, { method: 'POST', headers: auth, body: '{"mode":"MANUAL","temperature":50}' })).status === 201, 'start failed');
    assert((await fetch(`${base}/dryer/GR-001/fan`, { method: 'POST', headers: auth, body: '{"fanTarget":"FAN1","fanAction":"ON"}' })).status === 201, 'fan failed');
    assert((await fetch(`${base}/dryer/GR-001/stepper`, { method: 'POST', headers: auth, body: '{"stepperAction":"CW"}' })).status === 201, 'stepper failed');
    assert((await fetch(`${base}/dryer/GR-001/relay`, { method: 'POST', headers: auth, body: '{"relayAction":"ON"}' })).status === 201, 'relay failed');
    assert((await fetch(`${base}/dryer/GR-001/heater`, { method: 'POST', headers: auth, body: '{"heaterAction":"OFF"}' })).status === 201, 'heater failed');
    assert((await fetch(`${base}/dryer/GR-001/stop`, { method: 'POST', headers: auth })).status === 201, 'stop failed');
  });

  await check('Sessions: create → active; complete → stats', async () => {
    const created = await j(await fetch(`${base}/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ deviceId: 'GR-001', grainType: 'rice' })
    }));
    sessionId = created.data._id;
    assert(created.data.status === 'active', 'not active');

    const activeList = await j(await fetch(`${base}/sessions?status=active`, { headers: { Authorization: `Bearer ${token}` } }));
    assert(activeList.data.length >= 1, '?status=active found nothing');

    // Ingest readings DURING the session window (realistic flow).
    for (const [t, h] of [[45, 58], [50, 62]] as const) {
      await fetch(`${base}/sensors/data`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId: 'GR-001', temperature: t, humidity: h })
      });
    }

    const done = await j(await fetch(`${base}/sessions/${sessionId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: '{"action":"complete"}'
    }));
    assert(done.data.status === 'completed', 'not completed');
    assert(done.data.avgTemperature === 47.5, `avgTemperature=${done.data.avgTemperature}`);
    assert(done.data.avgHumidity === 60, 'avgHumidity wrong');
    assert(done.data.dataPoints === 2, 'dataPoints wrong');
    assert(typeof done.data.duration === 'number', 'duration missing');
    assert(done.data.efficiency === 100, `efficiency=${done.data.efficiency}`);

    const notifBody = await j(await fetch(`${base}/notifications`, { headers: { Authorization: `Bearer ${token}` } }));
    assert(notifBody.data.some((n: any) => n.type === 'drying_complete'), 'drying_complete notification missing');
    notificationId = notifBody.data[0]._id;
  });

  await check('AI predictions: fallback pipeline + throttle + route', async () => {
    // Active AI-test session on its own device. Backdated 28h so its
    // readings never land in *today's* analytics buckets (checked later).
    const aiStart = new Date(Date.now() - 28 * 3_600_000);
    const { DryingSession } = await import('../src/models/DryingSession');
    const { SensorDatum } = await import('../src/models/SensorDatum');
    const { Prediction } = await import('../src/models/Prediction');
    const { refreshLatestForDevice } = await import('../src/services/predictionService');
    const { completionRhThreshold } = await import('../src/services/emc');

    const aiUser = await j(await fetch(`${base}/auth/me`, { headers: { Authorization: `Bearer ${token}` } }));
    const aiSession = await DryingSession.create({
      deviceId: 'GR-AI',
      userId: aiUser.data.user._id,
      grainType: 'rice',
      status: 'active',
      startedAt: aiStart
    });

    // Decaying exhaust-RH signature toward the equilibrium threshold at 46°C.
    const threshold = completionRhThreshold(46, 14);
    const docs = [];
    for (let t = 0; t <= 180; t += 5) {
      docs.push({
        deviceId: 'GR-AI',
        temperature: 46,
        humidity: Math.min(95, threshold + 28 * Math.exp(-0.007 * t)),
        status: 'running',
        timestamp: new Date(aiStart.getTime() + t * 60_000)
      });
    }
    await SensorDatum.insertMany(docs);

    await refreshLatestForDevice('GR-AI');
    let count = await Prediction.countDocuments({ sessionId: aiSession._id });
    assert(count === 1, `expected 1 prediction, got ${count}`);
    const pred = await Prediction.findOne({ sessionId: aiSession._id }).lean();
    assert(pred!.source === 'physics_fallback', `source=${pred!.source}`);
    assert(
      pred!.remainingMinutes >= 300 && pred!.remainingMinutes <= 500,
      `remainingMinutes=${pred!.remainingMinutes} outside plausible band`
    );

    await refreshLatestForDevice('GR-AI'); // throttled
    count = await Prediction.countDocuments({ sessionId: aiSession._id });
    assert(count === 1, `throttle failed, got ${count}`);

    const res = await fetch(`${base}/predictions/${aiSession._id}?history=true`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    assert(res.status === 200, `route status ${res.status}`);
    const body = await j(res);
    assert(body.success === true && !!body.data.latest?.estimatedCompletionAt, 'route payload wrong');
  });

  await check('PATCH /api/notifications → unreadCount 0', async () => {
    const list = await j(await fetch(`${base}/notifications`, { headers: { Authorization: `Bearer ${token}` } }));
    const allIds = list.data.map((n: any) => n._id);
    const res = await fetch(`${base}/notifications`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ ids: allIds })
    });
    assert(res.status === 200, `status ${res.status}`);
    assert((await j(res)).unreadCount === 0, 'unreadCount not 0');
  });

  await check('Analytics overview trends + cycles', async () => {
    const body = (await j(await fetch(`${base}/analytics/overview?period=daily`, { headers: { Authorization: `Bearer ${token}` } }))).data;
    assert(body.temperatureTrend.length === 7 && body.humidityTrend.length === 7 && body.dryingCycles.length === 7, 'bucket counts wrong');
    assert(body.temperatureTrend[6].value === 47.5, `today avg=${body.temperatureTrend[6].value}`);
    assert(body.dryingCycles[6].value === 1, 'cycle count wrong');
  });

  await check('Alerts list + clear', async () => {
    assert((await fetch(`${base}/alerts`, { headers: { Authorization: `Bearer ${token}` } })).status === 200, 'list failed');
    assert((await fetch(`${base}/alerts`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } })).status === 200, 'clear failed');
  });

  await check('Assistant chat local fallback replies', async () => {
    const res = await fetch(`${base}/v1/assistant/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'What temperature for rice?' }], language: 'EN' })
    });
    assert(res.status === 200, `status ${res.status}`);
    const reply = (await j(res)).data.reply;
    assert(typeof reply === 'string' && reply.toLowerCase().includes('rice'), `bad reply: ${reply}`);
  });

  await check('FCM token save/remove + legacy push token', async () => {
    const auth = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
    assert((await fetch(`${base}/notifications/fcm-token`, { method: 'POST', headers: auth, body: '{"token":"fcm-token-123","platform":"android"}' })).status === 200, 'fcm save failed');
    assert((await fetch(`${base}/push/token`, { method: 'POST', headers: auth, body: '{"pushToken":"expo-push-xyz"}' })).status === 200, 'legacy push failed');
    const me = await j(await fetch(`${base}/auth/me`, { headers: { Authorization: `Bearer ${token}` } }));
    assert(me.data.user.pushToken === 'expo-push-xyz', 'pushToken not stored');
    assert((await fetch(`${base}/notifications/fcm-token`, { method: 'DELETE', headers: auth, body: '{"token":"fcm-token-123"}' })).status === 200, 'fcm remove failed');
  });

  await check('Auth guard rejects missing token with 401', async () => {
    assert((await fetch(`${base}/devices`)).status === 401, 'expected 401');
  });

  server.close();
  await disconnectDB();
  await mongod.stop();

  if (failures > 0) {
    console.error(`\n[smoke] ${failures} check(s) FAILED`);
    process.exit(1);
  }
  console.log('\n[smoke] ALL CHECKS PASSED ✅');
  process.exit(0);
}
main().catch((err) => {
  console.error('[smoke] fatal:', err instanceof Error ? err.stack : err);
  process.exit(1);
});
