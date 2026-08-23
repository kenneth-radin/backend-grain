/**
 * Export completed drying sessions + their DHT22 readings to the CSV schema
 * that ml/train.py expects, so real experimental trials can replace the
 * synthetic training data with one command.
 *
 * Usage:  npm run export-training-data -- [--min-points 30]
 * Output: ml/data/exported_sessions.csv
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import { SensorDatum } from '../src/models/SensorDatum';
import { DryingSession } from '../src/models/DryingSession';

const uri = (process.env.MONGODB_URI || '').trim();
if (!uri) {
  console.error('[export] MONGODB_URI not set');
  process.exit(1);
}

const minPoints = Math.max(
  1,
  parseInt(process.argv[process.argv.indexOf('--min-points') + 1] || '30', 10)
);
const outPath = 'ml/data/exported_sessions.csv';

async function main(): Promise<void> {
  console.log('[export] Connecting…');
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 20_000 });
  console.log('[export] Connected.');

  const sessions = await DryingSession.find({ status: 'completed' }).lean();
  console.log(`[export] Found ${sessions.length} completed session(s).`);

  const lines: string[] = ['sessionId,elapsedMinutes,temperature,humidity'];
  let included = 0;
  const skipped: string[] = [];

  for (const s of sessions) {
    const readings = await SensorDatum.find({
      deviceId: s.deviceId,
      timestamp: { $gte: s.startedAt, $lte: s.completedAt ?? new Date(0) }
    })
      .sort({ timestamp: 1 })
      .lean();

    if (readings.length < minPoints) {
      skipped.push(`${s._id} (${readings.length} pts)`);
      continue;
    }

    for (const r of readings) {
      const elapsed = (r.timestamp.getTime() - new Date(s.startedAt).getTime()) / 60_000;
      lines.push(
        [s._id.toString(), elapsed.toFixed(2), r.temperature, r.humidity].join(',')
      );
    }
    included++;
  }

  await import('fs').then((fs) =>
    fs.promises.writeFile(outPath, lines.join('\n'), 'utf8')
  );

  console.log(`[export] Wrote ${included} session(s), ${lines.length - 1} rows → ${outPath}`);
  if (skipped.length) {
    console.log(`[export] Skipped ${skipped.length} session(s) under ${minPoints} points:`);
    for (const id of skipped) console.log(`   - ${id}`);
  }

  await mongoose.disconnect();
  process.exit(0);
}

main().catch(async (err) => {
  console.error('[export] FAILED:', err instanceof Error ? err.message : err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
