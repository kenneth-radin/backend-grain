import mongoose from 'mongoose';

const CommandSchema = new mongoose.Schema(
  {
    deviceId: { type: String, required: true, index: true },
    /** Raw command string, e.g. 'START:AUTO:45:80' or 'STOP' */
    command: { type: String, required: true },
    commandStr: { type: String },
    status: { type: String, enum: ['pending', 'executed', 'failed', 'superseded'], default: 'pending' },
    fanTarget: { type: String },
    fanAction: { type: String },
    relayAction: { type: String },
    stepperAction: { type: String },
    heaterAction: { type: String },
    parameters: {
      mode: { type: String, enum: ['AUTO', 'MANUAL'], default: 'MANUAL' },
      temperature: { type: Number },
      fanSpeed: { type: Number }
    }
  },
  { timestamps: true } // provides createdAt (+ updatedAt)
);

export interface ICommandDoc extends mongoose.Document {
  deviceId: string;
  command: string;
  commandStr?: string;
  status: 'pending' | 'executed' | 'failed' | 'superseded';
  fanTarget?: string;
  fanAction?: string;
  relayAction?: string;
  stepperAction?: string;
  heaterAction?: string;
  parameters: {
    mode: 'AUTO' | 'MANUAL';
    temperature?: number;
    fanSpeed?: number;
  };
  createdAt: Date;
}

type ICommand = mongoose.Model<ICommandDoc>;

export const Command: ICommand =
  (mongoose.models.Command as ICommand) || mongoose.model<ICommandDoc>('Command', CommandSchema);
