import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { listAlerts, markAlertRead, deleteAllAlerts } from '../controllers/alertController';

const router = Router();
router.use(requireAuth);

// NOTE: '/:id/read' before any conflicting pattern; DELETE '/' clears all.
router.get('/', listAlerts);
router.patch('/:id/read', markAlertRead);
router.delete('/', deleteAllAlerts);

export default router;
