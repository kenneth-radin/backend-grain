import { Request, Response } from 'express';
import { DryingSession } from '../models/DryingSession';
import { getAuthUser } from '../middleware/auth';
import { notifyUser } from '../services/notificationService';
import { finalizeSession, ensureDeviceExists } from '../services/sessionStats';
import { ApiError, asyncHandler, clamp, parseIntParam } from '../utils/http';

/** GET /api/sessions?status=&deviceId=&page=&limit= */
export const listSessions = asyncHandler(async (req: Request, res: Response) => {
  const user = getAuthUser(req);
  const page = Math.max(1, parseIntParam(req.query.page, 1));
  const limit = clamp(parseIntParam(req.query.limit, 20), 1, 200);

  const filter: Record<string, unknown> = { userId: user._id };
  const status = typeof req.query.status === 'string' ? req.query.status.trim() : '';
  if (status) filter.status = status;
  const deviceId = typeof req.query.deviceId === 'string' ? req.query.deviceId.trim() : '';
  if (deviceId) filter.deviceId = deviceId;

  const [total, docs] = await Promise.all([
    DryingSession.countDocuments(filter),
    DryingSession.find(filter).sort({ startedAt: -1 }).skip((page - 1) * limit).limit(limit).lean()
  ]);

  res.json({
    success: true,
    data: docs,
    pagination: { total, page, totalPages: Math.max(1, Math.ceil(total / limit)) }
  });
});

/** GET /api/sessions/:id */
export const getSession = asyncHandler(async (req: Request, res: Response) => {
  const user = getAuthUser(req);
  const session = await DryingSession.findById(req.params.id).lean();
  if (!session) throw new ApiError(404, 'Session not found');

  const isOwner = String(session.userId) === String(user._id);
  if (!isOwner && user.role !== 'admin') throw new ApiError(403, 'Not allowed to view this session');

  res.json({ success: true, data: session });
});

/** POST /api/sessions { deviceId, grainType?, isSimulated? } */
export const createSession = asyncHandler(async (req: Request, res: Response) => {
  const user = getAuthUser(req);
  const body = (req.body || {}) as { deviceId?: string; grainType?: string; isSimulated?: boolean };

  const deviceId = String(body.deviceId || '').trim();
  if (!deviceId) throw new ApiError(400, 'deviceId is required');

  // Guard: one active session per device at a time.
  const active = await DryingSession.findOne({ deviceId, status: 'active' }).lean();
  if (active) {
    res.status(200).json({ success: true, data: active });
    return;
  }

  await ensureDeviceExists(deviceId);

  const grainType = String(body.grainType || 'rice').trim().toLowerCase() || 'rice';

  const session = await DryingSession.create({
    deviceId,
    userId: user._id,
    grainType,
    status: 'active',
    avgTemperature: 0,
    avgHumidity: 0,
    dataPoints: 0,
    startedAt: new Date(),
    isSimulated: Boolean(body.isSimulated)
  });

  void notifyUser({
    userId: user._id as never,
    deviceId,
    type: 'session_started',
    title: 'Drying started',
    body: `A ${grainType} drying session has started on ${deviceId}.`
  });

  res.status(201).json({ success: true, data: session.toJSON() });
});
