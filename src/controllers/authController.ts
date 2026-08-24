import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { User } from '../models/User';
import { ResetToken } from '../models/ResetToken';
import { serializeUser } from '../utils/serialize';
import { signAccessToken } from '../utils/tokens';
import { ApiError, asyncHandler } from '../utils/http';
import { env } from '../config/env';


/** POST /api/auth/register */
export const register = asyncHandler(async (req: Request, res: Response) => {
  const body = (req.body || {}) as {
    name?: string;
    email?: string;
    password?: string;
    role?: string;
  };

  const name = String(body.name || '').trim();
  const email = String(body.email || '').trim().toLowerCase();
  const password = typeof body.password === 'string' ? body.password : '';

  if (!name || !email || !password) {
    throw new ApiError(400, 'name, email and password are required');
  }
  if (!/^\S+@\S+\.\S+$/.test(email)) {
    throw new ApiError(400, 'Please provide a valid email address');
  }
  if (password.length < 6) {
    throw new ApiError(400, 'Password must be at least 6 characters');
  }

  const existing = await User.findOne({ email }).lean();
  if (existing) {
    throw new ApiError(409, 'An account with this email already exists');
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await User.create({
    name,
    email,
    passwordHash,
    role: body.role === 'admin' ? 'admin' : 'farmer'
  });

  const accessToken = signAccessToken(String(user._id));
  res.status(201).json({
    success: true,
    data: { accessToken, user: serializeUser(user) }
  });
});

/** POST /api/auth/login */
export const login = asyncHandler(async (req: Request, res: Response) => {
  const body = (req.body || {}) as { email?: string; password?: string };

  const email = String(body.email || '').trim().toLowerCase();
  const password = typeof body.password === 'string' ? body.password : '';

  if (!email || !password) {
    throw new ApiError(400, 'email and password are required');
  }

  const user = await User.findOne({ email });
  if (!user) {
    throw new ApiError(401, 'Invalid email or password');
  }

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) {
    throw new ApiError(401, 'Invalid email or password');
  }

  const accessToken = signAccessToken(String(user._id));
  res.json({
    success: true,
    data: { accessToken, user: serializeUser(user) }
  });
});

/** GET /api/auth/me */
export const me = asyncHandler(async (req: Request, res: Response) => {
  const { getAuthUser } = await import('../middleware/auth');
  res.json({ success: true, data: { user: serializeUser(getAuthUser(req)) } });
});

/** POST /api/auth/logout — client drops the token; nothing to invalidate. */
export const logout = asyncHandler(async (_req: Request, res: Response) => {
  res.json({ success: true, data: { message: 'Logged out' } });
});

/** POST /api/auth/forgot — generate a reset token for the given email. */
export const forgot = asyncHandler(async (req: Request, res: Response) => {
  const { email } = (req.body || {}) as { email?: string };

  if (!email || !/^\S+@\S+\.\S+$/.test(String(email).trim().toLowerCase())) {
    throw new ApiError(400, 'A valid email address is required');
  }

  const normalizedEmail = String(email).trim().toLowerCase();
  const user = await User.findOne({ email: normalizedEmail }).lean();

  // Always return the same response shape to avoid leaking which emails are registered.
  if (!user) {
    res.status(200).json({
      success: true,
      data: { message: 'If that email is registered, a reset link has been sent.' }
    });
    return;
  }

  // Generate cryptographically-secure token.
  const token = crypto.randomBytes(32).toString('hex');

  // Store token (TTL index auto-deletes after 1 hour).
  await ResetToken.create({ token, userId: user._id });

    // Build a reset URL the client can surface to the user.
  const resetUrl = `${env.appUrl}/reset-password?token=${token}`;

  res.status(200).json({
    success: true,
    data: {
      message: 'If that email is registered, a reset link has been sent.',
      // Only return if the user exists — used to show a deep link to the user.
      resetToken: user ? token : undefined,
      resetUrl: user ? resetUrl : undefined
    }
  });
});

/** POST /api/auth/reset — consume a token and set a new password. */
export const reset = asyncHandler(async (req: Request, res: Response) => {
  const { token, password } = (req.body || {}) as { token?: string; password?: string };

  if (!token || !password) {
    throw new ApiError(400, 'Token and new password are required');
  }
  if (password.length < 6) {
    throw new ApiError(400, 'Password must be at least 6 characters');
  }

  // Find token with non-expired TTL (MongoDB handles actual expiry, but double-check).
  const resetToken = await ResetToken.findOne({ token }).exec();
  if (!resetToken) {
    throw new ApiError(400, 'Invalid or expired reset token');
  }

  // Update the user's password.
  const passwordHash = await bcrypt.hash(password, 10);
  await User.findByIdAndUpdate(resetToken.userId, { passwordHash });

  // Delete the used token (single-use).
  await ResetToken.deleteOne({ _id: resetToken._id });

  res.json({
    success: true,
    data: { message: 'Password has been reset successfully.' }
  });
});
