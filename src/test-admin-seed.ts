import argon2 from 'argon2';
import { pool } from './db.js';

// Runs only when an operator temporarily provides a strong password via
// Render Environment. Never a public API, never a hardcoded password.
// Existing administrators are unchanged unless the one-time lab-only recovery is requested.
const DB_NAME='mantenimiento_360_db_pruebas_20261012';
const ADMIN_EMAIL='administracion-lab360@test.invalid';

export async function seedLabAdminIfRequested(): Promise<void> {
  const secret=process.env.LAB_ADMIN_SETUP_PASSWORD;
  const resetPassword=process.env.LAB_ADMIN_RESET_PASSWORD;
  if(!secret && !resetPassword)return;
  if(secret && secret.length<20)throw new Error('Refusing weak lab administrator seed credential');
  if(resetPassword && resetPassword.length<20)throw new Error('Refusing weak lab administrator recovery credential');

  const db=await pool.connect();
  try {
    await db.query('SELECT pg_advisory_lock($1::bigint)',[36020261013]);
    const name=await db.query('SELECT current_database() AS name');
    if(name.rows[0]?.name!==DB_NAME) {
      throw new Error('Refusing administrator seed outside lab database');
    }
    const already=await db.query(
      "SELECT id,role,status FROM users WHERE email=$1",[ADMIN_EMAIL]
    );
    if(already.rows[0]){
      if(already.rows[0].role!=='admin'||already.rows[0].status!=='active') {
        throw new Error('Lab admin email is not an active administrator');
      }
      if (!resetPassword) {
        console.log('Lab administrator exists; not changing password');
        return;
      }
      // One-time operator recovery; only on the named disposable lab database.
      // The audit record makes repeat startup/deploys idempotent until the
      // temporary Render variable is removed.
      const recoveryAction='lab_admin_password_recovery_20261012';
      await db.query('BEGIN');
      try {
        const previous=await db.query(
          'SELECT id FROM audit_events WHERE action=$1 LIMIT 1',[recoveryAction]
        );
        if(previous.rowCount){
          await db.query('ROLLBACK');
          console.log('Lab administrator recovery already applied; skipping');
          return;
        }
        const passwordHash=await argon2.hash(resetPassword,{type:argon2.argon2id});
        await db.query(
          'UPDATE users SET password_hash=$1,updated_at=now() WHERE id=$2',
          [passwordHash,already.rows[0].id]
        );
        await db.query(
          `INSERT INTO audit_events(actor_id,action,resource_type,resource_id,metadata)
           VALUES($1,$2,'user',$3,$4::jsonb)`,
          [already.rows[0].id,recoveryAction,String(already.rows[0].id),
            JSON.stringify({scope:'test_only',source:'render_startup'})]
        );
        await db.query('COMMIT');
        console.log('Lab administrator password recovered once; remove temporary Render variable');
      } catch(error) {
        await db.query('ROLLBACK').catch(()=>undefined);
        throw error;
      }
      return;
    }
    if(resetPassword) throw new Error('Recovery refused: lab admin account not found');
    if(!secret) return;
    const passwordHash=await argon2.hash(secret,{type:argon2.argon2id});
    await db.query(
      `INSERT INTO users(name,email,password_hash,role,status)
       VALUES('Administración de Pruebas',$1,$2,'admin','active')`,
      [ADMIN_EMAIL,passwordHash]
    );
    console.log('Lab administrator created, no plaintext password logged');
  } finally {
    await db.query('SELECT pg_advisory_unlock($1::bigint)',[36020261013]).catch(()=>undefined);
    db.release();
  }
}
