import { Request, Response, NextFunction } from 'express';
import multer from 'multer';
import logger from '../utils/logger';

interface ApiError extends Error {
  statusCode?: number;
  isOperational?: boolean;
}

export const errorHandler = (
  err: ApiError,
  req: Request,
  res: Response,
  _next: NextFunction
) => {
  let statusCode = err.statusCode || 500;
  if (err instanceof multer.MulterError) {
    statusCode = 400;
  } else if (String(err.message || '').includes('Unsupported file type')) {
    statusCode = 400;
  }

  const message = err.message || 'Internal Server Error';

  logger.error('Error occurred:', {
    statusCode,
    message,
    stack: err.stack,
    url: req.originalUrl,
    method: req.method,
  });

  res.status(statusCode).json({
    success: false,
    error: {
      message,
      ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
    },
  });
};

