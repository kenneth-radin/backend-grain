import { NextFunction, Request, Response } from 'express';
import { Device } from '../models/Device';
import { ApiError } from '../utils/http';

interface DeviceRequest extends Request {
  device?: any;
}

/**
 * Middleware factory: loads the device identified by `getDeviceId(req)`,
 * enforces ownership (or admin bypass), attaches `req.device`.
 *
 * Returns 404 if the device does not exist (no leakage about existence).
 * Returns 403 if the device exists but the caller is neither admin nor owner.
 * Error body contains no device details.
 */
export function requireDeviceOwnership(
  getDeviceId: (req: Request) => string | undefined
) {
  return async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    const deviceId = getDeviceId(req);
    if (!deviceId) {
      res.status(400).json({ success: false, error: 'deviceId is required' });
      return;
    }

    let device;
    if (/^[0-9a-fA-F]{24}$/.test(deviceId)) {
      device = await Device.findById(deviceId).lean();
    } else {
      device = await Device.findOne({ deviceId }).lean();
    }

    if (!device) {
      res.status(404).json({ success: false, error: 'Device not found' });
      return;
    }

    const user = (req as any).user;
    const isAdmin = Boolean(user) && user.role === 'admin';
    const isOwner = Boolean(device.ownerId) && String(device.ownerId) === String(user?._id);

    if (!isAdmin && !isOwner) {
      res.status(403).json({
        success: false,
        error: 'Forbidden: you do not have access to this device'
      });
      return;
    }

    (req as DeviceRequest).device = device;
    next();
  };
}