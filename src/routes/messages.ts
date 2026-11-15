import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db.js';
import { requireAuth, requireRole } from '../security.js';

/**
 * Private, append-only messages between the client and the selected
 * professional. Free pre-quote chat is deliberately prohibited.
 * Administrators do not get a silent access bypass; any future moderated
 * access must have a separate documented, reason-audited workflow.
 */
export const messagesRouter = Router();
messagesRouter.use(requireAuth, requireRole('client', 'professional'));

const idSchema = z.coerce.number().int().positive().safe();
const bodySchema = z.object({
  body: z.string().trim().min(1).max(3000),
}).strict();

async function membership(db:import('pg').PoolClient, jobId:number, role:string, userId:string,
  lock:boolean) {
  const result=await db.query(
    `SELECT j.id,j.status,
       j.client_id,jq.professional_id
     FROM jobs j
     JOIN job_contracts jc ON jc.job_id=j.id
     JOIN job_quotes jq ON jq.id=jc.quote_id AND jq.job_id=j.id
     WHERE j.id=$1 AND (
       ($2='client' AND j.client_id=$3)
       OR ($2='professional' AND jq.professional_id=$3)
     ) ${lock?'FOR UPDATE OF j':''}`,
    [jobId,role,userId]
  );
  return result.rows[0] as undefined|{
    id:string;status:string;client_id:string;professional_id:string
  };
}

messagesRouter.get('/:jobId/messages', async (req,res,next)=>{
  const id=idSchema.safeParse(req.params.jobId);
  const older=req.query.beforeId===undefined?null:idSchema.safeParse(req.query.beforeId);
  if(!id.success || (older!==null&&!older.success) ||
     Object.keys(req.query).some(key=>key!=='beforeId')){
    res.status(400).json({error:'invalid_message_query'});return;
  }
  const db=await pool.connect();
  try{
    const job=await membership(db,id.data,req.authUser!.role,req.authUser!.id,false);
    if(!job){res.status(404).json({error:'chat_not_available'});return;}
    // After cancellation, historical records remain visible to both parties.
    const found=await db.query(
      `SELECT m.id,m.job_id,m.sender_id,u.name AS sender_name,u.role AS sender_role,
         m.body,m.created_at
       FROM job_messages m JOIN users u ON u.id=m.sender_id
       WHERE m.job_id=$1 AND ($2::bigint IS NULL OR m.id<$2::bigint)
         AND (m.sender_id=$3 OR m.sender_id=$4)
       ORDER BY m.id DESC LIMIT 51`,
      [id.data,older===null?null:older.data,job.client_id,job.professional_id]
    );
    const hasMore=found.rows.length>50;
    res.setHeader('Cache-Control','private, no-store');
    res.json({items:found.rows.slice(0,50).reverse(),hasMore,jobStatus:job.status});
  }catch(error){next(error);}finally{db.release();}
});

messagesRouter.post('/:jobId/messages', async (req,res,next)=>{
  const id=idSchema.safeParse(req.params.jobId);
  const parsed=bodySchema.safeParse(req.body);
  if(!id.success||!parsed.success){
    res.status(400).json({error:'invalid_message_input'});return;
  }
  const db=await pool.connect();
  let active=false;
  try{
    await db.query('BEGIN');active=true;
    const job=await membership(db,id.data,req.authUser!.role,req.authUser!.id,true);
    if(!job){
      await db.query('ROLLBACK');active=false;
      res.status(404).json({error:'chat_not_available'});return;
    }
    if(!['confirmed','in_progress','completed'].includes(job.status)){
      await db.query('ROLLBACK');active=false;
      res.status(409).json({error:'chat_closed'});return;
    }
    // The job row lock also serializes attempts to bypass limits by
    // clicking Send repeatedly on multiple tabs of the same contract.
    const recent=await db.query(
      `SELECT count(*)::integer AS total FROM job_messages
       WHERE job_id=$1 AND sender_id=$2 AND created_at > now() - interval '1 minute'`,
      [id.data,req.authUser!.id]
    );
    if(recent.rows[0].total>=10){
      await db.query('ROLLBACK');active=false;
      res.status(429).json({error:'message_rate_limited'});return;
    }
    const inserted=await db.query(
      `INSERT INTO job_messages(job_id,sender_id,body)
       VALUES($1,$2,$3)
       RETURNING id,job_id,sender_id,body,created_at`,
      [id.data,req.authUser!.id,parsed.data.body]
    );
    await db.query('COMMIT');active=false;
    res.status(201).json({item:{
      ...inserted.rows[0],sender_name:req.authUser!.name,
      sender_role:req.authUser!.role,
    }});
  }catch(error){
    if(active)await db.query('ROLLBACK').catch(()=>undefined);
    next(error);
  }finally{db.release();}
});
