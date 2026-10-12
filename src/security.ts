import type { RequestHandler } from 'express';
import { pool } from './db.js';
import { verifyAccessToken, type Role } from './auth.js';

export interface AuthUser {
  id: string;
  role: Role;
  name: string;
  email: string;
}

declare global {
  namespace Express {
    interface Request {
      authUser?: AuthUser;
    }
  }
}

export const requireAuth: RequestHandler = async (req, res, next) => {
  const authorization = req.header('authorization') || '';
  const match = /^Bearer ([A-Za-z0-9._-]+)$/.exec(authorization);
  if (!match) {
    res.status(401).json({ error: 'authentication_required' });
    return;
  }
  let userId: string;
  try {
    userId = verifyAccessToken(match[1]);
  } catch {
    res.status(401).json({ error: 'invalid_or_expired_token' });
    return;
  }
  try {
    const result = await pool.query(
      'SELECT id, name, email, role, status FROM users WHERE id=$1',
      [userId]
    );
    const user = result.rows[0];
    if (!user || user.status !== 'active') {
      res.status(403).json({ error: 'account_unavailable' });
      return;
    }
    if (!['client', 'professional', 'admin'].includes(user.role)) {
      res.status(403).json({ error: 'role_forbidden' });
      return;
    }
    req.authUser = {
      id: String(user.id),
      name: user.name,
      email: user.email,
      role: user.role as Role,
    };
    next();
  } catch (error) {
    next(error);
  }
};

export const requireRole = (...allowed: Role[]): RequestHandler => (req, res, next) => {
  if (!req.authUser) {
    res.status(401).json({ error: 'authentication_required' });
    return;
  }
  if (!allowed.includes(req.authUser.role)) {
    res.status(403).json({ error: 'role_forbidden' });
    return;
  }
  next();
};
