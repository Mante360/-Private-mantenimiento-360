import {Router} from 'express';
import {z} from 'zod';
import {pool} from '../db.js';
import {requireAuth,requireRole} from '../security.js';
import {LAB_PROFESSION_REQUEST_DB} from '../lab-profession-requests.js';

export const professionRequestsRouter=Router();
professionRequestsRouter.use(requireAuth);

const proposed=z.object({
  name:z.string().trim().min(3).max(100).regex(/^[\p{L}\p{N}][\p{L}\p{N}\s.'-]*$/u)
}).strict();
const decision=z.object({decision:z.enum(['approved','rejected'])}).strict();
const requestId=z.coerce.number().int().positive();
const normalize=(value:string)=>value.normalize('NFD').replace(/[\u0300-\u036f]/g,'')
  .toLocaleLowerCase('es-AR').replace(/\s+/g,' ').trim();

async function existingProfession(db:{query:(sql:string,args?:unknown[])=>Promise<{rows:any[]}>},name:string):Promise<boolean>{
  const rows=await db.query('SELECT name FROM specialties WHERE active=true');
  return rows.rows.some(row=>normalize(String(row.name))===normalize(name));
}

professionRequestsRouter.post('/mine',requireRole('professional'),async(req,res,next)=>{
  const data=proposed.safeParse(req.body);
  if(!data.success){res.status(400).json({error:'invalid_profession_name'});return;}
  const normalized=normalize(data.data.name);
  const db=await pool.connect().catch(next);if(!db)return;
  let active=false;
  try{
    await db.query('BEGIN');active=true;
    const current=await db.query('SELECT current_database() name');
    if(current.rows[0]?.name!==LAB_PROFESSION_REQUEST_DB){
      await db.query('ROLLBACK');active=false;res.status(403).json({error:'test_database_only'});return;
    }
    if(await existingProfession(db,data.data.name)){
      await db.query('ROLLBACK');active=false;res.status(409).json({error:'profession_already_available'});return;
    }
    const inserted=await db.query(
      `INSERT INTO lab_profession_requests(professional_id,requested_name,normalized_name)
       VALUES($1,$2,$3) ON CONFLICT DO NOTHING
       RETURNING id::text,requested_name,status`,
      [req.authUser!.id,data.data.name,normalized]
    );
    if(inserted.rows[0]){
      await db.query(
        `INSERT INTO audit_events(actor_id,action,resource_type,resource_id,metadata)
         VALUES($1,'lab_profession_requested','lab_profession_request',$2,$3::jsonb)`,
        [req.authUser!.id,inserted.rows[0].id,JSON.stringify({scope:'lab',name:normalized})]
      );
      await db.query('COMMIT');active=false;
      res.status(201).json({request:inserted.rows[0],alreadyPending:false});return;
    }
    const currentRequest=await db.query(
      `SELECT id::text,requested_name,status FROM lab_profession_requests
       WHERE professional_id=$1 AND normalized_name=$2 AND status='pending' LIMIT 1`,
      [req.authUser!.id,normalized]
    );
    await db.query('COMMIT');active=false;
    if(!currentRequest.rows[0]){res.status(409).json({error:'request_conflict'});return;}
    res.json({request:currentRequest.rows[0],alreadyPending:true});
  }catch(error){if(active)await db.query('ROLLBACK').catch(()=>undefined);next(error);}
  finally{db.release();}
});

professionRequestsRouter.get('/mine',requireRole('professional'),async(req,res,next)=>{
  try{
    const r=await pool.query(
      `SELECT id::text,requested_name,status,created_at,reviewed_at
       FROM lab_profession_requests WHERE professional_id=$1
       ORDER BY created_at DESC,id DESC LIMIT 30`,[req.authUser!.id]
    );
    res.json({items:r.rows});
  }catch(error){next(error);}
});

professionRequestsRouter.get('/pending',requireRole('admin'),async(_req,res,next)=>{
  try{
    const r=await pool.query(
      `SELECT request.id::text,request.requested_name,request.created_at,
         user_acc.name AS professional_name,request.professional_id::text
       FROM lab_profession_requests request
       JOIN users user_acc ON user_acc.id=request.professional_id
       WHERE request.status='pending'
       ORDER BY request.created_at,request.id LIMIT 100`
    );
    res.json({items:r.rows,notice:'Solicitudes ficticias para evaluación exclusiva de Administración.'});
  }catch(error){next(error);}
});

professionRequestsRouter.post('/:id/decision',requireRole('admin'),async(req,res,next)=>{
  const id=requestId.safeParse(req.params.id);
  const parsed=decision.safeParse(req.body);
  if(!id.success||!parsed.success){res.status(400).json({error:'invalid_input'});return;}
  const db=await pool.connect().catch(next);if(!db)return;
  let active=false;
  try{
    await db.query('BEGIN');active=true;
    const current=await db.query('SELECT current_database() name');
    if(current.rows[0]?.name!==LAB_PROFESSION_REQUEST_DB){
      await db.query('ROLLBACK');active=false;res.status(403).json({error:'test_database_only'});return;
    }
    const found=await db.query(
      `SELECT id,requested_name,status FROM lab_profession_requests
       WHERE id=$1 FOR UPDATE`,[id.data]
    );
    const request=found.rows[0];
    if(!request){await db.query('ROLLBACK');active=false;res.status(404).json({error:'request_not_found'});return;}
    if(request.status!=='pending'){await db.query('ROLLBACK');active=false;res.status(409).json({error:'request_already_reviewed'});return;}
    let specialtyId:string|null=null;
    if(parsed.data.decision==='approved'){
      const categories=await db.query('SELECT id::text,name FROM specialties WHERE active=true');
      const existing=categories.rows.find(row=>normalize(String(row.name))===normalize(String(request.requested_name)));
      if(existing)specialtyId=existing.id;
      else{
        const formatted=String(request.requested_name).replace(/^./u,(value:string)=>value.toLocaleUpperCase('es-AR'));
        const created=await db.query(
          `INSERT INTO specialties(name,active) VALUES($1,true)
           ON CONFLICT(name) DO UPDATE SET active=true RETURNING id::text`,[formatted]
        );
        specialtyId=created.rows[0].id;
      }
    }
    await db.query(
      `UPDATE lab_profession_requests SET status=$2,reviewed_by=$3,
        reviewed_at=NOW(),specialty_id=$4 WHERE id=$1`,
      [id.data,parsed.data.decision,req.authUser!.id,specialtyId]
    );
    await db.query(
      `INSERT INTO audit_events(actor_id,action,resource_type,resource_id,metadata)
       VALUES($1,'lab_profession_request_reviewed','lab_profession_request',$2,$3::jsonb)`,
      [req.authUser!.id,String(id.data),JSON.stringify({
        scope:'lab',decision:parsed.data.decision,specialtyId,automaticProfessionalApproval:false
      })]
    );
    await db.query('COMMIT');active=false;
    res.json({id:String(id.data),status:parsed.data.decision,specialtyId,
      notice:'No se aprobaron profesionales ni servicios. La habilitación requiere revisión separada.'});
  }catch(error){if(active)await db.query('ROLLBACK').catch(()=>undefined);next(error);}
  finally{db.release();}
});
