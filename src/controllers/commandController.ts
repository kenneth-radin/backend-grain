import { Request, Response } from 'express';
import { Command } from '../models/Command';
import { Device } from '../models/Device';
import { parseCommandString } from '../services/commandParser';
import { enqueueCommand } from '../services/commandService';
import { mirrorCommandExecuted, mirrorRuntimeState } from '../config/firebase';
import { ApiError, asyncHandler, clamp, parseIntParam } from '../utils/http';

/** POST /api/commands { deviceId, command } */
export const createCommand = asyncHandler(async (req: Request, res: Response) => {
  const body = (req.body || {}) as { deviceId?: string; command?: string };

  const deviceId = String(body.deviceId || '').trim();
  const raw = body.command;

  if (!deviceId) throw new ApiError(400, 'deviceId is required');

  const parsed = parseCommandString(raw);
  if (!parsed) {
    throw new ApiError(
      400,
      `Unsupported command format: ${JSON.stringify(raw)}. Supported: START:MANUAL|AUTO[:temp[:fanSpeed]], STOP, FAN:FAN1|FAN2|ALL:ON|OFF, STEP:START|STOP|CW|CCW, R1:1|0, H1:1|0`
    );
  }

  const command = await enqueueCommand(deviceId, parsed);
  res.status(201).json({ success: true, data: command.toJSON() });
});

/**
 * GET /api/commands/:deviceId — ESP32 poll endpoint (PUBLIC).
 * Marks the newest pending command as polled and refreshes the heartbeat.
 */
export const listCommandsForDevice = asyncHandler(async (req: Request, res: Response) => {
  const deviceId = req.params.deviceId;
  const now = new Date();

  // Stale-pending guard: any pending command older than STALE_PENDING_MS is
  // marked failed so a lost-ACK command can never wedge the queue (and the
  // app's pendingCommand guard) forever.
  const STALE_PENDING_MS = 3 * 60 * 1000;
  const staleCutoff = new Date(Date.now() - STALE_PENDING_MS);
  await Command.updateMany(
    { deviceId, status: 'pending', createdAt: { $lt: staleCutoff } },
    { $set: { status: 'failed' } }
  );

  const latestPending = await Command.findOne({ deviceId, status: 'pending' })
    .sort({ createdAt: -1 });

  if (latestPending) {
    await Device.updateOne(
      { deviceId },
      {
        $set: {
          lastSeen: now,
          isOnline: true,
          status: 'online',
          'runtimeState.commandStatus': 'polled',
          'runtimeState.activeCommand': latestPending.command,
          'runtimeState.lastCommand': latestPending.command,
          'runtimeState.pendingCommand': latestPending.command,
          'runtimeState.commandAcknowledged': false,
          'runtimeState.lastHeartbeat': now
        }
      }
    );
  } else {
    // Polling alone proves the device is alive. No pending command exists,
    // so clear any stale pendingCommand left over from a lost-ACK command.
    await Device.updateOne(
      { deviceId },
      { $set: { lastSeen: now, isOnline: true, status: 'online', 'runtimeState.lastHeartbeat': now, 'runtimeState.pendingCommand': null } },
      { upsert: true }
    );
  }

  // Respect the ESP-raised ?limit so the payload stays small enough for the
  // ESP8266 to parse (a hardcoded 50 produced ~10 KB responses that got
  // truncated on the ESP and caused IncompleteInput).
  const reqLimit = parseIntParam(req.query.limit, 50);
  const cap = clamp(reqLimit, 1, 50);
  const commands = await Command.find({ deviceId }).sort({ createdAt: -1 }).limit(cap).lean();

  // Mirror the polled runtimeState so the mobile app sees pending state live.
  const polledDoc = await Device.findOne({ deviceId }, { runtimeState: 1 }).lean();
  mirrorRuntimeState(deviceId, polledDoc?.runtimeState);

  res.json({ success: true, data: commands });
});

/**
 * POST /api/commands/ack — ESP32 acknowledgement (PUBLIC).
 * Body: { deviceId, command, status?: 'executed'|'failed' }.
 * Marks every matching pending command as executed/failed so it is never
 * replayed by later polls or reboots, refreshes the heartbeat, mirrors the new
 * runtimeState + executed flag to Firebase for the mobile app.
 */
export const ackCommand = asyncHandler(async (req: Request, res: Response) => {
  const body = (req.body || {}) as { deviceId?: string; command?: string; status?: string };
  const deviceId = String(body.deviceId || '').trim();
  const command = String(body.command || '').trim().toUpperCase();
  const failed = String(body.status || '').trim().toLowerCase() === 'failed';

  if (!deviceId) throw new ApiError(400, 'deviceId is required');
  if (!command) throw new ApiError(400, 'command is required');

  // Case-insensitive match against pending commands for this device.
  const pending = await Command.find({ deviceId, status: 'pending' }).select('command').lean();
  const matchedIds = pending
    .filter((c) => String(c.command).trim().toUpperCase() === command)
    .map((c) => c._id);

  if (matchedIds.length > 0) {
    await Command.updateMany(
      { _id: { $in: matchedIds } },
      { $set: { status: failed ? 'failed' : 'executed' } }
    );
  }

  const now = new Date();
  const set: Record<string, unknown> = {
    lastSeen: now,
    isOnline: true,
    status: 'online',
    'runtimeState.commandStatus': failed ? 'failed' : 'executed',
    'runtimeState.commandAcknowledged': !failed,
    'runtimeState.pendingCommand': null,
    'runtimeState.lastHeartbeat': now
  };
  if (command === 'STOP') set['runtimeState.activeCommand'] = null;

  const updated = await Device.findOneAndUpdate(
    { deviceId },
    { $set: set },
    { upsert: true, new: true }
  ).lean();

  mirrorRuntimeState(deviceId, updated?.runtimeState);
  mirrorCommandExecuted(deviceId, command, !failed);

  res.json({ success: true, data: { acknowledged: true, updated: matchedIds.length } });
});
