/**
 * @file database.ts
 * @description Prisma client singleton with lifecycle management.
 *
 * A global singleton is used to prevent multiple PrismaClient instances from
 * being created during hot-reload in development (ts-node-dev / webpack HMR),
 * which would exhaust the PostgreSQL connection pool.
 *
 * In production, a fresh instance is created once and reused for the
 * lifetime of the process.
 */

import { PrismaClient } from '@prisma/client';
import { logger } from '@/utils/logger';

// ─────────────────────────────────────────────────────────────────────────────
// Global singleton declaration (for HMR safety in development)
// ─────────────────────────────────────────────────────────────────────────────

declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

// ─────────────────────────────────────────────────────────────────────────────
// PrismaClient instantiation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Singleton Prisma client. Import this throughout the application instead of
 * creating new instances.
 *
 * Log levels:
 * - `development`: all query, info, warn, and error events are logged.
 * - `production` / `test`: only errors are logged to reduce noise.
 */
export const prisma: PrismaClient =
  global.__prisma ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === 'development'
        ? [
            { emit: 'event', level: 'query' },
            { emit: 'event', level: 'info' },
            { emit: 'event', level: 'warn' },
            { emit: 'event', level: 'error' },
          ]
        : [{ emit: 'event', level: 'error' }],
  });

// Forward Prisma log events to the Winston logger so all logs flow through
// the same transport (console, file, etc.).
if (process.env.NODE_ENV === 'development') {
  // @ts-expect-error — Prisma emits typed events but TS struggles with the overload
  prisma.$on('query', (e: { query: string; duration: number }) => {
    logger.debug('Prisma query', { query: e.query, duration: `${e.duration}ms` });
  });
  // @ts-expect-error
  prisma.$on('info', (e: { message: string }) => {
    logger.info('Prisma info', { message: e.message });
  });
  // @ts-expect-error
  prisma.$on('warn', (e: { message: string }) => {
    logger.warn('Prisma warning', { message: e.message });
  });
}

// @ts-expect-error
prisma.$on('error', (e: { message: string }) => {
  logger.error('Prisma error', { message: e.message });
});

// Pin the instance to the global in non-production environments to survive HMR.
if (process.env.NODE_ENV !== 'production') {
  global.__prisma = prisma;
}

// ─────────────────────────────────────────────────────────────────────────────
// Lifecycle helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Opens the database connection and validates reachability.
 * Called once during server startup.
 *
 * @throws {Error} If the database is unreachable after Prisma's internal retry.
 */
export async function connectDatabase(): Promise<void> {
  try {
    // $connect is a no-op if already connected; it also validates the
    // DATABASE_URL format and performs an initial handshake.
    await prisma.$connect();
    logger.info('✅  Database connected successfully');
  } catch (error) {
    logger.error('❌  Failed to connect to database', { error });
    throw error;
  }
}

/**
 * Gracefully closes the database connection pool.
 * Called during graceful shutdown (SIGTERM / SIGINT handlers).
 *
 * Swallows the error and logs it rather than re-throwing so the shutdown
 * sequence can continue even if the DB is already unreachable.
 */
export async function disconnectDatabase(): Promise<void> {
  try {
    await prisma.$disconnect();
    logger.info('🔌  Database disconnected');
  } catch (error) {
    logger.error('Error disconnecting database', { error });
  }
}
