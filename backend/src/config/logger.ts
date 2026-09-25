import winston from 'winston';
import { env } from '@/config/env';

const { combine, timestamp, errors, json, colorize, simple } = winston.format;

/**
 * Centralised Winston logger.
 * - Development: colorized console output
 * - Production/Test: JSON structured output
 */
export const logger = winston.createLogger({
  level: env.NODE_ENV === 'production' ? 'info' : 'debug',
  format: combine(timestamp(), errors({ stack: true }), json()),
  transports: [
    new winston.transports.Console({
      format:
        env.NODE_ENV === 'development'
          ? combine(colorize(), simple())
          : combine(timestamp(), json()),
    }),
  ],
});
