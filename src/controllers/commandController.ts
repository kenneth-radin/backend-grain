import { Request, Response } from 'express';
import { Command } from '../models/Command';
import { Device } from '../models/Device';
import { parseCommandString } from '../services/commandParser';
import { enqueueCommand } from '../services/commandService';
import { ApiError, asyncHandler } from '../utils/http';

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
    // Polling alone proves the device is alive.
    await Device.updateOne(
      { deviceId },
      { $set: { lastSeen: now, isOnline: true, status: 'online', 'runtimeState.lastHeartbeat': now } },
      { upsert: true }
    );
  }

  const commands = await Command.find({ deviceId }).sort({ createdAt: -1 }).limit(50).lean();
  res.json({ success: true, data: commands });
});
