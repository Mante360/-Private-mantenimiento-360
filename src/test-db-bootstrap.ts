import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pool } from './db.js';

// Never initialize another database: this opt-in is exclusively for the
// disposable Render test database. No DROP/TRUNCATE or browser-data import.
const EXPECTED_DB = 'mantenimiento_360_db_pruebas_20261012';
const FLAG = 'INSTALL_TEST_SCHEMA_20261012';

export async function bootstrapTestSchemaIfRequested(): Promise<void> {
  const mode = process.env.TEST_SCHEMA_SETUP;
  if (mode === undefined || mode === '' || mode === 'off') return;
  if (mode !== FLAG) throw new Error('Refusing unknown test schema setup mode');

  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1::bigint)', [36020261012]);
    const identity = await client.query('SELECT current_database() AS name');
    if (identity.rows[0]?.name !== EXPECTED_DB) {
      throw new Error('Refusing schema installation on any non-test database');
    }

    const existing = await client.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema='public' AND table_type='BASE TABLE'`
    );
    if (existing.rows.length === 0) {
      const sql = readFileSync(join(process.cwd(), 'database', '001_new_install.sql'), 'utf8');
      await client.query(sql);
      console.log('Test-only PostgreSQL schema installed');
    } else if ([21,22].includes(existing.rows.length)) {
      // A previously completed installation may be reused. Do not touch rows.
      console.log('Test-only PostgreSQL schema already present');
    } else {
      throw new Error('Refusing installation: unexpected nonempty/partial schema');
    }

    const schema = await client.query(
      `SELECT count(*)::integer AS total FROM information_schema.tables
       WHERE table_schema='public' AND table_type='BASE TABLE'`
    );
    const warranty = await client.query(
      `SELECT count(*)::integer AS total FROM information_schema.views
       WHERE table_schema='public' AND table_name='warranty_display_codes'`
    );
    const essentials = await client.query(
      `SELECT count(*)::integer AS total
       FROM information_schema.tables WHERE table_schema='public'
         AND table_name=ANY($1::text[])`,
      [[
        'users','jobs','professional_profiles','job_quotes','job_contracts',
        'claims','warranty_visits','ratings','audit_events','legacy_imports'
      ]]
    );
    if (![21,22].includes(schema.rows[0]?.total) ||
        warranty.rows[0]?.total !== 1 ||
        essentials.rows[0]?.total !== 10) {
      throw new Error('Refusing startup: test schema integrity check failed');
    }
    console.log('Test-only database schema verified: 21 original tables, optional photo table and warranty view');
  } finally {
    await client.query('SELECT pg_advisory_unlock($1::bigint)', [36020261012]).catch(() => undefined);
    client.release();
  }
}
