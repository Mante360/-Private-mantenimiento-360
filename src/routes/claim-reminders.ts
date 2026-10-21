import { Router } from 'express';
import { pool } from '../db.js';
import { requireAuth,requireRole } from '../security.js';
import { processLabClaimReminders } from '../lab-claim-reminders.js';

// LAB ONLY; administrator can inspect durable milestones or run a manual check.
// This endpoint never sends WhatsApp/email, and never modifies claim status.
export const claimRemindersRouter=Router();
claimRemindersRouter.use(requireAuth,requireRole('admin'));

claimRemindersRouter.get('/',async(_req,res,next)=>{
  try{
    const items=await pool.query(
      `SELECT r.id,r.claim_id,r.milestone_hours,r.scheduled_at,
              r.recorded_at,r.origin,j.public_code AS job_public_code,
              pro.name AS professional_name
       FROM lab_claim_reminder_events r
       JOIN claims c ON c.id=r.claim_id
       JOIN jobs j ON j.id=c.job_id
       LEFT JOIN users pro ON pro.id=c.professional_id
       ORDER BY r.recorded_at DESC,r.id DESC LIMIT 60`
    );
    const totals=await pool.query(
      `SELECT count(*)::integer AS recorded,
              count(*) FILTER(WHERE milestone_hours=12)::integer AS overdue
       FROM lab_claim_reminder_events`
    );
    res.json({items:items.rows,totals:totals.rows[0],
      notice:'Historial interno: no confirma entrega por WhatsApp, email ni lectura por el profesional.'});
  }catch(error){next(error);}
});

claimRemindersRouter.post('/run',async(req,res,next)=>{
  try{
    const result=await processLabClaimReminders('manual',req.authUser!.id);
    res.json(result);
  }catch(error){next(error);}
});
