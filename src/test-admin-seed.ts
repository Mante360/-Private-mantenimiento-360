import argon2 from 'argon2';
import { pool } from './db.js';

// Runs only when an operator temporarily provides a strong password via
// Render Environment. Never a public API, never a hardcoded password.
// An existing administrator is never reset or replaced.
const DB_NAME='mantenimiento_360_db_pruebas_20261012';
const ADMIN_EMAIL='administracion-lab360@test.invalid';

export async function seedLabAdminIfRequested(): Promise<void> {
  const secret=process.env.LAB_ADMIN_SETUP_PASSWORD;
  if(!secret)return;
  if(secret.length<20)throw new Error('Refusing weak lab administrator seed credential');

  const db=await pool.connect();
  try {
    await db.query('SELECT pg_advisory_lock($1::bigint)',[36020261013]);
    const name=await db.query('SELECT current_database() AS name');
    if(name.rows[0]?.name!==DB_NAME) {
      throw new Error('Refusing administrator seed outside lab database');
    }
    const already=await db.query(
      "SELECT id,role FROM users WHERE email=$1",[ADMIN_EMAIL]
    );
    if(already.rows[0]){
      if(already.rows[0].role!=='admin') {
        throw new Error('Lab admin email already assigned to another role');
      }
      console.log('Lab administrator exists; not changing password');
      return;
    }
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
