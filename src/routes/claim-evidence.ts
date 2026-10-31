import express, { Router } from 'express';
import { z } from 'zod';
import type { PoolClient } from 'pg';
import { pool } from '../db.js';
import { requireAuth } from '../security.js';
import type { AuthUser } from '../security.js';

export const claimEvidenceRouter = Router();
claimEvidenceRouter.use(requireAuth);

// This temporary evidence store is ONLY permitted in the isolated test DB.
// In production, images will require private object storage and backup policy.
const LAB_DB = 'mantenimiento_360_db_pruebas_20261012';
const MAX_BYTES = 700000;
const MAX_PER_ACTOR_SCOPE = 5;
const positiveId = (value: unknown) => z.coerce.number().int().positive().safeParse(value);

export async function ensureLabClaimEvidenceSchema(): Promise<void> {
  const db = await pool.connect();
  try {
    const found = await db.query('SELECT current_database() AS name');
    if (found.rows[0]?.name !== LAB_DB) {
      throw new Error('Claim evidence is restricted to the laboratory database');
    }
    await db.query('SELECT pg_advisory_lock($1::bigint)', [36020261031]);
    await db.query(`CREATE TABLE IF NOT EXISTS lab_claim_evidence (
      id BIGSERIAL PRIMARY KEY,
      claim_id BIGINT NOT NULL REFERENCES claims(id) ON DELETE RESTRICT,
      warranty_visit_id BIGINT REFERENCES warranty_visits(id) ON DELETE RESTRICT,
      uploader_id BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      uploader_role TEXT NOT NULL CHECK(uploader_role IN ('client','professional','admin')),
      content BYTEA NOT NULL,
      mime_type TEXT NOT NULL DEFAULT 'image/jpeg' CHECK(mime_type='image/jpeg'),
      size_bytes INTEGER NOT NULL CHECK(size_bytes BETWEEN 1 AND 700000),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
    await db.query(`CREATE INDEX IF NOT EXISTS lab_claim_evidence_scope_idx
      ON lab_claim_evidence(claim_id,warranty_visit_id,created_at,id)`);
    console.log('Lab claim and warranty evidence ready (test database only)');
  } finally {
    await db.query('SELECT pg_advisory_unlock($1::bigint)', [36020261031]).catch(() => undefined);
    db.release();
  }
}

function inputIds(req: express.Request) {
  const claim = positiveId(req.params.id);
  const visit = req.params.visitId === undefined ? null : positiveId(req.params.visitId);
  const photo = req.params.photoId === undefined ? null : positiveId(req.params.photoId);
  if (!claim.success || (visit && !visit.success) || (photo && !photo.success)) return null;
  return { claimId: claim.data, visitId: visit?.success ? visit.data : null,
    photoId: photo?.success ? photo.data : null };
}

// The warranty association is validated through the historical, append-only
// authorization audit event, not merely by matching the original job.
async function scope(db: PoolClient, ids: { claimId:number;visitId:number|null },
  actor: AuthUser, lock: boolean) {
  const result=await db.query(`SELECT c.id,c.status,c.created_by,c.professional_id,
       w.id AS visit_id,w.status AS visit_status,
       EXISTS(SELECT 1 FROM audit_events a
         WHERE a.resource_type='claim' AND a.resource_id=c.id::text
           AND a.action='warranty_client_confirmed'
           AND a.metadata->>'warrantyId'=w.id::text) AS warranty_confirmed
      FROM claims c
      LEFT JOIN warranty_visits w ON w.id=$2 AND w.original_job_id=c.job_id
        AND EXISTS(SELECT 1 FROM audit_events a WHERE a.resource_type='claim'
          AND a.resource_id=c.id::text AND a.action='claim_warranty_authorized'
          AND a.metadata->>'warrantyId'=w.id::text)
      WHERE c.id=$1 ${lock ? 'FOR UPDATE OF c' : ''}`,
    [ids.claimId,ids.visitId]);
  const claim=result.rows[0];
  const participant=!!claim && (actor.role==='admin' ||
    (actor.role==='client' && String(claim.created_by)===actor.id) ||
    (actor.role==='professional' && String(claim.professional_id)===actor.id));
  const validVisit=ids.visitId===null || (claim?.visit_id != null);
  const read=participant && validVisit;
  const write=read && ['open','in_review'].includes(claim.status) &&
    (ids.visitId===null || (claim.visit_status!=='cancelled' && !claim.warranty_confirmed));
  return {read,write};
}

async function list(req: express.Request,res:express.Response,next:express.NextFunction) {
  const ids=inputIds(req); if(!ids){res.status(400).json({error:'invalid_input'});return;}
  const db=await pool.connect();
  try {
    if(!(await scope(db,ids,req.authUser!,false)).read) {
      res.status(404).json({error:'claim_evidence_not_found'});return;
    }
    const records=await db.query(`SELECT e.id,e.size_bytes,e.created_at,e.uploader_role,
         u.name AS uploader_name
      FROM lab_claim_evidence e JOIN users u ON u.id=e.uploader_id
      WHERE e.claim_id=$1 AND e.warranty_visit_id IS NOT DISTINCT FROM $2::bigint
      ORDER BY e.created_at ASC,e.id ASC LIMIT 100`,[ids.claimId,ids.visitId]);
    res.setHeader('Cache-Control','no-store');
    res.json(records.rows);
  }catch(error){next(error);}finally{db.release();}
}

async function view(req:express.Request,res:express.Response,next:express.NextFunction) {
  const ids=inputIds(req); if(!ids || ids.photoId===null){res.status(400).json({error:'invalid_input'});return;}
  const db=await pool.connect();
  try {
    if(!(await scope(db,ids,req.authUser!,false)).read) {
      res.status(404).json({error:'claim_evidence_not_found'});return;
    }
    const rows=await db.query(`SELECT content FROM lab_claim_evidence
      WHERE id=$1 AND claim_id=$2
        AND warranty_visit_id IS NOT DISTINCT FROM $3::bigint`,
      [ids.photoId,ids.claimId,ids.visitId]);
    if(!rows.rows[0]){res.status(404).json({error:'photo_not_found'});return;}
    res.setHeader('Cache-Control','no-store');
    res.setHeader('Content-Disposition','inline');
    res.type('image/jpeg').send(rows.rows[0].content as Buffer);
  }catch(error){next(error);}finally{db.release();}
}

async function upload(req:express.Request,res:express.Response,next:express.NextFunction) {
  const ids=inputIds(req);if(!ids){res.status(400).json({error:'invalid_input'});return;}
  if(req.get('content-type')?.split(';')[0].trim().toLowerCase()!=='image/jpeg'){
    res.status(415).json({error:'only_jpeg_allowed'});return;
  }
  const body:unknown=req.body;
  if(!Buffer.isBuffer(body)||body.length<100||body.length>MAX_BYTES||
    body[0]!==0xff||body[1]!==0xd8||body[2]!==0xff||
    body[body.length-2]!==0xff||body[body.length-1]!==0xd9){
    res.status(400).json({error:'invalid_or_large_image'});return;
  }
  const db=await pool.connect();
  try{
    await db.query('BEGIN');
    const access=await scope(db,ids,req.authUser!,true);
    if(!access.write){
      await db.query('ROLLBACK');res.status(403).json({error:'claim_evidence_upload_not_allowed'});return;
    }
    const count=await db.query(`SELECT COUNT(*)::integer AS total FROM lab_claim_evidence
      WHERE claim_id=$1 AND warranty_visit_id IS NOT DISTINCT FROM $2::bigint
        AND uploader_id=$3`,[ids.claimId,ids.visitId,req.authUser!.id]);
    if(count.rows[0].total>=MAX_PER_ACTOR_SCOPE){
      await db.query('ROLLBACK');res.status(409).json({error:'claim_evidence_limit_reached'});return;
    }
    const saved=await db.query(`INSERT INTO lab_claim_evidence
      (claim_id,warranty_visit_id,uploader_id,uploader_role,content,size_bytes)
      VALUES($1,$2,$3,$4,$5,$6)
      RETURNING id,claim_id,warranty_visit_id,created_at,size_bytes,uploader_role`,
      [ids.claimId,ids.visitId,req.authUser!.id,req.authUser!.role,body,body.length]);
    await db.query(`INSERT INTO audit_events(actor_id,action,resource_type,resource_id,metadata)
      VALUES($1,'lab_claim_evidence_added','claim',$2,$3::jsonb)`,
      [req.authUser!.id,String(ids.claimId),JSON.stringify({
        evidenceId:saved.rows[0].id,warrantyVisitId:ids.visitId,
        sizeBytes:body.length,source:'lab_web'
      })]);
    await db.query('COMMIT');
    res.setHeader('Cache-Control','no-store');
    res.status(201).json(saved.rows[0]);
  }catch(error){await db.query('ROLLBACK').catch(()=>undefined);next(error);}finally{db.release();}
}

const jpeg=express.raw({type:'image/jpeg',limit:'800kb'});
claimEvidenceRouter.get('/:id/evidence',list);
claimEvidenceRouter.get('/:id/evidence/:photoId',view);
claimEvidenceRouter.post('/:id/evidence',jpeg,upload);
claimEvidenceRouter.get('/:id/warranty/:visitId/evidence',list);
claimEvidenceRouter.get('/:id/warranty/:visitId/evidence/:photoId',view);
claimEvidenceRouter.post('/:id/warranty/:visitId/evidence',jpeg,upload);

// No DELETE or PATCH routes: evidence is append-only even within an open claim.
