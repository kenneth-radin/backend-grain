import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { requireDeviceOwnership } from '../middleware/deviceOwnership';
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
// User must own the target device (admin bypasses).
const checkOwnership = requireDeviceOwnership((req) => req.params.deviceId);

router.post('/:deviceId/start', requireAuth, checkOwnership, startDryer);
router.post('/:deviceId/stop', requireAuth, checkOwnership, stopDryer);
router.post('/:deviceId/fan', requireAuth, checkOwnership, controlFan);
router.post('/:deviceId/stepper', requireAuth, checkOwnership, controlStepper);
router.post('/:deviceId/relay', requireAuth, checkOwnership, controlRelay);
router.post('/:deviceId/heater', requireAuth, checkOwnership, controlHeater);

export default router;
