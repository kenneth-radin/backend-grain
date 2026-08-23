import { Request, Response } from 'express';
import { SensorDatum } from '../models/SensorDatum';
import { Device } from '../models/Device';
import { mirrorDeviceReading } from '../config/firebase';
import { createAlert } from '../services/notificationService';
import { refreshLatestForDevice } from '../services/predictionService';
import { env } from '../config/env';
import { ApiError, asyncHandler, clamp, parseIntParam } from '../utils/http';

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
          'runtimeState.lastHeartbeat': now
        }
      },
      { upsert: true }
    )
  ]);

  // Optional RTDB mirror (fire-and-forget).
  mirrorDeviceReading(deviceId, temperature, humidity, status);

  // Continuous AI prediction refresh (fire-and-forget, throttled internally so
  // frequent ESP posts do not spam predictions).
  void refreshLatestForDevice(deviceId);

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
