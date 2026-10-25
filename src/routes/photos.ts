import express, { Router } from 'express';
import { z } from 'zod';
import type { PoolClient } from 'pg';
import { pool } from '../db.js';
import { requireAuth } from '../security.js';
import type { AuthUser } from '../security.js';

export const photosRouter = Router();
photosRouter.use(requireAuth);

// Temporary LAB ONLY: small, browser-reencoded JPEGs in the isolated test DB.
// The official product must use private object storage, not this prototype.
const LAB_DB = 'mantenimiento_360_db_pruebas_20261012';
const MAX_STORED_PHOTO_BYTES = 700000;
const MAX_PHOTOS_PER_ROLE = 5;
const jobIdFrom = (value: string) => z.coerce.number().int().positive().safeParse(value);

export async function ensureLabPhotoSchema(): Promise<void> {
  const db = await pool.connect();
  try {
    const found = await db.query('SELECT current_database() AS name');
    if (found.rows[0]?.name !== LAB_DB) {
      throw new Error('Photo prototype restricted to isolated laboratory DB');
    }
    await db.query('SELECT pg_advisory_lock($1::bigint)', [36020261016]);
    await db.query(`CREATE TABLE IF NOT EXISTS lab_job_photos (
      id BIGSERIAL PRIMARY KEY,
      job_id BIGINT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      uploader_id BIGINT NOT NULL REFERENCES users(id),
      uploader_role TEXT NOT NULL CHECK (uploader_role IN ('client','professional')),
      mime_type TEXT NOT NULL DEFAULT 'image/jpeg' CHECK (mime_type='image/jpeg'),
      content BYTEA NOT NULL,
      size_bytes INTEGER NOT NULL CHECK (size_bytes BETWEEN 1 AND 700000),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
    await db.query('CREATE INDEX IF NOT EXISTS idx_lab_job_photos_job ON lab_job_photos(job_id,created_at,id)');
    console.log('Laboratory photo storage ready (test database only)');
  } finally {
    await db.query('SELECT pg_advisory_unlock($1::bigint)', [36020261016]).catch(() => undefined);
    db.release();
  }
}

async function permission(db: PoolClient, jobId: number, user: AuthUser, lock = false) {
  const result = await db.query(
    `SELECT j.id, j.client_id, j.status,
       EXISTS(
         SELECT 1 FROM job_contracts jc
         JOIN job_quotes q ON q.id=jc.quote_id AND q.job_id=j.id
         WHERE jc.job_id=j.id AND q.professional_id=$2
       ) AS contracted,
       EXISTS(
         SELECT 1 FROM lab_visit_offers v
         WHERE v.job_id=j.id AND v.professional_id=$2 AND v.status='accepted'
       ) AS selected_visit,
       EXISTS(
         SELECT 1 FROM professional_profiles pp
         JOIN professional_specialties ps ON ps.professional_id=pp.user_id
           AND ps.specialty_id=j.specialty_id
         WHERE pp.user_id=$2 AND pp.verification_status='approved'
           AND pp.available=true
           AND (j.service_id IS NULL OR EXISTS(
             SELECT 1 FROM professional_services pts
             WHERE pts.professional_id=$2 AND pts.service_id=j.service_id
           ))
           AND NOT EXISTS(
             SELECT 1 FROM professional_restrictions pr
             WHERE pr.professional_id=$2 AND pr.lifted_at IS NULL
           )
       ) AS eligible_for_feed
     FROM jobs j WHERE j.id=$1 ${lock ? 'FOR UPDATE OF j' : ''}`,
    [jobId, user.id]
  );
  const job = result.rows[0];
  const owner = user.role === 'client' && String(job?.client_id) === user.id;
  const contractor = user.role === 'professional' && job?.contracted === true;
  const selectedVisit = user.role === 'professional' && job?.selected_visit === true;
  const openFeed = user.role === 'professional' && job?.eligible_for_feed === true &&
    ['requested','quoted'].includes(job.status);
  const read = !!job && (owner || contractor || selectedVisit || openFeed || user.role === 'admin');
  const write = !!job && (owner || contractor || selectedVisit) && job.status !== 'cancelled';
  return { read, write };
}

photosRouter.get('/:jobId/photos', async (req, res, next) => {
  const id = jobIdFrom(req.params.jobId);
  if (!id.success) { res.status(400).json({error:'invalid_job_id'}); return; }
  const db = await pool.connect();
  try {
    if (!(await permission(db,id.data,req.authUser!)).read) {
      res.status(404).json({error:'job_not_found'}); return;
    }
    const photos = await db.query(
      `SELECT id,uploader_role,size_bytes,created_at,(uploader_id=$2 AND created_at>now()-interval '15 minutes') AS can_remove
       FROM lab_job_photos WHERE job_id=$1 ORDER BY created_at,id LIMIT 20`,
      [id.data,req.authUser!.id]
    );
    res.json(photos.rows);
  } catch (error) { next(error); } finally { db.release(); }
});

photosRouter.get('/:jobId/photos/:photoId', async (req, res, next) => {
  const id = jobIdFrom(req.params.jobId);
  const photoId = jobIdFrom(req.params.photoId);
  if (!id.success || !photoId.success) { res.status(400).json({error:'invalid_photo_id'}); return; }
  const db = await pool.connect();
  try {
    if (!(await permission(db,id.data,req.authUser!)).read) {
      res.status(404).json({error:'job_not_found'}); return;
    }
    const found = await db.query(
      'SELECT content FROM lab_job_photos WHERE job_id=$1 AND id=$2',
      [id.data,photoId.data]
    );
    if (!found.rows[0]) { res.status(404).json({error:'photo_not_found'}); return; }
    res.setHeader('Content-Disposition','inline');
    res.type('image/jpeg').send(found.rows[0].content as Buffer);
  } catch (error) { next(error); } finally { db.release(); }
});

photosRouter.post('/:jobId/photos',
  express.raw({ type:'image/jpeg', limit:'800kb' }),
  async (req, res, next) => {
    const id = jobIdFrom(req.params.jobId);
    if (!id.success) { res.status(400).json({error:'invalid_job_id'}); return; }
    if (req.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'image/jpeg') {
      res.status(415).json({error:'only_jpeg_allowed'}); return;
    }
    const body: unknown = req.body;
    if (!Buffer.isBuffer(body) || body.length < 100 || body.length > MAX_STORED_PHOTO_BYTES ||
        body[0] !== 0xff || body[1] !== 0xd8 || body[2] !== 0xff ||
        body[body.length-2] !== 0xff || body[body.length-1] !== 0xd9) {
      res.status(400).json({error:'invalid_or_large_image'}); return;
    }
    const db = await pool.connect();
    try {
      await db.query('BEGIN');
      const access = await permission(db,id.data,req.authUser!,true);
      if (!access.write) {
        await db.query('ROLLBACK');
        res.status(403).json({error:'photo_upload_not_allowed'}); return;
      }
      const count = await db.query(
        'SELECT count(*)::integer AS total FROM lab_job_photos WHERE job_id=$1 AND uploader_role=$2',
        [id.data,req.authUser!.role]
      );
      if (count.rows[0].total >= MAX_PHOTOS_PER_ROLE) {
        await db.query('ROLLBACK');
        res.status(409).json({error:'photo_limit_reached'}); return;
      }
      const saved = await db.query(
        `INSERT INTO lab_job_photos(job_id,uploader_id,uploader_role,content,size_bytes)
         VALUES($1,$2,$3,$4,$5)
         RETURNING id,job_id,uploader_role,size_bytes,created_at`,
        [id.data,req.authUser!.id,req.authUser!.role,body,body.length]
      );
      await db.query('COMMIT');
      res.status(201).json(saved.rows[0]);
    } catch (error) {
      await db.query('ROLLBACK').catch(() => undefined);
      next(error);
    } finally { db.release(); }
  }
);

 // Laboratory only: uploader may retract a mistakenly selected photograph.
photosRouter.delete('/:jobId/photos/:photoId', async (req, res, next) => {
  const id = jobIdFrom(req.params.jobId);
  const photoId = jobIdFrom(req.params.photoId);
  if (!id.success || !photoId.success) {
    res.status(400).json({error:'invalid_photo_id'}); return;
  }
  const db=await pool.connect();
  try {
    await db.query('BEGIN');
    const access=await permission(db,id.data,req.authUser!,true);
    if (!access.write) {
      await db.query('ROLLBACK');
      res.status(403).json({error:'photo_delete_not_allowed'}); return;
    }
    const deleted=await db.query(
      `DELETE FROM lab_job_photos WHERE job_id=$1 AND id=$2 AND uploader_id=$3 AND created_at > now() - interval '15 minutes' RETURNING id`,
      [id.data,photoId.data,req.authUser!.id]
    );
    await db.query('COMMIT');
    if (!deleted.rows.length) { res.status(404).json({error:'photo_not_found'}); return; }
    res.json({deleted:true});
  } catch (error) {
    await db.query('ROLLBACK').catch(() => undefined);
    next(error);
  } finally {db.release();}
});
