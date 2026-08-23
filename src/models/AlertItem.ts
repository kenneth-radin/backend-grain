import mongoose from 'mongoose';

const AlertItemSchema = new mongoose.Schema(
  {
    deviceId: { type: String, index: true },
    severity: { type: String, enum: ['error', 'warning', 'info'], default: 'info' },
    title: { type: String, required: true },
    message: { type: String, default: '' },
    timestamp: { type: Date, default: Date.now, index: true },
    acknowledged: { type: Boolean, default: false }
  },
  { timestamps: false, versionKey: false }
);

interface IAlertItemDoc extends mongoose.Document {
  deviceId?: string;
  severity: 'error' | 'warning' | 'info';
  title: string;
  message: string;
  timestamp: Date;
  acknowledged: boolean;
}

type IAlertItemModel = mongoose.Model<IAlertItemDoc>;

export const AlertItem: IAlertItemModel =
  (mongoose.models.AlertItem as IAlertItemModel) ||
  mongoose.model<IAlertItemDoc>('AlertItem', AlertItemSchema);
