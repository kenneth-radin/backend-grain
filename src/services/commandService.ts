import { Command, ICommandDoc } from '../models/Command';
import { Device } from '../models/Device';
import { ParsedCommand } from './commandParser';
import { mirrorRuntimeState } from '../config/firebase';

/**
 * Creates a pending Command document for a device and optimistically updates
 * the device's runtimeState so the mobile UI reflects intent immediately
 * (the ESP32 picks the command up on its next poll of GET /api/commands/:deviceId).
 */
export async function enqueueCommand(
  deviceId: string,
  parsed: ParsedCommand
): Promise<ICommandDoc> {
  // Ensure a device record exists (idempotent provisioning for IoT devices).
  await Device.updateOne(
    { deviceId },
    {
      $setOnInsert: {
        deviceId,
        location: 'Unspecified',
        status: 'offline',
        isOnline: false
      }
    },
    { upsert: true }
  );

  // Exactly-one-execution semantics: any newly enqueued command supersedes
  // all older pending ones, so a STOP can never be overridden by a stale
    // queued START and one button press results in one execution.
  await Command.updateMany(
    { deviceId, status: 'pending' },
    { $set: { status: 'superseded' } }
  );

  const command = await Command.create({
    deviceId,
    command: parsed.command,
    commandStr: parsed.commandStr,
    status: 'pending',
    fanTarget: parsed.fanTarget,
    fanAction: parsed.fanAction,
    relayAction: parsed.relayAction,
    stepperAction: parsed.stepperAction,
    heaterAction: parsed.heaterAction,
    parameters: parsed.parameters
  });

  // Optimistic runtime state update using dotted paths so unrelated fields
  // (e.g. currentTemperature) are preserved.
  const now = new Date();
  const set: Record<string, unknown> = {
    'runtimeState.pendingCommand': parsed.command,
    'runtimeState.activeCommand': parsed.command,
    'runtimeState.lastCommand': parsed.command,
    'runtimeState.commandStatus': 'pending',
    'runtimeState.commandAcknowledged': false,
    'runtimeState.lastHeartbeat': now,
    'runtimeState.currentMode': parsed.parameters.mode
  };

  switch (true) {
    case parsed.command.startsWith('START'):
      set['runtimeState.isRunning'] = true;
      // Mirror the hardware behavior of START: fans + heater energize.
      // (AUTO thermostat adjustments happen later on the Arduino.)
      set['runtimeState.heaterState'] = 'ON';
      set['runtimeState.fan1State'] = 'ON';
      set['runtimeState.fan2State'] = 'ON';
      break;
    case parsed.command === 'STOP':
      set['runtimeState.isRunning'] = false;
      set['runtimeState.heaterState'] = 'OFF';
      set['runtimeState.fan1State'] = 'OFF';
      set['runtimeState.fan2State'] = 'OFF';
      set['runtimeState.relayState'] = 'OFF';
      set['runtimeState.stepperState'] = 'STOP';
      break;
    default:
      break;
  }

  if (parsed.fanTarget === 'FAN1' && parsed.fanAction) set['runtimeState.fan1State'] = parsed.fanAction;
  if (parsed.fanTarget === 'FAN2' && parsed.fanAction) set['runtimeState.fan2State'] = parsed.fanAction;
  if (parsed.fanTarget === 'ALL' && parsed.fanAction) {
    set['runtimeState.fan1State'] = parsed.fanAction;
    set['runtimeState.fan2State'] = parsed.fanAction;
  }
  if (parsed.stepperAction) set['runtimeState.stepperState'] = parsed.stepperAction;
  if (parsed.relayAction) set['runtimeState.relayState'] = parsed.relayAction;
  if (parsed.heaterAction) set['runtimeState.heaterState'] = parsed.heaterAction;

  await Device.updateOne({ deviceId }, { $set: set });

  // Mirror the optimistic runtimeState + lastCommand so the app UI reacts instantly.
  const enqueuedDoc = await Device.findOne({ deviceId }, { runtimeState: 1 }).lean();
  mirrorRuntimeState(deviceId, enqueuedDoc?.runtimeState);

  return command;
}
