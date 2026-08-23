import { Router } from 'express';
import { Request, Response } from 'express';
import { User } from '../models/User';
import { requireAuth, getAuthUser } from '../middleware/auth';
import { asyncHandler } from '../utils/http';

const router = Router();

/**
 * POST /api/push/token { pushToken } — legacy endpoint; just stores the token.
 * (Preferred: POST /api/notifications/fcm-token)
 */
router.post(
  '/token',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const user = getAuthUser(req);
    const body = (req.body || {}) as { pushToken?: string };
    const pushToken = String(body.pushToken || '').trim();

    if (!pushToken) {
      res.status(400).json({ success: false, error: 'pushToken is required' });
      return;
    }

    await User.updateOne({ _id: user._id }, { $set: { pushToken } });
    res.json({ success: true, data: { saved: true } });
  })
);

export default router;
