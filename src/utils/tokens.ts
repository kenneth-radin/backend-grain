import jwt from 'jsonwebtoken';
import { SignOptions } from 'jsonwebtoken';
import { env } from '../config/env';

/** Signs a JWT access token for a user id. */
export function signAccessToken(userId: string): string {
  const options: SignOptions = {
    expiresIn: env.jwtExpiresIn as unknown as SignOptions['expiresIn']
  };
  return jwt.sign({ sub: String(userId) }, env.jwtSecret, options);
}
