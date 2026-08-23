import mongoose from 'mongoose';

/**
 * DHT22 sensor reading — temperature and humidity ONLY.
 * Extra fields in incoming payloads are silently dropped by the ingress
 * controller (it whitelists fields explicitly).
 */
const SensorDatumSchema = new mongoose.Schema(
  {
    deviceId: { type: String, required: true, index: true },
    temperature: { type: Number, required: true }, // deg C (DHT22)
    humidity: { type: Number, required: true }, // % RH (DHT22)
    status: { type: String, default: 'idle' }, // e.g. 'idle' | 'running'
    timestamp: { type: Date, default: Date.now, index: true }
  },
  { timestamps: false, versionKey: false }
);

SensorDatumSchema.index({ deviceId: 1, timestamp: -1 });

export interface ISensorDatumDoc extends mongoose.Document {
  deviceId: string;
  temperature: number;
  humidity: number;
  status: string;
  timestamp: Date;
}

type ISensorDatumModel = mongoose.Model<ISensorDatumDoc>;

export const SensorDatum: ISensorDatumModel =
  (mongoose.models.SensorDatum as ISensorDatumModel) ||
  mongoose.model<ISensorDatumDoc>('SensorDatum', SensorDatumSchema);
