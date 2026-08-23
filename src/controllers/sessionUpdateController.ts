import { Request, Response } from 'express';
import { DryingSession } from '../models/DryingSession';
import { getAuthUser } from '../middleware/auth';
import { notifyUser } from '../services/notificationService';
import { finalizeSession } from '../services/sessionStats';
import { ApiError, asyncHandler } from '../utils/http';

/** PATCH /api/sessions/:id { action: 'complete' | 'abort' } */
export const updateSession = asyncHandler(async (req: Request, res: Response) => {
  const user = getAuthUser(req);
  const action = String(((req.body || {}) as { action?: string }).action || '').toLowerCase();

  if (action !== 'complete' && action !== 'abort') {
    throw new ApiError(400, "action must be 'complete' or 'abort'");
  }

  const session = await DryingSession.findById(req.params.id);
  if (!session) throw new ApiError(404, 'Session not found');

  const isOwner = String(session.userId) === String(user._id);
  if (!isOwner && user.role !== 'admin') throw new ApiError(403, 'Not allowed to modify this session');

  if (session.status !== 'active') {
    res.json({ success: true, data: session.toJSON() });
    return;
  }

  const finalized = await finalizeSession(session, action === 'complete' ? 'completed' : 'aborted');

  void notifyUser({
    userId: user._id as never,
    deviceId: session.deviceId,
    type: action === 'complete' ? 'drying_complete' : 'session_aborted',
    title: action === 'complete' ? 'Drying complete' : 'Drying aborted',
    body:
      action === 'complete'
        ? `Session on ${session.deviceId} finished — avg ${finalized.avgTemperature}°C, efficiency ${finalized.efficiency}%.`
        : `Session on ${session.deviceId} was aborted.`
  });

  res.json({ success: true, data: finalized.toJSON() });
});
