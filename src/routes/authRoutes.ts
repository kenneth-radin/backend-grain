import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { register, login, me, logout, forgot, reset } from '../controllers/authController';

const router = Router();

// Public
router.post('/login', login);
router.post('/register', register);
router.post('/forgot', forgot);
router.post('/reset', reset);

// Protected
router.get('/me', requireAuth, me);
router.post('/logout', requireAuth, logout);

export default router;
