import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { register, login, me, logout } from '../controllers/authController';

const router = Router();

// Public
router.post('/login', login);
router.post('/register', register);

// Protected
router.get('/me', requireAuth, me);
router.post('/logout', requireAuth, logout);

export default router;
