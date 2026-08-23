import mongoose from 'mongoose';

const NotificationItemSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    deviceId: { type: String },
    type: {
      type: String,
      enum: [
        'drying_complete',
        'alert_critical',
        'alert_warning',
        'device_offline',
        'session_started',
        'session_aborted'
      ],
      required: true,
      index: true
    },
    title: { type: String, required: true },
    body: { type: String, default: '' },
    data: { type: mongoose.Schema.Types.Mixed },
    isRead: { type: Boolean, default: false, index: true },
    sentViaFCM: { type: Boolean, default: false }
  },
  { timestamps: true, versionKey: false } // provides createdAt (+ updatedAt)
);

export interface INotificationItemDoc extends mongoose.Document {
  userId: mongoose.Types.ObjectId;
  deviceId?: string;
  type:
    | 'drying_complete'
    | 'alert_critical'
    | 'alert_warning'
    | 'device_offline'
    | 'session_started'
    | 'session_aborted';
  title: string;
  body: string;
  data?: Record<string, unknown>;
  isRead: boolean;
  sentViaFCM: boolean;
  createdAt: Date;
}

type INotificationItemModel = mongoose.Model<INotificationItemDoc>;

export const NotificationItem: INotificationItemModel =
  (mongoose.models.NotificationItem as INotificationItemModel) ||
  mongoose.model<INotificationItemDoc>('NotificationItem', NotificationItemSchema);
