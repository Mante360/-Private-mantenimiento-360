import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as pause } from 'node:timers/promises';
import pg from 'pg';
import argon2 from 'argon2';

const host = 'http://127.0.0.1:45678';
const connection = new pg.Client({ connectionString: process.env.DATABASE_URL });
const api = spawn(process.execPath, ['dist/server.js'], {
  env: process.env,
  stdio: ['ignore', 'pipe', 'pipe'],
});
let appErrors = '';
api.stderr.on('data', chunk => { appErrors += String(chunk).slice(0, 1000); });
let tests = 0;

async function request(method, path, token = null, body = undefined) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = 'Bearer ' + token;
  const response = await fetch(host + path, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: response.status, data };
}
function expectStatus(result, status, context) {
  assert.equal(result.status, status, context + ': ' + JSON.stringify(result.data));
  tests++;
  return result.data;
}
async function post(path, body, token) {
  return request('POST', path, token, body);
}
async function get(path, token) {
  return request('GET', path, token);
}
async function query(sql, params = []) {
  return (await connection.query(sql, params)).rows;
}

try {
  await connection.connect();
  let ready = false;
  for (let i = 0; i < 60; i++) {
    if (api.exitCode !== null) throw new Error('Server terminated: ' + appErrors);
    try {
      const response = await fetch(host + '/health');
      if (response.ok) { ready = true; break; }
    } catch {}
    await pause(150);
  }
  assert.ok(ready, 'API must listen and connect to the isolated PostgreSQL fixture');

  const labResponse = await fetch(host + '/pruebas');
  assert.equal(labResponse.status, 200, 'El laboratorio debe abrir');
  assert.match(labResponse.headers.get('content-security-policy') || '',
    /connect-src 'self'/, 'El laboratorio solo puede usar su propio backend');
  assert.match(await labResponse.text(), /Crear cuenta ficticia/,
    'El formulario de prueba debe estar disponible');
  tests += 3;
  const scriptResponse = await fetch(host + '/pruebas/ui.js');
  assert.equal(scriptResponse.status, 200, 'Script del formulario disponible');
  assert.match(await scriptResponse.text(), /\/api\/auth\/register/,
    'Formulario registra usando la API real');
  tests += 2;

  expectStatus(await get('/api/jobs'), 401, 'Sin token');
  expectStatus(await get('/api/claims'), 401, 'Reclamos sin token');
  expectStatus(await get('/api/jobs', 'token.alterado.x'), 401, 'Token invalido');

  const password = 'Solo-Pruebas-2026-ABC!'; // No real credential.
  expectStatus(await post('/api/auth/register', {
    name: 'Administrador Falso', email: 'evil@test.invalid', password, role: 'admin',
  }), 400, 'No autogenerar administrador');
  expectStatus(await post('/api/auth/register', {
    name: 'Clave Corta', email: 'short@test.invalid', password: 'short', role: 'client',
  }), 400, 'Clave demasiado corta');

  const userA = expectStatus(await post('/api/auth/register', {
    name: 'Cliente Uno', email: 'uno@test.invalid', password, role: 'client',
  }), 201, 'Crear Cliente Uno');
  const userB = expectStatus(await post('/api/auth/register', {
    name: 'Cliente Dos', email: 'dos@test.invalid', password, role: 'client',
  }), 201, 'Crear Cliente Dos');
  const pro = expectStatus(await post('/api/auth/register', {
    name: 'Profesional Uno', email: 'pro@test.invalid', password, role: 'professional',
  }), 201, 'Crear profesional sin verificar');
  assert.ok(userA.token && userB.token && pro.token);
  tests++;

  const wrongPassword = await post('/api/auth/login', { email: 'uno@test.invalid', password: 'incorrecta' });
  expectStatus(wrongPassword, 401, 'Clave incorrecta');
  expectStatus(await post('/api/auth/login', { email: 'uno@test.invalid', password }), 200, 'Inicio de sesion');
  const me = expectStatus(await get('/api/auth/me', userA.token), 200, 'Identidad propia');
  assert.equal(me.user.role, 'client');
  tests++;

  const [refrigeration] = await query(
    "INSERT INTO specialties(name) VALUES('Refrigeracion') ON CONFLICT(name) DO UPDATE SET name=EXCLUDED.name RETURNING id");
  const [electricity] = await query(
    "INSERT INTO specialties(name) VALUES('Electricidad') RETURNING id");
  const [repair] = await query(
    "INSERT INTO specialty_services(specialty_id,name) VALUES($1,'Reparacion') ON CONFLICT(specialty_id,name) DO UPDATE SET name=EXCLUDED.name RETURNING id",
    [refrigeration.id]
  );

  expectStatus(await post('/api/jobs', {
    specialtyId: Number(refrigeration.id), serviceId: Number(repair.id),
    description: 'Quiero atribuir a otro usuario', locality: 'San Isidro',
    clientId: userB.user.id,
  }, userA.token), 400, 'Cliente no puede falsificar propietario');

  const jobA = expectStatus(await post('/api/jobs', {
    specialtyId: Number(refrigeration.id), serviceId: Number(repair.id),
    description: 'Reparacion de heladera', locality: 'San Isidro',
  }, userA.token), 201, 'Solicitud del Cliente Uno');
  const jobB = expectStatus(await post('/api/jobs', {
    specialtyId: Number(electricity.id),
    description: 'Sin luz en el tablero', locality: 'Olivos',
  }, userB.token), 201, 'Solicitud del Cliente Dos');

  const listA = expectStatus(await get('/api/jobs', userA.token), 200, 'Lista privada de A');
  const listB = expectStatus(await get('/api/jobs', userB.token), 200, 'Lista privada de B');
  assert.ok(listA.some(x => String(x.id) === String(jobA.id)));
  assert.ok(listB.some(x => String(x.id) === String(jobB.id)));
  assert.ok(!listA.some(x => String(x.id) === String(jobB.id)));
  assert.ok(!listB.some(x => String(x.id) === String(jobA.id)));
  tests++;
  expectStatus(await get('/api/jobs/' + jobA.id, userB.token), 404, 'B no abre A');
  expectStatus(await get('/api/jobs/' + jobB.id, userA.token), 404, 'A no abre B');

  const proUnverified = expectStatus(await get('/api/jobs', pro.token), 200, 'Pro no verificado');
  assert.deepEqual(proUnverified, []);
  tests++;
  expectStatus(await post('/api/jobs', {
    specialtyId: Number(refrigeration.id),
    description: 'No autorizado', locality: 'Olivos',
  }, pro.token), 403, 'Pro no puede crear trabajo como cliente');
  expectStatus(await get('/api/jobs/' + jobA.id, pro.token), 404, 'Pro no ve privado sin contrato');

  await query("UPDATE professional_profiles SET verification_status='approved',available=true WHERE user_id=$1",
    [pro.user.id]);
  await query("INSERT INTO professional_specialties(professional_id,specialty_id) VALUES($1,$2)",
    [pro.user.id,refrigeration.id]);
  await query("INSERT INTO professional_services(professional_id,specialty_id,service_id) VALUES($1,$2,$3)",
    [pro.user.id,refrigeration.id,repair.id]);
  const proFeed = expectStatus(await get('/api/jobs', pro.token), 200, 'Solicitudes por especialidad');
  assert.ok(proFeed.some(x => String(x.id) === String(jobA.id)));
  assert.ok(!proFeed.some(x => String(x.id) === String(jobB.id)));
  assert.ok(!proFeed.some(x => 'exact_address' in x || 'client_id' in x));
  tests++;

  const [quote] = await query(
    "INSERT INTO job_quotes(job_id,professional_id,amount,description,warranty_days,status) VALUES($1,$2,85000,'Reparacion con garantia',30,'accepted') RETURNING id",
    [jobA.id,pro.user.id]);
  await query("INSERT INTO job_contracts(job_id,quote_id) VALUES($1,$2)",[jobA.id,quote.id]);
  await query("UPDATE jobs SET status='completed',completed_at=now() WHERE id=$1",[jobA.id]);
  const proJobs = expectStatus(await get('/api/jobs/mine', pro.token), 200, 'Trabajos adjudicados');
  assert.ok(proJobs.some(x => String(x.id) === String(jobA.id)));
  assert.ok(!proJobs.some(x => String(x.id) === String(jobB.id)));
  tests++;
  expectStatus(await get('/api/jobs/' + jobA.id, pro.token), 200, 'Pro contratado ve detalle');

  expectStatus(await post('/api/claims', {
    jobId: Number(jobA.id), reason: 'Reclamo', description: 'No es mi trabajo',
  }, userB.token), 404, 'B no reclama trabajo de A');
  expectStatus(await post('/api/claims', {
    jobId: Number(jobB.id), reason: 'Reclamo', description: 'Todavia no esta terminado',
  }, userB.token), 404, 'No reclamar trabajo sin finalizar');
  const claim = expectStatus(await post('/api/claims', {
    jobId: Number(jobA.id), reason: 'Garantia', description: 'El problema sigue',
  }, userA.token), 201, 'Reclamo valido de A');

  const aClaims = expectStatus(await get('/api/claims', userA.token), 200, 'Reclamos A');
  const bClaims = expectStatus(await get('/api/claims', userB.token), 200, 'Reclamos B');
  const pClaims = expectStatus(await get('/api/claims', pro.token), 200, 'Reclamos P');
  assert.equal(aClaims.length,1);
  assert.equal(bClaims.length,0);
  assert.equal(pClaims.length,1);
  tests++;
  expectStatus(await request('PATCH','/api/claims/' + claim.id + '/resolve',
    pro.token, { resolutionNote: 'Quiero cerrar un reclamo ajeno' }),403,'Pro no resuelve reclamos');
  expectStatus(await request('PATCH','/api/claims/' + claim.id + '/resolve',
    userA.token, { resolutionNote: 'Quiero cerrarlo yo' }),403,'Cliente no resuelve reclamos');

  const adminPasswordHash = await argon2.hash(password, { type: argon2.argon2id });
  await query("INSERT INTO users(name,email,password_hash,role) VALUES('Administrador Prueba','admin@test.invalid',$1,'admin')",
    [adminPasswordHash]);
  const admin = expectStatus(await post('/api/auth/login', {
    email:'admin@test.invalid', password,
  }),200,'Acceso de admin preparado por sistema');
  expectStatus(await request('PATCH','/api/claims/' + claim.id + '/resolve',admin.token,
    { resolutionNote:'Se coordino visita correctiva.' }),200,'Admin resuelve y documenta');
  expectStatus(await request('PATCH','/api/claims/' + claim.id + '/resolve',admin.token,
    { resolutionNote:'Intento repetido' }),409,'No resolver dos veces');
  const audit = await query("SELECT count(*)::integer AS total FROM audit_events WHERE action='claim_resolved'");
  assert.equal(audit[0].total,1,'Auditoria de resolucion');
  tests++;

  // A claim with a zero-day warranty may be filed and resolved, but no
  // contractual warranty visit should be authorized by the API.
  const zeroJob = expectStatus(await post('/api/jobs', {
    specialtyId: Number(refrigeration.id), serviceId: Number(repair.id),
    description: 'Reparacion sin garantia', locality: 'Olivos',
  }, userB.token), 201, 'Crear solicitud sin garantia');
  const [zeroQuote] = await query(
    "INSERT INTO job_quotes(job_id,professional_id,amount,description,warranty_days,status) VALUES($1,$2,60000,'Sin garantia',0,'accepted') RETURNING id",
    [zeroJob.id,pro.user.id]);
  await query("INSERT INTO job_contracts(job_id,quote_id) VALUES($1,$2)",
    [zeroJob.id,zeroQuote.id]);
  await query("UPDATE jobs SET status='completed',completed_at=now() WHERE id=$1",[zeroJob.id]);
  const zeroClaim = expectStatus(await post('/api/claims', {
    jobId: Number(zeroJob.id), reason: 'Falla posterior',
    description: 'Solicito revision de la falla sin garantia contractual.',
  }, userB.token), 201, 'Reclamar con cero dias');
  expectStatus(await post('/api/claims', {
    jobId: Number(zeroJob.id), reason: 'Reclamo repetido',
    description: 'Segundo reclamo simultaneo sobre el mismo trabajo.',
  }, userB.token), 409, 'Impedir reclamo duplicado mientras hay uno abierto');
  expectStatus(await post('/api/claims/' + zeroClaim.id + '/authorize-warranty', {
    note: 'Intento de autorizar garantia sin dias pactados',
  }, admin.token), 409, 'Bloquear garantia contractual sin plazo');
  const [zeroState] = await query("SELECT status FROM claims WHERE id=$1",[zeroClaim.id]);
  assert.equal(zeroState.status,'open');
  tests++;
  const zeroResolved = expectStatus(await request('PATCH',
    '/api/claims/' + zeroClaim.id + '/resolve', admin.token,
    { resolutionNote:'Se reviso el informe sin autorizar garantia.' }),
    200,'Resolver reclamo sin garantia');
  assert.equal(zeroResolved.status,'resolved');
  const visibleToClient = expectStatus(await get('/api/claims',userB.token),
    200,'Cliente consulta resolucion archivada');
  const zeroArchived = visibleToClient.find(x=>String(x.id)===String(zeroClaim.id));
  assert.equal(zeroArchived?.status,'resolved');
  assert.equal(zeroArchived?.warranty_days,0);
  assert.equal(zeroArchived?.resolution_note,'Se reviso el informe sin autorizar garantia.');
  tests += 4;
  const reopenedClaim = expectStatus(await post('/api/claims', {
    jobId: Number(zeroJob.id), reason: 'Incidencia diferente',
    description: 'Se presenta un nuevo problema tras resolver el reclamo anterior.',
  }, userB.token), 201, 'Nuevo reclamo permitido tras resolucion');
  assert.ok(Number(reopenedClaim.id) > Number(zeroClaim.id));
  expectStatus(await request('PATCH','/api/claims/' + reopenedClaim.id + '/resolve',
    admin.token,{resolutionNote:'Cierre de segundo reclamo de prueba.'}),200,
    'Segundo reclamo archivado de forma independiente');
  tests++;

  // La autorización real no depende del rol mostrado en la interfaz:
  // estos endpoints comprueban el rol ADMIN en cada llamada.
  expectStatus(await get('/api/admin/professionals'),401,
    'Sin sesión no consulta aspirantes');
  expectStatus(await get('/api/admin/professionals',userA.token),403,
    'Cliente no consulta profesionales por Administración');
  expectStatus(await get('/api/admin/professionals',pro.token),403,
    'Profesional no consulta aspirantes');
  expectStatus(await post('/api/admin/specialties',{
    name:'Refrigeración',services:['Reparación']
  },userA.token),403,'Cliente no crea categoría desde Administración');

  const pendingLab = expectStatus(await post('/api/auth/register',{
    name:'Profesional ID Lab',email:'admin-pending@test.invalid',
    password,role:'professional'
  }),201,'Crear aspirante pendiente para prueba');
  const pendingLabId=Number(pendingLab.user.id);
  expectStatus(await post('/api/admin/professionals/'+pendingLabId+'/approve',{
    specialtyId:Number(refrigeration.id)
  },pendingLab.token),403,'Profesional no puede aprobarse a sí mismo');
  expectStatus(await post('/api/admin/professionals/'+pendingLabId+'/approve',{
    specialtyId:Number(refrigeration.id)
  },userA.token),403,'Cliente no puede aprobar al profesional');

  const cat=expectStatus(await post('/api/admin/specialties',{
    name:'Refrigeración',services:['Reparación','Mantenimiento preventivo']
  },admin.token),201,'Administración crea el rubro y servicios del laboratorio');
  const categories=expectStatus(await get('/api/admin/specialties',admin.token),200,
    'Administrador consulta especialidades');
  assert.ok(categories.some(s=>s.name==='Refrigeración' && s.services.length===2));
  tests++;
  const pendingList=expectStatus(await get('/api/admin/professionals',admin.token),200,
    'Administrador consulta los aspirantes');
  assert.ok(pendingList.some(p=>String(p.id)===String(pendingLabId) && p.verification_status==='pending'));
  tests++;
  expectStatus(await post('/api/admin/professionals/'+pendingLabId+'/approve',{
    specialtyId:999999999
  },admin.token),400,'Categoría inexistente no permite aprobar');
  expectStatus(await post('/api/admin/professionals/'+pendingLabId+'/approve',{
    specialtyId:Number(cat.id)
  },admin.token),200,'Administrador aprueba aspirante');
  expectStatus(await post('/api/admin/professionals/'+pendingLabId+'/approve',{
    specialtyId:Number(cat.id)
  },admin.token),409,'Aprobación duplicada rechazada');

  const profAfter=await query(
    'SELECT verification_status,available FROM professional_profiles WHERE user_id=$1',
    [pendingLabId]);
  assert.equal(profAfter[0].verification_status,'approved');
  assert.equal(profAfter[0].available,true);
  tests+=2;
  const servicesAfter=await query(
    'SELECT service_id FROM professional_services WHERE professional_id=$1',
    [pendingLabId]);
  assert.ok(servicesAfter.length>=2,'Servicios dados de alta para aprobado');
  tests++;
  const auditing=await query(
    "SELECT count(*)::integer AS total FROM audit_events WHERE action='lab_professional_approved' AND resource_id=$1",
    [String(pendingLabId)]);
  assert.equal(auditing[0].total,1);
  tests++;
  const testJob=expectStatus(await post('/api/jobs',{
    specialtyId:Number(cat.id),description:'Revisión de refrigeración de prueba',
    locality:'Beccar'
  },userB.token),201,'Cliente crea solicitud del rubro aprobado');
  const approvedFeed=expectStatus(await get('/api/jobs',pendingLab.token),200,
    'Profesional aprobado consulta sus solicitudes');
  assert.ok(approvedFeed.some(j=>String(j.id)===String(testJob.id)));
  tests++;

  await query("UPDATE users SET status='suspended' WHERE id=$1",[pro.user.id]);
  expectStatus(await get('/api/jobs',pro.token),403,'Usuario suspendido no tiene acceso');

  console.log('OK: ' + tests + ' validaciones de cuentas separadas, permisos, rubros, datos privados y reclamos');
} finally {
  api.kill('SIGTERM');
  await connection.end().catch(() => {});
}
