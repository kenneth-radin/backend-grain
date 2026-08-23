import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { createCommand, listCommandsForDevice } from '../controllers/commandController';

const router = Router();

// End-user command submission — PROTECTED.
router.post('/', requireAuth, createCommand);

// ESP32 poll — PUBLIC.
router.get('/:deviceId', listCommandsForDevice);

export default router;
