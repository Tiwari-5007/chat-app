// src/middlewares/errorHandler.ts
import { Request, Response, NextFunction } from 'express';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
import logger from '../lib/logger';
import { AppError } from '../errors/AppError';
import { mapPrismaError } from '../errors/prismaErrorMapper';

export function errorHandler(err: any, req: Request, res: Response, _next: NextFunction) {
  let appError: AppError;
  let isSystemError: boolean = false;

  // Prisma errors -> AppError
  if (err instanceof PrismaClientKnownRequestError) {
    appError = mapPrismaError(err);
    isSystemError = true;
  }
  // Already AppError
  else if (err instanceof AppError) {
    appError = err;
  }
  // Unknown errors
  else {
    isSystemError = true;
    appError = new AppError(
      500,
      "INTERNAL_SERVER_ERROR",
      "Internal Server Error",
      { raw: err.message ?? err }
    );
  }

  if (isSystemError) {
    //---- Logging the System / Unknown / Prisma Error ----
    logger.error("API Error: ", {
      reqId: res.locals.requestId,
      method: req.method,
      path: req.path,
      status: appError.status,
      code: appError.code,
      msg: appError.message,
      details: appError.details,
      // stack: err.stack,
    });
  } else {
    //---- Logging the Clients Error ----
    logger.debug("Client Error:", {
      reqId: res.locals.requestId,
      method: req.method,
      path: req.path,
      status: appError.status,
      code: appError.code,
      msg: appError.message,
      details: appError.details
    });
  }

  // Log Response Sent
  logger.info("Response Sent: ", {
    reqId: res.locals.requestId,
    method: req.method,
    statusCode: appError.status,
    status: "FAILURE",
    msg: appError.message
  });

  return res.status(appError.status).json({
    status: "FAILURE",
    msg: appError.message,
    data: null
  });
}
