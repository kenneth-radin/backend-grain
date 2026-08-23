import { Request, Response } from 'express';
import { computeAnalyticsOverview } from '../services/analytics';
import { AnalyticsPeriod } from '../services/analytics';
import { asyncHandler } from '../utils/http';

/** GET /api/analytics/overview?period=daily|weekly|monthly */
export const overview = asyncHandler(async (req: Request, res: Response) => {
  const raw = typeof req.query.period === 'string' ? req.query.period.toLowerCase() : 'daily';
  const period: AnalyticsPeriod =
    raw === 'weekly' || raw === 'monthly' ? (raw as AnalyticsPeriod) : 'daily';

  const data = await computeAnalyticsOverview(period);
  res.json({ success: true, data });
});
