import jwt, { type JwtPayload } from 'jsonwebtoken';

export type Role = 'client' | 'professional' | 'admin';

const ISSUER = 'mantenimiento-360';
const AUDIENCE = 'mantenimiento-360-api';

function tokenSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret || Buffer.byteLength(secret, 'utf8') < 32) {
    throw new Error('JWT_SECRET must contain at least 32 bytes of random data');
  }
  return secret;
}

// Access tokens are short-lived. Never trust a role embedded in an access token:
// requireAuth reloads role and account status from PostgreSQL for every request.
export function signAccessToken(userId: string): string {
  return jwt.sign({}, tokenSecret(), {
    algorithm: 'HS256',
    subject: userId,
    issuer: ISSUER,
    audience: AUDIENCE,
    expiresIn: '30m',
  });
}

export function verifyAccessToken(token: string): string {
  const decoded = jwt.verify(token, tokenSecret(), {
    algorithms: ['HS256'],
    issuer: ISSUER,
    audience: AUDIENCE,
  }) as JwtPayload;
  if (typeof decoded.sub !== 'string' || !/^[1-9]\d*$/.test(decoded.sub)) {
    throw new Error('Invalid token subject');
  }
  return decoded.sub;
}

export function checkJwtConfiguration(): void {
  tokenSecret();
}
