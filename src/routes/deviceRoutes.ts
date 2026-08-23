import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { listDevices, getDevice, createDevice } from '../controllers/deviceController';

const router = Router();

// All device routes are protected (end-user facing).
router.use(requireAuth);

router.get('/', listDevices);
router.post('/', createDevice);
router.get('/:id', getDevice);

export default router;
