import { Request, Response } from 'express';
import { parseCommandString, ParsedCommand } from '../services/commandParser';
import { enqueueCommand } from '../services/commandService';
import { ApiError, asyncHandler } from '../utils/http';

/** Shared helper: build a raw command string, parse it (validation), enqueue it. */
async function buildAndEnqueue(deviceId: string, raw: string): Promise<ParsedCommand> {
  const parsed = parseCommandString(raw);
  if (!parsed) throw new ApiError(400, `Unsupported command format: ${raw}`);
  await enqueueCommand(deviceId, parsed);
  return parsed;
}

/**
 * POST /api/dryer/:deviceId/start { mode?, temperature?, fanSpeed? }
 * Builds e.g. START:AUTO:45:80
 */
export const startDryer = asyncHandler(async (req: Request, res: Response) => {
  const deviceId = req.params.deviceId;
  const body = (req.body || {}) as {
    mode?: string;
    temperature?: number | string;
    fanSpeed?: number | string;
  };

  const mode = String(body.mode || 'MANUAL').toUpperCase();
  if (mode !== 'AUTO' && mode !== 'MANUAL') {
    throw new ApiError(400, "mode must be 'AUTO' or 'MANUAL'");
  }

  let temperature: number | undefined;
  let fanSpeed: number | undefined;
  if (body.temperature !== undefined && body.temperature !== '') {
    temperature = Number(body.temperature);
    if (!Number.isFinite(temperature)) throw new ApiError(400, 'temperature must be a number');
  }
  if (body.fanSpeed !== undefined && body.fanSpeed !== '') {
    fanSpeed = Number(body.fanSpeed);
    if (!Number.isFinite(fanSpeed)) throw new ApiError(400, 'fanSpeed must be a number');
  }

  const raw = `START:${mode}:${temperature ?? ''}:${fanSpeed ?? ''}`;
  const command = await buildAndEnqueue(deviceId, raw);
  res.status(201).json({ success: true, data: { ...command, deviceId } as unknown as Record<string, unknown> });
});

/** POST /api/dryer/:deviceId/stop */
export const stopDryer = asyncHandler(async (req: Request, res: Response) => {
  const deviceId = req.params.deviceId;
  const command = await buildAndEnqueue(deviceId, 'STOP');
  res.status(201).json({ success: true, data: { ...command, deviceId } as unknown as Record<string, unknown> });
});

/** POST /api/dryer/:deviceId/fan { fanTarget, fanAction } */
export const controlFan = asyncHandler(async (req: Request, res: Response) => {
  const deviceId = req.params.deviceId;
  const body = (req.body || {}) as { fanTarget?: string; fanAction?: string; fan?: string; action?: string };

  // Accept both canonical names and the short aliases some clients use.
  const fanTarget = String(body.fanTarget || body.fan || '').toUpperCase().replace(/\s+/g, '');
  const fanAction = String(body.fanAction || body.action || '').toUpperCase();

  if (!['FAN1', 'FAN2', 'ALL', '1', '2'].includes(fanTarget)) {
    throw new ApiError(400, "fanTarget must be 'FAN1', 'FAN2' or 'ALL'");
  }
  if (!['ON', 'OFF'].includes(fanAction)) {
    throw new ApiError(400, "fanAction must be 'ON' or 'OFF'");
  }

  const target = fanTarget === '1' ? 'FAN1' : fanTarget === '2' ? 'FAN2' : fanTarget;
  const command = await buildAndEnqueue(deviceId, `FAN:${target}:${fanAction}`);
  res.status(201).json({ success: true, data: { ...command, deviceId } as unknown as Record<string, unknown> });
});

/** POST /api/dryer/:deviceId/stepper { stepperAction } */
export const controlStepper = asyncHandler(async (req: Request, res: Response) => {
  const deviceId = req.params.deviceId;
  const body = (req.body || {}) as { stepperAction?: string; action?: string };
  const stepperAction = String(body.stepperAction || body.action || '').toUpperCase();

  if (!['START', 'STOP', 'CW', 'CCW'].includes(stepperAction)) {
    throw new ApiError(400, "stepperAction must be one of 'START', 'STOP', 'CW', 'CCW'");
  }

  const command = await buildAndEnqueue(deviceId, `STEP:${stepperAction}`);
  res.status(201).json({ success: true, data: { ...command, deviceId } as unknown as Record<string, unknown> });
});

/** POST /api/dryer/:deviceId/relay { relayAction } */
export const controlRelay = asyncHandler(async (req: Request, res: Response) => {
  const deviceId = req.params.deviceId;
  const body = (req.body || {}) as { relayAction?: string | number; state?: string | number };
  const input = body.relayAction ?? body.state;

  let state: string;
  if (typeof input === 'number') {
    state = input === 1 ? 'ON' : input === 0 ? 'OFF' : '';
  } else {
    const s = String(input ?? '').toUpperCase();
    state = s === '1' ? 'ON' : s === '0' ? 'OFF' : s;
  }
  if (state !== 'ON' && state !== 'OFF') {
    throw new ApiError(400, "relayAction must be ON/OFF or 1/0");
  }

  const command = await buildAndEnqueue(deviceId, `R1:${state === 'ON' ? 1 : 0}`);
  res.status(201).json({ success: true, data: { ...command, deviceId } as unknown as Record<string, unknown> });
});

/** POST /api/dryer/:deviceId/heater { heaterAction } */
export const controlHeater = asyncHandler(async (req: Request, res: Response) => {
  const deviceId = req.params.deviceId;
  const body = (req.body || {}) as { heaterAction?: string | number; state?: string | number };
  const input = body.heaterAction ?? body.state;

  let state: string;
  if (typeof input === 'number') {
    state = input === 1 ? 'ON' : input === 0 ? 'OFF' : '';
  } else {
    const s = String(input ?? '').toUpperCase();
    state = s === '1' ? 'ON' : s === '0' ? 'OFF' : s;
  }
  if (state !== 'ON' && state !== 'OFF') {
    throw new ApiError(400, "heaterAction must be ON/OFF or 1/0");
  }

  const command = await buildAndEnqueue(deviceId, `H1:${state === 'ON' ? 1 : 0}`);
  res.status(201).json({ success: true, data: { ...command, deviceId } as unknown as Record<string, unknown> });
});
