import {Router} from 'express';
import {z} from 'zod';
import {pool} from '../db.js';
import {requireAuth,requireRole} from '../security.js';
import type {PoolClient} from 'pg';

// Exclusive laboratory-only: a diagnostic visit and later repair decision
// are two distinct proposals under the SAME original job.
export const labVisitsRouter=Router();
labVisitsRouter.use(requireAuth);
const LAB_DB='mantenimiento_360_db_pruebas_20261012';
const idInput=(v:unknown)=>z.coerce.number().int().positive().safeParse(v);
const visitInput=z.object({
  amount:z.number().positive().max(9999999999.99),
  description:z.string().trim().min(10).max(3000)
}).strict();
const repairInput=z.object({
  diagnosis:z.string().trim().min(10).max(3000),
  amount:z.number().positive().max(9999999999.99),
  description:z.string().trim().min(10).max(3000),
  warrantyDays:z.number().int().min(0).max(3650)
}).strict();
const decisionInput=z.object({accept:z.boolean()}).strict();

export async function ensureLabVisitSchema():Promise<void>{
  const db=await pool.connect();
  try{
    const identity=await db.query('SELECT current_database() AS name');
    if(identity.rows[0]?.name!==LAB_DB)throw new Error('Diagnostic visits are restricted to laboratory DB');
    await db.query('SELECT pg_advisory_lock($1::bigint)',[36020261025]);
    await db.query(`CREATE TABLE IF NOT EXISTS lab_visit_offers(
      id BIGSERIAL PRIMARY KEY,
      job_id BIGINT NOT NULL REFERENCES jobs(id) ON DELETE RESTRICT,
      professional_id BIGINT NOT NULL REFERENCES professional_profiles(user_id) ON DELETE RESTRICT,
      amount NUMERIC(12,2) NOT NULL CHECK(amount>0),
      description TEXT NOT NULL CHECK(length(btrim(description)) BETWEEN 10 AND 3000),
      status VARCHAR(24) NOT NULL DEFAULT 'submitted'
        CHECK(status IN ('submitted','accepted','not_selected')),
      offered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      accepted_at TIMESTAMPTZ,
      diagnosis TEXT CHECK(diagnosis IS NULL OR length(btrim(diagnosis)) BETWEEN 10 AND 3000),
      diagnosed_at TIMESTAMPTZ,
      repair_amount NUMERIC(12,2) CHECK(repair_amount IS NULL OR repair_amount>0),
      repair_description TEXT CHECK(repair_description IS NULL OR length(btrim(repair_description)) BETWEEN 10 AND 3000),
      repair_warranty_days INTEGER CHECK(repair_warranty_days BETWEEN 0 AND 3650),
      repair_offered_at TIMESTAMPTZ,
      repair_decision VARCHAR(20) CHECK(repair_decision IN ('accepted','rejected')),
      repair_decided_at TIMESTAMPTZ,
      UNIQUE(job_id,professional_id)
    )`);
    await db.query("CREATE UNIQUE INDEX IF NOT EXISTS lab_only_one_selected_visit ON lab_visit_offers(job_id) WHERE status='accepted'");
    await db.query('CREATE INDEX IF NOT EXISTS lab_visit_professional_idx ON lab_visit_offers(professional_id,offered_at DESC)');
    console.log('Two-stage diagnostic visit and repair proposal ready (lab only)');
  }finally{
    await db.query('SELECT pg_advisory_unlock($1::bigint)',[36020261025]).catch(()=>undefined);
    db.release();
  }
}

// Always lock the job FIRST. All quote / visit / contract state transitions
// serialize on jobs, and never infer participant access from a public code.
async function lockedJob(db:PoolClient,jobId:number){
  const r=await db.query('SELECT id,client_id,status,specialty_id,service_id FROM jobs WHERE id=$1 FOR UPDATE',[jobId]);
  return r.rows[0]||null;
}
async function approvedForJob(db:PoolClient,pro:string,job:any):Promise<boolean>{
  const r=await db.query(`SELECT 1 FROM professional_profiles pp
    JOIN professional_specialties ps ON ps.professional_id=pp.user_id
      AND ps.specialty_id=$2
    JOIN users u ON u.id=pp.user_id
    WHERE pp.user_id=$1 AND pp.verification_status='approved'
      AND pp.available=true AND u.status='active'
      AND ($3::bigint IS NULL OR EXISTS(
        SELECT 1 FROM professional_services pts
        JOIN lab_service_declarations d ON d.professional_id=pts.professional_id
          AND d.service_id=pts.service_id AND d.status='approved'
        WHERE pts.professional_id=$1 AND pts.service_id=$3))
      AND NOT EXISTS(SELECT 1 FROM claims c WHERE c.professional_id=$1
        AND c.status IN ('open','in_review'))
      AND NOT EXISTS(SELECT 1 FROM professional_restrictions p
        WHERE p.professional_id=$1 AND p.lifted_at IS NULL)`,
    [pro,job.specialty_id,job.service_id]);
  return !!r.rows.length;
}
async function changes(db:PoolClient,jobId:number,actor:string,from:string,to:string,note:string){
  await db.query('UPDATE jobs SET status=$2,updated_at=now() WHERE id=$1',[jobId,to]);
  await db.query(`INSERT INTO job_status_events(job_id,actor_id,old_status,new_status,note)
    VALUES($1,$2,$3,$4,$5)`,[jobId,actor,from,to,note]);
}
// Include visit details only to the client's own job, corresponding professional,
// or administrator. Other professionals may see open offers only after posting
// their own offer; they NEVER see competitors' price / identity.
labVisitsRouter.get('/mine/visits',requireRole('professional'),async(req,res,next)=>{
  try{
    const result=await pool.query(`SELECT v.id AS visit_id,v.id,
      v.job_id,j.public_code,j.locality,j.description,j.status,
      j.specialty_id,j.service_id,v.amount AS visit_amount,
      v.description AS visit_description,v.status AS visit_status,
      v.offered_at,v.accepted_at,v.diagnosed_at,v.repair_offered_at,
      v.repair_decision,
      q.amount AS repair_contract_amount,q.warranty_days AS repair_contract_warranty_days,
      q.description AS repair_contract_description
      FROM lab_visit_offers v JOIN jobs j ON j.id=v.job_id
      LEFT JOIN job_contracts jc ON jc.job_id=j.id
      LEFT JOIN job_quotes q ON q.id=jc.quote_id AND q.job_id=j.id
        AND q.professional_id=v.professional_id
      WHERE v.professional_id=$1 ORDER BY v.offered_at DESC LIMIT 100`,[req.authUser!.id]);
    res.json(result.rows);
  }catch(error){next(error);}
});
labVisitsRouter.get('/:jobId/visits',async(req,res,next)=>{
  const id=idInput(req.params.jobId);
  if(!id.success){res.status(400).json({error:'invalid_job_id'});return;}
  try{
    const me=req.authUser!;
    const job=await pool.query('SELECT client_id FROM jobs WHERE id=$1',[id.data]);
    if(!job.rows[0]){res.status(404).json({error:'job_not_found'});return;}
    const owner=me.role==='client'&&String(job.rows[0].client_id)===me.id;
    if(!owner&&me.role!=='professional'&&me.role!=='admin'){res.status(404).json({error:'job_not_found'});return;}
    const result=await pool.query(`SELECT v.id,v.job_id,v.professional_id,
      u.name AS professional_name,v.amount,v.description,v.status,v.offered_at,
      v.accepted_at,v.diagnosis,v.diagnosed_at,v.repair_amount,
      v.repair_description,v.repair_warranty_days,v.repair_offered_at,
      v.repair_decision,v.repair_decided_at,
      j.public_code,j.locality,j.status AS job_status,j.description AS job_description
      FROM lab_visit_offers v JOIN jobs j ON j.id=v.job_id
      JOIN users u ON u.id=v.professional_id
      WHERE v.job_id=$1 AND ($2::boolean OR v.professional_id=$3)
      ORDER BY v.offered_at,v.id`,
      [id.data,owner||me.role==='admin',me.id]);
    res.json(result.rows);
  }catch(error){next(error);}
});
labVisitsRouter.post('/:jobId/visits',requireRole('professional'),async(req,res,next)=>{
  const id=idInput(req.params.jobId),input=visitInput.safeParse(req.body);
  if(!id.success||!input.success){res.status(400).json({error:'invalid_visit_offer'});return;}
  const db=await pool.connect();
  try{
    await db.query('BEGIN');
    const j=await lockedJob(db,id.data);
    if(!j||!['requested','quoted'].includes(j.status)){
      await db.query('ROLLBACK');res.status(409).json({error:'job_not_accepting_visits'});return;
    }
    if(!await approvedForJob(db,req.authUser!.id,j)){
      await db.query('ROLLBACK');res.status(403).json({error:'professional_not_eligible'});return;
    }
    const existing=await db.query(`SELECT 1 FROM job_quotes WHERE job_id=$1 AND professional_id=$2
      UNION ALL SELECT 1 FROM lab_visit_offers WHERE job_id=$1 AND professional_id=$2 LIMIT 1`,
      [id.data,req.authUser!.id]);
    if(existing.rows.length){await db.query('ROLLBACK');res.status(409).json({error:'quote_already_submitted'});return;}
    const offer=await db.query(`INSERT INTO lab_visit_offers(job_id,professional_id,amount,description)
      VALUES($1,$2,$3,$4) RETURNING id,job_id,amount,description,status,offered_at`,
      [id.data,req.authUser!.id,input.data.amount,input.data.description]);
    if(j.status==='requested'){
      await changes(db,id.data,req.authUser!.id,'requested','quoted',
        'Se presentó una propuesta de visita técnica de diagnóstico, sin presupuesto de reparación.');
    }
    await db.query('COMMIT');res.status(201).json(offer.rows[0]);
  }catch(error){await db.query('ROLLBACK').catch(()=>undefined);next(error);}finally{db.release();}
});
labVisitsRouter.post('/:jobId/visits/:visitId/accept',
  requireRole('client'),async(req,res,next)=>{
  const id=idInput(req.params.jobId),vid=idInput(req.params.visitId);
  if(!id.success||!vid.success){res.status(400).json({error:'invalid_visit_id'});return;}
  const db=await pool.connect();
  try{
    await db.query('BEGIN');
    const j=await lockedJob(db,id.data);
    if(!j||String(j.client_id)!==req.authUser!.id){
      await db.query('ROLLBACK');res.status(404).json({error:'job_not_found'});return;
    }
    if(j.status!=='quoted'){await db.query('ROLLBACK');res.status(409).json({error:'job_not_accepting_selection'});return;}
    const offer=await db.query("SELECT id FROM lab_visit_offers WHERE id=$1 AND job_id=$2 AND status='submitted'",
      [vid.data,id.data]);
    if(!offer.rows.length){await db.query('ROLLBACK');res.status(409).json({error:'visit_not_available'});return;}
    await db.query("UPDATE lab_visit_offers SET status=CASE WHEN id=$2 THEN 'accepted' ELSE 'not_selected' END, accepted_at=CASE WHEN id=$2 THEN now() ELSE NULL END WHERE job_id=$1 AND status='submitted'",[id.data,vid.data]);
    await db.query("UPDATE job_quotes SET status='not_selected',updated_at=now() WHERE job_id=$1 AND status='submitted'",[id.data]);
    await changes(db,id.data,req.authUser!.id,'quoted','accepted',
      'Cliente aceptó únicamente la visita técnica. La reparación NO está contratada.');
    await db.query('COMMIT');res.json({jobId:id.data,visitId:vid.data,status:'visit_accepted',paymentProcessed:false});
  }catch(error){await db.query('ROLLBACK').catch(()=>undefined);next(error);}finally{db.release();}
});
labVisitsRouter.post('/:jobId/visits/:visitId/diagnosis',
  requireRole('professional'),async(req,res,next)=>{
  const id=idInput(req.params.jobId),vid=idInput(req.params.visitId),input=repairInput.safeParse(req.body);
  if(!id.success||!vid.success||!input.success){res.status(400).json({error:'invalid_diagnosis'});return;}
  const db=await pool.connect();
  try{
    await db.query('BEGIN');
    const j=await lockedJob(db,id.data);
    if(!j||j.status!=='accepted'){await db.query('ROLLBACK');res.status(409).json({error:'visit_not_ready_for_diagnosis'});return;}
    const eligible=await db.query(`SELECT 1 FROM lab_visit_offers
      WHERE id=$1 AND job_id=$2 AND professional_id=$3 AND status='accepted'
        AND diagnosed_at IS NULL`,[vid.data,id.data,req.authUser!.id]);
    if(!eligible.rows.length){await db.query('ROLLBACK');res.status(403).json({error:'visit_not_owned_or_already_diagnosed'});return;}
    const pending=await db.query("SELECT 1 FROM claims WHERE professional_id=$1 AND status IN ('open','in_review') LIMIT 1",
      [req.authUser!.id]);
    if(pending.rows.length){await db.query('ROLLBACK');res.status(403).json({error:'professional_has_open_claim'});return;}
    const saved=await db.query(`UPDATE lab_visit_offers SET diagnosis=$3,diagnosed_at=now(),
       repair_amount=$4,repair_description=$5,repair_warranty_days=$6,repair_offered_at=now()
       WHERE id=$1 AND job_id=$2 RETURNING id,diagnosed_at,repair_offered_at`,
      [vid.data,id.data,input.data.diagnosis,input.data.amount,input.data.description,input.data.warrantyDays]);
    await db.query(`INSERT INTO job_status_events(job_id,actor_id,old_status,new_status,note)
      VALUES($1,$2,'accepted','accepted','Diagnóstico informado y presupuesto de reparación presentado; pendiente de decisión del cliente')`,
      [id.data,req.authUser!.id]);
    await db.query('COMMIT');res.json(saved.rows[0]);
  }catch(error){await db.query('ROLLBACK').catch(()=>undefined);next(error);}finally{db.release();}
});
labVisitsRouter.post('/:jobId/visits/:visitId/repair-decision',
  requireRole('client'),async(req,res,next)=>{
  const id=idInput(req.params.jobId),vid=idInput(req.params.visitId),input=decisionInput.safeParse(req.body);
  if(!id.success||!vid.success||!input.success){res.status(400).json({error:'invalid_repair_decision'});return;}
  const db=await pool.connect();
  try{
    await db.query('BEGIN');
    const j=await lockedJob(db,id.data);
    if(!j||String(j.client_id)!==req.authUser!.id){
      await db.query('ROLLBACK');res.status(404).json({error:'job_not_found'});return;
    }
    if(j.status!=='accepted'){await db.query('ROLLBACK');res.status(409).json({error:'visit_not_awaiting_repair_decision'});return;}
    const q=await db.query(`SELECT * FROM lab_visit_offers WHERE id=$1 AND job_id=$2
      AND status='accepted' AND diagnosed_at IS NOT NULL AND repair_decision IS NULL`,[vid.data,id.data]);
    const visit=q.rows[0];
    if(!visit){await db.query('ROLLBACK');res.status(409).json({error:'repair_decision_unavailable'});return;}
    if(input.data.accept){
      // The accepted repair creates the ONE ordinary contract for the work.
      // The visit fee stays separately preserved on lab_visit_offers.
      const repair=await db.query(`INSERT INTO job_quotes(job_id,professional_id,amount,description,warranty_days,status)
        VALUES($1,$2,$3,$4,$5,'accepted')
        ON CONFLICT(job_id,professional_id) DO NOTHING RETURNING id`,
        [id.data,visit.professional_id,visit.repair_amount,
          visit.repair_description,visit.repair_warranty_days]);
      if(!repair.rows[0]){
        await db.query('ROLLBACK');res.status(409).json({error:'repair_quote_conflict'});return;
      }
      await db.query('INSERT INTO job_contracts(job_id,quote_id) VALUES($1,$2)',
        [id.data,repair.rows[0].id]);
      await changes(db,id.data,req.authUser!.id,'accepted','confirmed',
        'Cliente aceptó presupuesto de reparación posterior al diagnóstico. La visita técnica y su importe permanecen en historial separado.');
    }else{
      await changes(db,id.data,req.authUser!.id,'accepted','cancelled',
        'Visita técnica realizada; cliente NO contrató la reparación. El acuerdo de visita permanece registrado por separado.');
    }
    await db.query(`UPDATE lab_visit_offers SET repair_decision=$3,repair_decided_at=now()
      WHERE id=$1 AND job_id=$2`,[vid.data,id.data,input.data.accept?'accepted':'rejected']);
    await db.query('COMMIT');
    res.json({jobId:id.data,status:input.data.accept?'repair_contracted':'visit_only_closed',paymentProcessed:false});
  }catch(error){await db.query('ROLLBACK').catch(()=>undefined);next(error);}finally{db.release();}
});
