import { NextFunction, Request, Response } from 'express';
import ApiError from '../../errors/ApiError';
import httpStatus from 'http-status';
import { jwtHelpers } from '../../helper/jwtHelpers';
import config from '../../config';
import { Secret } from 'jsonwebtoken';

const auth =
  (...requiredRoles: string[]) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      // const token = req.headers.authorization; // access token

      // if (!token) {
      //   throw new ApiError(httpStatus.UNAUTHORIZED, 'Your are not authorized');
      // }

      // previous way👆
      const authHeader = req.headers.authorization;
      if (!authHeader) {
        throw new ApiError(httpStatus.UNAUTHORIZED, 'You are not authorized');
      }

      const token = authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : authHeader;

      let varifiedUser = null;

      varifiedUser = jwtHelpers.verifyToken(token, config.jwt.secret as Secret);

      (req as any).user = varifiedUser; // return role, id(own generated)

      if (requiredRoles.length && !requiredRoles.includes(varifiedUser.role)) {
        throw new ApiError(httpStatus.FORBIDDEN, "Forbidden. You're not allowed for this request.");
      }

      next();
    } catch (error) {
      next(error);
    }
  };

export default auth;
