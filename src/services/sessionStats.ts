import { IDryingSessionDoc } from '../models/DryingSession';
import { SensorDatum } from '../models/SensorDatum';
import { Device } from '../models/Device';
import { round1 } from '../utils/http';

/** Ideal DHT22 drying band (deg C) used for the efficiency metric. */
const IDEAL_TEMP_MIN = 40;
const IDEAL_TEMP_MAX = 60;

/**
 * Recomputes session statistics from SensorData in the session window:
 * averages, data point count, duration (s) and efficiency (% of samples with
 * temperature inside the ideal drying band).
 */
export async function finalizeSession(
  session: IDryingSessionDoc,
  status: 'completed' | 'aborted'
): Promise<IDryingSessionDoc> {
  const completedAt = new Date();
  const startedAt = new Date(session.startedAt);

  const samples = await SensorDatum.find({
    deviceId: session.deviceId,
    timestamp: { $gte: startedAt, $lte: completedAt }
  })
    .select('temperature humidity')
    .lean();

  const dataPoints = samples.length;
  const avgTemperature =
    dataPoints > 0
      ? round1(samples.reduce((sum, s) => sum + Number(s.temperature || 0), 0) / dataPoints)
      : round1(Number(session.avgTemperature || 0));
  const avgHumidity =
    dataPoints > 0
      ? round1(samples.reduce((sum, s) => sum + Number(s.humidity || 0), 0) / dataPoints)
      : round1(Number(session.avgHumidity || 0));

  const inIdealBand = samples.filter((s) => {
    const t = Number(s.temperature || 0);
    return t >= IDEAL_TEMP_MIN && t <= IDEAL_TEMP_MAX;
  }).length;

  const efficiency = dataPoints > 0 ? Math.round((inIdealBand / dataPoints) * 100) : 0;
  const duration = Math.max(0, Math.round((completedAt.getTime() - startedAt.getTime()) / 1000)); // seconds

  session.status = status;
  session.completedAt = completedAt;
  session.avgTemperature = avgTemperature;
  session.avgHumidity = avgHumidity;
  session.dataPoints = dataPoints;
  session.efficiency = efficiency;
  session.duration = duration;
  await session.save();

  await Device.updateOne({ deviceId: session.deviceId }, { $set: { 'runtimeState.isRunning': false } });

  return session;
}

export async function ensureDeviceExists(deviceId: string): Promise<void> {
  await Device.updateOne(
    { deviceId },
    { $setOnInsert: { deviceId, location: 'Unspecified', status: 'offline', isOnline: false } },
    { upsert: true }
  );
}
