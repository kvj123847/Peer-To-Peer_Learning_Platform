/**
 * @file app.ts
 * @description Express application setup, security middleware configuration, and router mounting.
 */

import express, { Application, Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import morgan from 'morgan';
import { v4 as uuidv4 } from 'uuid';
import { env } from '@/config/env';
import { logger } from '@/utils/logger';
import { errorHandler, notFoundHandler } from '@/middleware/errorHandler';
import { generalLimiter } from '@/middleware/rateLimiter';

// Routers
import authRoutes from '@/modules/auth/auth.routes';
import usersRoutes from '@/modules/users/users.routes';
import rolesRoutes from '@/modules/roles/roles.routes';
import tutorsRoutes from '@/modules/tutors/tutors.routes';
import mentorRoutes from '@/modules/mentorReview/mentorReview.routes';
import paymentsRoutes from '@/modules/payments/payments.routes';
import sessionsRoutes from '@/modules/sessions/sessions.routes';

const app: Application = express();

// ── 1. Security & Hygiene Middleware ─────────────────────────────────────────
app.use(
  helmet({
    contentSecurityPolicy: process.env.NODE_ENV === 'production' ? undefined : false,
    crossOriginEmbedderPolicy: false,
  }),
);

const allowedOrigins = [
  env.CLIENT_URL,
  env.ADMIN_URL,
  'http://localhost:3000',
  'http://localhost:5173',
  'http://localhost:8081', // React Native Metro bundler
  'http://localhost:19006', // Expo web
].filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow mobile apps or curl (no origin) or allowed origins
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(null, true); // Permissive for local mobile dev testing
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'stripe-signature'],
  }),
);

app.use(compression());
app.use(cookieParser());

// Request ID and logging
app.use((req: Request, _res: Response, next: NextFunction) => {
  req.requestId = (req.headers['x-request-id'] as string) || uuidv4();
  next();
});

if (process.env.NODE_ENV !== 'test') {
  app.use(
    morgan(':method :url :status :res[content-length] - :response-time ms', {
      stream: {
        write: (message: string) => logger.info(message.trim()),
      },
    }),
  );
}

// ── 2. Body Parsers (Exclude Stripe Webhooks from JSON parsing) ───────────────
// Payments module mounts express.raw() on its webhook routes specifically,
// so here we parse JSON for all standard routes.
app.use((req: Request, res: Response, next: NextFunction) => {
  if (req.originalUrl.includes('/payments/webhook') || req.originalUrl.includes('/payments/connect-webhook')) {
    next();
  } else {
    express.json({ limit: '10mb' })(req, res, next);
  }
});
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Apply general rate limiting
app.use(generalLimiter);

// ── 3. Health Check ──────────────────────────────────────────────────────────
const healthHandler = (_req: Request, res: Response) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    version: env.API_VERSION,
    environment: env.NODE_ENV,
  });
};

app.get('/health', healthHandler);
app.get(`/api/${env.API_VERSION}/health`, healthHandler);

// ── 4. API Routes Mounting ───────────────────────────────────────────────────
const apiPrefix = `/api/${env.API_VERSION}`;

app.use(`${apiPrefix}/auth`, authRoutes);
app.use(`${apiPrefix}/users`, usersRoutes);
app.use(`${apiPrefix}/roles`, rolesRoutes);
app.use(`${apiPrefix}/tutors`, tutorsRoutes);
app.use(`${apiPrefix}/mentor`, mentorRoutes);
app.use(`${apiPrefix}/payments`, paymentsRoutes);
app.use(`${apiPrefix}/sessions`, sessionsRoutes);

// ── 5. Error Handling ────────────────────────────────────────────────────────
app.use(notFoundHandler);
app.use(errorHandler);

export default app;
