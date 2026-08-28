import { Router } from 'express';
import argon2 from 'argon2';
import { z } from 'zod';
import { pool } from '../db.js';
import { signToken, type Role } from '../auth.js';

export const authRouter = Router();

const registerSchema = z.object({
  name: z.string().min(2).max(120),
  email: z.string().email().transform(v => v.toLowerCase()),
  password: z.string().min(8).max(128),
  role: z.enum(['client', 'professional']).default('client'),
});

authRouter.post('/register', async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input', details: parsed.error.flatten() });
  const { name, email, password, role } = parsed.data;
  const existing = await pool.query('select id from users where email=$1', [email]);
  if (existing.rowCount) return res.status(409).json({ error: 'email_already_exists' });
  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
  const result = await pool.query(
    'insert into users (name,email,password_hash,role) values ($1,$2,$3,$4) returning id,name,email,role,created_at',
    [name,email,passwordHash,role]
  );
  const user = result.rows[0];
  res.status(201).json({ user, token: signToken(user as {id:number; role:Role; email:string}) });
});

const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });
authRouter.post('/login', async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input' });
  const email = parsed.data.email.toLowerCase();
  const result = await pool.query('select id,name,email,role,password_hash,created_at from users where email=$1', [email]);
  if (!result.rowCount) return res.status(401).json({ error: 'invalid_credentials' });
  const user = result.rows[0];
  const ok = await argon2.verify(user.password_hash, parsed.data.password);
  if (!ok) return res.status(401).json({ error: 'invalid_credentials' });
  delete user.password_hash;
  res.json({ user, token: signToken(user as {id:number; role:Role; email:string}) });
});
