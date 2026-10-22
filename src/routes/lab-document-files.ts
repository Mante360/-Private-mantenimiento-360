// Isolated LAB ONLY. No real ID, insurance or private documents here.
import express,{Router} from 'express';
import {createHash} from 'node:crypto';
import {z} from 'zod';
import {pool} from '../db.js';
import type {PoolClient} from 'pg';
import {requireAuth,requireRole} from '../security.js';
import {LAB_DOCUMENT_DB} from '../lab-document-setup.js';

export const labDocumentFilesRouter=Router();
labDocumentFilesRouter.use(requireAuth);
const idOf=(v:unknown)=>z.coerce.number().int().positive().safeParse(v);
const LIMIT=1500000;
const MIME=['application/pdf','image/jpeg','image/png','image/webp'];

function check(bytes:Buffer,mime:string):boolean{
 if(bytes.length<20||bytes.length>LIMIT)return false;
 if(mime==='application/pdf'){
  const s=bytes.toString('latin1');
  return /^%PDF-1\.[0-7]/.test(s)&&s.slice(-1024).includes('%%EOF')
    &&!/\/(?:JavaScript|JS|Launch|EmbeddedFile|OpenAction|AcroForm)\b/i.test(s);
 }
 if(mime==='image/jpeg')return bytes[0]===255&&bytes[1]===216&&bytes[2]===255
  &&bytes[bytes.length-2]===255&&bytes[bytes.length-1]===217;
 if(mime==='image/png')return bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
  &&bytes.subarray(12,16).toString('ascii')==='IHDR';
 if(mime==='image/webp')return bytes.subarray(0,4).toString('ascii')==='RIFF'
  &&bytes.subarray(8,12).toString('ascii')==='WEBP';
 return false;
}

function demoPdf(type:string,ref:string,expiry:string|null):Buffer{
 const clean=(s:string)=>s.replace(/[^\x20-\x7e]/g,' ').replace(/[\\()]/g,'');
 const lines=[
  'MANTENIMIENTO 360 - LABORATORIO',
  'DOCUMENTO FICTICIO - SIN VALOR LEGAL',
  'Tipo: '+clean(type),
  'Referencia SIMULADA: '+clean(ref),
  'Vencimiento declarado: '+(expiry||'NO INFORMADO'),
  'Este PDF NO acredita cobertura ni matricula.',
  'Comparar visualmente la fecha con el formulario.'
 ];
 const stream=lines.map((s,i)=>
   'BT /F1 '+(i<2?'15':'11')+' Tf 38 '+(780-i*48)+' Td ('+s+') Tj ET'
 ).join('\n')+'\n';
 const obj=[
  '<< /Type /Catalog /Pages 2 0 R >>',
  '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
  '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  '<< /Length '+Buffer.byteLength(stream,'ascii')+' >>\nstream\n'+stream+'endstream'
 ];
 let pdf='%PDF-1.4\n';const offsets=[0];
 for(let i=0;i<obj.length;i++){
  offsets.push(Buffer.byteLength(pdf,'ascii'));
  pdf+=(i+1)+' 0 obj\n'+obj[i]+'\nendobj\n';
 }
 const offset=Buffer.byteLength(pdf,'ascii');
 pdf+='xref\n0 '+(obj.length+1)+'\n0000000000 65535 f \n';
 pdf+=offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('');
 pdf+='trailer\n<< /Size '+(obj.length+1)+' /Root 1 0 R >>\nstartxref\n'+offset+'\n%%EOF\n';
 return Buffer.from(pdf,'ascii');
}
async function labOnly(db:PoolClient){
 const d=await db.query('SELECT current_database() AS name');
 if(d.rows[0]?.name!==LAB_DOCUMENT_DB)throw Error('lab_database_only');
}
async function allowedReviewer(role:string,userId:string){
 if(role==='admin')return true;
 if(role!=='subadmin')return false;
 const result=await pool.query('SELECT 1 FROM lab_staff_permissions WHERE user_id=$1 AND document_review=true',[userId]);
 return Boolean(result.rowCount);
}
async function saveEvidence(docId:number,owner:string,content:Buffer,mime:string,res:express.Response,next:express.NextFunction){
 const sha=createHash('sha256').update(content).digest('hex');
 const db=await pool.connect();let active=false;
 try{
  await db.query('BEGIN');active=true;await labOnly(db);
  const row=await db.query('SELECT status FROM lab_document_entries WHERE id=$1 AND professional_id=$2 FOR UPDATE',[docId,owner]);
  if(!row.rows[0]||!['pending','needs_more'].includes(row.rows[0].status)){
   await db.query('ROLLBACK');active=false;res.status(409).json({error:'document_not_editable'});return;
  }
  await db.query('INSERT INTO lab_document_evidence(document_id,mime_type,content,size_bytes,sha256,uploaded_by) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(document_id) DO UPDATE SET mime_type=EXCLUDED.mime_type,content=EXCLUDED.content,size_bytes=EXCLUDED.size_bytes,sha256=EXCLUDED.sha256,uploaded_by=EXCLUDED.uploaded_by,created_at=now()',
   [docId,mime,content,content.length,sha,owner]);
  await db.query("UPDATE lab_document_entries SET status='pending',reviewer_note=NULL,reviewed_by=NULL,reviewed_at=NULL WHERE id=$1",[docId]);
  await db.query("INSERT INTO audit_events(actor_id,action,resource_type,resource_id,metadata) VALUES($1,'lab_doc_evidence_attached','lab_document',$2,$3::jsonb)",
   [owner,String(docId),JSON.stringify({mime,sha,scope:'lab',size:content.length})]);
  await db.query('COMMIT');active=false;
  res.status(201).json({ok:true,mime_type:mime,size_bytes:content.length});
 }catch(e){if(active)await db.query('ROLLBACK').catch(()=>undefined);next(e);}
 finally{db.release();}
}
labDocumentFilesRouter.post('/mine/:id/evidence/demo',requireRole('professional'),async(req,res,next)=>{
 const doc=idOf(req.params.id);if(!doc.success){res.status(400).json({error:'invalid_document_id'});return;}
 try{
  const r=await pool.query('SELECT document_type,fictional_reference,expires_on::text FROM lab_document_entries WHERE id=$1 AND professional_id=$2',
   [doc.data,req.authUser!.id]);
  if(!r.rows[0]){res.status(404).json({error:'document_not_found'});return;}
  await saveEvidence(doc.data,req.authUser!.id,
   demoPdf(r.rows[0].document_type,r.rows[0].fictional_reference,r.rows[0].expires_on),
   'application/pdf',res,next);
 }catch(e){next(e);}
});
labDocumentFilesRouter.post('/mine/:id/evidence',requireRole('professional'),
 express.raw({type:MIME,limit:'1600kb'}),async(req,res,next)=>{
 const doc=idOf(req.params.id);if(!doc.success){res.status(400).json({error:'invalid_document_id'});return;}
 const mime=(req.get('content-type')||'').split(';')[0].trim().toLowerCase();
 const content:unknown=req.body;
 if(!MIME.includes(mime)||!Buffer.isBuffer(content)||!check(content,mime)){
  res.status(400).json({error:'invalid_test_document_file'});return;
 }
 await saveEvidence(doc.data,req.authUser!.id,content,mime,res,next);
});
labDocumentFilesRouter.get('/:id/evidence',requireRole('professional','admin','subadmin'),async(req,res,next)=>{
 const doc=idOf(req.params.id);if(!doc.success){res.status(400).json({error:'invalid_document_id'});return;}
 try{
  const actor=req.authUser!;
  if(actor.role!=='professional'&&!await allowedReviewer(actor.role,actor.id)){
   res.status(403).json({error:'permission_denied'});return;
  }
  const result=await pool.query('SELECT e.content,e.mime_type,e.sha256,d.professional_id FROM lab_document_evidence e JOIN lab_document_entries d ON d.id=e.document_id WHERE e.document_id=$1',[doc.data]);
  const record=result.rows[0];
  if(!record||(actor.role==='professional'&&String(record.professional_id)!==actor.id)){
   res.status(404).json({error:'evidence_not_found'});return;
  }
  if(actor.role!=='professional'){
   await pool.query("INSERT INTO audit_events(actor_id,action,resource_type,resource_id,metadata) VALUES($1,'lab_doc_evidence_viewed','lab_document',$2,$3::jsonb)",
    [actor.id,String(doc.data),JSON.stringify({sha:record.sha256,scope:'lab'})]);
  }
  res.setHeader('Cache-Control','private, no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Content-Security-Policy',"default-src 'none'; sandbox");
  const ext=record.mime_type==='application/pdf'?'pdf':record.mime_type==='image/png'?'png':record.mime_type==='image/webp'?'webp':'jpg';
  res.setHeader('Content-Disposition','attachment; filename="respaldo-ficticio.'+ext+'"');
  res.type(record.mime_type).send(record.content as Buffer);
 }catch(e){next(e);}
});
