// Full laboratory complaint + warranty lifecycle through the real HTTP API.
// Isolated GitHub Actions PostgreSQL only. No live users, purchases or messages.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {setTimeout as pause} from 'node:timers/promises';
import pg from 'pg';

const fixtureUrl=process.env.DATABASE_URL||'';
assert.equal(process.env.CI,'true','Only run this test on ephemeral GitHub CI');
assert.match(fixtureUrl,/\/mantenimiento_360_db_pruebas_20261012(?:\?|$)/,
  'Refuse any database except disposable CI laboratory');
const root='http://127.0.0.1:45678';
const pass='Claim-CI-Only-2026!';
const adminPass='Admin-Only-Test-2026-Password!';
const db=new pg.Client({connectionString:fixtureUrl});
const app=spawn(process.execPath,['dist/server.js'],{env:process.env,stdio:['ignore','pipe','pipe']});
let stderr='',checks=0;
app.stderr.on('data',chunk=>stderr+=String(chunk).slice(0,1400));
async function call(method,path,token=null,body){
  const r=await fetch(root+path,{
    method,
    headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},
    ...(body===undefined?{}:{body:JSON.stringify(body)})
  });
  const raw=await r.text();
  let data;try{data=raw?JSON.parse(raw):null;}catch{data=raw;}
  return {status:r.status,data};
}
function expect(result,status,label){
  assert.equal(result.status,status,label+': '+JSON.stringify(result.data));
  checks++;return result.data;
}
const post=(p,t,b)=>call('POST',p,t,b);
const get=(p,t)=>call('GET',p,t);
const patch=(p,t,b)=>call('PATCH',p,t,b);
const register=async(name,email,role)=>
  expect(await post('/api/auth/register',null,{name,email,password:pass,role}),201,'Create '+role);
const query=async(sql,args=[])=> (await db.query(sql,args)).rows;
const quote=(days)=>({amount:85000,description:'Reparacion simulada y visita tecnica',warrantyDays:days});
const claimBody=(job)=>({jobId:Number(job.id),reason:'Falla posterior',description:'El problema aparece de nuevo despues de la reparacion.'});
try {
  await db.connect();
  assert.equal((await query('SELECT current_database() name'))[0].name,
    'mantenimiento_360_db_pruebas_20261012');checks++;
  let ready=false;
  for(let i=0;i<110;i++){
    if(app.exitCode!==null)throw Error('API stopped: '+stderr);
    try{if((await fetch(root+'/health')).ok){ready=true;break;}}catch{}
    await pause(125);
  }
  assert.ok(ready,'Temporary claims API must start');checks++;
  const admin=expect(await post('/api/auth/login',null,{
    email:'administracion-lab360@test.invalid',password:adminPass
  }),200,'Admin login');

  const client=await register('Cliente Reclamo Automatico','claims-client-ci@test.invalid','client');
  const stranger=await register('Cliente Ajeno Automatico','claims-outsider-ci@test.invalid','client');
  const pro=await register('Profesional Reclamos Automatico','claims-pro-ci@test.invalid','professional');
  const otherPro=await register('Profesional Ajeno Automatico','claims-pro-other-ci@test.invalid','professional');
  const pending=await register('Profesional Pendiente Reclamos','claims-pro-pending-ci@test.invalid','professional');
  const staff=expect(await post('/api/lab-documents/staff',admin.token,{
    name:'Revisor Documental Reclamos CI',
    email:'claims-revisor-ci@test.invalid',password:pass
  }),201,'Admin creates documentary reviewer without claim permissions');
  assert.equal(staff.permission,'document_review');checks++;
  const reviewer=expect(await post('/api/auth/login',null,{
    email:'claims-revisor-ci@test.invalid',password:pass
  }),200,'Documentary reviewer login');

  const [trade]=await query(
    "INSERT INTO specialties(name) VALUES('Reparacion Reclamos CI') RETURNING id");
  const [service]=await query(
    "INSERT INTO specialty_services(specialty_id,name) VALUES($1,'Servicio Reclamos CI') RETURNING id",
    [trade.id]);
  await query("UPDATE professional_profiles SET verification_status='approved',available=true WHERE user_id=$1",
    [pro.user.id]);
  await query('INSERT INTO professional_specialties(professional_id,specialty_id) VALUES($1,$2)',
    [pro.user.id,trade.id]);
  await query('INSERT INTO professional_services(professional_id,specialty_id,service_id) VALUES($1,$2,$3)',
    [pro.user.id,trade.id,service.id]);
  await query("INSERT INTO lab_service_declarations(professional_id,service_id,status) VALUES($1,$2,'approved')",
    [pro.user.id,service.id]);
  // This approved outsider is deliberately not assigned the tested profession.
  await query("UPDATE professional_profiles SET verification_status='approved',available=true WHERE user_id=$1",
    [otherPro.user.id]);
  checks++;
  
  const jobInput={
    specialtyId:Number(trade.id),serviceId:Number(service.id),
    description:'Servicio de prueba con garantia de 30 dias',locality:'San Isidro'
  };
  const job=expect(await post('/api/jobs',client.token,jobInput),201,
    'Client requests a genuine test job');
  const nextJob=expect(await post('/api/jobs',stranger.token,{
    ...jobInput,description:'Otra solicitud antes de presentar el reclamo'
  }),201,'Second eligible test job created before block');
  const pQuote=expect(await post('/api/jobs/'+job.id+'/quotes',pro.token,quote(30)),201,
    'Verified professional submits 30-day quote');
  expect(await post('/api/jobs/'+job.id+'/accept-quote',client.token,{
    quoteId:Number(pQuote.id)
  }),200,'Client accepts quote once');
  expect(await post('/api/jobs/'+job.id+'/start',pro.token),200,
    'Selected professional starts the contracted job');
  expect(await post('/api/jobs/'+job.id+'/report-completed',pro.token),200,
    'Selected professional reports work complete');
  expect(await post('/api/claims',stranger.token,claimBody(job)),404,
    'An unrelated client cannot open complaint for this job');
  expect(await post('/api/claims',pending.token,claimBody(job)),403,
    'Pending professional cannot lodge customer complaints');

  const claim=expect(await post('/api/claims',client.token,claimBody(job)),201,
    'Client opens complaint about own completed job');
  const c='/api/claims/'+claim.id;
  assert.equal(claim.status,'open');checks++;
  expect(await post('/api/claims',client.token,claimBody(job)),409,
    'Duplicate unresolved complaint rejected');
  const outsiderCases=expect(await get('/api/claims',stranger.token),200,'Separate client claims list');
  assert.ok(!outsiderCases.some(c=>String(c.id)===String(claim.id)));checks++;
  const proCases=expect(await get('/api/claims',pro.token),200,'Assigned professional claims list');
  assert.ok(proCases.some(c=>String(c.id)===String(claim.id)));checks++;
  const otherProCases=expect(await get('/api/claims',otherPro.token),200,'Unrelated professional claims list');
  assert.ok(!otherProCases.some(c=>String(c.id)===String(claim.id)));checks++;
  expect(await get('/api/claims',reviewer.token),403,'Document reviewer cannot see claims');
  expect(await get('/api/claims/admin-list',reviewer.token),403,
    'Document reviewer cannot see administrative inbox');
  expect(await get(c+'/updates',otherPro.token),404,
    'Unrelated professional cannot see the case notes');
  expect(await get(c+'/warranty',stranger.token),200,
    'A stranger gets no warranty data (empty list)');
  const noWarranty=expect(await get(c+'/warranty',stranger.token),200,
    'Stranger cannot see someone else warranty');
  assert.deepEqual(noWarranty,[]);checks++;
  expect(await get('/api/jobs',pending.token),403,
    'Pending professional remains blocked from work');
  expect(await post('/api/jobs/'+nextJob.id+'/quotes',pro.token,quote(10)),403,
    'Open complaint blocks all further quoting');
  const blockedFeed=expect(await get('/api/jobs',pro.token),200,
    'Approved professional gets filtered work feed while blocked');
  assert.ok(!blockedFeed.some(j=>String(j.id)===String(nextJob.id)));checks++;
  expect(await post('/api/jobs',stranger.token,jobInput),409,
    'A new chosen-service job cannot be offered while sole eligible professional has active complaint');

  // Two-stage receipt and response. Neither action can decide or close claim.
  const received=expect(await post(c+'/acknowledge',pro.token),200,
    'Professional acknowledges receiving the claim');
  assert.equal(received.alreadyAcknowledged,false);checks++;
  const receivedAgain=expect(await post(c+'/acknowledge',pro.token),200,
    'Repeated acknowledgement idempotent');
  assert.equal(receivedAgain.alreadyAcknowledged,true);checks++;
  expect(await post(c+'/acknowledge',otherPro.token),404,
    'Unrelated professional cannot acknowledge claim');
  expect(await post(c+'/professional-response',stranger.token,{
    description:'Intento de defender un reclamo ajeno'
  }),403,'Client cannot submit a professional defense');
  expect(await post(c+'/professional-response',otherPro.token,{
    description:'Soy otro profesional y no debo intervenir'
  }),404,'Unrelated professional cannot send a defense');
  expect(await post(c+'/professional-response',pro.token,{
    description:'Propuesta ficticia: verificar y corregir la instalacion.'
  }),201,'Assigned professional submits response');
  const responses=expect(await get(c+'/updates',client.token),200,
    'Client reads professional response without losing claim');
  assert.ok(responses.some(x=>x.action==='claim_professional_response'));checks++;
  const reviewNote={note:'Administracion solicita diagnostico ficticio previo a decidir garantia.'};
  expect(await post(c+'/request-technical-review',pro.token,reviewNote),403,
    'Professional cannot request administrative technical review');
  const inReview=expect(await post(c+'/request-technical-review',admin.token,reviewNote),200,
    'Admin records technical review and keeps case open');
  assert.equal(inReview.status,'in_review');checks++;
  expect(await post('/api/jobs/'+nextJob.id+'/quotes',pro.token,quote(10)),403,
    'While in review, professional remains unable to budget');

  expect(await post(c+'/authorize-warranty',reviewer.token,{
    note:'Revisor documental no autoriza garantia'
  }),403,'Document reviewer cannot authorize warranty');
  expect(await post(c+'/authorize-warranty',client.token,{
    note:'Cliente no autoriza por si mismo'
  }),403,'Client cannot authorize warranty visit');
  const visit=expect(await post(c+'/authorize-warranty',admin.token,{
    note:'Corresponde intervencion correctiva bajo garantia pactada.'
  }),201,'General administrator authorizes the covered warranty visit');
  assert.equal(visit.status,'requested');checks++;
  assert.match(visit.code,/-A$/);checks++;
  const visitPath=c+'/warranty/'+visit.id;
  expect(await post(c+'/authorize-warranty',admin.token,{
    note:'Intento duplicado de habilitar una segunda visita'
  }),409,'Cannot create duplicate active warranty visit');
  const clientWarranty=expect(await get(c+'/warranty',client.token),200,
    'Client sees only their linked warranty');
  assert.equal(clientWarranty.length,1);checks++;
  assert.equal(String(clientWarranty[0].id),String(visit.id));checks++;
  expect(await post(visitPath+'/client-confirm',stranger.token,{confirmed:true}),409,
    'Unrelated client cannot confirm warranty correction');
  expect(await post(visitPath+'/client-confirm',client.token,{confirmed:true}),409,
    'Client cannot confirm work before professional reports completion');
  expect(await post(visitPath+'/rating',client.token,{
    stars:5,comment:'Intento de calificar antes de recibir trabajo'
  }),409,'Rating requires completed and client-confirmed corrective work');
  expect(await post(visitPath+'/report-completed',otherPro.token,{
    note:'Profesional ajeno intenta concluir garantia'
  }),409,'Only assigned professional may finish warranty');
  expect(await post(visitPath+'/report-completed',pro.token,{
    note:'Correccion simulada realizada dentro de la garantia.'
  }),200,'Assigned professional records corrective work completed');
  expect(await post(visitPath+'/report-completed',pro.token,{
    note:'No duplicar finalizacion de garantia'
  }),409,'Warranty completion is not repeatable');
  const clientConfirmation=expect(await post(visitPath+'/client-confirm',client.token,{
    confirmed:true
  }),200,'Client confirms corrective work finished');
  assert.equal(clientConfirmation.alreadyConfirmed,false);checks++;
  const again=expect(await post(visitPath+'/client-confirm',client.token,{
    confirmed:true
  }),200,'Repeated client confirmation is idempotent');
  assert.equal(again.alreadyConfirmed,true);checks++;
  expect(await post(c+'/professional-response',pro.token,{
    description:'No se pueden cambiar respuestas despues de confirmar garantia'
  }),409,'Professional cannot reopen defense after customer confirmation');
  expect(await post(visitPath+'/rating',stranger.token,{
    stars:1,comment:'Cliente ajeno'
  }),409,'Another client cannot rate corrective work');
  const rating=expect(await post(visitPath+'/rating',client.token,{
    stars:5,comment:'Resolucion ficticia conforme.'
  }),201,'Client rates the warranty intervention');
  assert.equal(rating.stars,5);checks++;
  expect(await post(visitPath+'/rating',client.token,{
    stars:1,comment:'Repetido'
  }),409,'Only one rating per warranty visit');
  const afterRating=expect(await get(visitPath+'/rating',pro.token),200,
    'Assigned professional sees recorded warranty rating');
  assert.equal(afterRating.stars,5);checks++;
  expect(await get(visitPath+'/rating',otherPro.token),404,
    'Unrelated professional cannot read warranty rating');

  const pendingList=expect(await get('/api/claims/admin-list?view=pending&search='+claim.id,admin.token),
    200,'General admin sees pending case in review');
  assert.ok(pendingList.items.some(x=>String(x.id)===String(claim.id) && x.status==='in_review'));
  checks++;
  expect(await patch(c+'/resolve',pro.token,{resolutionNote:'Un profesional no cierra reclamos'}),403,
    'Professional cannot close customer complaint');
  expect(await patch(c+'/resolve',reviewer.token,{resolutionNote:'Revisor de papeles no cierra reclamos'}),403,
    'Document reviewer cannot close customer complaint');
  const resolved=expect(await patch(c+'/resolve',admin.token,{
    resolutionNote:'Administracion verifico conformidad del cliente con la correccion ficticia.'
  }),200,'Only administrator resolves claim');
  assert.equal(resolved.status,'resolved');checks++;
  expect(await patch(c+'/resolve',admin.token,{resolutionNote:'Segundo cierre no autorizado'}),409,
    'Double resolution rejected');
  const archive=expect(await get('/api/claims/admin-list?view=archived&search='+claim.id,admin.token),
    200,'Resolved complaint appears in admin archive');
  assert.ok(archive.items.some(x=>String(x.id)===String(claim.id) && x.status==='resolved'));
  checks++;
  const stillPending=expect(await get('/api/claims/admin-list?view=pending&search='+claim.id,admin.token),
    200,'Resolved complaint no longer in pending list');
  assert.ok(!stillPending.items.some(x=>String(x.id)===String(claim.id)));checks++;

  // Once claim was closed, P can finally quote the job that was waiting.
  const unblocked=expect(await post('/api/jobs/'+nextJob.id+'/quotes',pro.token,quote(10)),201,
    'Closing complaint re-enables quoting for approved professional');
  assert.equal(unblocked.status,'submitted');checks++;

  const audit=await query(
    "SELECT action,metadata FROM audit_events WHERE resource_type='claim' AND resource_id=$1 ORDER BY id",
    [String(claim.id)]
  );
  for(const action of [
    'claim_professional_acknowledged','claim_professional_response',
    'claim_technical_review_requested','claim_warranty_authorized',
    'warranty_client_confirmed','claim_resolved'
  ]){
    assert.ok(audit.some(a=>a.action===action),'Audit missed '+action);checks++;
  }
  assert.equal(audit.filter(a=>a.action==='claim_professional_acknowledged').length,1);
  assert.equal(audit.filter(a=>a.action==='warranty_client_confirmed').length,1);
  assert.equal(audit.filter(a=>a.action==='claim_resolved').length,1);
  checks+=3;
  const evidence=await query(
    'SELECT id,status,suffix FROM warranty_visits WHERE original_job_id=$1',
    [job.id]);
  assert.equal(evidence.length,1);checks++;
  assert.equal(evidence[0].status,'completed');checks++;

  // Zero-day warranty: claims still possible; contractual visit must not be.
  const zeroJob=expect(await post('/api/jobs',client.token,{
    ...jobInput,description:'Servicio simulado sin garantia contractual'
  }),201,'Client can request test work again after complaint is closed');
  const zeroQuote=expect(await post('/api/jobs/'+zeroJob.id+'/quotes',pro.token,quote(0)),201,
    'Professional may quote a zero-day warranty explicitly');
  expect(await post('/api/jobs/'+zeroJob.id+'/accept-quote',client.token,{
    quoteId:Number(zeroQuote.id)
  }),200,'Client selects a zero-day warranty quote');
  expect(await post('/api/jobs/'+zeroJob.id+'/start',pro.token),200,
    'Professional starts zero-day job');
  expect(await post('/api/jobs/'+zeroJob.id+'/report-completed',pro.token),200,
    'Professional finishes zero-day job');
  const zeroCase=expect(await post('/api/claims',client.token,claimBody(zeroJob)),201,
    'Customer complaint remains available with zero warranty');
  const denied=expect(await post('/api/claims/'+zeroCase.id+'/authorize-warranty',
    admin.token,{note:'Prueba sin cobertura no debe aprobar visita contractual'}),409,
    'Zero-day coverage cannot generate contractual warranty work');
  assert.equal(denied.error,'no_contractual_warranty');checks++;
  expect(await patch('/api/claims/'+zeroCase.id+'/resolve',admin.token,{
    resolutionNote:'Administracion cerro reclamo sin cobertura contractual.'
  }),200,'Admin can close complaint without guaranteed repair');
  const zeroVisits=await query(
    'SELECT count(*)::int AS n FROM warranty_visits WHERE original_job_id=$1',[zeroJob.id]);
  assert.equal(zeroVisits[0].n,0,'No warranty visits created without coverage');checks++;

  console.log('OK: '+checks+
    ' pruebas del circuito reclamos-garantias, bloqueo, cliente, calificacion, cierre y permisos');
} finally {
  app.kill('SIGTERM');
  await db.end().catch(()=>undefined);
}
