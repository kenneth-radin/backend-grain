import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { listSessions, getSession, createSession } from '../controllers/sessionController';
import { updateSession } from '../controllers/sessionUpdateController';

const router = Router();
router.use(requireAuth);

// NOTE: '/:id' last so it does not shadow other paths.
router.get('/', listSessions);
router.post('/', createSession);
router.patch('/:id', updateSession);
router.get('/:id', getSession);

export default router;
