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
  reference:z.string().trim().regex(/^SIM-[A-Za-z0-9-]{3,100}$/),
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
  if(status==='superseded')return 'superseded';
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
 return {...row,reminder:row.status==='reviewed_test_only' && row.is_current_approved===false
   ? 'historical' : reminder(days,String(row.status))};
}
labDocumentsRouter.get('/requirements',(_req,res)=>{
 res.json({types:documentKinds,notices:[30,15,7,0],mode:'fictitious_documents_with_private_test_evidence',
  message:'Solo se aceptan archivos PDF o imagen INVENTADOS, nunca DNI, seguros ni comprobantes reales. Los avisos se calculan al consultar.'});
});

labDocumentsRouter.get('/mine',requireRole('professional'),async(req,res,next)=>{
 try{
  const r=await pool.query(`SELECT d.id::text,d.document_type,d.fictional_reference,
   d.expires_on::text,d.status,d.reviewer_note,d.reviewed_at,d.created_at,
   EXISTS(SELECT 1 FROM lab_document_evidence e WHERE e.document_id=d.id) AS has_evidence,
   (d.status='reviewed_test_only' AND d.id=(
     SELECT approved.id FROM lab_document_entries approved
     WHERE approved.professional_id=d.professional_id
       AND approved.document_type=d.document_type
       AND approved.status='reviewed_test_only'
     ORDER BY approved.expires_on DESC NULLS LAST,approved.reviewed_at DESC NULLS LAST,approved.id DESC
     LIMIT 1
   )) AS is_current_approved,
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
  // Idempotent double click: identical pending entries are uniquely indexed.
  // Keep previous reviewed versions; retrying the same pending submission is safe.
  const result=await tx.query(`INSERT INTO lab_document_entries
    (professional_id,document_type,fictional_reference,expires_on,status)
    VALUES($1,$2,$3,$4,'pending') ON CONFLICT DO NOTHING
    RETURNING id::text,document_type,status,expires_on::text,created_at`,
    [req.authUser!.id,data.data.type,data.data.reference,expiry]);
  if(!result.rows[0]){
    const existing=await tx.query(`SELECT id::text,document_type,status,expires_on::text,created_at
      FROM lab_document_entries
      WHERE professional_id=$1 AND document_type=$2 AND fictional_reference=$3
        AND expires_on IS NOT DISTINCT FROM $4::date AND status='pending'
      ORDER BY id DESC LIMIT 1`,
      [req.authUser!.id,data.data.type,data.data.reference,expiry]);
    await tx.query('COMMIT');active=false;
    if(!existing.rows[0]){res.status(409).json({error:'submission_conflict'});return;}
    res.json({item:existing.rows[0],alreadyPending:true,
      message:'Ya existia un registro pendiente identico. No se creo otra presentacion.'});
    return;
  }
  await tx.query(`INSERT INTO audit_events(actor_id,action,resource_type,resource_id,metadata)
    VALUES($1,'lab_doc_submitted','lab_document',$2,$3::jsonb)`,
    [req.authUser!.id,result.rows[0].id,JSON.stringify({type:data.data.type,mode:'fictitious_metadata_only'})]);
  await tx.query('COMMIT');active=false;
  res.status(201).json({item:result.rows[0],alreadyPending:false,
    message:'Datos ficticios enviados a revisión. No se verificó documentación real.'});
 }catch(e){if(active)await tx.query('ROLLBACK').catch(()=>undefined);next(e);}
 finally{tx.release();}
});

// Administrative, read-only audit of laboratory document decisions.
// Subadministrators cannot consult the supervisor's audit history.
labDocumentsRouter.get('/audit',requireRole('admin'),async(_req,res,next)=>{
 try{
  const rows=await pool.query(`SELECT
    a.id::text AS event_id,a.action,a.created_at,
    a.actor_id::text,COALESCE(actor.name,'Sistema') AS actor_name,
    d.id::text AS document_id,d.document_type,d.fictional_reference,
    d.expires_on::text AS expires_on,
    pro.name AS professional_name,
    a.metadata->>'decision' AS decision,
    -- Newer audit events own an immutable observation snapshot.
    -- For legacy events, display the document's current note ONLY when
    -- the event is demonstrably its latest review by that same reviewer.
    -- Never attach a later review's note to an older action.
    COALESCE(NULLIF(a.metadata->>'note',''),
      CASE WHEN a.action='lab_doc_reviewed'
        AND a.actor_id=d.reviewed_by
        AND d.reviewed_at IS NOT NULL
        AND a.created_at BETWEEN d.reviewed_at - INTERVAL '10 seconds'
                             AND d.reviewed_at + INTERVAL '10 seconds'
        AND NOT EXISTS (
          SELECT 1 FROM audit_events newer
          WHERE newer.action='lab_doc_reviewed'
            AND newer.resource_type='lab_document'
            AND newer.resource_id=a.resource_id
            AND newer.id>a.id
        )
      THEN d.reviewer_note ELSE NULL END
    ) AS review_note,
    staff.name AS created_staff_name
   FROM audit_events a
   LEFT JOIN users actor ON actor.id=a.actor_id
   LEFT JOIN lab_document_entries d
     ON a.resource_type='lab_document' AND a.resource_id=d.id::text
   LEFT JOIN users pro ON pro.id=d.professional_id
   LEFT JOIN users staff
     ON a.resource_type='user' AND a.resource_id=staff.id::text
   WHERE a.action IN (
     'lab_doc_reviewed','lab_doc_duplicate_superseded','lab_subadmin_created'
   )
   ORDER BY a.created_at DESC,a.id DESC LIMIT 60`);
  res.json({items:rows.rows,scope:'lab_admin_only',
    notice:'Actuaciones de laboratorio. No acreditan documentos reales.'});
 }catch(error){next(error);}
});

labDocumentsRouter.get('/queue',requireRole('admin','subadmin'),async(req,res,next)=>{
 try{
  if(!await canReview(req.authUser!.role,req.authUser!.id)){res.status(403).json({error:'permission_denied'});return;}
  const r=await pool.query(`SELECT d.id::text,d.document_type,d.fictional_reference,
    d.expires_on::text,d.status,d.created_at,u.name AS professional_name,
    EXISTS(SELECT 1 FROM lab_document_evidence e WHERE e.document_id=d.id) AS has_evidence,
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
  // A date typed by the professional is never proof. The reviewer must open
  // the current private evidence file before approving even a test record.
  if(decision.data.decision==='reviewed_test_only'){
   const evidence=await tx.query('SELECT sha256 FROM lab_document_evidence WHERE document_id=$1',[doc.data]);
   if(!evidence.rows.length){
    await tx.query('ROLLBACK');active=false;res.status(409).json({error:'evidence_required'});return;
   }
   const viewed=await tx.query(
    "SELECT 1 FROM audit_events a JOIN lab_document_evidence e ON e.document_id=$1 WHERE a.actor_id=$2 AND a.action='lab_doc_evidence_viewed' AND a.resource_type='lab_document' AND a.resource_id=$3 AND a.metadata->>'sha'=e.sha256 AND a.created_at>=e.created_at LIMIT 1",
    [doc.data,req.authUser!.id,String(doc.data)]);
   if(!viewed.rows.length){
    await tx.query('ROLLBACK');active=false;res.status(409).json({error:'evidence_must_be_viewed'});return;
   }
  }
  const edited=await tx.query(`UPDATE lab_document_entries SET status=$1,reviewer_note=$2,
    reviewed_by=$3,reviewed_at=now() WHERE id=$4 RETURNING id::text,status,reviewed_at`,
    [decision.data.decision,decision.data.note,req.authUser!.id,doc.data]);
  await tx.query(`INSERT INTO audit_events(actor_id,action,resource_type,resource_id,metadata)
    VALUES($1,'lab_doc_reviewed','lab_document',$2,$3::jsonb)`,
    [req.authUser!.id,String(doc.data),JSON.stringify({decision:decision.data.decision,
      note:decision.data.note,
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
