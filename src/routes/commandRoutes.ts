import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { requireDeviceOwnership } from '../middleware/deviceOwnership';
import { ackCommand, createCommand, listCommandsForDevice } from '../controllers/commandController';

const router = Router();

// End-user command submission — PROTECTED. User must own the target device.
router.post('/', requireAuth, requireDeviceOwnership((req) => req.body?.deviceId), createCommand);

// ESP32 poll — PUBLIC.
router.get('/:deviceId', listCommandsForDevice);

// ESP32 acknowledgement — PUBLIC. Marks commands executed so they never replay.
router.post('/ack', ackCommand);

export default router;
