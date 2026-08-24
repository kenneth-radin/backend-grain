import { Router } from 'express';
import { chat } from '../controllers/assistantController';

const router = Router();

/**
  * POST / — the mobile client calls POST /api/assistant/chat.
 * Protected? The spec allows either; we keep it PUBLIC-friendly but cheap:
 * rate limiting can be added at the Render/proxy level if abused.
 */
router.post('/chat', chat);

export default router;
