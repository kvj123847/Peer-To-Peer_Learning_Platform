/**
 * @file server.ts
 * @description HTTP server entrypoint with database lifecycle management and graceful shutdown.
 */

import http from 'http';
import app from '@/app';
import { env } from '@/config/env';
import { connectDatabase, disconnectDatabase } from '@/config/database';
import { logger } from '@/utils/logger';

async function bootstrap() {
  try {
    logger.info('Initializing P2P Student Learning App backend...');

    // Connect to PostgreSQL database
    await connectDatabase();
    logger.info('Database connection established successfully');

    // Create HTTP server
    const server = http.createServer(app);

    server.listen(env.PORT, () => {
      logger.info(`Server listening on port ${env.PORT} [${env.NODE_ENV}]`);
      logger.info(`API Base URL: http://localhost:${env.PORT}/api/${env.API_VERSION}`);
    });

    // Graceful shutdown handling
    const shutdown = async (signal: string) => {
      logger.info(`Received ${signal}. Initiating graceful shutdown...`);

      server.close(async () => {
        logger.info('HTTP server closed');
        try {
          await disconnectDatabase();
          logger.info('Database disconnected cleanly');
          process.exit(0);
        } catch (err) {
          logger.error('Error during database teardown', { error: err });
          process.exit(1);
        }
      });

      // Force exit after 10s if connections refuse to drain
      setTimeout(() => {
        logger.error('Graceful shutdown timeout exceeded. Forcing termination.');
        process.exit(1);
      }, 10000).unref();
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

    process.on('uncaughtException', (error) => {
      logger.error('Uncaught Exception occurred', { error });
      shutdown('uncaughtException');
    });

    process.on('unhandledRejection', (reason) => {
      logger.error('Unhandled Promise Rejection occurred', { reason });
    });
  } catch (error) {
    logger.error('Fatal initialization error during server bootstrap', { error });
    process.exit(1);
  }
}

bootstrap();
