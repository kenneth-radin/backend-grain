import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import {
  startDryer,
  stopDryer,
  controlFan,
  controlStepper,
  controlRelay,
  controlHeater
} from '../controllers/dryerController';

const router = Router();

// Direct dryer control fallback endpoints — PROTECTED (end-user facing).
router.post('/:deviceId/start', requireAuth, startDryer);
router.post('/:deviceId/stop', requireAuth, stopDryer);
router.post('/:deviceId/fan', requireAuth, controlFan);
router.post('/:deviceId/stepper', requireAuth, controlStepper);
router.post('/:deviceId/relay', requireAuth, controlRelay);
router.post('/:deviceId/heater', requireAuth, controlHeater);

export default router;
