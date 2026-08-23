import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { getSessionPredictions } from '../controllers/predictionController';

const router = Router();
router.use(requireAuth);

// NOTE: '/:sessionId' pattern mirrors sessionRoutes ('/:id' last).
router.get('/:sessionId', getSessionPredictions);

export default router;