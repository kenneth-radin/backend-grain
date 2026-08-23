import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { User } from '../models/User';
import { serializeUser } from '../utils/serialize';
import { signAccessToken } from '../utils/tokens';
import { ApiError, asyncHandler } from '../utils/http';

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
