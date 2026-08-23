/**
 * End-to-end check of the AI prediction pipeline against an in-memory MongoDB:
 * active session -> synthetic decaying-RH DHT22 history -> physics-fallback
 * prediction persisted -> throttling -> GET /api/predictions/:sessionId.
 *
 * Run: npx tsx scripts/predictionSmoke.ts
 */
import { MongoMemoryServer } from 'mongodb-memory-server';

async function main(): Promise<void> {
  console.log('[pred-smoke] Starting in-memory MongoDB...');
  const mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri('grain-pred');
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'pred-smoke-secret-pred-smoke-secret';

  const { connectDB, disconnectDB } = await import('../src/config/db');
  const { createApp } = await import('../src/app');
  const { User } = await import('../src/models/User');
  const { SensorDatum } = await import('../src/models/SensorDatum');
  const { DryingSession } = await import('../src/models/DryingSession');
  const { Prediction } = await import('../src/models/Prediction');
  const { refreshLatestForDevice } = await import('../src/services/predictionService');
  const { completionRhThreshold } = await import('../src/services/emc');

  let failures = 0;
  function assert(cond: unknown, msg: string): void {
    if (!cond) throw new Error(msg);
    console.log(`[pred-smoke] PASS  ${msg}`);
  }

  try {
    await connectDB();
    const app = createApp();
    const server = app.listen(8096);
    const base = 'http://localhost:8096/api';

    // Register a farmer (known-good public endpoint) to own the session.
    const regRes = await fetch(`${base}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Pred Tester', email: 'pred@grain.local', password: 'secret123' })
    });
    assert(regRes.status === 201, `register -> ${regRes.status}`);
    const regBody = (await regRes.json()) as { data: { accessToken: string; user: { _id: string } } };
    const token = regBody.data.accessToken;

    // Active session that started 3 hours ago.
    const startedAt = new Date(Date.now() - 180 * 60_000);
    const session = await DryingSession.create({
      deviceId: 'GR-PRED',
      userId: regBody.data.user._id,
      grainType: 'rice',
      status: 'active',
      startedAt
    });

    // Synthetic DHT22 history: exhaust RH decaying toward the equilibrium
    // threshold at 46 degC / 14% target — realistic drying signature.
    const threshold = completionRhThreshold(46, 14);
    const docs = [];
    for (let t = 0; t <= 180; t += 5) {
      const gap = 28 * Math.exp(-0.007 * t);
      docs.push({
        deviceId: 'GR-PRED',
        temperature: 46,
        humidity: Math.min(95, threshold + gap),
        status: 'running',
        timestamp: new Date(startedAt.getTime() + t * 60_000)
      });
    }
    await SensorDatum.insertMany(docs);
    const rhStart = Math.min(95, threshold + 28).toFixed(1);
    const rhEnd = (threshold + 28 * Math.exp(-0.007 * 180)).toFixed(1);
    console.log(`[pred-smoke] inserted ${docs.length} readings (RH ${rhStart}% -> ${rhEnd}%)`);

    // 1) First refresh creates exactly one prediction via the fallback estimator.
    await refreshLatestForDevice('GR-PRED');
    const count1 = await Prediction.countDocuments({ sessionId: session._id });
    assert(count1 === 1, `first refresh stored exactly 1 prediction (got ${count1})`);
    const pred = await Prediction.findOne({ sessionId: session._id }).lean();
    assert(!!pred, 'prediction document exists');
    assert(pred!.source === 'physics_fallback', 'source is physics_fallback (no ML service configured)');
    assert(
      pred!.remainingMinutes >= 300 && pred!.remainingMinutes <= 500,
      `remainingMinutes=${pred!.remainingMinutes} plausible (~395 expected)`
    );
    assert(pred!.status === 'in_progress', `status=${pred!.status}`);
    assert(pred!.recommendation === 'CONTINUE_DRYING', `recommendation=${pred!.recommendation}`);

    // 2) Immediate second refresh is throttled.
    await refreshLatestForDevice('GR-PRED');
    const count2 = await Prediction.countDocuments({ sessionId: session._id });
    assert(count2 === 1, `throttle prevents duplicate predictions (got ${count2})`);

    // 3) Authenticated read through the new route.
    const res = await fetch(`${base}/predictions/${session._id}?history=true`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    assert(res.status === 200, `GET /predictions/:sessionId -> ${res.status}`);
    const body = (await res.json()) as {
      success: boolean;
      data: { latest: { remainingMinutes: number; estimatedCompletionAt: string } | null; history: unknown[] };
    };
    assert(body.success === true && !!body.data.latest, 'route returns latest prediction');
    assert(body.data.history.length === 1, 'route returns history');

    console.log('\n[pred-smoke] ALL CHECKS PASSED ✅');
    console.log(`[pred-smoke] sample: remaining=${pred!.remainingMinutes}min, ETA=${new Date(body.data.latest!.estimatedCompletionAt).toISOString()}`);
    server.close();
  } finally {
    await disconnectDB();
    await mongod.stop();
  }
  process.exit(failures > 0 ? 1 : 0);
}

void main();