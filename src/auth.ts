import jwt from 'jsonwebtoken';

export type Role = 'client' | 'professional' | 'admin';

export function signToken(user: { id: number; role: Role; email: string }) {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET is required');
  return jwt.sign(user, secret, { expiresIn: '7d' });
}
