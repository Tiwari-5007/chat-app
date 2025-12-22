import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import authRouter from './routes/authRoutes';
import { errorHandler } from './middlewares/errorHandler';
import { reqIdMiddleware } from './middlewares/utilMiddleware';

dotenv.config();

export function createApp() {
    const app = express();

    app.use(cors({ origin: true }));
    app.use(express.json({ limit: '2mb' }));

    app.use(reqIdMiddleware);
    
    // Routes
    app.use('/api/v1/auth', authRouter);

    // Health Check Route.
    app.get('/healthcheck', (_, res) => res.json({ ok: true }));

    app.use(errorHandler);
    return app;
}