// Executable for a Render Cron Job or an AWS schedule, LAB only.
// Start with: node dist/lab-claim-reminder-worker.js
// Requires DATABASE_URL; does NOT start the HTTP application.
import 'dotenv/config';
import { pool } from './db.js';
import { ensureLabClaimReminderSchema,processLabClaimReminders } from './lab-claim-reminders.js';

try{
  await ensureLabClaimReminderSchema();
  const result=await processLabClaimReminders('scheduled');
  console.log('Laboratory internal reminders processed:',JSON.stringify(result));
}catch(error){
  console.error('Laboratory reminder worker failed',error instanceof Error?error.message:'unknown');
  process.exitCode=1;
}finally{
  await pool.end();
}
