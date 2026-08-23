import { Request, Response } from 'express';
import { AlertItem } from '../models/AlertItem';
import { asyncHandler } from '../utils/http';

/** GET /api/alerts */
export const listAlerts = asyncHandler(async (_req: Request, res: Response) => {
  const alerts = await AlertItem.find({}).sort({ timestamp: -1 }).limit(200).lean();
  res.json({ success: true, data: alerts });
});

/** PATCH /api/alerts/:id/read */
export const markAlertRead = asyncHandler(async (req: Request, res: Response) => {
  await AlertItem.updateOne({ _id: req.params.id }, { $set: { acknowledged: true } });
  const alert = await AlertItem.findById(req.params.id).lean();
  res.json({ success: true, data: { alert } });
});

/** DELETE /api/alerts — clears all alerts. */
export const deleteAllAlerts = asyncHandler(async (_req: Request, res: Response) => {
  const result = await AlertItem.deleteMany({});
  res.json({ success: true, data: { deletedCount: result.deletedCount ?? 0 } });
});
