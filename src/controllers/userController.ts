import { Request, Response } from 'express';
import { User } from '../models/User';
import { getAuthUser } from '../middleware/auth';
import { serializeUser } from '../utils/serialize';
import { ApiError, asyncHandler } from '../utils/http';

const MAX_AVATAR_BYTES = 3 * 1024 * 1024; // 3 MB decoded

/** PATCH /api/users/profile { name?, bio?, phoneNumber?, location? } */
export const updateProfile = asyncHandler(async (req: Request, res: Response) => {
  const user = getAuthUser(req);
  const body = (req.body || {}) as Record<string, unknown>;

  if (typeof body.name === 'string' && body.name.trim()) user.name = body.name.trim();
  if (typeof body.bio === 'string') user.bio = body.bio;
  if (typeof body.phoneNumber === 'string') user.phoneNumber = body.phoneNumber;
  if (typeof body.location === 'string') user.location = body.location;

  await user.save();

  // Re-fetch so the serialized doc reflects saved values.
  const fresh = (await User.findById(user._id)) as typeof user;
  res.json({ success: true, data: { user: serializeUser(fresh) } });
});

/**
 * POST /api/users/profile/avatar { image }
 * `image` is a base64 string or a full data URI. Stored as a data URI in
 * `profileImage` and returned as part of the user payload.
 */
export const uploadAvatar = asyncHandler(async (req: Request, res: Response) => {
  const user = getAuthUser(req);
  const body = (req.body || {}) as { image?: string };

  let image = String(body.image || '').trim();
  if (!image) throw new ApiError(400, 'image is required');

  const isDataUri = image.startsWith('data:image/');
  const base64Part = isDataUri ? image.slice(image.indexOf(',') + 1) : image;

  if (!/^[A-Za-z0-9+/=\r\n]+$/.test(base64Part)) {
    throw new ApiError(400, 'image must be base64-encoded');
  }

  const decodedBytes = Math.floor((base64Part.length * 3) / 4);
  if (decodedBytes > MAX_AVATAR_BYTES) {
    throw new ApiError(413, 'Image too large — keep it under 3 MB');
  }

  user.profileImage = isDataUri ? image : `data:image/jpeg;base64,${base64Part}`;
  await user.save();

  const fresh = (await User.findById(user._id)) as typeof user;
  res.json({ success: true, data: { user: serializeUser(fresh), profileImage: fresh.profileImage } });
});
