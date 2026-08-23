import express, { NextFunction, Request, Response } from 'express';
import cors from 'cors';
import { isDbConnected } from './config/db';

import authRoutes from './routes/authRoutes';
import deviceRoutes from './routes/deviceRoutes';
import sensorRoutes from './routes/sensorRoutes';
import commandRoutes from './routes/commandRoutes';
import dryerRoutes from './routes/dryerRoutes';
import sessionRoutes from './routes/sessionRoutes';
import analyticsRoutes from './routes/analyticsRoutes';
import alertRoutes from './routes/alertRoutes';
import notificationRoutes from './routes/notificationRoutes';
import pushRoutes from './routes/pushRoutes';
import assistantRoutes from './routes/assistantRoutes';
import userRoutes from './routes/userRoutes';

/** eslint-disable @typescript-eslint/no-unused-vars */
export function createApp(): express.Express {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  // CORS: allow all origins (dev convenience per project spec).
  app.use(cors());

  // --- Health / cold-start endpoints FIRST, no body parsing needed ---
  const healthRouter = express.Router();
  const ok = (_req: Request, res: Response) =>
    res.status(200).json({
      success: true,
      ok: true,
      status: 'ok',
      db: isDbConnected() ? 'connected' : 'connecting',
      uptimeSec: Math.round(process.uptime()),
      timestamp: new Date().toISOString()
    });
  healthRouter.get('/health', ok);
  healthRouter.get('/warmup', ok);
  healthRouter.get('/ping', (_req: Request, res: Response) => res.status(200).send('pong'));
  app.use('/api', healthRouter);

  // --- JSON parsing (8 MB to allow base64 avatar uploads) ---
  app.use(express.json({ limit: '8mb' }));

  // --- API routes ---
  const api = express.Router();

  api.use('/auth', authRoutes);
  api.use('/devices', deviceRoutes);
  api.use('/sensors', sensorRoutes);
  api.use('/commands', commandRoutes);
  api.use('/dryer', dryerRoutes);
  api.use('/sessions', sessionRoutes);
  api.use('/analytics', analyticsRoutes);
  api.use('/alerts', alertRoutes);
  api.use('/notifications', notificationRoutes);
  api.use('/push', pushRoutes);
  api.use('/users', userRoutes);
  api.use('/v1/assistant', assistantRoutes);

  app.use('/api', api);

  // --- 404 ---
  app.use((req: Request, res: Response) => {
    res.status(404).json({ success: false, error: `Not found: ${req.method} ${req.originalUrl}` });
  });

  // --- Central error handler (must keep 4 args for Express signature) ---
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    if (
      err &&
      typeof err === 'object' &&
      'type' in err &&
      (err as { type?: string }).type === 'entity.parse.failed'
    ) {
      res.status(400).json({ success: false, error: 'Invalid JSON body' });
      return;
    }

    const status =
      typeof err === 'object' && err !== null && 'statusCode' in err
        ? Number((err as { statusCode: number }).statusCode)
        : 500;

    const message = err instanceof Error ? err.message : 'Internal server error';
    if (status >= 500) {
      console.error('[grAIn API] Unhandled error:', err instanceof Error ? err.stack : err);
    }

    res.status(Number.isFinite(status) && status >= 400 ? status : 500).json({
      success: false,
      error: message
    });
  });

  return app;
}
