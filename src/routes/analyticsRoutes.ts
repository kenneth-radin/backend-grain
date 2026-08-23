import { Router } from 'express';
import { overview } from '../controllers/analyticsController';

const router = Router();
router.get('/overview', overview);

export default router;
