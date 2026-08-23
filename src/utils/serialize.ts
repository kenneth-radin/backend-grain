import { IUserDoc } from '../models/User';

/**
 * Serialize a user WITHOUT the password hash — exactly the shape the mobile
 * app expects.
 */
export function serializeUser(user: IUserDoc): Record<string, unknown> {
  return {
    _id: user._id,
    name: user.name,
    email: user.email,
    role: user.role,
    profileImage: user.profileImage ?? null,
    bio: user.bio ?? null,
    phoneNumber: user.phoneNumber ?? null,
    location: user.location ?? null,
    pushToken: user.pushToken ?? null,
    createdAt: user.createdAt
  };
}
