import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db.js';

export const claimsRouter = Router();

const schema = z.object({
  jobId: z.number().int().positive(),
  createdBy: z.number().int().positive(),
  reason: z.string().min(2).max(120),
  description: z.string().min(3).max(3000),
});

claimsRouter.post('/', async (req, res) => {
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input' });
  const d = parsed.data;
  const result = await pool.query(
    `insert into claims (job_id,created_by,reason,description,status)
     values ($1,$2,$3,$4,'open') returning *`,
    [d.jobId,d.createdBy,d.reason,d.description]
  );
  res.status(201).json(result.rows[0]);
});
