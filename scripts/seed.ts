/**
 * Seeds the database with realistic grAIn sample data (DHT22-only).
 * Usage: npx tsx scripts/seed.ts
 *
 * Wipes domain collections and inserts demo users, devices, ~48h of DHT22
 * readings, sessions, commands, alerts and notifications.
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

import { User } from '../src/models/User';
import { Device } from '../src/models/Device';
import { SensorDatum } from '../src/models/SensorDatum';
import { Command } from '../src/models/Command';
import { DryingSession } from '../src/models/DryingSession';
import { AlertItem } from '../src/models/AlertItem';
import { NotificationItem } from '../src/models/NotificationItem';
import { simulateReadings, HOUR, MIN } from './seedSim';

const uri = (process.env.MONGODB_URI || process.env.MONGO_URI || '').trim();
if (!uri || /<[a-z_]+>/i.test(uri)) {
  console.error('[seed] MONGODB_URI missing or still contains a placeholder');
  process.exit(1);
}

async function seedUsers(): Promise<{ farmer: mongoose.Types.ObjectId }> {
  const passwordHash = await bcrypt.hash('demo1234', 10);
  const farmer = await User.create({
    name: 'Juan Dela Cruz',
    email: 'demo@grain.app',
    passwordHash,
    role: 'farmer',
    bio: 'Rice farmer from Laguna. 3 hectares.',
    phoneNumber: '+63 917 123 4567',
    location: 'Los Baños, Laguna'
  });
  await User.create({
    name: 'grAIn Admin',
    email: 'admin@grain.app',
    passwordHash: await bcrypt.hash('admin1234', 10),
    role: 'admin',
    location: 'Los Baños, Laguna'
  });
  console.log('[seed] Users: demo@grain.app/demo1234 (farmer), admin@grain.app/admin1234 (admin)');
  return { farmer: farmer._id as mongoose.Types.ObjectId };
}

async function seedDevices(): Promise<void> {
  await Device.create([
    {
      deviceId: 'GR-001', name: 'Dryer Unit 1', location: 'Los Baños, Laguna',
      status: 'online', isOnline: true, lastSeen: new Date()
    },
    {
      deviceId: 'GR-002', name: 'Dryer Unit 2', location: 'Bay, Laguna',
      status: 'offline', isOnline: false, lastSeen: new Date(Date.now() - 26 * HOUR)
    },
    {
      deviceId: 'GR-003', name: 'Coop Shared Dryer', location: 'Calauan, Laguna',
      status: 'offline', isOnline: false, lastSeen: new Date(Date.now() - 3 * HOUR)
    }
  ]);
  console.log('[seed] Devices: GR-001..GR-003');
}

async function seedCommands(): Promise<void> {
  const now = Date.now();
  await Command.insertMany([
    {
      deviceId: 'GR-001', command: 'START:AUTO:45:80', commandStr: 'START:AUTO:45:80',
      status: 'executed', parameters: { mode: 'AUTO', temperature: 45, fanSpeed: 80 },
      createdAt: new Date(now - 11 * HOUR)
    },
    {
      deviceId: 'GR-001', command: 'FAN:FAN1:ON', commandStr: 'FAN:FAN1:ON',
      status: 'executed', fanTarget: 'FAN1', fanAction: 'ON', parameters: { mode: 'AUTO' },
      createdAt: new Date(now - 10.5 * HOUR)
    },
    {
      deviceId: 'GR-001', command: 'H1:1', commandStr: 'H1:1',
      status: 'executed', heaterAction: 'ON', parameters: { mode: 'AUTO' },
      createdAt: new Date(now - 10 * HOUR)
    },
    {
      deviceId: 'GR-001', command: 'STOP', commandStr: 'STOP',
      status: 'pending', parameters: { mode: 'MANUAL' },
      createdAt: new Date(now - 5 * MIN)
    }
  ]);
  console.log('[seed] Commands: 4 (3 executed, 1 pending for ESP32 pickup)');
}

async function seedSessions(
  farmerId: mongoose.Types.ObjectId,
  readings: Array<{ temperature: number; humidity: number; timestamp: Date }>
): Promise<{ avgT: number }> {
  const now = Date.now();

  // Completed session covering the simulated daytime drying run.
  const sessionStart = new Date(now - 40 * HOUR + 8 * HOUR);
  const sessionEnd = new Date(sessionStart.getTime() + 11 * HOUR);
  const window = readings.filter((r) => r.timestamp >= sessionStart && r.timestamp <= sessionEnd);
  const avgT = Math.round((window.reduce((s, r) => s + r.temperature, 0) / window.length) * 10) / 10;
  const avgH = Math.round(window.reduce((s, r) => s + r.humidity, 0) / window.length);
  const inBand = window.filter((r) => r.temperature >= 40 && r.temperature <= 60).length;

  await DryingSession.create({
    deviceId: 'GR-001', userId: farmerId, status: 'completed', grainType: 'rice',
    avgTemperature: avgT, avgHumidity: avgH, dataPoints: window.length,
    startedAt: sessionStart, completedAt: sessionEnd,
    duration: Math.round((sessionEnd.getTime() - sessionStart.getTime()) / 1000),
    efficiency: Math.round((inBand / window.length) * 100),
    createdAt: sessionStart, updatedAt: sessionEnd
  });

  // Active session right now.
  await DryingSession.create({
    deviceId: 'GR-001', userId: farmerId, status: 'active', grainType: 'corn',
    avgTemperature: 0, avgHumidity: 0, dataPoints: 0,
    startedAt: new Date(now - 2 * HOUR), isSimulated: true
  });

  // Older aborted session for variety.
  await DryingSession.create({
    deviceId: 'GR-001', userId: farmerId, status: 'aborted', grainType: 'coffee',
    avgTemperature: 41.2, avgHumidity: 68.4, dataPoints: 14,
    startedAt: new Date(now - 5 * 24 * HOUR),
    completedAt: new Date(now - 5 * 24 * HOUR + 3 * HOUR),
    duration: 3 * 3600, efficiency: 64,
    createdAt: new Date(now - 5 * 24 * HOUR),
    updatedAt: new Date(now - 5 * 24 * HOUR + 3 * HOUR)
  });
  console.log('[seed] Sessions: 1 completed (rice), 1 active (corn), 1 aborted (coffee)');
  return { avgT };
}

async function seedSensors(): Promise<{
  readings: Array<{ temperature: number; humidity: number; timestamp: Date }>;
}> {
  const readings = simulateReadings(48, 15); // ≈193 points
  await SensorDatum.insertMany(
    readings.map((r) => ({
      deviceId: 'GR-001',
      temperature: r.temperature,
      humidity: r.humidity,
      status: r.temperature > 40 ? 'running' : 'idle',
      timestamp: r.timestamp
    }))
  );
  // Sparse history for GR-003 (its final hours online).
  const stale = simulateReadings(6, 30).slice(0, 6);
  await SensorDatum.insertMany(
    stale.map((r) => ({
      deviceId: 'GR-003',
      temperature: r.temperature,
      humidity: r.humidity,
      status: 'idle',
      timestamp: new Date(Date.now() - 3 * HOUR - (6 - stale.indexOf(r)) * 30 * MIN)
    }))
  );
  console.log(`[seed] SensorData: ${readings.length} pts (GR-001) + ${stale.length} pts (GR-003)`);
  return { readings };
}

async function seedAlertsAndNotifications(
  farmerId: mongoose.Types.ObjectId,
  avgT: number
): Promise<void> {
  const now = Date.now();
  await AlertItem.insertMany([
    {
      deviceId: 'GR-001', severity: 'warning', title: 'High drying temperature',
      message: 'GR-001 reported 58.4°C — consider reducing heat or increasing fan speed.',
      timestamp: new Date(now - 6 * HOUR), acknowledged: false
    },
    {
      deviceId: 'GR-002', severity: 'error', title: 'Device offline',
      message: 'GR-002 has not reported a heartbeat in over 24 hours.',
      timestamp: new Date(now - 20 * HOUR), acknowledged: false
    },
    {
      deviceId: 'GR-003', severity: 'info', title: 'Batch completed',
      message: 'GR-003 finished a drying cycle with average 47.1°C.',
      timestamp: new Date(now - 3 * HOUR), acknowledged: true
    }
  ]);

  await NotificationItem.insertMany([
    {
      userId: farmerId, deviceId: 'GR-001', type: 'drying_complete',
      title: 'Drying complete', body: `Rice batch finished — avg ${avgT}°C.`,
      isRead: true, sentViaFCM: true, createdAt: new Date(now - 29 * HOUR)
    },
    {
      userId: farmerId, deviceId: 'GR-001', type: 'session_started',
      title: 'Drying started', body: 'A corn drying session has started on GR-001.',
      isRead: false, sentViaFCM: false, createdAt: new Date(now - 2 * HOUR)
    },
    {
      userId: farmerId, deviceId: 'GR-002', type: 'device_offline',
      title: 'GR-002 went offline', body: 'Device has not responded in 24 hours. Check power and WiFi.',
      isRead: false, sentViaFCM: false, createdAt: new Date(now - 20 * HOUR)
    },
    {
      userId: farmerId, deviceId: 'GR-001', type: 'alert_warning',
      title: 'High temperature warning',
      body: 'Temperature approached the safety limit earlier today.',
      isRead: false, sentViaFCM: false, createdAt: new Date(now - 6 * HOUR)
    }
  ]);
  console.log('[seed] Alerts: 3 | Notifications: 4 (3 unread)');
}

async function main(): Promise<void> {
  console.log(`[seed] Connecting to ${uri.replace(/\/\/[^@]+@/, '//***@')} ...`);
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 20_000 });
  console.log('[seed] Connected ✅');

  await Promise.all([
    User.deleteMany({}), Device.deleteMany({}), SensorDatum.deleteMany({}),
    Command.deleteMany({}), DryingSession.deleteMany({}),
    AlertItem.deleteMany({}), NotificationItem.deleteMany({})
  ]);
  console.log('[seed] Cleared existing collections');

  const { farmer } = await seedUsers();
  await seedDevices();
  const { readings } = await seedSensors();

  // Live runtime state on GR-001 from its latest reading.
  const latest = readings[readings.length - 1];
  await Device.updateOne(
    { deviceId: 'GR-001' },
    {
      $set: {
        runtimeState: {
          isRunning: true, currentMode: 'AUTO', heaterState: 'ON',
          fan1State: 'ON', fan2State: 'OFF', relayState: 'ON', stepperState: 'CW',
          lastCommand: 'START:AUTO:45:80', commandStatus: 'executed',
          commandAcknowledged: true, lastHeartbeat: new Date(),
          currentTemperature: latest.temperature, currentHumidity: latest.humidity
        }
      }
    }
  );

  await seedCommands();
  const { avgT } = await seedSessions(farmer, readings);
  await seedAlertsAndNotifications(farmer, avgT);

  const counts = {
    users: await User.countDocuments(),
    devices: await Device.countDocuments(),
    sensorData: await SensorDatum.countDocuments(),
    commands: await Command.countDocuments(),
    sessions: await DryingSession.countDocuments(),
    alerts: await AlertItem.countDocuments(),
    notifications: await NotificationItem.countDocuments()
  };
  console.log('[seed] Done ✅', JSON.stringify(counts));
  console.log('[seed] Login with: demo@grain.app / demo1234');

  await mongoose.disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error('[seed] FAILED:', err instanceof Error ? err.message : err);
  process.exit(1);
});

