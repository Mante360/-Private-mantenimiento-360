import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db.js';

export const jobsRouter = Router();

const createSchema = z.object({
  clientId: z.number().int().positive(),
  service: z.string().min(2).max(100),
  description: z.string().min(3).max(2000),
  locality: z.string().min(2).max(120),
});

jobsRouter.post('/', async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input' });
  const d = parsed.data;
  const result = await pool.query(
    `insert into jobs (client_id,service,description,locality,status)
     values ($1,$2,$3,$4,'requested') returning *`,
    [d.clientId,d.service,d.description,d.locality]
  );
  res.status(201).json(result.rows[0]);
});

jobsRouter.get('/', async (_req, res) => {
  const result = await pool.query('select * from jobs order by created_at desc limit 100');
  res.json(result.rows);
});
