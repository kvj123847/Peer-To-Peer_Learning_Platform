import { Request, Response, NextFunction } from 'express';
import { logger } from '@/config/logger';

/**
 * Typed application error with HTTP status code.
 * Extends native Error so it can be thrown anywhere in the service layer
 * and caught by the global error handler.
 */
export class ApiError extends Error {
  public readonly statusCode: number;
  public readonly isOperational: boolean;

  constructor(statusCode: number, message: string, isOperational = true) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    this.name = 'ApiError';
    Error.captureStackTrace(this, this.constructor);
  }

  /** 400 Bad Request */
  static badRequest(message: string): ApiError {
    return new ApiError(400, message);
  }

  /** 401 Unauthorized */
  static unauthorized(message = 'Unauthorized'): ApiError {
    return new ApiError(401, message);
  }

  /** 403 Forbidden */
  static forbidden(message = 'Forbidden'): ApiError {
    return new ApiError(403, message);
  }

  /** 404 Not Found */
  static notFound(message: string): ApiError {
    return new ApiError(404, message);
  }

  /** 409 Conflict */
  static conflict(message: string): ApiError {
    return new ApiError(409, message);
  }

  /** 422 Unprocessable Entity */
  static unprocessable(message: string): ApiError {
    return new ApiError(422, message);
  }

  /** 429 Too Many Requests */
  static tooManyRequests(message = 'Too many requests'): ApiError {
    return new ApiError(429, message);
  }

  /** 500 Internal Server Error */
  static internal(message = 'Internal server error'): ApiError {
    return new ApiError(500, message, false);
  }
}

/**
 * Global Express error handler middleware.
 * Formats all errors into a consistent JSON envelope.
 * Must be registered LAST in the Express middleware stack.
 */
export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof ApiError || (err as any).statusCode) {
    const statusCode = (err as any).statusCode || 500;
    logger.warn('Operational error', {
      statusCode,
      message: err.message,
      path: req.path,
      method: req.method,
    });
    res.status(statusCode).json({
      success: false,
      error: {
        statusCode,
        message: err.message,
        ...((err as any).code ? { code: (err as any).code } : {}),
      },
    });
    return;
  }

  // Unhandled / programming errors
  logger.error('Unhandled error', {
    message: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method,
  });

  res.status(500).json({
    success: false,
    error: {
      statusCode: 500,
      message: 'Internal server error',
    },
  });
}

/**
 * 404 handler – placed after all routes to catch unmatched requests.
 */
export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    success: false,
    error: {
      statusCode: 404,
      message: `Route ${req.method} ${req.path} not found`,
    },
  });
}
