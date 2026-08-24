import mongoose, { Schema, Document } from 'mongoose';

/**
 * Stores password-reset tokens. Each token belongs to a user and expires
 * automatically after 1 hour thanks to the MongoDB TTL index (expiresAt).
 */
export interface IResetTokenDoc extends Document {
  token: string;
  userId: mongoose.Types.ObjectId;
  createdAt: Date;
  expiresAt: Date;
}

const ResetTokenSchema = new Schema<IResetTokenDoc>(
  {
    token: { type: String, required: true, unique: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    createdAt: { type: Date, default: Date.now, expires: 3600 } // TTL: auto-delete after 1 hour
  },
  {
    timestamps: true,
    // Auto-add expiresAt from createdAt + TTL so MongoDB can garbage-collect.
    // (The 'expires' option sets a TTL on createdAt.)
  }
);

export const ResetToken: mongoose.Model<IResetTokenDoc> =
  (mongoose.models.ResetToken as mongoose.Model<IResetTokenDoc>) ||
  mongoose.model<IResetTokenDoc>('ResetToken', ResetTokenSchema);