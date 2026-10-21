import {Router} from 'express';
import argon2 from 'argon2';
import {z} from 'zod';
import {pool} from '../db.js';
import {requireAuth,requireRole} from '../security.js';
import {documentKinds,LAB_DOCUMENT_DB} from '../lab-document-setup.js';

export const labDocumentsRouter=Router();
labDocumentsRouter.use(requireAuth);
const types=documentKinds.map(x=>x.key) as [typeof documentKinds[number]['key'],...typeof documentKinds[number]['key'][]];
const dateRE=/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const submission=z.object({
  type:z.enum(types),
  reference:z.string().trim().min(5).max(120),
  expiresOn:z.string().regex(dateRE).nullable()
}).strict();
const review=z.object({
  decision:z.enum(['reviewed_test_only','needs_more','rejected']),
  note:z.string().trim().min(8).max(600)
}).strict();
const staff=z.object({
  name:z.string().trim().min(2).max(120),
  email:z.string().email().toLowerCase().endsWith('@test.invalid'),
  password:z.string().min(12).max(128)
}).strict();
const id=z.coerce.number().int().positive();
const argToday="(now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date";
const reminderSql=`CASE WHEN d.expires_on IS NULL THEN NULL
 ELSE d.expires_on - ${argToday} END AS days_until_expiry`;

function reminder(days:number|null,status:string):string{
  if(status!=='reviewed_test_only')return 'pending_review';
  if(days===null)return 'no_expiry_recorded';
  if(days<0)return 'expired';
  if(days===0)return 'expires_today';
  if(days<=7)return '7_days';
  if(days<=15)return '15_days';
  if(days<=30)return '30_days';
  return 'current';
}
async function isReviewer(userId:string):Promise<boolean>{
 const r=await pool.query(`SELECT 1 FROM lab_staff_permissions WHERE user_id=$1
    AND document_review=true LIMIT 1`,[userId]);
 return r.rowCount===1;
}
async function canReview(reqRole:string,userId:string):Promise<boolean>{
 return reqRole==='admin'||(reqRole==='subadmin'&&await isReviewer(userId));
}
function safeSummary(row:Record<string,unknown>){
 const days=row.days_until_expiry===null?null:Number(row.days_until_expiry);
 return {...row,reminder:reminder(days,String(row.status))};
}
labDocumentsRouter.get('/requirements',(_req,res)=>{
 res.json({types:documentKinds,notices:[30,15,7,0],mode:'fictitious_metadata_only',
  message:'No se solicitan ni almacenan documentos reales ni imágenes. Los avisos solo se calculan al consultar la plataforma.'});
});

labDocumentsRouter.get('/mine',requireRole('professional'),async(req,res,next)=>{
 try{
  const r=await pool.query(`SELECT d.id::text,d.document_type,d.fictional_reference,
   d.expires_on::text,d.status,d.reviewer_note,d.reviewed_at,d.created_at,
   ${reminderSql} FROM lab_document_entries d
   WHERE d.professional_id=$1 ORDER BY d.document_type,d.id DESC LIMIT 100`,[req.authUser!.id]);
  res.json({items:r.rows.map(safeSummary),mode:'fictitious_metadata_only'});
 }catch(e){next(e);}
});

labDocumentsRouter.post('/mine',requireRole('professional'),async(req,res,next)=>{
 const data=submission.safeParse(req.body);
 if(!data.success){res.status(400).json({error:'invalid_input'});return;}
 // Date validity: avoid rollover 2026-02-31 and unrealistically old/future dates.
 const expiry=data.data.expiresOn;
 if(expiry){
  const date=new Date(expiry+'T00:00:00.000Z');
  if(!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==expiry||
     expiry<'2020-01-01'||expiry>'2100-12-31'){
    res.status(400).json({error:'invalid_expiry_date'});return;
  }
 }
 const tx=await pool.connect().catch(next);if(!tx)return;let active=false;
 try{
  await tx.query('BEGIN');active=true;
  const db=await tx.query('SELECT current_database() name');
  if(db.rows[0]?.name!==LAB_DOCUMENT_DB)throw Error('lab_only');
  // A new version does not silently overwrite, approve or delete the old version.
  const result=await tx.query(`INSERT INTO lab_document_entries
    (professional_id,document_type,fictional_reference,expires_on,status)
    VALUES($1,$2,$3,$4,'pending') RETURNING id::text,document_type,status,expires_on::text,created_at`,
    [req.authUser!.id,data.data.type,data.data.reference,expiry]);
  await tx.query(`INSERT INTO audit_events(actor_id,action,resource_type,resource_id,metadata)
    VALUES($1,'lab_doc_submitted','lab_document',$2,$3::jsonb)`,
    [req.authUser!.id,result.rows[0].id,JSON.stringify({type:data.data.type,mode:'fictitious_metadata_only'})]);
  await tx.query('COMMIT');active=false;
  res.status(201).json({item:result.rows[0],message:'Datos ficticios enviados a revisión. No se verificó documentación real.'});
 }catch(e){if(active)await tx.query('ROLLBACK').catch(()=>undefined);next(e);}
 finally{tx.release();}
});

labDocumentsRouter.get('/queue',requireRole('admin','subadmin'),async(req,res,next)=>{
 try{
  if(!await canReview(req.authUser!.role,req.authUser!.id)){res.status(403).json({error:'permission_denied'});return;}
  const r=await pool.query(`SELECT d.id::text,d.document_type,d.fictional_reference,
    d.expires_on::text,d.status,d.created_at,u.name AS professional_name,
    d.professional_id::text FROM lab_document_entries d
    JOIN users u ON u.id=d.professional_id
    WHERE d.status='pending'
    ORDER BY d.created_at,d.id LIMIT 100`);
  res.json({items:r.rows,mode:'fictitious_metadata_only',
    notice:'Revisás datos inventados. No significa validar identidad, DNI o habilitaciones reales.'});
 }catch(e){next(e);}
});

labDocumentsRouter.post('/queue/:id/review',requireRole('admin','subadmin'),async(req,res,next)=>{
 const doc=id.safeParse(req.params.id),decision=review.safeParse(req.body);
 if(!doc.success||!decision.success){res.status(400).json({error:'invalid_input'});return;}
 if(!await canReview(req.authUser!.role,req.authUser!.id)){res.status(403).json({error:'permission_denied'});return;}
 const tx=await pool.connect().catch(next);if(!tx)return;let active=false;
 try{
  await tx.query('BEGIN');active=true;
  const row=await tx.query(`SELECT d.id,d.professional_id,d.document_type,d.status
    FROM lab_document_entries d WHERE d.id=$1 FOR UPDATE`,[doc.data]);
  if(!row.rows.length||row.rows[0].status!=='pending'){
    await tx.query('ROLLBACK');active=false;res.status(409).json({error:'document_not_pending'});return;
  }
  const edited=await tx.query(`UPDATE lab_document_entries SET status=$1,reviewer_note=$2,
    reviewed_by=$3,reviewed_at=now() WHERE id=$4 RETURNING id::text,status,reviewed_at`,
    [decision.data.decision,decision.data.note,req.authUser!.id,doc.data]);
  await tx.query(`INSERT INTO audit_events(actor_id,action,resource_type,resource_id,metadata)
    VALUES($1,'lab_doc_reviewed','lab_document',$2,$3::jsonb)`,
    [req.authUser!.id,String(doc.data),JSON.stringify({decision:decision.data.decision,
      professionalId:String(row.rows[0].professional_id),mode:'test_only'})]);
  await tx.query('COMMIT');active=false;
  res.json({item:edited.rows[0],notice:'Revisión de metadatos ficticios: no verifica documentos reales ni habilita profesionales.'});
 }catch(e){if(active)await tx.query('ROLLBACK').catch(()=>undefined);next(e);}
 finally{tx.release();}
});

// Only the GENERAL administrator can create a subadmin identity.
// Registration endpoint never accepts subadmin; no inherited admin privileges.
labDocumentsRouter.post('/staff',requireRole('admin'),async(req,res,next)=>{
 const parsed=staff.safeParse(req.body);
 if(!parsed.success){res.status(400).json({error:'invalid_input'});return;}
 const tx=await pool.connect().catch(next);if(!tx)return;let active=false;
 try{
  const hash=await argon2.hash(parsed.data.password,{type:argon2.argon2id});
  await tx.query('BEGIN');active=true;
  const db=await tx.query('SELECT current_database() name');
  if(db.rows[0]?.name!==LAB_DOCUMENT_DB)throw Error('lab_only');
  const user=await tx.query(`INSERT INTO users(name,email,password_hash,role,status)
    VALUES($1,$2,$3,'subadmin','active')
    RETURNING id::text,name,role`,[parsed.data.name,parsed.data.email,hash]);
  await tx.query(`INSERT INTO lab_staff_permissions(user_id,document_review,created_by)
    VALUES($1,true,$2)`,[user.rows[0].id,req.authUser!.id]);
  await tx.query(`INSERT INTO audit_events(actor_id,action,resource_type,resource_id,metadata)
    VALUES($1,'lab_subadmin_created','user',$2,$3::jsonb)`,
    [req.authUser!.id,user.rows[0].id,JSON.stringify({document_review:true,scope:'lab'})]);
  await tx.query('COMMIT');active=false;res.status(201).json({user:user.rows[0],permission:'document_review'});
 }catch(e){
  if(active)await tx.query('ROLLBACK').catch(()=>undefined);
  if((e as {code?:string})?.code==='23505'){res.status(409).json({error:'account_unavailable'});return;}
  next(e);
 }finally{tx.release();}
});

labDocumentsRouter.get('/staff',requireRole('admin'),async(_req,res,next)=>{
 try{const r=await pool.query(`SELECT u.id::text,u.name,u.status,p.document_review,p.created_at
   FROM lab_staff_permissions p JOIN users u ON u.id=p.user_id WHERE u.role='subadmin'
   ORDER BY u.id DESC LIMIT 30`);res.json({items:r.rows});}
 catch(e){next(e);}
});
