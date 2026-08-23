import { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { User, IUserDoc } from '../models/User';

export interface AuthRequest extends Request {
  user?: IUserDoc;
}

/** Extract the authenticated user document inside controllers. */
export function getAuthUser(req: Request): IUserDoc {
  const user = (req as AuthRequest).user;
  if (!user) {
    throw new Error('getAuthUser() called on an unauthenticated request');
  }
  return user;
}

/** JWT Bearer guard. Attaches the full user doc to the request. */
export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';

  if (!token) {
    res.status(401).json({ success: false, error: 'Unauthorized: missing bearer token' });
    return;
  }

  try {
    const payload = jwt.verify(token, env.jwtSecret) as { sub?: string };
    if (!payload.sub) {
      res.status(401).json({ success: false, error: 'Unauthorized: invalid token' });
      return;
    }

    const user = await User.findById(payload.sub);
    if (!user) {
      res.status(401).json({ success: false, error: 'Unauthorized: user no longer exists' });
      return;
    }

    (req as AuthRequest).user = user;
    next();
  } catch {
    res.status(401).json({ success: false, error: 'Unauthorized: invalid or expired token' });
  }
}
