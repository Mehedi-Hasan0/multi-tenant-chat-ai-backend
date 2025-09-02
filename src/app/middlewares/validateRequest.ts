import { NextFunction, Request, Response } from 'express';
import { ZodObject } from 'zod';

const validateRequest =
  (zodSchema: ZodObject) =>
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await zodSchema.parseAsync({
        body: req.body,
        query: req.query,
        params: req.params,
        cookies: req.cookies,
      });

      return next();
    } catch (error) {
      next(error);
    }
  };

export default validateRequest;
