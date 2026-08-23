import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import {
  listByDevice,
  latestForAllDevices,
  ingestSensorData
} from '../controllers/sensorController';

const router = Router();

// ESP32 ingress — PUBLIC. Extra payload fields are silently dropped.
router.post('/data', ingestSensorData);

// Reads are end-user facing — PROTECTED.
// NOTE: '/data' must be registered before '/:deviceId'.
router.get('/data', requireAuth, latestForAllDevices);
router.get('/:deviceId', requireAuth, listByDevice);

export default router;
