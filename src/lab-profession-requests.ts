// Laboratory-only request inbox for professions absent from the catalog.
// Requests never grant verification, services, or professional permissions.
import {pool} from './db.js';

export const LAB_PROFESSION_REQUEST_DB='mantenimiento_360_db_pruebas_20261012';

export async function ensureLabProfessionRequestSchema():Promise<void>{
  const db=await pool.connect();
  let active=false;
  try{
    await db.query('BEGIN');active=true;
    const current=await db.query('SELECT current_database() name');
    if(current.rows[0]?.name!==LAB_PROFESSION_REQUEST_DB){
      throw Error('Lab profession requests are disabled outside test database');
    }
    await db.query(`CREATE TABLE IF NOT EXISTS lab_profession_requests(
      id BIGSERIAL PRIMARY KEY,
      professional_id BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      requested_name VARCHAR(100) NOT NULL,
      normalized_name VARCHAR(100) NOT NULL,
      status VARCHAR(16) NOT NULL DEFAULT 'pending'
        CHECK(status IN ('pending','approved','rejected')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      reviewed_by BIGINT REFERENCES users(id) ON DELETE RESTRICT,
      reviewed_at TIMESTAMPTZ,
      specialty_id BIGINT REFERENCES specialties(id) ON DELETE RESTRICT
    )`);
    await db.query(`CREATE UNIQUE INDEX IF NOT EXISTS lab_profession_request_one_pending
      ON lab_profession_requests(professional_id,normalized_name)
      WHERE status='pending'`);
    await db.query(`CREATE INDEX IF NOT EXISTS lab_profession_requests_status_date
      ON lab_profession_requests(status,created_at,id)`);
    await db.query('COMMIT');active=false;
  }catch(error){if(active)await db.query('ROLLBACK').catch(()=>undefined);throw error;}
  finally{db.release();}
}
