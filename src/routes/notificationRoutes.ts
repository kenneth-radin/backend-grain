import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import {
  listNotifications,
  markNotificationsRead,
  saveFcmToken,
  removeFcmToken
} from '../controllers/notificationController';

const router = Router();

// All notification routes are PROTECTED and scoped to the authenticated user.
router.use(requireAuth);

router.get('/', listNotifications);
router.patch('/', markNotificationsRead);

// NOTE: '/fcm-token' must be registered before any '/:id' style route.
router.post('/fcm-token', saveFcmToken);
router.delete('/fcm-token', removeFcmToken);

export default router;
