import mongoose from 'mongoose';

/**
 * A drying session. DHT22-only project: averages are computed from
 * temperature + humidity readings. NO moisture/weight fields anywhere.
 */
const DryingSessionSchema = new mongoose.Schema(
  {
    deviceId: { type: String, required: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    status: {
      type: String,
      enum: ['active', 'completed', 'aborted'],
      default: 'active',
      index: true
    },
    grainType: { type: String, default: 'rice' }, // rice, corn, wheat, soybean, coffee
    avgTemperature: { type: Number, default: 0 },
    avgHumidity: { type: Number, default: 0 },
    dataPoints: { type: Number, default: 0 },
    startedAt: { type: Date, default: Date.now, index: true },
    completedAt: { type: Date },
    /** Seconds between startedAt and completedAt. */
    duration: { type: Number },
    /** Percent of samples with temperature inside the grain's ideal band. */
    efficiency: { type: Number },
    isSimulated: { type: Boolean, default: false }
  },
  { timestamps: true, versionKey: false }
);

export interface IDryingSessionDoc extends mongoose.Document {
  deviceId: string;
  userId: mongoose.Types.ObjectId;
  status: 'active' | 'completed' | 'aborted';
  grainType: string;
  avgTemperature: number;
  avgHumidity: number;
  dataPoints: number;
  startedAt: Date;
  completedAt?: Date;
  duration?: number;
  efficiency?: number;
  isSimulated?: boolean;
  createdAt: Date;
  updatedAt: Date;
}

type IDryingSessionModel = mongoose.Model<IDryingSessionDoc>;

export const DryingSession: IDryingSessionModel =
  (mongoose.models.DryingSession as IDryingSessionModel) ||
  mongoose.model<IDryingSessionDoc>('DryingSession', DryingSessionSchema);
