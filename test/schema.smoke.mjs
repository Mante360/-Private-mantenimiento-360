import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import pg from 'pg';

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

const run = async (sql, args = []) => (await client.query(sql, args)).rows;
try {
  await client.query(readFileSync('database/001_new_install.sql', 'utf8'));

  const [{ total }] = await run(
    "SELECT count(*)::integer AS total FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'"
  );
  assert.equal(total, 21, 'Se esperan exactamente 21 tablas');

  const [{ total: views }] = await run(
    "SELECT count(*)::integer AS total FROM information_schema.views WHERE table_schema='public' AND table_name='warranty_display_codes'"
  );
  assert.equal(views, 1, 'Vista de codigos de garantia');

  const [{ total: indices }] = await run(
    `SELECT count(*)::integer AS total FROM pg_indexes WHERE schemaname='public'
      AND indexname IN ('only_one_accepted_quote_idx','ratings_original_unique',
                        'ratings_warranty_unique','professional_restriction_active')`
  );
  assert.equal(indices, 4, 'Indices unicos importantes');

  const [a] = await run(
    "INSERT INTO users(name,email,password_hash,role) VALUES('Cliente A','a@test.invalid','fixture-only','client') RETURNING id"
  );
  const [p] = await run(
    "INSERT INTO users(name,email,password_hash,role) VALUES('Profesional P','p@test.invalid','fixture-only','professional') RETURNING id"
  );
  await run("INSERT INTO professional_profiles(user_id) VALUES($1)", [p.id]);
  const [s] = await run("INSERT INTO specialties(name) VALUES('Refrigeracion') RETURNING id");
  const [sv] = await run("INSERT INTO specialty_services(specialty_id,name) VALUES($1,'Reparacion') RETURNING id", [s.id]);
  await run("INSERT INTO professional_specialties(professional_id,specialty_id) VALUES($1,$2)", [p.id, s.id]);
  await run("INSERT INTO professional_services(professional_id,specialty_id,service_id) VALUES($1,$2,$3)", [p.id,s.id,sv.id]);
  const [j] = await run(
    "INSERT INTO jobs(client_id,specialty_id,service_id,description,locality) VALUES($1,$2,$3,'Falta frio en heladera','San Isidro') RETURNING id,public_code",
    [a.id,s.id,sv.id]
  );
  assert.match(j.public_code, /^360-\d{5,}$/);
  const [quote] = await run(
    "INSERT INTO job_quotes(job_id,professional_id,amount,description,warranty_days) VALUES($1,$2,85000,'Reparacion y prueba',30) RETURNING id",
    [j.id,p.id]
  );
  await run("INSERT INTO job_contracts(job_id,quote_id) VALUES($1,$2)", [j.id,quote.id]);
  const [w] = await run(
    "INSERT INTO warranty_visits(original_job_id,suffix,description) VALUES($1,'A','Nueva visita de garantia') RETURNING id",
    [j.id]
  );
  const [code] = await run("SELECT warranty_code FROM warranty_display_codes WHERE warranty_id=$1", [w.id]);
  assert.equal(code.warranty_code, j.public_code + '-A');

  await run("INSERT INTO ratings(job_id,client_id,stars) VALUES($1,$2,4)", [j.id,a.id]);
  await run("INSERT INTO ratings(warranty_visit_id,client_id,stars) VALUES($1,$2,5)", [w.id,a.id]);
  const [ratingCount] = await run("SELECT count(*)::integer AS total FROM ratings");
  assert.equal(ratingCount.total, 2, 'Original y garantia tienen calificaciones independientes');

  const [claim] = await run(
    "INSERT INTO claims(job_id,warranty_visit_id,created_by,professional_id,reason,description) VALUES($1,$2,$3,$4,'Garantia','El equipo vuelve a fallar') RETURNING id",
    [j.id,w.id,a.id,p.id]
  );
  assert.ok(claim.id);

  // A duplicate winner must fail at the database level, not merely in UI logic.
  let duplicateQuoteFailed = false;
  try {
    await run(
      "INSERT INTO job_quotes(job_id,professional_id,amount,description) VALUES($1,$2,90000,'Otra oferta duplicada')",
      [j.id,p.id]
    );
  } catch (err) {
    duplicateQuoteFailed = err.code === '23505';
  }
  assert.ok(duplicateQuoteFailed, 'Una oferta por profesional y trabajo');

  console.log('OK: 21 tablas, 1 vista, 4 indices, trabajos, ofertas, garantias, evaluaciones, reclamos y unicidad');
} finally {
  await client.end();
}
