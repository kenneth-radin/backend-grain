import { Request, Response } from 'express';
import { DryingSession } from '../models/DryingSession';
import { Prediction } from '../models/Prediction';
import { getAuthUser } from '../middleware/auth';
import { ApiError, asyncHandler, clamp, parseIntParam } from '../utils/http';

/**
 * GET /api/predictions/:sessionId?history=true&limit=20
 *
 * Latest AI prediction for a drying session (+ optional prediction history).
 * Only the session owner or an admin may read it.
 */
export const getSessionPredictions = asyncHandler(async (req: Request, res: Response) => {
  const user = getAuthUser(req);
  const { sessionId } = req.params;

  const session = await DryingSession.findById(sessionId).lean();
  if (!session) throw new ApiError(404, 'Session not found');
  if (String(session.userId) !== String(user._id) && user.role !== 'admin') {
    throw new ApiError(403, 'Not allowed to view predictions for this session');
  }

  const wantHistory = req.query.history === 'true';
  const limit = clamp(parseIntParam(req.query.limit, 20), 1, 200);

  const latest = await Prediction.findOne({ sessionId }).sort({ createdAt: -1 }).lean();
  const history = wantHistory
    ? await Prediction.find({ sessionId }).sort({ createdAt: -1 }).limit(limit).lean()
    : [];

  res.json({ success: true, data: { latest, history } });
});