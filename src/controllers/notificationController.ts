import { Request, Response } from 'express';
import { NotificationItem } from '../models/NotificationItem';
import { User } from '../models/User';
import { getAuthUser } from '../middleware/auth';
import { ApiError, asyncHandler, clamp, parseIntParam } from '../utils/http';

/** GET /api/notifications?page=&limit=&unread= */
export const listNotifications = asyncHandler(async (req: Request, res: Response) => {
  const user = getAuthUser(req);
  const page = Math.max(1, parseIntParam(req.query.page, 1));
  const limit = clamp(parseIntParam(req.query.limit, 20), 1, 100);

  const filter: Record<string, unknown> = { userId: user._id };
  if (req.query.unread === 'true') filter.isRead = false;

  const [total, docs, unreadCount] = await Promise.all([
    NotificationItem.countDocuments(filter),
    NotificationItem.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    NotificationItem.countDocuments({ userId: user._id, isRead: false })
  ]);

  res.json({
    success: true,
    data: docs,
    unreadCount,
    pagination: { total, page, totalPages: Math.max(1, Math.ceil(total / limit)) }
  });
});

/** PATCH /api/notifications { ids?: string[] } or { markAll: true } → { unreadCount } */
export const markNotificationsRead = asyncHandler(async (req: Request, res: Response) => {
  const user = getAuthUser(req);
  const body = (req.body || {}) as { ids?: string[]; markAll?: boolean };

  const validIds = (Array.isArray(body.ids) ? body.ids : [])
    .filter((id): id is string => typeof id === 'string' && /^[0-9a-fA-F]{24}$/.test(id));

  if (validIds.length > 0) {
    await NotificationItem.updateMany(
      { _id: { $in: validIds }, userId: user._id },
      { $set: { isRead: true } }
    );
  } else if (body.markAll === true) {
    await NotificationItem.updateMany({ userId: user._id }, { $set: { isRead: true } });
  } else {
    throw new ApiError(400, 'Provide { ids: [...] } or { markAll: true }');
  }

  const unreadCount = await NotificationItem.countDocuments({ userId: user._id, isRead: false });
  // Top-level AND nested so either parsing style works.
  res.json({ success: true, unreadCount, data: { unreadCount } });
});

/** POST /api/notifications/fcm-token { token, platform } */
export const saveFcmToken = asyncHandler(async (req: Request, res: Response) => {
  const user = getAuthUser(req);
  const body = (req.body || {}) as { token?: string; platform?: string };

  const token = String(body.token || '').trim();
  if (!token) throw new ApiError(400, 'token is required');

  await User.updateOne({ _id: user._id }, { $set: { pushToken: token } });

  res.json({
    success: true,
    data: {
      saved: true,
      platform: ['android', 'ios', 'web'].includes(String(body.platform)) ? body.platform : 'unknown'
    }
  });
});

/** DELETE /api/notifications/fcm-token { token } */
export const removeFcmToken = asyncHandler(async (req: Request, res: Response) => {
  const user = getAuthUser(req);
  const body = (req.body || {}) as { token?: string };
  const token = String(body.token || '').trim();

  if (!token) throw new ApiError(400, 'token is required');

  // Only clear it if it belongs to this user.
  if (user.pushToken === token) {
    await User.updateOne({ _id: user._id }, { $unset: { pushToken: '' } });
  }

  res.json({ success: true, data: { removed: true } });
});
