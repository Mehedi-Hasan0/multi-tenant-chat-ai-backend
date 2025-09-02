import { ErrorRequestHandler } from 'express';
import { IGenericErrorMessage } from '../../types';
import handleValidationError from '../../errors/handleValidationError';
import config from '../../config';
import ApiError from '../../errors/ApiError';
import { ZodError } from 'zod';
import handleZodError from '../../errors/handleZodError';
import handleCastError from '../../errors/handleCastError';
import httpStatus from 'http-status';

const globalErrorHandler: ErrorRequestHandler = async (error, req, res, next) => {
  // separating logs based on development and production
  // config.env === 'development'
  // ? console.log('globalErrorHandler ~~~', error)
  //   : errorLogger.error('globalErrorHandler ~~~', error);
  // console.log('globalErrorHandler ~~~', error);

  //   👆 using logger required winston library

  let statusCode = 500;
  let message = 'Something went wrong!';
  let errorMessages: IGenericErrorMessage[] = [];

  // Check if the error is a RateLimit error (429)
  if (error?.status === httpStatus.TOO_MANY_REQUESTS) {
    statusCode = httpStatus.TOO_MANY_REQUESTS;
    message = 'Too many requests. Please try again later.';
    errorMessages = [{ path: '', message: 'Rate limit exceeded. Please slow down.' }];
  } else if (error?.name === 'ValidationError') {
    const simplifiedError = handleValidationError(error);

    statusCode = simplifiedError.statusCode;
    message = simplifiedError.message;
    errorMessages = simplifiedError.errorMessages;
  } else if (error instanceof ZodError) {
    const simplifiedError = handleZodError(error);

    statusCode = simplifiedError.statusCode;
    message = simplifiedError.message;
    errorMessages = simplifiedError.errorMessages;
  } else if (error?.name === 'CastError') {
    const simplifiedError = handleCastError(error);

    statusCode = simplifiedError.statusCode;
    message = simplifiedError.message;
    errorMessages = simplifiedError.errorMessages;
  } else if (error instanceof Error) {
    // Check for MongoServerError: E11000
    if (error.name === 'MongoServerError' && (error as any).code === 11000) {
      statusCode = 400; // We can set a more appropriate status code for duplicate key errors
      message = 'User aleady exist. Try with another email.';
    } else {
      message = error?.message;
      errorMessages = error?.message ? [{ path: '', message: error?.message }] : [];
    }
  } else if (error instanceof ApiError) {
    statusCode = error?.statusCode;
    message = error?.message;
    errorMessages = error?.message ? [{ path: '', message: error?.message }] : [];
  }

  res.status(statusCode).json({
    success: false,
    message,
    errorMessages,
    stack: config.env !== 'production' ? error?.stack : undefined,
  });
};

export default globalErrorHandler;
