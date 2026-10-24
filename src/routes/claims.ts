import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db.js';
import { requireAuth, requireRole } from '../security.js';
import { getLabClaimReminder } from '../lab-claim-deadlines.js';

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
  let db;
  try {
    db = await pool.connect();
    await db.query('BEGIN');
    // Serialize new claims for the same job to prevent concurrent open duplicates.
    const allowed = await db.query(
      `SELECT j.id FROM jobs j
       JOIN job_contracts jc ON jc.job_id=j.id
       JOIN job_quotes q ON q.id=jc.quote_id AND q.job_id=j.id
       WHERE j.id=$1 AND j.client_id=$2 AND j.status='completed'
         AND ($3::bigint IS NULL OR EXISTS(
           SELECT 1 FROM warranty_visits w
           WHERE w.id=$3 AND w.original_job_id=j.id
         ))
       FOR UPDATE OF j`,
      [jobId,req.authUser!.id,warrantyVisitId ?? null]
    );
    if (!allowed.rows[0]) {
      await db.query('ROLLBACK');
      res.status(404).json({ error: 'job_not_found_or_not_completed' });
      return;
    }
    const pending = await db.query(
      "SELECT 1 FROM claims WHERE job_id=$1 AND status IN ('open','in_review') LIMIT 1",
      [jobId]
    );
    if (pending.rowCount) {
      await db.query('ROLLBACK');
      res.status(409).json({ error: 'claim_already_open' });
      return;
    }
    const result = await db.query(
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
    await db.query('COMMIT');
    res.status(201).json(result.rows[0]);
  } catch (error) {
    if (db) await db.query('ROLLBACK').catch(() => undefined);
    next(error);
  } finally { db?.release(); }
});

// Administrative inbox and searchable archive. This is a read-only view:
// resolving a complaint archives it automatically; no record is deleted.
const adminClaimListInput = z.object({
  view:z.enum(['pending','archived']).default('pending'),
  search:z.string().trim().max(120).default(''),
  page:z.coerce.number().int().min(1).max(100000).default(1)
}).strict();
claimsRouter.get('/admin-list',requireRole('admin'),async(req,res,next)=>{
  const parsed=adminClaimListInput.safeParse(req.query);
  if(!parsed.success){res.status(400).json({error:'invalid_filter'});return;}
  const {view,search,page}=parsed.data;
  const pageSize=10;
  const statusWhere=view==='archived'
    ? "c.status IN ('resolved','dismissed')"
    : "c.status IN ('open','in_review')";
  const fromWhere=`FROM claims c
    JOIN jobs j ON j.id=c.job_id
    LEFT JOIN users pro ON pro.id=c.professional_id
    WHERE ${statusWhere}
      AND ($1::text='' OR pro.name ILIKE '%' || $1 || '%'
        OR c.id::text=$1 OR c.professional_id::text=$1
        OR j.id::text=$1 OR j.public_code ILIKE '%' || $1 || '%')`;
  try{
    // Unfiltered dashboard totals: counts reflect all claims, not just this page.
    const totals=await pool.query(
      `SELECT count(*) FILTER (WHERE status='open')::integer AS open,
              count(*) FILTER (WHERE status='in_review')::integer AS in_review,
              count(*) FILTER (WHERE status IN ('resolved','dismissed'))::integer AS archived
       FROM claims`
    );
    const counts=totals.rows[0];
    const statusTotals={
      open:Number(counts.open),
      inReview:Number(counts.in_review),
      pending:Number(counts.open)+Number(counts.in_review),
      archived:Number(counts.archived)
    };
    const count=await pool.query(`SELECT count(*)::integer AS total ${fromWhere}`,[search]);
    const total=Number(count.rows[0].total);
    const items=await pool.query(
      `SELECT c.id,c.job_id,c.warranty_visit_id,c.reason,c.description,
          c.status,c.resolution_note,c.created_at,c.resolved_at,
          (SELECT MIN(a.created_at) FROM audit_events a
           WHERE a.resource_type='claim' AND a.resource_id=c.id::text
             AND a.action='claim_professional_acknowledged'
             AND a.actor_id=c.professional_id) AS professional_acknowledged_at,
          (SELECT MIN(a.created_at) FROM audit_events a
           WHERE a.resource_type='claim' AND a.resource_id=c.id::text
             AND a.action='claim_professional_response'
             AND a.actor_id=c.professional_id) AS professional_responded_at,
          pro.name AS professional_name,j.public_code AS job_public_code,
          (SELECT q.warranty_days FROM job_contracts jc
           JOIN job_quotes q ON q.id=jc.quote_id AND q.job_id=jc.job_id
           WHERE jc.job_id=c.job_id) AS warranty_days
        ${fromWhere}
        ORDER BY ${view==='archived'?'COALESCE(c.resolved_at,c.created_at)':'c.created_at'} DESC,c.id DESC
        LIMIT $2 OFFSET $3`,
      [search,pageSize,(page-1)*pageSize]
    );
    res.json({items:items.rows.map(claim=>({
      ...claim,
      response_window:['open','in_review'].includes(claim.status)
        ? getLabClaimReminder(claim.created_at,claim.professional_responded_at)
        : null
    })),total,page,pageSize,hasMore:page*pageSize<total,statusTotals});
  }catch(error){next(error);}
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
              c.status,c.resolution_note,c.created_at,c.resolved_at,
          (SELECT MIN(a.created_at) FROM audit_events a
           WHERE a.resource_type='claim' AND a.resource_id=c.id::text
             AND a.action='claim_professional_acknowledged'
             AND a.actor_id=c.professional_id) AS professional_acknowledged_at,
          (SELECT MIN(a.created_at) FROM audit_events a
           WHERE a.resource_type='claim' AND a.resource_id=c.id::text
             AND a.action='claim_professional_response'
             AND a.actor_id=c.professional_id) AS professional_responded_at,
              (SELECT q.warranty_days
               FROM job_contracts jc JOIN job_quotes q
                 ON q.id=jc.quote_id AND q.job_id=jc.job_id
               WHERE jc.job_id=c.job_id) AS warranty_days
       FROM claims c ${conditions}
       ORDER BY c.created_at DESC LIMIT 100`,
      params
    );
    res.json(result.rows.map(claim=>({
      ...claim,
      response_window: ['open','in_review'].includes(claim.status)
        ? getLabClaimReminder(claim.created_at,claim.professional_responded_at)
        : null
    })));
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
  let db;
  try {
    db = await pool.connect();
    await db.query('BEGIN');
    // Serialize with client warranty confirmation: both actions lock the
    // complaint before reading/writing its audit trail.
    const selected = await db.query(
      `SELECT c.id,c.job_id FROM claims c
       WHERE c.id=$1 AND c.professional_id=$2 AND c.status IN ('open','in_review')
       FOR UPDATE OF c`,
      [id.data,req.authUser!.id]
    );
    const claim=selected.rows[0];
    if (!claim) {
      await db.query('ROLLBACK');
      res.status(404).json({error:'claim_not_open_or_unavailable'}); return;
    }
    const confirmed = await db.query(
      `SELECT 1 FROM audit_events a
       WHERE a.resource_type='claim' AND a.resource_id=$1
         AND a.action='warranty_client_confirmed'
       LIMIT 1`,
      [String(id.data)]
    );
    if (confirmed.rowCount) {
      await db.query('ROLLBACK');
      res.status(409).json({error:'warranty_correction_already_confirmed'}); return;
    }
    const result = await db.query(
      `INSERT INTO audit_events(actor_id,action,resource_type,resource_id,metadata)
       VALUES($1,'claim_professional_response','claim',$2,
         jsonb_build_object('description',$3::text,'jobId',$4::bigint))
       RETURNING id,created_at`,
      [req.authUser!.id,String(id.data),input.data.description,claim.job_id]
    );
    await db.query('COMMIT');
    res.status(201).json({saved:true,createdAt:result.rows[0].created_at});
  } catch (error) {
    if(db) await db.query('ROLLBACK').catch(()=>undefined);
    next(error);
  } finally {db?.release();}
});

// In-app acknowledgement only: an explicit professional action, not a
// WhatsApp delivery/read receipt and not proof of a legal notification.
// Unique for each claim/professional through a row-locked idempotent operation.
claimsRouter.post('/:id/acknowledge',requireRole('professional'),async(req,res,next)=>{
  const id=z.coerce.number().int().positive().safeParse(req.params.id);
  if(!id.success){res.status(400).json({error:'invalid_claim_id'});return;}
  const db=await pool.connect();
  try{
    await db.query('BEGIN');
    const claim=await db.query(
      `SELECT id,job_id FROM claims
       WHERE id=$1 AND professional_id=$2 AND status IN ('open','in_review')
       FOR UPDATE`,
      [id.data,req.authUser!.id]
    );
    if(!claim.rows[0]){
      await db.query('ROLLBACK');
      res.status(404).json({error:'claim_not_open_or_unavailable'});return;
    }
    const prior=await db.query(
      `SELECT created_at FROM audit_events
       WHERE resource_type='claim' AND resource_id=$1
         AND action='claim_professional_acknowledged' AND actor_id=$2
       ORDER BY id ASC LIMIT 1`,
      [String(id.data),req.authUser!.id]
    );
    if(prior.rows[0]){
      await db.query('COMMIT');
      res.json({acknowledged:true,alreadyAcknowledged:true,acknowledgedAt:prior.rows[0].created_at});
      return;
    }
    const event=await db.query(
      `INSERT INTO audit_events(actor_id,action,resource_type,resource_id,metadata)
       VALUES($1,'claim_professional_acknowledged','claim',$2,$3::jsonb)
       RETURNING created_at`,
      [req.authUser!.id,String(id.data),JSON.stringify({
        source:'lab_web',jobId:String(claim.rows[0].job_id)
      })]
    );
    await db.query('COMMIT');
    res.json({acknowledged:true,alreadyAcknowledged:false,acknowledgedAt:event.rows[0].created_at});
  }catch(error){
    await db.query('ROLLBACK').catch(()=>undefined);
    next(error);
  }finally{db.release();}
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
      `SELECT a.action,a.metadata->>'description' AS description,a.metadata->>'warrantyId' AS warranty_id,a.created_at
       FROM audit_events a WHERE a.resource_type='claim' AND a.resource_id=$1
         AND a.action IN ('claim_professional_response','claim_technical_review_requested','claim_warranty_authorized','warranty_client_confirmed')
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


const warrantyNote = z.object({note:z.string().trim().min(10).max(3000)}).strict();
const warrantyId = (value:unknown) => z.coerce.number().int().positive().safeParse(value);

// Only Administration can authorize a warranty intervention; a suffix is
// allocated per original job. This is NOT an additional independent job.
claimsRouter.post('/:id/authorize-warranty', requireRole('admin'), async (req,res,next) => {
  const id=warrantyId(req.params.id), input=warrantyNote.safeParse(req.body);
  if(!id.success || !input.success){res.status(400).json({error:'invalid_input'});return;}
  let db;
  try {
    db=await pool.connect(); await db.query('BEGIN');
    const found=await db.query(
      `SELECT c.id,c.job_id,c.professional_id,j.public_code,q.warranty_days
       FROM claims c
       JOIN jobs j ON j.id=c.job_id
       JOIN job_contracts jc ON jc.job_id=j.id
       JOIN job_quotes q ON q.id=jc.quote_id AND q.job_id=j.id
       WHERE c.id=$1 AND c.status IN ('open','in_review') FOR UPDATE OF c`,[id.data]);
    const claim=found.rows[0];
    if(!claim?.professional_id){await db.query('ROLLBACK');res.status(409).json({error:'claim_unavailable'});return;}
    // A zero-day contractual warranty must not create an automatic warranty visit.
    // Administrative review and resolution of the underlying complaint remains possible.
    if(Number(claim.warranty_days) <= 0){
      await db.query('ROLLBACK');
      res.status(409).json({error:'no_contractual_warranty'});
      return;
    }
    await db.query('SELECT id FROM jobs WHERE id=$1 FOR UPDATE',[claim.job_id]);
    const existing=await db.query(
      `SELECT w.id,j.public_code||'-'||w.suffix AS code,w.status
       FROM warranty_visits w JOIN jobs j ON j.id=w.original_job_id
       WHERE w.original_job_id=$1 AND w.status <> 'cancelled'
       ORDER BY w.id DESC LIMIT 1`,[claim.job_id]);
    if(existing.rows[0]){
      await db.query('ROLLBACK');res.status(409).json({error:'warranty_already_exists',warranty:existing.rows[0]});return;
    }
    const suffix='A';
    const created=await db.query(
      `INSERT INTO warranty_visits(original_job_id,suffix,assigned_professional_id,description,status)
       VALUES($1,$2,$3,$4,'requested')
       RETURNING id,original_job_id,suffix,status`,
      [claim.job_id,suffix,claim.professional_id,input.data.note]);
    await db.query(`UPDATE claims SET status='in_review' WHERE id=$1`,[id.data]);
    await db.query(
      `INSERT INTO audit_events(actor_id,action,resource_type,resource_id,metadata)
       VALUES($1,'claim_warranty_authorized','claim',$2,$3::jsonb)`,
      [req.authUser!.id,String(id.data),JSON.stringify({description:input.data.note,jobId:claim.job_id,warrantyId:created.rows[0].id,code:claim.public_code+'-'+suffix})]);
    await db.query('COMMIT');res.status(201).json({...created.rows[0],code:claim.public_code+'-'+suffix});
  } catch(error){if(db)await db.query('ROLLBACK').catch(()=>undefined);next(error);}finally{db?.release();}
});

// A warranty visit belongs to the complaint that authorized it, not every
// complaint sharing the original job. The authorization audit was committed
// with the warranty row. Preserve that scope for reads and mutations.
// Only claim participants can inspect the linked warranty.
claimsRouter.get('/:id/warranty',async(req,res,next)=>{
  const id=warrantyId(req.params.id);
  if(!id.success){res.status(400).json({error:'invalid_input'});return;}
  try{
    const result=await pool.query(
      `SELECT w.id,w.original_job_id,w.status,w.description,w.resolution_note,
              j.public_code||'-'||w.suffix AS code,
              (SELECT MIN(a.created_at) FROM audit_events a
                WHERE a.resource_type='claim' AND a.resource_id=c.id::text
                  AND a.action='warranty_client_confirmed'
                  AND a.metadata->>'warrantyId'=w.id::text) AS client_confirmed_at
       FROM claims c JOIN warranty_visits w ON w.original_job_id=c.job_id
          AND EXISTS (SELECT 1 FROM audit_events linked
        WHERE linked.resource_type='claim'
          AND linked.action='claim_warranty_authorized'
          AND linked.resource_id=c.id::text
          AND linked.metadata->>'warrantyId'=w.id::text)
       JOIN jobs j ON j.id=c.job_id
       WHERE c.id=$1 AND ($2='admin' OR c.created_by=$3 OR c.professional_id=$3)
       ORDER BY w.id DESC LIMIT 10`,[id.data,req.authUser!.role,req.authUser!.id]);
    res.json(result.rows);
  }catch(error){next(error);}
});

claimsRouter.post('/:id/warranty/:visitId/report-completed',requireRole('professional'),async(req,res,next)=>{
  const id=warrantyId(req.params.id),visit=warrantyId(req.params.visitId),input=warrantyNote.safeParse(req.body);
  if(!id.success||!visit.success||!input.success){res.status(400).json({error:'invalid_input'});return;}
  try{
    const result=await pool.query(
      `UPDATE warranty_visits w SET status='completed',resolution_note=$4,completed_at=now()
       FROM claims c WHERE c.id=$1 AND w.id=$2 AND w.original_job_id=c.job_id
          AND EXISTS (SELECT 1 FROM audit_events linked
        WHERE linked.resource_type='claim'
          AND linked.action='claim_warranty_authorized'
          AND linked.resource_id=c.id::text
          AND linked.metadata->>'warrantyId'=w.id::text)
         AND w.assigned_professional_id=$3 AND c.professional_id=$3
         AND c.status IN ('open','in_review') AND w.status IN ('requested','scheduled','in_progress')
       RETURNING w.id,w.status,w.resolution_note`,
      [id.data,visit.data,req.authUser!.id,input.data.note]);
    if(!result.rows[0]){res.status(409).json({error:'warranty_not_available'});return;}
    res.json(result.rows[0]);
  }catch(error){next(error);}
});

claimsRouter.post('/:id/warranty/:visitId/client-confirm',requireRole('client'),async(req,res,next)=>{
  const id=warrantyId(req.params.id),visit=warrantyId(req.params.visitId);
  const input=z.object({confirmed:z.literal(true)}).strict().safeParse(req.body);
  if(!id.success||!visit.success||!input.success){res.status(400).json({error:'invalid_input'});return;}
  let db;
  try{
    db=await pool.connect();await db.query('BEGIN');
    const result=await db.query(
      `SELECT c.id,w.id AS visit_id,w.status FROM claims c
       JOIN warranty_visits w ON w.original_job_id=c.job_id
          AND EXISTS (SELECT 1 FROM audit_events linked
        WHERE linked.resource_type='claim'
          AND linked.action='claim_warranty_authorized'
          AND linked.resource_id=c.id::text
          AND linked.metadata->>'warrantyId'=w.id::text)
       WHERE c.id=$1 AND w.id=$2 AND c.created_by=$3 AND c.status='in_review'
         AND w.status='completed' FOR UPDATE OF c,w`,
      [id.data,visit.data,req.authUser!.id]);
    if(!result.rows[0]){await db.query('ROLLBACK');res.status(409).json({error:'warranty_not_ready'});return;}
    // Claim row is locked above, so repeated clicks cannot write duplicate events.
    const previous=await db.query(
      `SELECT a.created_at FROM audit_events a
       WHERE a.action='warranty_client_confirmed' AND a.resource_type='claim'
         AND a.resource_id=$1 AND a.metadata->>'warrantyId'=$2
       ORDER BY a.id LIMIT 1`,
      [String(id.data),String(visit.data)]
    );
    if(previous.rows[0]){
      await db.query('COMMIT');
      res.json({confirmed:true,alreadyConfirmed:true,confirmedAt:previous.rows[0].created_at});
      return;
    }
    const recorded=await db.query(
      `INSERT INTO audit_events(actor_id,action,resource_type,resource_id,metadata)
       VALUES($1,'warranty_client_confirmed','claim',$2,$3::jsonb)
       RETURNING created_at`,
      [req.authUser!.id,String(id.data),JSON.stringify({warrantyId:visit.data})]);
    await db.query('COMMIT');res.json({confirmed:true,alreadyConfirmed:false,confirmedAt:recorded.rows[0].created_at});
  }catch(error){if(db)await db.query('ROLLBACK').catch(()=>undefined);next(error);}finally{db?.release();}
});

const ratingInput=z.object({stars:z.number().int().min(1).max(5),comment:z.string().trim().max(3000).optional()}).strict();
claimsRouter.get('/:id/warranty/:visitId/rating',async(req,res,next)=>{
 const id=warrantyId(req.params.id),visit=warrantyId(req.params.visitId);
 if(!id.success||!visit.success){res.status(400).json({error:'invalid_input'});return;}
 try{
  const result=await pool.query(`SELECT r.stars,r.comment,r.created_at FROM claims c
   JOIN warranty_visits w ON w.original_job_id=c.job_id AND w.id=$2
      AND EXISTS (SELECT 1 FROM audit_events linked
        WHERE linked.resource_type='claim'
          AND linked.action='claim_warranty_authorized'
          AND linked.resource_id=c.id::text
          AND linked.metadata->>'warrantyId'=w.id::text)
   LEFT JOIN ratings r ON r.warranty_visit_id=w.id
   WHERE c.id=$1 AND ($3='admin' OR c.created_by=$4 OR c.professional_id=$4)`,
   [id.data,visit.data,req.authUser!.role,req.authUser!.id]);
  if(!result.rows[0]){res.status(404).json({error:'warranty_not_found'});return;}
  res.json(result.rows[0].stars===null?null:result.rows[0]);
 }catch(error){next(error);}
});
claimsRouter.post('/:id/warranty/:visitId/rating',requireRole('client'),async(req,res,next)=>{
 const id=warrantyId(req.params.id),visit=warrantyId(req.params.visitId),input=ratingInput.safeParse(req.body);
 if(!id.success||!visit.success||!input.success){res.status(400).json({error:'invalid_input'});return;}
 try{
  const result=await pool.query(`INSERT INTO ratings(warranty_visit_id,client_id,stars,comment)
   SELECT w.id,c.created_by,$4,$5 FROM claims c
   JOIN warranty_visits w ON w.original_job_id=c.job_id AND w.id=$2
      AND EXISTS (SELECT 1 FROM audit_events linked
        WHERE linked.resource_type='claim'
          AND linked.action='claim_warranty_authorized'
          AND linked.resource_id=c.id::text
          AND linked.metadata->>'warrantyId'=w.id::text)
   WHERE c.id=$1 AND c.created_by=$3 AND w.status='completed'
    AND EXISTS(SELECT 1 FROM audit_events a WHERE a.resource_type='claim'
       AND a.resource_id=c.id::text AND a.action='warranty_client_confirmed'
       AND a.metadata->>'warrantyId'=$2::text)
   ON CONFLICT (warranty_visit_id) WHERE warranty_visit_id IS NOT NULL DO NOTHING
   RETURNING stars,comment,created_at`,
   [id.data,visit.data,req.authUser!.id,input.data.stars,input.data.comment||null]);
  if(!result.rows[0]){res.status(409).json({error:'warranty_rating_not_available_or_already_submitted'});return;}
  res.status(201).json(result.rows[0]);
 }catch(error){next(error);}
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
