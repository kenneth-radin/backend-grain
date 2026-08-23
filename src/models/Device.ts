import mongoose from 'mongoose';

export interface IRuntimeState {
  isRunning?: boolean;
  currentMode?: 'AUTO' | 'MANUAL';
  heaterState?: 'ON' | 'OFF';
  fan1State?: 'ON' | 'OFF';
  fan2State?: 'ON' | 'OFF';
  relayState?: 'ON' | 'OFF';
  stepperState?: 'ON' | 'OFF' | 'CW' | 'CCW';
  pendingCommand?: string;
  activeCommand?: string;
  lastCommand?: string;
  commandStatus?:
    | 'idle'
    | 'pending'
    | 'polled'
    | 'executing'
    | 'executed'
    | 'failed'
    | 'timeout'
    | 'error';
  commandAcknowledged?: boolean;
  lastHeartbeat?: Date;
  currentTemperature?: number;
  currentHumidity?: number;
}

const RuntimeStateSchema = new mongoose.Schema(
  {
    isRunning: { type: Boolean },
    currentMode: { type: String, enum: ['AUTO', 'MANUAL'] },
    heaterState: { type: String, enum: ['ON', 'OFF'] },
    fan1State: { type: String, enum: ['ON', 'OFF'] },
    fan2State: { type: String, enum: ['ON', 'OFF'] },
    relayState: { type: String, enum: ['ON', 'OFF'] },
    stepperState: { type: String, enum: ['ON', 'OFF', 'CW', 'CCW'] },
    pendingCommand: { type: String },
    activeCommand: { type: String },
    lastCommand: { type: String },
    commandStatus: {
      type: String,
      enum: ['idle', 'pending', 'polled', 'executing', 'executed', 'failed', 'timeout', 'error'],
      default: 'idle'
    },
    commandAcknowledged: { type: Boolean },
    lastHeartbeat: { type: Date },
    // DHT22-only live values. NO moisture / weight / voltage / battery fields.
    currentTemperature: { type: Number },
    currentHumidity: { type: Number }
  },
  { _id: false }
);

const DeviceSchema = new mongoose.Schema(
  {
    deviceId: { type: String, required: true, unique: true, trim: true, index: true },
    name: { type: String, trim: true },
    location: { type: String, required: true, trim: true },
    status: { type: String, enum: ['online', 'offline'], default: 'offline' },
    isOnline: { type: Boolean, default: false },
    lastSeen: { type: Date, default: Date.now },
    runtimeState: { type: RuntimeStateSchema, default: () => ({}) }
  },
  { timestamps: true }
);

export interface IDeviceDoc extends mongoose.Document {
  deviceId: string;
  name?: string;
  location: string;
  status: 'online' | 'offline';
  isOnline: boolean;
  lastSeen: Date;
  runtimeState?: IRuntimeState;
  createdAt: Date;
  updatedAt: Date;
}

type IDeviceModel = mongoose.Model<IDeviceDoc>;

export const Device: IDeviceModel =
  (mongoose.models.Device as IDeviceModel) || mongoose.model<IDeviceDoc>('Device', DeviceSchema);
