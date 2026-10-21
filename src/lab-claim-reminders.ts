// MANTENIMIENTO 360 LAB ONLY: persistent internal reminder ledger.
// No WhatsApp/email/push delivery is attempted here. Run as an on-demand
// administrator check or an independent scheduled Node process on any host.
import { pool } from './db.js';
import { getLabClaimReminder } from './lab-claim-deadlines.js';

const LAB_DATABASE='mantenimiento_360_db_pruebas_20261012';
const SCHEMA_LOCK=36020261021;
const RUN_LOCK=36020261022;
const BATCH_SIZE=1000;

export type ReminderRunResult={
  busy:boolean;
  scanned:number;
  recorded:number;
  calendarPending:number;
  executedAt:string;
  delivery:'in_app_ledger_only';
};

// Identity check is deliberately repeated by both the server and the worker.
// Never run this lab-only functionality against the official database.
export async function ensureLabClaimReminderSchema():Promise<void>{
  const client=await pool.connect();
  try{
    const id=await client.query('SELECT current_database() AS name');
    if(id.rows[0]?.name!==LAB_DATABASE)
      throw new Error('Claim reminder ledger restricted to laboratory DB');
    await client.query('SELECT pg_advisory_lock($1::bigint)',[SCHEMA_LOCK]);
    await client.query(`CREATE TABLE IF NOT EXISTS lab_claim_reminder_events(
      id BIGSERIAL PRIMARY KEY,
      claim_id BIGINT NOT NULL REFERENCES claims(id),
      milestone_hours SMALLINT NOT NULL CHECK(milestone_hours IN(4,8,12)),
      scheduled_at TIMESTAMPTZ NOT NULL,
      recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      origin TEXT NOT NULL CHECK(origin IN('manual','scheduled')),
      operator_id BIGINT REFERENCES users(id),
      UNIQUE(claim_id,milestone_hours)
    )`);
    console.log('Lab claim reminder ledger ready (in-app, no external delivery)');
  }finally{
    await client.query('SELECT pg_advisory_unlock($1::bigint)',[SCHEMA_LOCK]).catch(()=>undefined);
    client.release();
  }
}

export async function processLabClaimReminders(
  origin:'manual'|'scheduled',operatorId:string|null=null,
  at=new Date()
):Promise<ReminderRunResult>{
  if(!Number.isFinite(at.getTime()))throw new Error('Invalid reminder processing timestamp');
  const client=await pool.connect();
  let inTransaction=false;
  try{
    await client.query('BEGIN');
    inTransaction=true;
    const identity=await client.query('SELECT current_database() AS name');
    if(identity.rows[0]?.name!==LAB_DATABASE)
      throw new Error('Cannot process reminders outside lab database');
    const lock=await client.query('SELECT pg_try_advisory_xact_lock($1::bigint) AS acquired',[RUN_LOCK]);
    if(lock.rows[0]?.acquired!==true){
      await client.query('ROLLBACK');inTransaction=false;
      return {busy:true,scanned:0,recorded:0,calendarPending:0,executedAt:at.toISOString(),delivery:'in_app_ledger_only'};
    }
    // Row locks serialize this scan with professional submissions and closures.
    // Never count "Tomé conocimiento" as a technical response.
    const pending=await client.query(
      `SELECT c.id,c.created_at
       FROM claims c
       WHERE c.status IN ('open','in_review')
         AND c.created_at < $1::timestamptz - interval '4 hours'
         AND NOT EXISTS(
           SELECT 1 FROM audit_events a
           WHERE a.resource_type='claim' AND a.resource_id=c.id::text
             AND a.action='claim_professional_response'
             AND a.actor_id=c.professional_id
         )
         AND EXISTS(
           SELECT 1 FROM (VALUES (4),(8),(12)) milestone(hours)
           WHERE NOT EXISTS(
             SELECT 1 FROM lab_claim_reminder_events r
             WHERE r.claim_id=c.id AND r.milestone_hours=milestone.hours
           )
         )
       ORDER BY c.created_at ASC,c.id ASC
       LIMIT ${BATCH_SIZE}
       FOR UPDATE OF c SKIP LOCKED`,
      [at]
    );
    let recorded=0,calendarPending=0;
    for(const claim of pending.rows){
      const window=getLabClaimReminder(claim.created_at,null,at);
      if(window.state==='calendar_pending'){
        calendarPending++;continue;
      }
      for(const [hours,time] of [
        [4,window.firstReminderAt],[8,window.secondReminderAt],[12,window.dueAt]
      ] as const){
        if(!time||new Date(time).getTime()>at.getTime())continue;
        const inserted=await client.query(
          `INSERT INTO lab_claim_reminder_events
           (claim_id,milestone_hours,scheduled_at,origin,operator_id)
           VALUES($1,$2,$3,$4,$5)
           ON CONFLICT(claim_id,milestone_hours) DO NOTHING
           RETURNING id`,
          [claim.id,hours,time,origin,operatorId]
        );
        recorded+=(inserted.rowCount??0);
      }
    }
    await client.query('COMMIT');inTransaction=false;
    return {busy:false,scanned:pending.rows.length,recorded,calendarPending,
      executedAt:at.toISOString(),delivery:'in_app_ledger_only'};
  }catch(error){
    if(inTransaction)await client.query('ROLLBACK').catch(()=>undefined);
    throw error;
  }finally{client.release();}
}
