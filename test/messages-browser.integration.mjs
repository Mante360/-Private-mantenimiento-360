// Real Chromium clicks: private messages after contract, not before, retained
// after a page reload. Only ephemeral GitHub CI/Postgres, fictitious people.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {setTimeout as pause} from 'node:timers/promises';
import {mkdir} from 'node:fs/promises';
import pg from 'pg';
import {chromium} from 'playwright';

const url=process.env.DATABASE_URL||'';
assert.equal(process.env.CI,'true','No real accounts or production execution');
assert.match(url,/\/mantenimiento_360_db_pruebas_20261012(?:\?|$)/,
  'Only disposable GitHub test database');
const host='http://127.0.0.1:45678';
const password='Fictitious-Browser-Chat-2026!';
const db=new pg.Client({connectionString:url});
const proc=spawn(process.execPath,['dist/server.js'],{
  env:{...process.env,PORT:'45678'},stdio:['ignore','pipe','pipe']
});
let stderr='',browser=null,checks=0;
const contexts={};
proc.stderr.on('data',x=>{stderr+=String(x).slice(0,1100);});

function verify(condition,label){assert.ok(condition,label);checks++;}
async function api(method,path,token=null,body){
  const res=await fetch(host+path,{
    method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},
    ...(body===undefined?{}:{body:JSON.stringify(body)})
  });
  const raw=await res.text();
  let data;try{data=JSON.parse(raw);}catch{data=raw;}
  assert.ok(res.ok,method+' '+path+': '+JSON.stringify(data));checks++;
  return data;
}
const register=(role,name,email)=>api('POST','/api/auth/register',null,{role,name,email,password});
async function login(context,email){
  const page=await context.newPage();
  await page.goto(host+'/pruebas',{waitUntil:'domcontentloaded'});
  await page.locator('#showLogin').click();
  await page.locator('#loginEmail').fill(email);
  await page.locator('#loginPassword').fill(password);
  await page.locator('#loginButton').click();
  await page.locator('#signedIn').waitFor({state:'visible',timeout:20000});
  checks++;
  return page;
}
async function openClientJob(page,code){
  await page.locator('#refreshJobs').click();
  const row=page.locator('#jobsPanel .jobspanel').filter({hasText:code});
  await row.waitFor({state:'visible',timeout:20000});
  await row.locator('button').click();
  await page.locator('#jobDetailTitle').getByText(code).waitFor({state:'visible'});
  checks++;
}
async function openProfessionalJob(page,code){
  await page.locator('#refreshContracts').click();
  const row=page.locator('#contractsPanel .contract-entry').filter({hasText:code});
  await row.waitFor({state:'visible',timeout:20000});
  await row.locator('button').click();
  await page.locator('#jobMessagesSection').waitFor({state:'visible',timeout:20000});
  checks++;
}
try{
  await db.connect();
  verify((await db.query('SELECT current_database() name')).rows[0].name===
    'mantenimiento_360_db_pruebas_20261012','CI database');
  let ready=false;
  for(let i=0;i<115;i++){
    if(proc.exitCode!==null)throw Error('API failed to start: '+stderr);
    try{ready=(await fetch(host+'/health')).ok;if(ready)break;}catch{}
    await pause(130);
  }
  verify(ready,'API started');
  const customer=await register('client','Cliente Chat Pantallas','chat-ui-customer@test.invalid');
  const stranger=await register('client','Cliente Ajeno Chat Pantallas','chat-ui-stranger@test.invalid');
  const professional=await register('professional','Profesional Chat Pantallas','chat-ui-professional@test.invalid');
  const unchosen=await register('professional','Profesional No Seleccionado','chat-ui-unchosen@test.invalid');
  const [category]=(await db.query(
    "INSERT INTO specialties(name) VALUES('Reparacion Chat Browser') RETURNING id")).rows;
  const [service]=(await db.query(
    "INSERT INTO specialty_services(specialty_id,name) VALUES($1,'Mantenimiento protegido') RETURNING id",
    [category.id])).rows;
  for(const pro of [professional,unchosen]){
    await db.query(
      "UPDATE professional_profiles SET verification_status='approved',available=true WHERE user_id=$1",
      [pro.user.id]);
    await db.query('INSERT INTO professional_specialties(professional_id,specialty_id) VALUES($1,$2)',
      [pro.user.id,category.id]);
    await db.query('INSERT INTO professional_services(professional_id,specialty_id,service_id) VALUES($1,$2,$3)',
      [pro.user.id,category.id,service.id]);
    await db.query(
      "INSERT INTO lab_service_declarations(professional_id,service_id,status) VALUES($1,$2,'approved')",
      [pro.user.id,service.id]);
  }
  const job=await api('POST','/api/jobs',customer.token,{
    specialtyId:Number(category.id),serviceId:Number(service.id),
    description:'Prueba de mensajes privados asociados a la contratacion',
    locality:'San Isidro',exactAddress:'Calle Ficticia 123, Piso 2'
  });
  browser=await chromium.launch({headless:true,args:['--no-sandbox']});
  for(const id of ['client','professional','stranger','unchosen'])
    contexts[id]=await browser.newContext({viewport:{width:1280,height:930}});
  const clientPage=await login(contexts.client,'chat-ui-customer@test.invalid');
  await openClientJob(clientPage,job.public_code);
  verify(!(await clientPage.locator('#jobMessagesSection').isVisible()),
    'No free chat before first quote');

  const quote=await api('POST','/api/jobs/'+job.id+'/quotes',professional.token,{
    amount:67000,description:'Reparacion simulada en laboratorio',warrantyDays:30
  });
  await api('POST','/api/jobs/'+job.id+'/quotes',unchosen.token,{
    amount:95000,description:'Otro presupuesto de prueba',warrantyDays:60
  });
  await openClientJob(clientPage,job.public_code);
  verify(!(await clientPage.locator('#jobMessagesSection').isVisible()),
    'A quotation alone does not unlock free chat');

  const selected=await api('POST','/api/jobs/'+job.id+'/accept-quote',customer.token,{
    quoteId:Number(quote.id)
  });
  verify(selected.status==='confirmed'&&selected.paymentProcessed===false,
    'Contract is not a real payment');
  await openClientJob(clientPage,job.public_code);
  await clientPage.locator('#jobMessagesSection').waitFor({state:'visible',timeout:20000});
  await clientPage.locator('#jobMessagesList').getByText('Todavía no hay mensajes').waitFor();
  checks++;
  const otherClient=await login(contexts.stranger,'chat-ui-stranger@test.invalid');
  verify(!(await otherClient.locator('#jobMessagesSection').isVisible()),
    'Another client cannot see the private chat section');
  const otherPro=await login(contexts.unchosen,'chat-ui-unchosen@test.invalid');
  verify(!(await otherPro.locator('#jobMessagesSection').isVisible()),
    'Non-selected professional does not see contracted chat');

  await clientPage.locator('#jobMessageBody').fill('Mensaje ficticio del cliente');
  await clientPage.locator('#jobMessageForm button[type="submit"]').click();
  await clientPage.locator('#jobMessagesList').getByText('Mensaje ficticio del cliente').waitFor();
  await clientPage.locator('#jobMessageFeedback').getByText('Mensaje guardado').waitFor();
  checks+=2;

  const proPage=await login(contexts.professional,'chat-ui-professional@test.invalid');
  await openProfessionalJob(proPage,job.public_code);
  await proPage.locator('#jobMessagesList').getByText('Mensaje ficticio del cliente').waitFor();
  checks++;
  await proPage.locator('#jobMessageBody').fill('Respuesta ficticia del profesional');
  await proPage.locator('#jobMessageForm button[type="submit"]').click();
  await proPage.locator('#jobMessagesList').getByText('Respuesta ficticia del profesional').waitFor();
  checks++;

  await clientPage.locator('#refreshJobMessages').click();
  await clientPage.locator('#jobMessagesList').getByText('Respuesta ficticia del profesional').waitFor();
  verify(await clientPage.locator('#jobMessagesList .service-review-item').count()===2,
    'Both parties see the same two stored messages');

  // Persistent messages survive a full browser reload and a new login.
  await clientPage.reload({waitUntil:'domcontentloaded'});
  await clientPage.locator('#signedIn').waitFor({state:'visible',timeout:20000});
  await openClientJob(clientPage,job.public_code);
  await clientPage.locator('#jobMessagesList').getByText('Mensaje ficticio del cliente').waitFor();
  await clientPage.locator('#jobMessagesList').getByText('Respuesta ficticia del profesional').waitFor();
  checks+=2;

  await api('POST','/api/jobs/'+job.id+'/start',professional.token);
  await api('POST','/api/jobs/'+job.id+'/report-completed',professional.token);
  await openProfessionalJob(proPage,job.public_code);
  verify(await proPage.locator('#jobMessagesSection').isVisible(),
    'Conversation retained on completed job');
  await proPage.locator('#jobMessageBody').fill('El trabajo de prueba quedó finalizado');
  await proPage.locator('#jobMessageForm button[type="submit"]').click();
  await proPage.locator('#jobMessagesList').getByText('El trabajo de prueba quedó finalizado').waitFor();
  checks++;

  // Untrusted HTML remains plain text (never render user content as markup).
  await clientPage.locator('#jobMessageBody').fill('<img src=x onerror=alert(1)>');
  await clientPage.locator('#jobMessageForm button[type="submit"]').click();
  await clientPage.locator('#jobMessagesList').getByText('<img src=x onerror=alert(1)>').waitFor();
  verify(await clientPage.locator('#jobMessagesList img').count()===0,
    'Message HTML does not create executable elements');
  const rows=(await db.query('SELECT sender_id,body FROM job_messages WHERE job_id=$1 ORDER BY id',[job.id])).rows;
  verify(rows.length===4,'Four messages saved only in PostgreSQL');
  verify(rows[0].sender_id==customer.user.id&&rows[1].sender_id==professional.user.id,
    'Message sender IDs always derived from authenticated session');

  console.log('OK: '+checks+
    ' controles Chromium del chat privado, persistencia, roles y protección HTML');
}catch(error){
  console.error('CHAT BROWSER TEST FAILED:',error);
  process.exitCode=1;
  await mkdir('test-results',{recursive:true});
  for(const [name,context] of Object.entries(contexts)){
    for(const [i,p] of context.pages().entries()){
      await p.screenshot({path:'test-results/chat-'+name+'-'+i+'.png',
        fullPage:true,timeout:4000}).catch(()=>undefined);
    }
  }
}finally{
  if(browser)await browser.close().catch(()=>undefined);
  proc.kill('SIGTERM');
  await db.end().catch(()=>undefined);
}
