import { Request, Response } from 'express';
import { Device, IDeviceDoc } from '../models/Device';
import { env } from '../config/env';
import { ApiError, asyncHandler } from '../utils/http';

function isStale(device: Pick<IDeviceDoc, 'isOnline' | 'lastSeen'>): boolean {
  return Boolean(device.isOnline) && Date.now() - new Date(device.lastSeen).getTime() > env.deviceOfflineAfterMs;
}

/** Decorate a device doc: report stale devices as offline (and persist it lazily). */
function decorate(doc: Record<string, unknown>): Record<string, unknown> {
  const device = { ...(doc as Record<string, unknown>) };
  if (isStale(doc as never)) {
    device.status = 'offline';
    device.isOnline = false;
    void Device.updateOne(
      { _id: (doc as { _id: unknown })._id },
      { $set: { status: 'offline', isOnline: false } }
    ).catch(() => undefined);
  }
  return device;
}

/** GET /api/devices */
export const listDevices = asyncHandler(async (_req: Request, res: Response) => {
  const docs = await Device.find({}).sort({ deviceId: 1 }).lean();
  res.json({ success: true, data: docs.map((d) => decorate(d)) });
});

/** GET /api/devices/:id — accepts Mongo _id OR the string deviceId. */
export const getDevice = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;

  let doc =
    /^[0-9a-fA-F]{24}$/.test(id)
      ? await Device.findById(id).lean()
      : await Device.findOne({ deviceId: id }).lean();

  if (!doc && !/^[0-9a-fA-F]{24}$/.test(id)) {
    doc = null;
  }

  if (!doc) {
    throw new ApiError(404, `Device not found: ${id}`);
  }

  res.json({ success: true, data: { device: decorate(doc) } });
});

/** POST /api/devices { deviceId, location, name? } */
export const createDevice = asyncHandler(async (req: Request, res: Response) => {
  const body = (req.body || {}) as { deviceId?: string; location?: string; name?: string };

  const deviceId = String(body.deviceId || '').trim();
  const location = String(body.location || '').trim();

  if (!deviceId) throw new ApiError(400, 'deviceId is required');
  if (!location) throw new ApiError(400, 'location is required');

  // Idempotent create: re-registering an existing deviceId returns the device.
  const existing = await Device.findOne({ deviceId }).lean();
  if (existing) {
    res.status(200).json({ success: true, data: decorate(existing) });
    return;
  }

  const created = await Device.create({
    deviceId,
    location,
    name: body.name ? String(body.name).trim() : undefined,
    status: 'offline',
    isOnline: false
  });

  res.status(201).json({ success: true, data: created.toJSON() });
});
