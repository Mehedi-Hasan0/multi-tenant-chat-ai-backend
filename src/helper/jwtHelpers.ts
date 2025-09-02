import jwt, { JwtPayload, Secret, SignOptions } from 'jsonwebtoken';

const createToken = (
  payload: Record<string, unknown>,
  secret: string,
  expireTime: string,
): string => {
  const options: SignOptions = { expiresIn: expireTime as any };
  return jwt.sign(payload, secret, options);
};

const verifyToken = (token: string, secret: Secret): JwtPayload => {
  return jwt.verify(token, secret) as JwtPayload;
};

export const jwtHelpers = {
  createToken,
  verifyToken,
};
