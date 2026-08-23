import mongoose, { Schema } from 'mongoose';

const UserSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true
    },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ['farmer', 'admin'], default: 'farmer' },
    /** Optional URL or data URI. Set via POST /api/users/profile/avatar. */
    profileImage: { type: String },
    bio: { type: String },
    phoneNumber: { type: String },
    location: { type: String },
    pushToken: { type: String }
  },
  { timestamps: true }
);

export interface IUserDoc extends mongoose.Document {
  name: string;
  email: string;
  passwordHash: string;
  role: 'farmer' | 'admin';
  profileImage?: string;
  bio?: string;
  phoneNumber?: string;
  location?: string;
  pushToken?: string;
  createdAt: Date;
  updatedAt: Date;
}

type IUserModel = mongoose.Model<IUserDoc>;

export const User: IUserModel =
  (mongoose.models.User as IUserModel) || mongoose.model<IUserDoc>('User', UserSchema);
