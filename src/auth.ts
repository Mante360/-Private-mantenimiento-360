import jwt, { type JwtPayload } from 'jsonwebtoken';

export type Role = 'client' | 'professional' | 'admin' | 'subadmin';

const ISSUER = 'mantenimiento-360';
const AUDIENCE = 'mantenimiento-360-api';
const ACCESS_SECONDS = 30 * 60;
const MAX_SESSION_SECONDS = 4 * 60 * 60;

function tokenSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret || Buffer.byteLength(secret, 'utf8') < 32) {
    throw new Error('JWT_SECRET must contain at least 32 bytes of random data');
  }
  return secret;
}

// Access tokens are short-lived. Never trust a role embedded in an access token:
// requireAuth reloads role and account status from PostgreSQL for every request.
function decodeAccessToken(token: string): JwtPayload {
  const decoded = jwt.verify(token, tokenSecret(), {
    algorithms: ['HS256'],
    issuer: ISSUER,
    audience: AUDIENCE,
  }) as JwtPayload;
  if (typeof decoded.sub !== 'string' || !/^[1-9]\d*$/.test(decoded.sub)) {
    throw new Error('Invalid token subject');
  }
  return decoded;
}

// A working test session may renew, but cannot extend beyond four hours since
// its original login. An idle or expired token cannot be used for renewal.
export function signAccessToken(userId: string, originalLogin?: number): string {
  const now = Math.floor(Date.now() / 1000);
  const startedAt = originalLogin ?? now;
  if (!Number.isSafeInteger(startedAt) || startedAt > now ||
      now - startedAt >= MAX_SESSION_SECONDS) {
    throw new Error('session_max_age');
  }
  const expiresIn = Math.min(ACCESS_SECONDS, MAX_SESSION_SECONDS - (now - startedAt));
  return jwt.sign({ sessionStartedAt: startedAt }, tokenSecret(), {
    algorithm: 'HS256',
    subject: userId,
    issuer: ISSUER,
    audience: AUDIENCE,
    expiresIn,
  });
}

export function verifyAccessToken(token: string): string {
  return decodeAccessToken(token).sub!;
}

export function renewAccessToken(token: string): { token: string; expiresIn: number } {
  const decoded = decodeAccessToken(token);
  const now = Math.floor(Date.now() / 1000);
  // Legacy tokens issued before this change carry only a signed 'iat'.
  const startedAt = decoded.sessionStartedAt ?? decoded.iat;
  if (typeof startedAt !== 'number' || !Number.isSafeInteger(startedAt) ||
      startedAt > now || now - startedAt >= MAX_SESSION_SECONDS) {
    throw new Error('session_max_age');
  }
  return {
    token: signAccessToken(decoded.sub!, startedAt),
    expiresIn: Math.min(ACCESS_SECONDS, MAX_SESSION_SECONDS - (now - startedAt))
  };
}

export function checkJwtConfiguration(): void {
  tokenSecret();
}
