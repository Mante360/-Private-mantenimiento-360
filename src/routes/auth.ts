import { Router } from 'express';
import argon2 from 'argon2';
import { z } from 'zod';
import { pool } from '../db.js';
import { signAccessToken } from '../auth.js';
import { requireAuth } from '../security.js';

export const authRouter = Router();

// The public route must NEVER create an administrator or verified professional.
// Strong passwords and email verification are separate requirements.
const registerSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(255).transform(v => v.toLowerCase()),
  password: z.string().min(12).max(128),
  role: z.enum(['client', 'professional']).default('client'),
}).strict();

authRouter.post('/register', async (req, res, next) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid_input' });
    return;
  }
  const { name, email, password, role } = parsed.data;
  const client = await pool.connect().catch(next);
  if (!client) return;
  try {
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    await client.query('BEGIN');
    const created = await client.query(
      `INSERT INTO users(name,email,password_hash,role,status)
       VALUES($1,$2,$3,$4,'active')
       RETURNING id,name,email,role,created_at`,
      [name,email,passwordHash,role]
    );
    const user = created.rows[0];
    if (role === 'professional') {
      await client.query(
        `INSERT INTO professional_profiles(user_id,verification_status,available)
         VALUES($1,'pending',false)`,
        [user.id]
      );
    }
    await client.query('COMMIT');
    res.status(201).json({
      user,
      token: signAccessToken(String(user.id)),
      expiresIn: 1800,
    });
  } catch (error: unknown) {
    await client.query('ROLLBACK').catch(() => undefined);
    if ((error as { code?: string })?.code === '23505') {
      res.status(409).json({ error: 'account_unavailable' });
    } else {
      next(error);
    }
  } finally {
    client.release();
  }
});

const loginSchema = z.object({
  email: z.string().trim().email().max(255).transform(v => v.toLowerCase()),
  password: z.string().min(1),
}).strict();

authRouter.post('/login', async (req, res, next) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid_input' });
    return;
  }
  try {
    const result = await pool.query(
      `SELECT id,name,email,role,password_hash,status
       FROM users WHERE email=$1`,
      [parsed.data.email]
    );
    const account = result.rows[0];
    if (!account) {
      res.status(401).json({ error: 'invalid_credentials' });
      return;
    }
    const ok = await argon2.verify(account.password_hash, parsed.data.password);
    if (!ok) {
      res.status(401).json({ error: 'invalid_credentials' });
      return;
    }
    if (account.status !== 'active') {
      res.status(403).json({ error: 'account_unavailable' });
      return;
    }
    res.json({
      user: { id: account.id, name: account.name, email: account.email, role: account.role },
      token: signAccessToken(String(account.id)),
      expiresIn: 1800,
    });
  } catch (error) {
    next(error);
  }
});

authRouter.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.authUser });
});
