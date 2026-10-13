import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db.js';
import { requireAuth, requireRole } from '../security.js';

export const quotesRouter = Router();
quotesRouter.use(requireAuth);

const jobIdFrom = (value: unknown) => z.coerce.number().int().positive().safeParse(value);
const quoteInput = z.object({
  amount: z.number().positive().max(9999999999.99),
  description: z.string().trim().min(3).max(3000),
  warrantyDays: z.number().int().min(0).max(3650),
}).strict();

// Only an approved, available professional with the matching approved service
// may submit a quote. The job lock serializes quoting with client acceptance.
quotesRouter.post('/:jobId/quotes', requireRole('professional'), async (req, res, next) => {
  const jobId = jobIdFrom(req.params.jobId);
  const input = quoteInput.safeParse(req.body);
  if (!jobId.success || !input.success) {
    res.status(400).json({ error: 'invalid_input' });
    return;
  }
  let db;
  try {
    db = await pool.connect();
    await db.query('BEGIN');
    const jobs = await db.query(
      'SELECT id,status,specialty_id,service_id FROM jobs WHERE id=$1 FOR UPDATE',
      [jobId.data]
    );
    const job = jobs.rows[0];
    if (!job) {
      await db.query('ROLLBACK');
      res.status(404).json({ error: 'job_not_available' });
      return;
    }
    if (!['requested', 'quoted'].includes(job.status)) {
      await db.query('ROLLBACK');
      res.status(409).json({ error: 'job_no_longer_accepting_quotes' });
      return;
    }

    const pendingClaim = await db.query(
      "SELECT 1 FROM claims WHERE professional_id=$1 AND status IN ('open','in_review') LIMIT 1",
      [req.authUser!.id]
    );
    if (pendingClaim.rowCount) {
      await db.query('ROLLBACK');
      res.status(403).json({error:'professional_has_open_claim'});
      return;
    }

    const professional = await db.query(
      `SELECT pp.user_id FROM professional_profiles pp
       JOIN professional_specialties ps
         ON ps.professional_id=pp.user_id AND ps.specialty_id=$2
       WHERE pp.user_id=$1 AND pp.verification_status='approved'
         AND pp.available=true
         AND ($3::bigint IS NULL OR EXISTS (
           SELECT 1 FROM professional_services pts
           WHERE pts.professional_id=$1 AND pts.service_id=$3
         ))
         AND NOT EXISTS (
           SELECT 1 FROM professional_restrictions pr
           WHERE pr.professional_id=$1 AND pr.lifted_at IS NULL
         )
         AND NOT EXISTS (
           SELECT 1 FROM claims c
           WHERE c.professional_id=$1 AND c.status IN ('open','in_review')
         )`,
      [req.authUser!.id,job.specialty_id,job.service_id]
    );
    if (!professional.rowCount) {
      await db.query('ROLLBACK');
      res.status(403).json({ error: 'professional_not_eligible' });
      return;
    }

    const created = await db.query(
      `INSERT INTO job_quotes(job_id,professional_id,amount,description,warranty_days)
       VALUES($1,$2,$3,$4,$5)
       ON CONFLICT(job_id,professional_id) DO NOTHING
       RETURNING id,job_id,amount,description,warranty_days,status,submitted_at`,
      [jobId.data,req.authUser!.id,input.data.amount,input.data.description,input.data.warrantyDays]
    );
    if (!created.rows[0]) {
      await db.query('ROLLBACK');
      res.status(409).json({ error: 'quote_already_submitted' });
      return;
    }

    if (job.status === 'requested') {
      await db.query(
        `UPDATE jobs SET status='quoted',updated_at=now() WHERE id=$1`,
        [jobId.data]
      );
      await db.query(
        `INSERT INTO job_status_events(job_id,actor_id,old_status,new_status)
         VALUES($1,$2,'requested','quoted')`,
        [jobId.data,req.authUser!.id]
      );
    }
    await db.query('COMMIT');
    res.status(201).json(created.rows[0]);
  } catch (error) {
    if (db) await db.query('ROLLBACK').catch(() => undefined);
    next(error);
  } finally {
    db?.release();
  }
});

// Clients may compare ALL quotes only on their own request. Professionals may
// view their OWN quote/status, not competing prices, identities or comments.
quotesRouter.get('/:jobId/quotes', requireRole('client','professional'), async (req, res, next) => {
  const jobId = jobIdFrom(req.params.jobId);
  if (!jobId.success) {
    res.status(400).json({ error: 'invalid_job_id' });
    return;
  }
  try {
    if (req.authUser!.role === 'client') {
      const owner = await pool.query(
        'SELECT id FROM jobs WHERE id=$1 AND client_id=$2',
        [jobId.data,req.authUser!.id]
      );
      if (!owner.rows[0]) {
        res.status(404).json({ error: 'job_not_found' });
        return;
      }
      const result = await pool.query(
        `SELECT q.id,q.job_id,q.professional_id,u.name AS professional_name,
                q.amount,q.description,q.warranty_days,q.status,q.submitted_at
         FROM job_quotes q JOIN users u ON u.id=q.professional_id
         WHERE q.job_id=$1 ORDER BY q.submitted_at ASC,q.id ASC`,
        [jobId.data]
      );
      res.json(result.rows);
      return;
    }
    const own = await pool.query(
      `SELECT q.id,q.job_id,q.amount,q.description,q.warranty_days,
              q.status,q.submitted_at
       FROM job_quotes q WHERE q.job_id=$1 AND q.professional_id=$2`,
      [jobId.data,req.authUser!.id]
    );
    if (!own.rows[0]) {
      res.status(404).json({ error: 'quote_not_found' });
      return;
    }
    res.json(own.rows);
  } catch (error) {
    next(error);
  }
});

const acceptInput = z.object({
  quoteId: z.number().int().positive(),
}).strict();

// Client decides once. Lock the original job so two simultaneous acceptances
// cannot confirm different professionals. No payment is collected by this API.
quotesRouter.post('/:jobId/accept-quote', requireRole('client'), async (req, res, next) => {
  const jobId = jobIdFrom(req.params.jobId);
  const input = acceptInput.safeParse(req.body);
  if (!jobId.success || !input.success) {
    res.status(400).json({ error: 'invalid_input' });
    return;
  }
  let db;
  try {
    db = await pool.connect();
    await db.query('BEGIN');
    const found = await db.query(
      'SELECT id,status FROM jobs WHERE id=$1 AND client_id=$2 FOR UPDATE',
      [jobId.data,req.authUser!.id]
    );
    const job = found.rows[0];
    if (!job) {
      await db.query('ROLLBACK');
      res.status(404).json({ error: 'job_not_found' });
      return;
    }
    if (job.status !== 'quoted') {
      await db.query('ROLLBACK');
      res.status(409).json({ error: 'job_not_accepting_selection' });
      return;
    }
    const winner = await db.query(
      `SELECT id,professional_id FROM job_quotes
       WHERE id=$1 AND job_id=$2 AND status='submitted'`,
      [input.data.quoteId,jobId.data]
    );
    if (!winner.rows[0]) {
      await db.query('ROLLBACK');
      res.status(404).json({ error: 'quote_not_found' });
      return;
    }
    await db.query(
      `UPDATE job_quotes SET status=CASE WHEN id=$2 THEN 'accepted' ELSE 'not_selected' END,
         updated_at=now()
       WHERE job_id=$1 AND status='submitted'`,
      [jobId.data,input.data.quoteId]
    );
    await db.query(
      'INSERT INTO job_contracts(job_id,quote_id) VALUES($1,$2)',
      [jobId.data,input.data.quoteId]
    );
    await db.query(
      `UPDATE jobs SET status='confirmed',updated_at=now() WHERE id=$1`,
      [jobId.data]
    );
    await db.query(
      `INSERT INTO job_status_events(job_id,actor_id,old_status,new_status)
       VALUES($1,$2,'quoted','confirmed')`,
      [jobId.data,req.authUser!.id]
    );
    await db.query('COMMIT');
    res.json({
      jobId:jobId.data,
      quoteId:input.data.quoteId,
      status:'confirmed',
      paymentProcessed:false,
    });
  } catch (error) {
    if (db) await db.query('ROLLBACK').catch(() => undefined);
    next(error);
  } finally {
    db?.release();
  }
});
