import mongoose from 'mongoose';

/**
 * An AI drying prediction produced for an active drying session.
 *
 * DHT22-only project: the prediction infers drying progress from temperature +
 * humidity patterns learned from historical sessions (see ml/ training
 * pipeline). It NEVER claims to measure grain moisture directly — the target
 * end condition is defined by the equilibrium-RH completion criterion.
 */
const PredictionSchema = new mongoose.Schema(
  {
    sessionId: { type: mongoose.Schema.Types.ObjectId, ref: 'DryingSession', required: true, index: true },
    deviceId: { type: String, required: true, index: true },
    /** Minutes elapsed between session start and this prediction. */
    elapsedMinutes: { type: Number, required: true },
    temperature: { type: Number, required: true },
    humidity: { type: Number, required: true },
    /** Current exhaust RH minus the equilibrium-RH completion threshold (pp). */
    rhGapToEquilibrium: { type: Number },
    /** Model output: estimated minutes left until the end condition is met. */
    remainingMinutes: { type: Number, required: true },
    /** Wall-clock time when drying is predicted to reach the end condition. */
    estimatedCompletionAt: { type: Date, required: true },
    status: {
      type: String,
      enum: ['in_progress', 'approaching_completion', 'estimated_complete'],
      required: true
    },
    recommendation: {
      type: String,
      enum: [
        'CONTINUE_DRYING',
        'REDUCE_HEATING',
        'INCREASE_AIRFLOW',
        'APPROACHING_COMPLETION',
        'ESTIMATED_COMPLETE'
      ],
      required: true
    },
    /** Which predictor produced this: trained model or physics fallback. */
    source: {
      type: String,
      enum: ['ml_model', 'physics_fallback'],
      required: true
    },
    modelVersion: { type: String, default: 'untrained' }
  },
  { timestamps: true, versionKey: false }
);

PredictionSchema.index({ sessionId: 1, createdAt: -1 });

export interface IPredictionDoc extends mongoose.Document {
  sessionId: mongoose.Types.ObjectId;
  deviceId: string;
  elapsedMinutes: number;
  temperature: number;
  humidity: number;
  rhGapToEquilibrium?: number;
  remainingMinutes: number;
  estimatedCompletionAt: Date;
  status: 'in_progress' | 'approaching_completion' | 'estimated_complete';
  recommendation:
    | 'CONTINUE_DRYING'
    | 'REDUCE_HEATING'
    | 'INCREASE_AIRFLOW'
    | 'APPROACHING_COMPLETION'
    | 'ESTIMATED_COMPLETE';
  source: 'ml_model' | 'physics_fallback';
  modelVersion: string;
  createdAt: Date;
  updatedAt: Date;
}

type IPredictionModel = mongoose.Model<IPredictionDoc>;

export const Prediction: IPredictionModel =
  (mongoose.models.Prediction as IPredictionModel) ||
  mongoose.model<IPredictionDoc>('Prediction', PredictionSchema);