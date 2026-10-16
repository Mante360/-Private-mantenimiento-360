import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db.js';
import { requireAuth, requireRole } from '../security.js';
import type { AuthUser } from '../security.js';
import type { PoolClient } from 'pg';

// Isolated lab prototype. All data persists in the separate laboratory database.
export const technicalRouter = Router();
technicalRouter.use(requireAuth);

const LAB_DB='mantenimiento_360_db_pruebas_20261012';
const positiveId=(v:unknown)=>z.coerce.number().int().positive().safeParse(v);
const questionInput=z.object({question:z.string().trim().min(10).max(800)}).strict();
const answerInput=z.object({answer:z.string().trim().min(2).max(1500)}).strict();
const preparationInput=z.object({notes:z.string().trim().max(1800)}).strict();
const activeQuote=(status:string)=>['submitted','accepted'].includes(status);
const preparationStatuses=(status:string)=>['quoted','confirmed'].includes(status);

export async function ensureLabTechnicalSchema(): Promise<void> {
  const db=await pool.connect();
  try {
    const found=await db.query('SELECT current_database() AS name');
    if (found.rows[0]?.name!==LAB_DB) throw new Error('Technical consultation feature restricted to test database');
    await db.query('SELECT pg_advisory_lock($1::bigint)',[36020261017]);
    await db.query(
      `CREATE TABLE IF NOT EXISTS lab_quote_technical_questions (
        id BIGSERIAL PRIMARY KEY,
        quote_id BIGINT NOT NULL REFERENCES job_quotes(id) ON DELETE CASCADE,
        question TEXT NOT NULL CHECK(length(question) BETWEEN 10 AND 800),
        answer TEXT CHECK (answer IS NULL OR length(answer) BETWEEN 2 AND 1500),
        asked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        answered_at TIMESTAMPTZ
      )`
    );
    await db.query(
      'CREATE UNIQUE INDEX IF NOT EXISTS uq_lab_question_one_pending ON lab_quote_technical_questions(quote_id) WHERE answer IS NULL'
    );
    await db.query(
      `CREATE TABLE IF NOT EXISTS lab_visit_preparations (
        quote_id BIGINT PRIMARY KEY REFERENCES job_quotes(id) ON DELETE CASCADE,
        notes TEXT NOT NULL DEFAULT '' CHECK(length(notes)<=1800),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`
    );
    console.log('Technical consultations and private visit-preparation ready (lab only)');
  } finally {
    await db.query('SELECT pg_advisory_unlock($1::bigint)',[36020261017]).catch(()=>undefined);
    db.release();
  }
}

async function getAccess(db:PoolClient,jobId:number,account:AuthUser,lock=false) {
  const result=await db.query(
    `SELECT id,client_id,status FROM jobs WHERE id=$1 ${lock?'FOR UPDATE':''}`,
    [jobId]
  );
  const job=result.rows[0];
  const isOwner=!!job && account.role==='client' && String(job.client_id)===account.id;
  const admin=!!job && account.role==='admin';
  if(!job || (!isOwner && !admin && account.role!=='professional')) return null;
  const quotes=await db.query(
    `SELECT q.id,q.status,q.professional_id,u.name AS professional_name
     FROM job_quotes q JOIN users u ON u.id=q.professional_id
     WHERE q.job_id=$1 ${account.role==='professional'?'AND q.professional_id=$2':''}
     ORDER BY q.submitted_at,q.id`,
    account.role==='professional'?[jobId,account.id]:[jobId]
  );
  if(account.role==='professional' && !quotes.rows.length) return null;
  return {job,quotes:quotes.rows,owner:isOwner,admin};
}

technicalRouter.get('/:jobId/technical', async(req,res,next)=>{
  const jobId=positiveId(req.params.jobId);
  if(!jobId.success){res.status(400).json({error:'invalid_job_id'});return;}
  const db=await pool.connect();
  try {
    const access=await getAccess(db,jobId.data,req.authUser!);
    if(!access){res.status(404).json({error:'technical_info_not_found'});return;}
    const quoteIds=access.quotes.map(q=>q.id);
    let records:{rows:any[]}={rows:[]};
    if(quoteIds.length) {
      records=await db.query(
        `SELECT id,quote_id,question,answer,asked_at,answered_at
         FROM lab_quote_technical_questions
         WHERE quote_id=ANY($1::bigint[]) ORDER BY asked_at,id LIMIT 500`,
        [quoteIds]
      );
    }
    let preparation:{rows:any[]}={rows:[]};
    if(req.authUser!.role==='professional' && quoteIds.length){
      preparation=await db.query(
        'SELECT quote_id,notes,updated_at FROM lab_visit_preparations WHERE quote_id=ANY($1::bigint[])',
        [quoteIds]
      );
    }
    // The client's view contains their own requests by each professional but
    // never the professional's private tools/replacement-parts notes.
    res.json({threads:access.quotes.map(q=>{
      const questions=records.rows.filter(x=>String(x.quote_id)===String(q.id));
      const pending=questions.some(x=>x.answer===null);
      const canContinue=activeQuote(q.status)&&preparationStatuses(access.job.status);
      const own=req.authUser!.role==='professional';
      return {
        quoteId:q.id,professionalName:q.professional_name,quoteStatus:q.status,
        questions,canAsk:own&&canContinue&&!pending,
        canAnswer:access.owner&&canContinue,
        canEditPreparation:own&&canContinue,
        preparation:own ? (preparation.rows.find(x=>String(x.quote_id)===String(q.id))||null) : null
      };
    })});
  }catch(error){next(error);}finally{db.release();}
});

// Only a professional who has ALREADY sent this quote can ask questions.
// One unanswered request per quote; no general chat or contact channel.
technicalRouter.post('/:jobId/technical/quotes/:quoteId/questions',
  requireRole('professional'),async(req,res,next)=>{
  const jobId=positiveId(req.params.jobId),quoteId=positiveId(req.params.quoteId);
  const input=questionInput.safeParse(req.body);
  if(!jobId.success||!quoteId.success||!input.success){
    res.status(400).json({error:'invalid_technical_input'});return;
  }
  const db=await pool.connect();
  try {
    await db.query('BEGIN');
    const access=await getAccess(db,jobId.data,req.authUser!,true);
    const q=access?.quotes.find(x=>String(x.id)===String(quoteId.data));
    if(!q){await db.query('ROLLBACK');res.status(404).json({error:'quote_not_found'});return;}
    if(!activeQuote(q.status)||!preparationStatuses(access!.job.status)){
      await db.query('ROLLBACK');res.status(409).json({error:'technical_window_closed'});return;
    }
    const claim=await db.query(
      "SELECT 1 FROM claims WHERE professional_id=$1 AND status IN ('open','in_review') LIMIT 1",
      [req.authUser!.id]
    );
    if(claim.rowCount){
      await db.query('ROLLBACK');res.status(403).json({error:'professional_has_open_claim'});return;
    }
    const pending=await db.query(
      'SELECT 1 FROM lab_quote_technical_questions WHERE quote_id=$1 AND answer IS NULL LIMIT 1',
      [quoteId.data]
    );
    if(pending.rowCount){
      await db.query('ROLLBACK');res.status(409).json({error:'technical_answer_pending'});return;
    }
    const saved=await db.query(
      'INSERT INTO lab_quote_technical_questions(quote_id,question) VALUES($1,$2) RETURNING id,quote_id,question,asked_at',
      [quoteId.data,input.data.question]
    );
    await db.query('COMMIT');res.status(201).json(saved.rows[0]);
  }catch(error){await db.query('ROLLBACK').catch(()=>undefined);next(error);}finally{db.release();}
});

// Client responds only to the pending question on their own job/quote.
technicalRouter.post('/:jobId/technical/quotes/:quoteId/questions/:questionId/answer',
  requireRole('client'),async(req,res,next)=>{
  const jobId=positiveId(req.params.jobId),quoteId=positiveId(req.params.quoteId),
        questionId=positiveId(req.params.questionId);
  const input=answerInput.safeParse(req.body);
  if(!jobId.success||!quoteId.success||!questionId.success||!input.success){
    res.status(400).json({error:'invalid_technical_input'});return;
  }
  const db=await pool.connect();
  try {
    await db.query('BEGIN');
    const access=await getAccess(db,jobId.data,req.authUser!,true);
    if(!access?.owner){await db.query('ROLLBACK');res.status(404).json({error:'job_not_found'});return;}
    const q=access.quotes.find(x=>String(x.id)===String(quoteId.data));
    if(!q||!activeQuote(q.status)||!preparationStatuses(access.job.status)){
      await db.query('ROLLBACK');res.status(409).json({error:'technical_window_closed'});return;
    }
    const saved=await db.query(
      `UPDATE lab_quote_technical_questions SET answer=$4,answered_at=now()
       WHERE id=$3 AND quote_id=$2 AND answer IS NULL
         AND EXISTS(SELECT 1 FROM job_quotes WHERE id=$2 AND job_id=$1)
       RETURNING id,quote_id,answer,answered_at`,
      [jobId.data,quoteId.data,questionId.data,input.data.answer]
    );
    if(!saved.rowCount){await db.query('ROLLBACK');res.status(409).json({error:'question_already_answered'});return;}
    await db.query('COMMIT');res.json(saved.rows[0]);
  }catch(error){await db.query('ROLLBACK').catch(()=>undefined);next(error);}finally{db.release();}
});

// Private planning notes are visible and editable only by the quoting professional.
technicalRouter.put('/:jobId/technical/quotes/:quoteId/preparation',
  requireRole('professional'),async(req,res,next)=>{
  const jobId=positiveId(req.params.jobId),quoteId=positiveId(req.params.quoteId);
  const input=preparationInput.safeParse(req.body);
  if(!jobId.success||!quoteId.success||!input.success){
    res.status(400).json({error:'invalid_technical_input'});return;
  }
  const db=await pool.connect();
  try {
    await db.query('BEGIN');
    const access=await getAccess(db,jobId.data,req.authUser!,true);
    const q=access?.quotes.find(x=>String(x.id)===String(quoteId.data));
    if(!q){await db.query('ROLLBACK');res.status(404).json({error:'quote_not_found'});return;}
    if(!activeQuote(q.status)||!preparationStatuses(access!.job.status)){
      await db.query('ROLLBACK');res.status(409).json({error:'technical_window_closed'});return;
    }
    const saved=await db.query(
      `INSERT INTO lab_visit_preparations(quote_id,notes) VALUES($1,$2)
       ON CONFLICT(quote_id) DO UPDATE SET notes=EXCLUDED.notes,updated_at=now()
       RETURNING quote_id,notes,updated_at`,
      [quoteId.data,input.data.notes]
    );
    await db.query('COMMIT');res.json(saved.rows[0]);
  }catch(error){await db.query('ROLLBACK').catch(()=>undefined);next(error);}finally{db.release();}
});
