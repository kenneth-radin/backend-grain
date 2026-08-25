import { Request, Response } from 'express';
import { SensorDatum } from '../models/SensorDatum';
import { Device } from '../models/Device';
import { DryingSession } from '../models/DryingSession';
import { mirrorDeviceReading, mirrorRuntimeState } from '../config/firebase';
import { createAlert } from '../services/notificationService';
import { refreshLatestForDevice } from '../services/predictionService';
import { env } from '../config/env';
import { ApiError, asyncHandler, clamp, parseIntParam, round1 } from '../utils/http';

/**
 * GET /api/sensors/:deviceId?page=1&limit=50&hours=24
 * Paged DHT22 history for one device (newest first).
 */
export const listByDevice = asyncHandler(async (req: Request, res: Response) => {
  const deviceId = req.params.deviceId;
  const page = Math.max(1, parseIntParam(req.query.page, 1));
  const limit = clamp(parseIntParam(req.query.limit, 50), 1, 500);
  const hours = parseIntParam(req.query.hours, 24);

  const filter: Record<string, unknown> = { deviceId };
  if (Number.isFinite(hours) && hours > 0) {
    filter.timestamp = { $gte: new Date(Date.now() - hours * 3_600_000) };
  }

  const [total, docs] = await Promise.all([
    SensorDatum.countDocuments(filter),
    SensorDatum.find(filter)
      .sort({ timestamp: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean()
  ]);

  res.json({
    success: true,
    data: docs,
    pagination: {
      total,
      page,
      totalPages: Math.max(1, Math.ceil(total / limit))
    }
  });
});

/**
 * GET /api/sensors/data — latest reading for every device.
 */
export const latestForAllDevices = asyncHandler(async (_req: Request, res: Response) => {
  const rows = await SensorDatum.aggregate<{
    _id: string;
    docId: unknown;
    temperature: number;
    humidity: number;
    status: string;
    timestamp: Date;
  }>([
    { $sort: { timestamp: -1 } },
    {
      $group: {
        _id: '$deviceId',
        docId: { $first: '$_id' },
        temperature: { $first: '$temperature' },
        humidity: { $first: '$humidity' },
        status: { $first: '$status' },
        timestamp: { $first: '$timestamp' }
      }
    }
  ]);

  const data = rows.map((r) => ({
    _id: r.docId,
    deviceId: r._id,
    temperature: r.temperature,
    humidity: r.humidity,
    status: r.status,
    timestamp: r.timestamp
  }));

  res.json({ success: true, data });
});

/**
 * POST /api/sensors/data — ESP32 ingress (PUBLIC).
 *
 * Body: { deviceId, temperature, humidity, status? }.
 * Extra fields are accepted but silently dropped. Also refreshes the device
 * heartbeat (lastSeen/isOnline) and optionally mirrors to Firebase RTDB.
 */

/**
 * Incrementally update running avg temp/humidity + dataPoints of the active
 * drying session for a device so the dashboard shows LIVE averages (not just
 * values computed at session finalization).
 */
async function updateActiveSessionAverages(
  deviceId: string,
  temperature: number,
  humidity: number
): Promise<void> {
  const active = await DryingSession.findOne({ deviceId, status: 'active' }).lean();
  if (!active) return;
  const n = (active.dataPoints || 0) + 1;
  const prevT = active.avgTemperature || 0;
  const prevH = active.avgHumidity || 0;
  const newAvgT = round1((prevT * (n - 1) + temperature) / n);
  const newAvgH = round1((prevH * (n - 1) + humidity) / n);
  await DryingSession.updateOne(
    { _id: active._id },
    { $set: { avgTemperature: newAvgT, avgHumidity: newAvgH, dataPoints: n } }
  );
}
export const ingestSensorData = asyncHandler(async (req: Request, res: Response) => {
  const body = (req.body || {}) as Record<string, unknown>;

  // Whitelist ONLY the DHT22 fields — everything else is silently ignored.
  const deviceId = typeof body.deviceId === 'string' ? body.deviceId.trim() : '';
  const temperature = Number(body.temperature);
  const humidity = Number(body.humidity);
  const status = typeof body.status === 'string' && body.status.trim() ? body.status.trim() : 'idle';

  if (!deviceId) throw new ApiError(400, 'deviceId is required');
  if (!Number.isFinite(temperature)) throw new ApiError(400, 'temperature must be a number');
  if (!Number.isFinite(humidity)) throw new ApiError(400, 'humidity must be a number');
  if (temperature < -50 || temperature > 90) throw new ApiError(400, 'temperature out of DHT22 range (-50..90 °C)');
  if (humidity < 0 || humidity > 100) throw new ApiError(400, 'humidity must be 0..100 %');

  const now = new Date();

  // The UNO reports its ACTUAL run state every sample via S:<running|idle>.
  // Treat it as ground truth ONLY for run/stop transitions: when the hardware
  // transitions running -> idle, clear all relay states (real stop happened).
  // While the system is simply IDLE, relay states are owned by the commands
  // (manual FAN/H1 control) and must NOT be overwritten every 3-second sample,
  // otherwise manual fan/heater toggles get reverted by the next reading.
  const hwOn = status === 'running';
  const devBefore = await Device.findOne({ deviceId }, { runtimeState: 1 }).lean();
  const wasRunning = Boolean(devBefore?.runtimeState?.isRunning);
  const hwSync: Record<string, unknown> = hwOn
    ? {
        'runtimeState.isRunning': true
      }
    : wasRunning
      ? {
          'runtimeState.isRunning': false,
          'runtimeState.heaterState': 'OFF',
          'runtimeState.fan1State': 'OFF',
          'runtimeState.fan2State': 'OFF',
        }
      : {};

  await Promise.all([
    SensorDatum.create({ deviceId, temperature, humidity, status, timestamp: now }),
    Device.updateOne(
      { deviceId },
      {
        $set: {
          lastSeen: now,
          isOnline: true,
          status: 'online',
          'runtimeState.currentTemperature': temperature,
          'runtimeState.currentHumidity': humidity,
          'runtimeState.lastHeartbeat': now,
          ...hwSync
        }
      },
      { upsert: true }
    )
  ]);

  // Optional RTDB mirror (fire-and-forget): live sensors + runtimeState.
  mirrorDeviceReading(deviceId, temperature, humidity, status);
  const devDoc = await Device.findOne({ deviceId }, { runtimeState: 1 }).lean();
  mirrorRuntimeState(deviceId, devDoc?.runtimeState);

  // Continuous AI prediction refresh (fire-and-forget, throttled internally so
  // frequent ESP posts do not spam predictions).
  void refreshLatestForDevice(deviceId);

  // Keep the active session's avg temp/humidity live for the dashboard.
  void updateActiveSessionAverages(deviceId, temperature, humidity);

  // High-temperature safety alert (deduped in notificationService).
  if (temperature >= env.highTempThresholdC) {
    void createAlert({
      deviceId,
      severity: temperature >= env.highTempThresholdC + 10 ? 'error' : 'warning',
      title: 'High drying temperature',
      message: `${deviceId} reported ${temperature}°C — consider reducing heat or increasing fan speed.`
    });
  }

  // Envelope-compatible with both `{ accepted: true }` and `data.data` parsing.
  res.json({ success: true, accepted: true, data: { accepted: true } });
});
