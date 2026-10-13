import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db.js';
import { requireAuth, requireRole } from '../security.js';

export const claimsRouter = Router();
claimsRouter.use(requireAuth);

// The server determines the client and the assigned professional.
const newClaimSchema = z.object({
  jobId: z.number().int().positive(),
  warrantyVisitId: z.number().int().positive().nullable().optional(),
  reason: z.string().trim().min(2).max(120),
  description: z.string().trim().min(3).max(3000),
}).strict();

claimsRouter.post('/', requireRole('client'), async (req, res, next) => {
  const parsed = newClaimSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid_input' });
    return;
  }
  const { jobId, warrantyVisitId, reason, description } = parsed.data;
  try {
    const result = await pool.query(
      `INSERT INTO claims(job_id,warranty_visit_id,created_by,professional_id,
                          reason,description,status)
       SELECT j.id,$3,$1,q.professional_id,$4,$5,'open'
       FROM jobs j
       JOIN job_contracts jc ON jc.job_id=j.id
       JOIN job_quotes q ON q.id=jc.quote_id AND q.job_id=j.id
       WHERE j.id=$2 AND j.client_id=$1 AND j.status='completed'
         AND ($3::bigint IS NULL OR EXISTS(
           SELECT 1 FROM warranty_visits w
           WHERE w.id=$3 AND w.original_job_id=j.id
         ))
       RETURNING id,job_id,warranty_visit_id,reason,description,status,created_at`,
      [req.authUser!.id,jobId,warrantyVisitId ?? null,reason,description]
    );
    if (!result.rows[0]) {
      res.status(404).json({ error: 'job_not_found_or_not_completed' });
      return;
    }
    res.status(201).json(result.rows[0]);
  } catch (error) {
    next(error);
  }
});

// Privacy: clients see their claims, professionals only their own related
// cases; administration has read access for complaint management.
claimsRouter.get('/', async (req, res, next) => {
  const actor = req.authUser!;
  try {
    const conditions = actor.role === 'client'
      ? 'WHERE c.created_by=$1'
      : actor.role === 'professional'
        ? 'WHERE c.professional_id=$1'
        : '';
    const params = actor.role === 'admin' ? [] : [actor.id];
    const result = await pool.query(
      `SELECT c.id,c.job_id,c.warranty_visit_id,c.reason,c.description,
              c.status,c.resolution_note,c.created_at,c.resolved_at
       FROM claims c ${conditions}
       ORDER BY c.created_at DESC LIMIT 100`,
      params
    );
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
});

const responseSchema = z.object({
  description: z.string().trim().min(10).max(3000),
}).strict();

// The assigned professional may explain the fault and proposed solution.
// This never closes the client's claim or changes guarantee coverage.
claimsRouter.post('/:id/professional-response', requireRole('professional'), async (req, res, next) => {
  const id = z.coerce.number().int().positive().safeParse(req.params.id);
  const input = responseSchema.safeParse(req.body);
  if (!id.success || !input.success) {
    res.status(400).json({error:'invalid_input'}); return;
  }
  try {
    const result = await pool.query(
      `INSERT INTO audit_events(actor_id,action,resource_type,resource_id,metadata)
       SELECT $2,'claim_professional_response','claim',$1::text,
              jsonb_build_object('description',$3::text,'jobId',c.job_id)
       FROM claims c WHERE c.id=$1::bigint AND c.professional_id=$2::bigint
         AND c.status IN ('open','in_review')
       RETURNING id,created_at`,
      [id.data,req.authUser!.id,input.data.description]
    );
    if (!result.rows[0]) {
      res.status(404).json({error:'claim_not_open_or_unavailable'}); return;
    }
    res.status(201).json({saved:true,createdAt:result.rows[0].created_at});
  } catch (error) { next(error); }
});

// Client, assigned professional and Administration see the same recorded responses.
claimsRouter.get('/:id/updates', async (req, res, next) => {
  const id = z.coerce.number().int().positive().safeParse(req.params.id);
  if (!id.success) { res.status(400).json({error:'invalid_claim_id'}); return; }
  try {
    const allowed = await pool.query(
      `SELECT id FROM claims
       WHERE id=$1 AND ($2='admin' OR created_by=$3 OR professional_id=$3)`,
      [id.data,req.authUser!.role,req.authUser!.id]
    );
    if (!allowed.rows[0]) { res.status(404).json({error:'claim_not_found'}); return; }
    const events = await pool.query(
      `SELECT a.action,a.metadata->>'description' AS description,a.created_at
       FROM audit_events a WHERE a.resource_type='claim' AND a.resource_id=$1
         AND a.action IN ('claim_professional_response','claim_technical_review_requested')
       ORDER BY a.created_at ASC,a.id ASC LIMIT 100`,
      [String(id.data)]
    );
    res.json(events.rows);
  } catch (error) { next(error); }
});

const requestReviewSchema = z.object({
  note: z.string().trim().min(10).max(3000),
}).strict();

// Administration requests a diagnosis without deciding warranty coverage.
// Keeping the claim in_review preserves the block on new quotes.
claimsRouter.post('/:id/request-technical-review', requireRole('admin'), async (req, res, next) => {
  const id = z.coerce.number().int().positive().safeParse(req.params.id);
  const parsed = requestReviewSchema.safeParse(req.body);
  if (!id.success || !parsed.success) {
    res.status(400).json({error:'invalid_input'}); return;
  }
  let db;
  try {
    db = await pool.connect();
    await db.query('BEGIN');
    const result = await db.query(
      `UPDATE claims SET status='in_review'
       WHERE id=$1 AND status IN ('open','in_review')
       RETURNING id,job_id,status`,
      [id.data]
    );
    if (!result.rows[0]) {
      await db.query('ROLLBACK');
      res.status(409).json({error:'claim_not_open'}); return;
    }
    await db.query(
      `INSERT INTO audit_events(actor_id,action,resource_type,resource_id,metadata)
       VALUES($1,'claim_technical_review_requested','claim',$2,$3::jsonb)`,
      [req.authUser!.id,String(id.data),JSON.stringify({description:parsed.data.note,jobId:result.rows[0].job_id})]
    );
    await db.query('COMMIT');
    res.json(result.rows[0]);
  } catch (error) {
    if (db) await db.query('ROLLBACK').catch(() => undefined);
    next(error);
  } finally {db?.release();}
});

const resolveSchema = z.object({
  resolutionNote: z.string().trim().min(5).max(3000),
}).strict();

// Only admin can close a claim. The action and resolution are atomic and audited.
claimsRouter.patch('/:id/resolve', requireRole('admin'), async (req, res, next) => {
  const claimId = z.coerce.number().int().positive().safeParse(req.params.id);
  const parsed = resolveSchema.safeParse(req.body);
  if (!claimId.success || !parsed.success) {
    res.status(400).json({ error: 'invalid_input' });
    return;
  }
  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    const result = await client.query(
      `UPDATE claims SET status='resolved',resolution_note=$2,
              resolved_by=$3,resolved_at=now()
       WHERE id=$1 AND status IN ('open','in_review')
       RETURNING id,job_id,status,resolution_note,resolved_at`,
      [claimId.data,parsed.data.resolutionNote,req.authUser!.id]
    );
    if (!result.rows[0]) {
      await client.query('ROLLBACK');
      res.status(409).json({ error: 'claim_not_open' });
      return;
    }
    await client.query(
      `INSERT INTO audit_events(actor_id,action,resource_type,resource_id,metadata)
       VALUES($1,'claim_resolved','claim',$2,$3::jsonb)`,
      [req.authUser!.id,String(claimId.data),JSON.stringify({ jobId: result.rows[0].job_id })]
    );
    await client.query('COMMIT');
    res.json(result.rows[0]);
  } catch (error) {
    if (client) await client.query('ROLLBACK').catch(() => undefined);
    next(error);
  } finally {
    client?.release();
  }
});
