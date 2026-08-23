import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { updateProfile, uploadAvatar } from '../controllers/userController';

const router = Router();
router.use(requireAuth);

router.patch('/profile', updateProfile);
router.post('/profile/avatar', uploadAvatar);

export default router;
