/**
 * @file logger.ts
 * @description Application-wide Winston logger.
 *
 * Features:
 * - Pretty, colorised console output in development.
 * - Structured JSON to rotating log files in all environments.
 * - Separate `error.log` for easy alerting integration.
 * - `requestId` field support via `logger.child({ requestId })`.
 */

import path from 'path';
import winston from 'winston';

// ─────────────────────────────────────────────────────────────────────────────
// Log directory (relative to the project root)
// ─────────────────────────────────────────────────────────────────────────────
const LOG_DIR = path.join(process.cwd(), 'logs');

// ─────────────────────────────────────────────────────────────────────────────
// Custom format helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Formats a log entry for human-readable console output.
 * Pattern: `[LEVEL] YYYY-MM-DD HH:mm:ss | message  { ...meta }`
 */
const consoleFormat = winston.format.combine(
  winston.format.colorize({ all: true }),
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.printf(({ level, message, timestamp, stack, ...meta }) => {
    const metaStr = Object.keys(meta).length
      ? `  ${JSON.stringify(meta)}`
      : '';
    const errorStack = stack ? `\n${stack}` : '';
    return `[${level}] ${timestamp as string} | ${message as string}${metaStr}${errorStack}`;
  }),
);

/**
 * JSON format written to log files — machine-parseable for log aggregators
 * such as Datadog, Loki, or Elastic.
 */
const fileFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  winston.format.json(),
);

// ─────────────────────────────────────────────────────────────────────────────
// Transports
// ─────────────────────────────────────────────────────────────────────────────

const transports: winston.transport[] = [
  // ── Error-only file ──────────────────────────────────────────────────────
  new winston.transports.File({
    filename: path.join(LOG_DIR, 'error.log'),
    level: 'error',
    format: fileFormat,
    maxsize: 10 * 1024 * 1024, // 10 MB
    maxFiles: 5,
    tailable: true,
  }),

  // ── Combined file (all levels) ───────────────────────────────────────────
  new winston.transports.File({
    filename: path.join(LOG_DIR, 'combined.log'),
    format: fileFormat,
    maxsize: 20 * 1024 * 1024, // 20 MB
    maxFiles: 10,
    tailable: true,
  }),
];

// ── Console transport (development / test) ───────────────────────────────────
if (process.env.NODE_ENV !== 'production') {
  transports.push(
    new winston.transports.Console({
      format: consoleFormat,
      // Suppress console noise during Jest runs; use --verbose to re-enable.
      silent: process.env.NODE_ENV === 'test' && !process.env.LOG_IN_TESTS,
    }),
  );
} else {
  // In production emit JSON to stdout so the container runtime captures it.
  transports.push(
    new winston.transports.Console({
      format: fileFormat,
    }),
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Logger instance
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Application logger. Use `logger.child({ requestId })` to create a
 * per-request child logger that automatically includes the request ID in
 * every log entry for that request lifecycle.
 *
 * @example
 * import { logger } from '@/utils/logger';
 * logger.info('Server started', { port: 3000 });
 *
 * // Per-request child logger in middleware:
 * const reqLogger = logger.child({ requestId: req.requestId });
 * reqLogger.error('Something went wrong', { error });
 */
export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === 'production' ? 'warn' : 'debug'),
  defaultMeta: { service: 'p2p-learning-api' },
  transports,
  // Do not exit on handled exceptions
  exitOnError: false,
});

// ── Catch unhandled exceptions / rejections via the logger ──────────────────
logger.exceptions.handle(
  new winston.transports.File({
    filename: path.join(LOG_DIR, 'exceptions.log'),
    format: fileFormat,
  }),
);

logger.rejections.handle(
  new winston.transports.File({
    filename: path.join(LOG_DIR, 'rejections.log'),
    format: fileFormat,
  }),
);

export default logger;
