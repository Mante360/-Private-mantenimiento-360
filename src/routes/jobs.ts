import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db.js';
import { requireAuth, requireRole } from '../security.js';

export const jobsRouter = Router();
jobsRouter.use(requireAuth);

const createSchema = z.object({
  specialtyId: z.number().int().positive(),
  serviceId: z.number().int().positive().nullable().optional(),
  description: z.string().trim().min(3).max(3000),
  locality: z.string().trim().min(2).max(120),
}).strict();

// Deliberately excludes client_id, exact_address, personal data and all quotes.
const publicJobFields = `j.id,j.public_code,j.specialty_id,j.service_id,
  j.description,j.locality,j.status,j.created_at,j.updated_at`;


jobsRouter.get('/specialties', requireRole('client'), async (_req, res, next) => {
  try {
    const result = await pool.query(
      'SELECT id, name FROM specialties WHERE active=true ORDER BY name LIMIT 100'
    );
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
});

jobsRouter.post('/', requireRole('client'), async (req, res, next) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid_input' });
    return;
  }
  const d = parsed.data;
  try {
    const result = await pool.query(
      `INSERT INTO jobs(client_id,specialty_id,service_id,description,locality,status)
       SELECT $1,s.id,ss.id,$4,$5,'requested'
       FROM specialties s
       LEFT JOIN specialty_services ss
         ON ss.id=$3 AND ss.specialty_id=s.id AND ss.active
       WHERE s.id=$2 AND s.active AND ($3::bigint IS NULL OR ss.id IS NOT NULL)
       RETURNING id,public_code,specialty_id,service_id,description,locality,status,created_at`,
      [req.authUser!.id,d.specialtyId,d.serviceId ?? null,d.description,d.locality]
    );
    if (!result.rows[0]) {
      res.status(400).json({ error: 'invalid_specialty_or_service' });
      return;
    }
    res.status(201).json(result.rows[0]);
  } catch (error) {
    next(error);
  }
});

// Client: only own jobs. Professional: approved matching open jobs, no address.
// Blocked professionals cannot see the open request feed.
jobsRouter.get('/', async (req, res, next) => {
  const account = req.authUser!;
  try {
    if (account.role === 'client') {
      const result = await pool.query(
        `SELECT ${publicJobFields} FROM jobs j
         WHERE j.client_id=$1 ORDER BY j.created_at DESC LIMIT 100`,
        [account.id]
      );
      res.json(result.rows);
      return;
    }
    if (account.role === 'professional') {
      const result = await pool.query(
        `SELECT ${publicJobFields} FROM jobs j
         JOIN professional_profiles pp ON pp.user_id=$1
           AND pp.verification_status='approved' AND pp.available=true
         JOIN professional_specialties ps
           ON ps.professional_id=$1 AND ps.specialty_id=j.specialty_id
         WHERE j.status IN ('requested','quoted')
           AND (j.service_id IS NULL OR EXISTS(
             SELECT 1 FROM professional_services pts
             WHERE pts.professional_id=$1 AND pts.service_id=j.service_id
           ))
           AND NOT EXISTS(
             SELECT 1 FROM professional_restrictions pr
             WHERE pr.professional_id=$1 AND pr.lifted_at IS NULL
           )
           AND NOT EXISTS(
             SELECT 1 FROM job_quotes q
             WHERE q.job_id=j.id AND q.professional_id=$1
           )
         ORDER BY j.created_at DESC LIMIT 100`,
        [account.id]
      );
      res.json(result.rows);
      return;
    }
    const result = await pool.query(
      `SELECT ${publicJobFields} FROM jobs j
       ORDER BY j.created_at DESC LIMIT 100`
    );
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
});

// Accepted contracts visible to the chosen professional only.
jobsRouter.get('/mine', requireRole('professional'), async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT ${publicJobFields},jq.amount,jq.description AS quote_description,
         jq.warranty_days,jc.confirmed_at FROM jobs j
       JOIN job_contracts jc ON jc.job_id=j.id
       JOIN job_quotes jq ON jq.id=jc.quote_id AND jq.job_id=j.id
       WHERE jq.professional_id=$1
       ORDER BY jc.confirmed_at DESC LIMIT 100`,
      [req.authUser!.id]
    );
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
});

// Only the selected professional may start an accepted contract, once.
jobsRouter.post('/:id/start', requireRole('professional'), async (req, res, next) => {
  const id = z.coerce.number().int().positive().safeParse(req.params.id);
  if (!id.success) {
    res.status(400).json({ error: 'invalid_job_id' });
    return;
  }
  let db;
  try {
    db = await pool.connect();
    await db.query('BEGIN');
    const result = await db.query(
      `SELECT j.id,j.status FROM jobs j
       JOIN job_contracts jc ON jc.job_id=j.id
       JOIN job_quotes jq ON jq.id=jc.quote_id AND jq.job_id=j.id
       WHERE j.id=$1 AND jq.professional_id=$2 FOR UPDATE OF j`,
      [id.data,req.authUser!.id]
    );
    const job = result.rows[0];
    if (!job) {
      await db.query('ROLLBACK');
      res.status(404).json({ error: 'job_not_found' });
      return;
    }
    if (job.status !== 'confirmed') {
      await db.query('ROLLBACK');
      res.status(409).json({ error: 'job_cannot_be_started' });
      return;
    }
    await db.query(
      "UPDATE jobs SET status='in_progress',updated_at=now() WHERE id=$1",
      [id.data]
    );
    await db.query(
      "INSERT INTO job_status_events(job_id,actor_id,old_status,new_status) VALUES($1,$2,'confirmed','in_progress')",
      [id.data,req.authUser!.id]
    );
    await db.query('COMMIT');
    res.json({ jobId:id.data, status:'in_progress' });
  } catch (error) {
    if (db) await db.query('ROLLBACK').catch(() => undefined);
    next(error);
  } finally {
    db?.release();
  }
});

// Professional reports finishing work; this is NOT client approval or payment release.
jobsRouter.post('/:id/report-completed', requireRole('professional'), async (req, res, next) => {
  const id = z.coerce.number().int().positive().safeParse(req.params.id);
  if (!id.success) {
    res.status(400).json({ error: 'invalid_job_id' });
    return;
  }
  let db;
  try {
    db = await pool.connect();
    await db.query('BEGIN');
    const found = await db.query(
      `SELECT j.id,j.status FROM jobs j
       JOIN job_contracts jc ON jc.job_id=j.id
       JOIN job_quotes jq ON jq.id=jc.quote_id AND jq.job_id=j.id
       WHERE j.id=$1 AND jq.professional_id=$2 FOR UPDATE OF j`,
      [id.data,req.authUser!.id]
    );
    const job = found.rows[0];
    if (!job) {
      await db.query('ROLLBACK');
      res.status(404).json({ error: 'job_not_found' });
      return;
    }
    if (job.status !== 'in_progress') {
      await db.query('ROLLBACK');
      res.status(409).json({ error: 'job_not_in_progress' });
      return;
    }
    await db.query("UPDATE jobs SET status='completed',updated_at=now() WHERE id=$1", [id.data]);
    await db.query(
      "INSERT INTO job_status_events(job_id,actor_id,old_status,new_status,note) VALUES($1,$2,'in_progress','completed','Profesional informó trabajo terminado; pendiente de revisión del cliente')",
      [id.data,req.authUser!.id]
    );
    await db.query('COMMIT');
    res.json({ jobId:id.data, status:'completed', clientApproved:false, paymentProcessed:false });
  } catch (error) {
    if (db) await db.query('ROLLBACK').catch(() => undefined);
    next(error);
  } finally {
    db?.release();
  }
});

// Client-only conformity and review. This does not release payments or waive guarantees.
const reviewInput = z.object({
  stars: z.number().int().min(1).max(5),
  comment: z.string().trim().max(3000),
}).strict();

jobsRouter.get('/:id/review', requireRole('client','professional','admin'), async (req, res, next) => {
  const id = z.coerce.number().int().positive().safeParse(req.params.id);
  if (!id.success) { res.status(400).json({error:'invalid_job_id'}); return; }
  try {
    const result = await pool.query(
      `SELECT r.stars,r.comment,r.created_at FROM ratings r
       JOIN jobs j ON j.id=r.job_id
       WHERE r.job_id=$1 AND (j.client_id=$2 OR $3='admin' OR ($3='professional' AND EXISTS (SELECT 1 FROM job_contracts jc JOIN job_quotes q ON q.id=jc.quote_id AND q.job_id=j.id WHERE jc.job_id=j.id AND q.professional_id=$2)))`,
      [id.data, req.authUser!.id,req.authUser!.role]
    );
    res.json(result.rows[0] ?? null);
  } catch (error) { next(error); }
});

jobsRouter.post('/:id/review', requireRole('client'), async (req, res, next) => {
  const id = z.coerce.number().int().positive().safeParse(req.params.id);
  const parsed = reviewInput.safeParse(req.body);
  if (!id.success || !parsed.success) {
    res.status(400).json({error:'invalid_input'}); return;
  }
  let db;
  try {
    db = await pool.connect();
    await db.query('BEGIN');
    const found = await db.query(
      'SELECT id,status FROM jobs WHERE id=$1 AND client_id=$2 FOR UPDATE',
      [id.data,req.authUser!.id]
    );
    if (!found.rows[0] || found.rows[0].status !== 'completed') {
      await db.query('ROLLBACK');
      res.status(409).json({error:'job_not_ready_for_review'});
      return;
    }
    const openClaims = await db.query(
      "SELECT id FROM claims WHERE job_id=$1 AND status IN ('open','in_review') LIMIT 1",
      [id.data]
    );
    if (openClaims.rowCount) {
      await db.query('ROLLBACK');
      res.status(409).json({error:'claim_pending_review'});
      return;
    }
    const rated = await db.query(
      `INSERT INTO ratings(job_id,client_id,stars,comment)
       VALUES($1,$2,$3,$4)
       ON CONFLICT (job_id) WHERE job_id IS NOT NULL DO NOTHING
       RETURNING stars,comment,created_at`,
      [id.data,req.authUser!.id,parsed.data.stars,parsed.data.comment || null]
    );
    if (!rated.rows[0]) {
      await db.query('ROLLBACK');
      res.status(409).json({error:'review_already_submitted'});
      return;
    }
    await db.query(
      `INSERT INTO job_status_events(job_id,actor_id,old_status,new_status,note)
       VALUES($1,$2,'completed','completed','Conformidad del cliente y reseña registradas')`,
      [id.data,req.authUser!.id]
    );
    await db.query('COMMIT');
    res.status(201).json({ ...rated.rows[0],clientApproved:true,paymentProcessed:false });
  } catch (error) {
    if (db) await db.query('ROLLBACK').catch(() => undefined);
    next(error);
  } finally { db?.release(); }
});

// Status history: job owner, selected professional, or administrator only.
jobsRouter.get('/:id/events', async (req, res, next) => {
  const id = z.coerce.number().int().positive().safeParse(req.params.id);
  if (!id.success) {
    res.status(400).json({ error: 'invalid_job_id' });
    return;
  }
  const account = req.authUser!;
  try {
    const result = await pool.query(
      `SELECT e.old_status,e.new_status,e.note,e.created_at
       FROM job_status_events e JOIN jobs j ON j.id=e.job_id
       WHERE j.id=$1 AND (
         ($2='client' AND j.client_id=$3)
         OR ($2='professional' AND EXISTS(
           SELECT 1 FROM job_contracts jc JOIN job_quotes jq
             ON jq.id=jc.quote_id AND jq.job_id=j.id
           WHERE jc.job_id=j.id AND jq.professional_id=$3
         ))
         OR $2='admin'
       ) ORDER BY e.created_at ASC,e.id ASC LIMIT 100`,
      [id.data,account.role,account.id]
    );
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
});

// No exact_address: address sharing requires separate consent-aware API.
jobsRouter.get('/:id', async (req, res, next) => {
  const id = z.coerce.number().int().positive().safeParse(req.params.id);
  if (!id.success) {
    res.status(400).json({ error: 'invalid_job_id' });
    return;
  }
  const account = req.authUser!;
  try {
    const result = await pool.query(
      `SELECT ${publicJobFields}
       FROM jobs j WHERE j.id=$1 AND (
         ($2='client' AND j.client_id=$3)
         OR ($2='professional' AND EXISTS(
           SELECT 1 FROM job_contracts jc JOIN job_quotes jq
             ON jq.id=jc.quote_id AND jq.job_id=j.id
           WHERE jc.job_id=j.id AND jq.professional_id=$3
         ))
         OR ($2='admin')
       )`,
      [id.data,account.role,account.id]
    );
    if (!result.rows[0]) {
      res.status(404).json({ error: 'job_not_found' });
      return;
    }
    res.json(result.rows[0]);
  } catch (error) {
    next(error);
  }
});
