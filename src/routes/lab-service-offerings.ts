import {Router} from 'express';
import {z} from 'zod';
import {pool} from '../db.js';
import {requireAuth,requireRole} from '../security.js';
import {LAB_SERVICE_DB} from '../lab-service-offerings.js';

export const labServicesRouter=Router();

const selectedSchema=z.object({serviceIds:z.array(z.number().int().positive()).max(60)}).strict();
const decisionSchema=z.object({decision:z.enum(['approved','rejected'])}).strict();

const catalogSql=`SELECT ss.id::text AS service_id,ss.specialty_id::text AS specialty_id,
     ss.name AS service_name,COALESCE(c.title,s.name) AS profession_name,
     COALESCE(c.profession_key,'') AS profession_key,
     COALESCE(k.keywords,ARRAY[]::text[]) AS keywords,
     (SELECT count(*)::integer FROM lab_service_declarations d
        JOIN professional_profiles pp ON pp.user_id=d.professional_id
        JOIN users u ON u.id=d.professional_id
        WHERE d.service_id=ss.id AND d.status='approved'
          AND pp.verification_status='approved' AND pp.available=true
          AND u.status='active') AS approved_professional_count
   FROM specialty_services ss
   JOIN specialties s ON s.id=ss.specialty_id AND s.active=true
   LEFT JOIN lab_profession_catalog c ON c.specialty_id=s.id
   LEFT JOIN lab_service_keywords k ON k.service_id=ss.id
   WHERE ss.active=true ORDER BY COALESCE(c.title,s.name),ss.name,ss.id LIMIT 500`;

labServicesRouter.get('/catalog',async(_req,res,next)=>{
 try{const data=await pool.query(catalogSql);
   res.json({items:data.rows,notice:'Solo se cuentan profesionales aprobados que declararon expresamente este servicio y fueron autorizados por Administración. No acredita matrículas.'});
 }catch(error){next(error);}
});

labServicesRouter.use(requireAuth);
labServicesRouter.get('/mine',requireRole('professional'),async(req,res,next)=>{
 try{
   const data=await pool.query(`SELECT d.id::text,d.service_id::text,d.status,d.requested_at,d.reviewed_at,
     ss.name AS service_name,s.name AS specialty_name
     FROM lab_service_declarations d
     JOIN specialty_services ss ON ss.id=d.service_id JOIN specialties s ON s.id=ss.specialty_id
     WHERE d.professional_id=$1 ORDER BY s.name,ss.name`,[req.authUser!.id]);
   res.json({items:data.rows});
 }catch(error){next(error);}
});

labServicesRouter.post('/mine',requireRole('professional'),async(req,res,next)=>{
 const parsed=selectedSchema.safeParse(req.body);
 if(!parsed.success||new Set(parsed.data.serviceIds).size!==parsed.data.serviceIds.length){
   res.status(400).json({error:'invalid_input'});return;
 }
 const db=await pool.connect().catch(next);if(!db)return;
 let started=false;
 try{
  await db.query('BEGIN');started=true;
  const dbname=await db.query('SELECT current_database() name');
  if(dbname.rows[0]?.name!==LAB_SERVICE_DB){res.status(403).json({error:'test_database_only'});await db.query('ROLLBACK');started=false;return;}
  const profile=await db.query('SELECT user_id FROM professional_profiles WHERE user_id=$1 FOR UPDATE',[req.authUser!.id]);
  if(!profile.rows.length){res.status(403).json({error:'professional_profile_required'});await db.query('ROLLBACK');started=false;return;}
  const ids=parsed.data.serviceIds;
  const exists=await db.query(`SELECT id FROM specialty_services WHERE active=true AND id=ANY($1::bigint[])`,[ids]);
  if(exists.rows.length!==ids.length){res.status(400).json({error:'invalid_service'});await db.query('ROLLBACK');started=false;return;}
  const removed=await db.query(`DELETE FROM lab_service_declarations
    WHERE professional_id=$1 AND NOT (service_id=ANY($2::bigint[]))
    RETURNING service_id`,[req.authUser!.id,ids]);
  for(const row of removed.rows){
    // Withdrawal immediately removes routing eligibility; existing jobs are retained.
    await db.query('DELETE FROM professional_services WHERE professional_id=$1 AND service_id=$2',
      [req.authUser!.id,row.service_id]);
  }
  for(const id of ids){
    await db.query(`INSERT INTO lab_service_declarations(professional_id,service_id,status)
      VALUES($1,$2,'pending') ON CONFLICT(professional_id,service_id)
      DO UPDATE SET status='pending',requested_at=now(),reviewed_by=NULL,reviewed_at=NULL
      WHERE lab_service_declarations.status='rejected'`,
      [req.authUser!.id,id]);
  }
  const statuses=await db.query('SELECT status,count(*)::integer n FROM lab_service_declarations WHERE professional_id=$1 GROUP BY status',[req.authUser!.id]);
  await db.query(`INSERT INTO audit_events(actor_id,action,resource_type,resource_id,metadata)
    VALUES($1,'lab_professional_services_updated','professional',$2,$3::jsonb)`,
    [req.authUser!.id,req.authUser!.id,JSON.stringify({serviceIds:ids,withdrawn:removed.rows.map(r=>Number(r.service_id)),scope:'lab'})]);
  await db.query('COMMIT');started=false;
  res.json({ok:true,statuses:statuses.rows,notice:'Las nuevas declaraciones quedan pendientes de aprobación; retirar servicios deja de ofrecerlos.'});
 }catch(error){if(started)await db.query('ROLLBACK').catch(()=>undefined);next(error);}
 finally{db.release();}
});

labServicesRouter.get('/pending',requireRole('admin'),async(_req,res,next)=>{
 try{
  const items=await pool.query(`SELECT d.id::text,d.professional_id::text,d.service_id::text,d.requested_at,
     u.name AS professional_name,pp.verification_status,
     ss.name AS service_name,COALESCE(c.title,s.name) AS profession_name,
     c.credential_note
    FROM lab_service_declarations d
    JOIN users u ON u.id=d.professional_id JOIN professional_profiles pp ON pp.user_id=u.id
    JOIN specialty_services ss ON ss.id=d.service_id JOIN specialties s ON s.id=ss.specialty_id
    LEFT JOIN lab_profession_catalog c ON c.specialty_id=s.id
    WHERE d.status='pending' ORDER BY d.requested_at,d.id LIMIT 100`);
  res.json({items:items.rows,notice:'Revisión ficticia del laboratorio. No verifica DNI, certificados o matrícula.'});
 }catch(error){next(error);}
});

labServicesRouter.post('/pending/:id/decision',requireRole('admin'),async(req,res,next)=>{
 const id=z.coerce.number().int().positive().safeParse(req.params.id);
 const input=decisionSchema.safeParse(req.body);
 if(!id.success||!input.success){res.status(400).json({error:'invalid_input'});return;}
 const db=await pool.connect().catch(next);if(!db)return;
 let started=false;
 try{
  await db.query('BEGIN');started=true;
  const identity=await db.query('SELECT current_database() name');
  if(identity.rows[0]?.name!==LAB_SERVICE_DB){res.status(403).json({error:'test_database_only'});await db.query('ROLLBACK');started=false;return;}
  const item=await db.query(`SELECT d.id,d.professional_id,d.service_id,d.status,
      ss.specialty_id,pp.verification_status,u.status AS user_status
    FROM lab_service_declarations d
    JOIN specialty_services ss ON ss.id=d.service_id
    JOIN professional_profiles pp ON pp.user_id=d.professional_id
    JOIN users u ON u.id=d.professional_id
    WHERE d.id=$1 FOR UPDATE OF d`,[id.data]);
  if(!item.rows.length){res.status(404).json({error:'service_declaration_not_found'});await db.query('ROLLBACK');started=false;return;}
  const d=item.rows[0];
  if(d.status!=='pending'||d.user_status!=='active'){res.status(409).json({error:'service_declaration_not_pending'});await db.query('ROLLBACK');started=false;return;}
  await db.query(`UPDATE lab_service_declarations SET status=$1,reviewed_by=$2,reviewed_at=now() WHERE id=$3`,
    [input.data.decision,req.authUser!.id,d.id]);
  if(input.data.decision==='approved'&&d.verification_status==='approved'){
    await db.query(`INSERT INTO professional_specialties(professional_id,specialty_id) VALUES($1,$2) ON CONFLICT DO NOTHING`,
      [d.professional_id,d.specialty_id]);
    await db.query(`INSERT INTO professional_services(professional_id,specialty_id,service_id) VALUES($1,$2,$3)
      ON CONFLICT DO NOTHING`,[d.professional_id,d.specialty_id,d.service_id]);
  }
  await db.query(`INSERT INTO audit_events(actor_id,action,resource_type,resource_id,metadata)
    VALUES($1,'lab_service_declaration_reviewed','professional',$2,$3::jsonb)`,
    [req.authUser!.id,String(d.professional_id),JSON.stringify({serviceId:Number(d.service_id),decision:input.data.decision,scope:'lab'})]);
  await db.query('COMMIT');started=false;
  res.json({ok:true,decision:input.data.decision,professionalVerified:d.verification_status==='approved'});
 }catch(error){if(started)await db.query('ROLLBACK').catch(()=>undefined);next(error);}
 finally{db.release();}
});
