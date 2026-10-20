import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db.js';
import { requireAuth, requireRole } from '../security.js';

// Etapa 1: control de cierres del laboratorio. No crea cuentas ni ejecuta pagos.
// Solo el rol Administrador puede consultar o validar; el futuro rol
// Subadministrador requerirá permisos específicos, nunca heredará este acceso.
export const claimPerformanceRouter = Router();
claimPerformanceRouter.use(requireAuth, requireRole('admin'));

const monthInput=z.object({
  month:z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  page:z.coerce.number().int().min(1).max(100000).default(1)
}).strict();
const validationInput=z.object({
  complexity:z.enum(['simple','intermediate','complex']),
  rationale:z.string().trim().min(8).max(800)
}).strict();

function monthBounds(month:string):[string,string] {
  const year=Number(month.slice(0,4));
  const m=Number(month.slice(5,7));
  const next=new Date(Date.UTC(year,m,1));
  return [month+'-01',next.toISOString().slice(0,10)];
}

// El autor del cierre surge de claims.resolved_by, NO del usuario que consulta.
// Una validación queda asentada en audit_events, sin liquidación automática.
const sourceSql=`
  FROM claims c
  JOIN jobs j ON j.id=c.job_id
  LEFT JOIN users responsible ON responsible.id=c.resolved_by
  LEFT JOIN LATERAL (
    SELECT a.actor_id,a.created_at,a.metadata->>'complexity' AS complexity
    FROM audit_events a
    WHERE a.action='claim_settlement_validated'
      AND a.resource_type='claim'
      AND a.resource_id=c.id::text
      AND a.created_at>=c.resolved_at
    ORDER BY a.created_at DESC,a.id DESC LIMIT 1
  ) review ON true
  WHERE c.status IN ('resolved','dismissed')
    AND c.resolved_at >= ($1::date AT TIME ZONE 'America/Argentina/Buenos_Aires')
    AND c.resolved_at < ($2::date AT TIME ZONE 'America/Argentina/Buenos_Aires')
`;

claimPerformanceRouter.get('/',async(req,res,next)=>{
  const parsed=monthInput.safeParse(req.query);
  if(!parsed.success || Number(parsed.data.month.slice(0,4))<2026 || Number(parsed.data.month.slice(0,4))>2099){
    res.status(400).json({error:'invalid_filter'});return;
  }
  const {month,page}=parsed.data;
  const [start,end]=monthBounds(month);
  const pageSize=20;
  try{
    const [people,totalResult,claims]=await Promise.all([
      pool.query(
        `SELECT c.resolved_by AS administrator_id,
                COALESCE(responsible.name,'Sin responsable registrado') AS administrator_name,
                count(*)::integer AS closed,
                count(*) FILTER (WHERE review.complexity IS NULL)::integer AS unvalidated,
                count(*) FILTER (WHERE review.complexity IS NOT NULL)::integer AS validated,
                count(*) FILTER (WHERE review.complexity='simple')::integer AS simple,
                count(*) FILTER (WHERE review.complexity='intermediate')::integer AS intermediate,
                count(*) FILTER (WHERE review.complexity='complex')::integer AS complex
         ${sourceSql}
         GROUP BY c.resolved_by,responsible.name
         ORDER BY validated DESC,closed DESC,administrator_name`,
        [start,end]
      ),
      pool.query(`SELECT count(*)::integer AS total ${sourceSql}`,[start,end]),
      pool.query(
        `SELECT c.id,c.status,c.resolved_at,c.resolved_by,
                j.public_code AS job_public_code,
                COALESCE(responsible.name,'Sin responsable registrado') AS administrator_name,
                review.complexity,review.created_at AS validated_at
         ${sourceSql}
         ORDER BY c.resolved_at DESC,c.id DESC
         LIMIT $3 OFFSET $4`,
        [start,end,pageSize,(page-1)*pageSize]
      )
    ]);
    const total=Number(totalResult.rows[0].total);
    res.json({month,people:people.rows,items:claims.rows,total,page,pageSize,hasMore:page*pageSize<total,
      notice:'Solo cierres registrados y revisiones manuales. No hay tarifas, pagos ni subadministradores habilitados.'});
  }catch(error){next(error);}
});

claimPerformanceRouter.post('/:id/validate',async(req,res,next)=>{
  const id=z.coerce.number().int().positive().safeParse(req.params.id);
  const parsed=validationInput.safeParse(req.body);
  if(!id.success||!parsed.success){res.status(400).json({error:'invalid_input'});return;}
  const db=await pool.connect();
  try{
    await db.query('BEGIN');
    // El bloqueo de la fila serializa validaciones concurrentes del mismo reclamo.
    const claim=await db.query(
      'SELECT id,status,resolved_by,resolved_at FROM claims WHERE id=$1 FOR UPDATE',
      [id.data]
    );
    const c=claim.rows[0];
    if(!c || !['resolved','dismissed'].includes(c.status) || !c.resolved_at){
      await db.query('ROLLBACK');
      res.status(409).json({error:'claim_not_resolved'});return;
    }
    const existing=await db.query(
      `SELECT 1 FROM audit_events
       WHERE action='claim_settlement_validated' AND resource_type='claim'
         AND resource_id=$1 AND created_at >= $2 LIMIT 1`,
      [String(id.data),c.resolved_at]
    );
    if(existing.rows.length){
      await db.query('ROLLBACK');
      res.status(409).json({error:'claim_already_validated'});return;
    }
    await db.query(
      `INSERT INTO audit_events(actor_id,action,resource_type,resource_id,metadata)
       VALUES($1,'claim_settlement_validated','claim',$2,$3::jsonb)`,
      [req.authUser!.id,String(id.data),JSON.stringify({
        complexity:parsed.data.complexity,
        rationale:parsed.data.rationale,
        resolvedBy:c.resolved_by===null?null:String(c.resolved_by),
        resolvedAt:c.resolved_at
      })]
    );
    await db.query('COMMIT');
    res.json({claimId:id.data,complexity:parsed.data.complexity,validated:true,paid:false});
  }catch(error){
    await db.query('ROLLBACK').catch(()=>undefined);
    next(error);
  }finally{db.release();}
});
