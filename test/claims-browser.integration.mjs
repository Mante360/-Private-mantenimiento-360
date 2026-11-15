// Full browser journey of a customer complaint and warranty using Chromium.
// CI-only, isolated disposable test Postgres. No real accounts or external payments.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {setTimeout as sleep} from 'node:timers/promises';
import {mkdir} from 'node:fs/promises';
import pg from 'pg';
import {chromium} from 'playwright';

const databaseUrl=process.env.DATABASE_URL||'';
assert.equal(process.env.CI,'true','Refuse execution outside disposable CI');
assert.match(databaseUrl,/\/mantenimiento_360_db_pruebas_20261012(?:\?|$)/,
  'Refuse any database other than the CI fixture');
const base='http://127.0.0.1:45678';
const adminPassword='Admin-Only-Test-2026-Password!';
const password='Claim-Browser-Auto-Only-2026!';
const db=new pg.Client({connectionString:databaseUrl});
const processApi=spawn(process.execPath,['dist/server.js'],{
  env:{...process.env,PORT:'45678'},stdio:['ignore','pipe','pipe']
});
let serverError='',browser,checks=0;
const contexts={};
processApi.stderr.on('data',chunk=>{serverError+=String(chunk).slice(0,1500);});
function check(value,message){assert.ok(value,message);checks++;}
async function http(method,path,token=null,body){
  const r=await fetch(base+path,{method,headers:{
    'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},
    ...(body===undefined?{}:{body:JSON.stringify(body)})});
  const response=await r.json();
  assert.ok(r.ok,method+' '+path+': '+JSON.stringify(response));
  checks++;return response;
}
async function register(role,name,email){
  return http('POST','/api/auth/register',null,{role,name,email,password});
}
async function login(context,email,secret){
  const page=await context.newPage();
  await page.goto(base+'/pruebas',{waitUntil:'domcontentloaded'});
  await page.locator('#showLogin').click();
  await page.locator('#loginEmail').fill(email);
  await page.locator('#loginPassword').fill(secret);
  await page.locator('#loginButton').click();
  await page.waitForFunction(()=>document.querySelector('#signedIn')?.hidden===false);
  checks++;
  // Accept only simulated test dialogs. Prompt text is always fictional.
  page.on('dialog',dialog=>void (dialog.type()==='prompt'
    ?dialog.accept(dialog.message().includes('Garantía') ||
       dialog.message().includes('garantía') ?
      'SIMULACION: correccion pactada dentro de la garantia ficticia.' :
      'SIMULACION: revision y resolucion documental del reclamo ficticio.')
    :dialog.accept()));
  return page;
}
async function txt(page,selector,part){
  await page.waitForFunction(([selector,part])=>
    document.querySelector(selector)?.textContent?.includes(part),[selector,part],
    {timeout:20000});
  checks++;
}
async function poll(sql,params,assertion){
  for(let i=0;i<90;i++){
    const rows=(await db.query(sql,params)).rows;
    if(assertion(rows))return rows;
    await sleep(120);
  }
  throw Error('Expected database transition not seen: '+sql);
}
try{
  await db.connect();
  const database=(await db.query('SELECT current_database() name')).rows[0].name;
  check(database==='mantenimiento_360_db_pruebas_20261012','Isolated CI fixture only');
  let ready=false;
  for(let i=0;i<100;i++){
    if(processApi.exitCode!==null)throw Error('Backend failed: '+serverError);
    try{ready=(await fetch(base+'/health')).ok;if(ready)break;}catch{}
    await sleep(125);
  }
  check(ready,'Test API ready');
  browser=await chromium.launch({headless:true,args:['--no-sandbox']});
  for(const id of ['client','professional','admin','reviewer'])
    contexts[id]=await browser.newContext({viewport:{width:1280,height:960}});

  const customer=await register('client','Cliente Reclamo Navegador','cliente-reclamo-ui@test.invalid');
  const professional=await register('professional','Profesional Garantia Navegador','profesional-garantia-ui@test.invalid');
  const stranger=await register('client','Cliente Ajeno Navegador','ajeno-reclamo-ui@test.invalid');
  const adminAuth=await http('POST','/api/auth/login',null,{
    email:'administracion-lab360@test.invalid',password:adminPassword
  });
  const subadmin=await http('POST','/api/lab-documents/staff',adminAuth.token,{
    name:'Revisor Solo Papeles UI',
    email:'revisor-reclamos-ui@test.invalid',password
  });
  check(subadmin.permission==='document_review','Reviewer has documentation-only permission');

  // Fixture state: one approved trade, a normal client job, accepted quote,
  // and work reported finished by the chosen professional through real API.
  const category=(await db.query(
    "INSERT INTO specialties(name) VALUES('Refrigeracion Reclamos UI') RETURNING id")).rows[0];
  const service=(await db.query(
    "INSERT INTO specialty_services(specialty_id,name) VALUES($1,'Correccion ficticia') RETURNING id",
    [category.id])).rows[0];
  await db.query(
    "UPDATE professional_profiles SET verification_status='approved',available=true WHERE user_id=$1",
    [professional.user.id]);
  await db.query(
    'INSERT INTO professional_specialties(professional_id,specialty_id) VALUES($1,$2)',
    [professional.user.id,category.id]);
  await db.query(
    'INSERT INTO professional_services(professional_id,specialty_id,service_id) VALUES($1,$2,$3)',
    [professional.user.id,category.id,service.id]);
  await db.query(
    "INSERT INTO lab_service_declarations(professional_id,service_id,status) VALUES($1,$2,'approved')",
    [professional.user.id,service.id]);
  const job=await http('POST','/api/jobs',customer.token,{
    specialtyId:Number(category.id),serviceId:Number(service.id),
    description:'Equipo de refrigeracion con falla posterior simulada',
    locality:'San Isidro',exactAddress:'Calle Ficticia 123, Piso 2'
  });
  const offer=await http('POST','/api/jobs/'+job.id+'/quotes',professional.token,{
    amount:85000,description:'Reparacion ficticia de equipo',
    warrantyDays:30
  });
  await http('POST','/api/jobs/'+job.id+'/accept-quote',customer.token,
    {quoteId:Number(offer.id)});
  await http('POST','/api/jobs/'+job.id+'/start',professional.token);
  await http('POST','/api/jobs/'+job.id+'/report-completed',professional.token);
  const anotherJob=await http('POST','/api/jobs',stranger.token,{
    specialtyId:Number(category.id),serviceId:Number(service.id),
    description:'Trabajo pendiente para comprobar bloqueo posterior',
    locality:'Olivos',exactAddress:'Calle Ficticia 123, Piso 2'
  });

  const clientPage=await login(contexts.client,'cliente-reclamo-ui@test.invalid',password);
  const proPage=await login(contexts.professional,'profesional-garantia-ui@test.invalid',password);
  const adminPage=await login(contexts.admin,'administracion-lab360@test.invalid',adminPassword);
  const reviewerPage=await login(contexts.reviewer,'revisor-reclamos-ui@test.invalid',password);
  check(!(await reviewerPage.locator('#claimInboxSection').isVisible()),
    'Documentation reviewer must never see work claims');
  check(!(await reviewerPage.locator('#adminSection').isVisible()),
    'Documentation reviewer must never see general admin claims');
  check(await reviewerPage.locator('#documentReviewSection').isVisible(),
    'Documentation reviewer sees only its permitted panel');

  // Client enters a completed job, opens complaint dialog, submits actual form.
  await clientPage.locator('#refreshJobs').click();
  const jobLine=clientPage.locator('#jobsPanel .jobspanel')
    .filter({hasText:job.public_code});
  await jobLine.getByRole('button',{name:'Seguir trabajo'}).click();
  await clientPage.locator('#clientReviewSection').waitFor({state:'visible'});
  await clientPage.locator('#openClaimFormButton').click();
  await clientPage.locator('#claimReason').fill('Falla posterior');
  await clientPage.locator('#claimDescription').fill('El equipo vuelve a fallar en esta simulacion.');
  await clientPage.locator('#clientClaimForm button[type="submit"]').click();
  await txt(clientPage,'#claimResult','Reclamo registrado.');
  const claims=await poll(
    'SELECT id,status FROM claims WHERE job_id=$1',[job.id],
    rows=>rows.length===1&&rows[0].status==='open'
  );
  const claimId=claims[0].id;
  check(!(await clientPage.locator('#openClaimFormButton').isVisible()),
    'Cannot open duplicate complaint while one remains pending');

  await adminPage.locator('#refreshAdminClaims').click();
  await txt(adminPage,'#adminOpenCount','1');
  await txt(adminPage,'#adminTotalPendingCount','1');
  await txt(adminPage,'#adminClaimsPanel','Reclamo '+claimId);
  const currentAdmin=()=>adminPage.locator('#adminClaimsPanel .jobspanel')
    .filter({hasText:'Reclamo '+claimId+' ·'});
  check(await currentAdmin().getByRole('button',{name:'Resolver reclamo'}).isVisible(),
    'General administrator can see claim resolution action');

  // Professional receives the complaint and can acknowledge it independently.
  await proPage.locator('#refreshClaimInbox').click();
  await txt(proPage,'#claimInboxPanel','Reclamo '+claimId);
  const proClaim=()=>proPage.locator('#claimInboxPanel .jobspanel')
    .filter({hasText:'Reclamo '+claimId+' ·'});
  await proClaim().getByRole('button',{name:'Tomé conocimiento del reclamo'}).click();
  await txt(proPage,'#claimInboxPanel','Recepción confirmada');
  const receipt=await db.query(
    "SELECT count(*)::int AS n FROM audit_events WHERE action='claim_professional_acknowledged' AND resource_id=$1",
    [String(claimId)]);
  check(receipt.rows[0].n===1,'Receipt registered once');
  await proClaim().locator('form').filter({hasText:'Diagnóstico y descargo técnico'})
    .locator('textarea').fill('SIMULACION: propongo revision tecnica y reparacion de la falla.');
  await proClaim().getByRole('button',{name:'Enviar descargo'}).click();
  await poll("SELECT id FROM audit_events WHERE action='claim_professional_response' AND resource_id=$1",
    [String(claimId)],rows=>rows.length===1);
  checks++;
  // An active complaint must prevent taking other jobs.
  const blocked=await fetch(base+'/api/jobs/'+anotherJob.id+'/quotes',{
    method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+professional.token},
    body:JSON.stringify({amount:10000,description:'Oferta no permitida',warrantyDays:5})
  });
  check(blocked.status===403,'Professional blocked from quoting while complaint active');

  // Real admin controls: request diagnosis, then authorize corrective warranty.
  await adminPage.locator('#refreshAdminClaims').click();
  await currentAdmin().getByRole('button',{name:'Solicitar revisión técnica'}).click();
  await txt(adminPage,'#adminReviewCount','1');
  const inReview=await db.query('SELECT status FROM claims WHERE id=$1',[claimId]);
  check(inReview.rows[0].status==='in_review','Claim still open during technical review');
  await currentAdmin().getByRole('button',{name:'Autorizar intervención en garantía'}).click();
  const visit=await poll(
    'SELECT id,status,suffix FROM warranty_visits WHERE original_job_id=$1',[job.id],
    rows=>rows.length===1&&rows[0].status==='requested'
  );
  check(visit[0].suffix==='A','Warranty correctly linked with A suffix');
  await txt(adminPage,'#adminClaimsPanel','Garantía '+job.public_code+'-A');

  // Professional reports the correction using the real prompt/button.
  await proPage.locator('#refreshClaimInbox').click();
  await txt(proPage,'#claimInboxPanel','Garantía '+job.public_code+'-A');
  await proClaim().getByRole('button',{name:'Informar corrección realizada'}).click();
  await poll('SELECT status FROM warranty_visits WHERE id=$1',[visit[0].id],
    rows=>rows[0]?.status==='completed');
  checks++;

  // Client explicitly confirms correction and rates the same warranty.
  await clientPage.locator('#refreshClaimInbox').click();
  const clientClaim=()=>clientPage.locator('#claimInboxPanel .jobspanel')
    .filter({hasText:'Reclamo '+claimId+' ·'});
  await clientClaim().getByRole('button',{name:'Confirmar corrección de garantía'}).click();
  await txt(clientPage,'#claimInboxPanel','Corrección confirmada por el cliente');
  const warrantyRating=clientClaim().locator('form').filter({hasText:'Calificar esta garantía'});
  await warrantyRating.locator('select').selectOption('5');
  await warrantyRating.locator('textarea').fill('SIMULACION: conforme con la correccion.');
  await warrantyRating.getByRole('button',{name:'Enviar calificación de garantía'}).click();
  await txt(clientPage,'#claimInboxPanel','Calificación de esta garantía: 5 estrellas');
  const rating=await db.query(
    'SELECT stars FROM ratings WHERE warranty_visit_id=$1',[visit[0].id]);
  check(rating.rows[0]?.stars===5,'Client warranty rating stored exactly once');

  // Archive, counters and the final professional unblock are checked in UI.
  await adminPage.locator('#refreshAdminClaims').click();
  await currentAdmin().getByRole('button',{name:'Resolver reclamo'}).click();
  await txt(adminPage,'#adminTotalPendingCount','0');
  await txt(adminPage,'#adminArchivedCount','1');
  await adminPage.locator('#toggleClaimArchive').click();
  const archived=adminPage.locator('#adminArchivePanel details').filter({hasText:'Reclamo '+claimId+' ·'});
  await archived.waitFor({state:'visible'});
  await archived.locator('summary').click();
  await txt(adminPage,'#adminArchivePanel','Estado: Resuelto');
  await proPage.locator('#refreshClaimInbox').click();
  await txt(proPage,'#claimInboxPanel','No tenés reclamos pendientes.');
  const quoteAfter=await http('POST','/api/jobs/'+anotherJob.id+'/quotes',
    professional.token,{amount:30000,description:'Oferta ficticia ahora permitida',warrantyDays:5});
  check(quoteAfter.status==='submitted','Resolved complaint unblocks new quote');
  const audit=await db.query(
    "SELECT action FROM audit_events WHERE resource_type='claim' AND resource_id=$1",
    [String(claimId)]);
  check(audit.rows.some(x=>x.action==='claim_resolved'),'Final administrative action audited');

  console.log('OK: '+checks+
    ' verificaciones de pantalla real para reclamos, garantias, permisos y archivo');
}catch(error){
  console.error('BROWSER CLAIMS TEST FAILED:',error);
  process.exitCode=1;
  await mkdir('test-results',{recursive:true});
  for(const [name,ctx] of Object.entries(contexts)){
    for(const [i,page] of ctx.pages().entries()){
      await page.screenshot({path:'test-results/claims-'+name+'-'+i+'.png',
        fullPage:true,timeout:5000}).catch(()=>undefined);
    }
  }
}finally{
  if(browser)await browser.close().catch(()=>undefined);
  processApi.kill('SIGTERM');
  await db.end().catch(()=>undefined);
}
