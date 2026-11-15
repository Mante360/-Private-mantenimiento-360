// Real Chromium clicks for the isolated MANTENIMIENTO 360 laboratory.
// No actual addresses, IDs, real documents, production or Render credentials.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {setTimeout as sleep} from 'node:timers/promises';
import {mkdir} from 'node:fs/promises';
import {chromium} from 'playwright';
import pg from 'pg';

const dbUrl=process.env.DATABASE_URL||'';
assert.equal(process.env.CI,'true','Browser automation must run only in CI');
assert.match(dbUrl,/\/mantenimiento_360_db_pruebas_20261012(?:\?|$)/,
  'Browser automation must use ephemeral lab fixture database');

const base='http://127.0.0.1:45678';
const adminPassword='Admin-Only-Test-2026-Password!';
const password='Autotest-Browser-Only-2026!';
let browser=null,professional=null,admin=null,reviewer=null,checks=0;
const proc=spawn(process.execPath,['dist/server.js'],{
  env:{...process.env,PORT:'45678'},stdio:['ignore','pipe','pipe']
});
let stderr='';
proc.stderr.on('data',data=>{stderr+=String(data).slice(0,1500);});
const db=new pg.Client({connectionString:dbUrl});
async function check(condition,label){
  assert.ok(condition,label);checks++;
}
async function waitText(page,selector,text){
  await page.waitForFunction(([selector,text])=>
    document.querySelector(selector)?.textContent?.includes(text),
    [selector,text],{timeout:20000});
  checks++;
}
async function api(method,path,token=null,body){
  const response=await fetch(base+path,{method,headers:{
    'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},
    ...(body===undefined?{}:{body:JSON.stringify(body)})});
  const data=await response.json();
  assert.ok(response.ok,method+' '+path+' failed: '+JSON.stringify(data));
  checks++;
  return data;
}
async function loginPage(context,email,secret){
  const page=await context.newPage();
  await page.goto(base+'/pruebas',{waitUntil:'domcontentloaded'});
  await page.locator('#showLogin').click();
  await page.locator('#loginEmail').fill(email);
  await page.locator('#loginPassword').fill(secret);
  await page.locator('#loginButton').click();
  await page.waitForFunction(()=>document.querySelector('#signedIn')?.hidden===false,
    null,{timeout:20000});
  checks++;
  return page;
}
try{
  await db.connect();
  const current=await db.query('SELECT current_database() AS name');
  assert.equal(current.rows[0].name,'mantenimiento_360_db_pruebas_20261012');checks++;
  let ready=false;
  for(let i=0;i<130;i++){
    if(proc.exitCode!==null)throw Error('Browser test API exited: '+stderr);
    try{if((await fetch(base+'/health')).ok){ready=true;break;}}catch{}
    await sleep(150);
  }
  assert.ok(ready,'Temporary CI API must be ready');checks++;
  browser=await chromium.launch({headless:true,args:['--no-sandbox']});
  professional=await browser.newContext({viewport:{width:1280,height:950}});
  admin=await browser.newContext({viewport:{width:1280,height:950}});
  reviewer=await browser.newContext({viewport:{width:1280,height:950}});

  // Real registration browser: the missing profession is staged BEFORE signup,
  // then the server atomically writes the person and the occupation request.
  const proPage=await professional.newPage();
  await proPage.goto(base+'/pruebas',{waitUntil:'domcontentloaded'});
  await proPage.locator('#rolePro').click();
  await proPage.locator('#guestProfessionSearch').fill('Zapatero');
  await proPage.locator('#guestProfessionRequestBox').waitFor({state:'visible',timeout:20000});
  checks++;
  await proPage.locator('#guestProfessionRequestButton').click();
  await waitText(proPage,'#guestProfessionRequestStatus','preparada');
  await proPage.locator('#regName').fill('Zapatero Automatizado');
  await proPage.locator('#regEmail').fill('zapatero-browser-ci@test.invalid');
  await proPage.locator('#regPassword').fill(password);
  await proPage.locator('#registerButton').click();
  await proPage.waitForFunction(()=>document.querySelector('#signedIn')?.hidden===false,
    null,{timeout:20000});
  await waitText(proPage,'#profileName','Zapatero Automatizado');
  await waitText(proPage,'#accessStatusTitle','Registro en revisión');
  await waitText(proPage,'#proProfessionRequestsMine','Zapatero · Pendiente de Administración');
  await check(!(await proPage.locator('#claimInboxSection').isVisible()),
    'Pending applicant cannot see work claims');
  await check(!(await proPage.locator('#myQuotesSection').isVisible()),
    'Pending applicant cannot see quotation panel');
  await check(!(await proPage.locator('#contractsSection').isVisible()),
    'Pending applicant cannot see contract panel');

  // General administration automatically sees separate counters and proposal.
  const adminPage=await loginPage(admin,'administracion-lab360@test.invalid',adminPassword);
  await waitText(adminPage,'#adminPendingProfessionalsCount','1');
  await waitText(adminPage,'#adminPendingProfessionsCount','1');
  await waitText(adminPage,'#adminProfessionRequests','Zapatero · solicitado por Zapatero Automatizado');
  await check(await adminPage.locator('#approveSelected').isDisabled(),
    'Professional approval disabled without separate review and specialty');

  // The browser, not only the API, submits fictitious document metadata and PDF.
  await proPage.locator('#labDocType option[value="fiscal"]').waitFor({state:'attached',timeout:20000});
  await proPage.locator('#labDocType').selectOption('fiscal');
  await proPage.locator('#labDocReference').fill('SIM-ARCA-UI-AUTO');
  await proPage.locator('#proLabDocForm button[type="submit"]').click();
  await waitText(proPage,'#proDocExpiryList','SIM-ARCA-UI-AUTO');
  let card=proPage.locator('#proDocExpiryList .service-review-item')
    .filter({hasText:'SIM-ARCA-UI-AUTO'});
  await card.getByRole('button',{name:'Generar y adjuntar PDF ficticio'}).click();
  await card.getByRole('button',{name:'Ver respaldo PDF / imagen'}).waitFor({
    state:'visible',timeout:20000
  });
  checks++;

  // Create an isolated reviewer through the protected admin route, then
  // exercise its actual browser controls, not borrowed admin permissions.
  const adminAuth=await api('POST','/api/auth/login',null,{
    email:'administracion-lab360@test.invalid',password:adminPassword
  });
  await api('POST','/api/lab-documents/staff',adminAuth.token,{
    name:'Revisor Browser Automatizado',
    email:'reviewer-browser-ci@test.invalid',password
  });
  const reviewerPage=await loginPage(reviewer,'reviewer-browser-ci@test.invalid',password);
  await check(await reviewerPage.locator('#documentReviewSection').isVisible(),
    'Document reviewer can see document-review section');
  await check(!(await reviewerPage.locator('#claimInboxSection').isVisible()),
    'Document reviewer must not see work claims');
  await check(!(await reviewerPage.locator('#adminSection').isVisible()),
    'Document reviewer cannot see general administration');

  let queue=reviewerPage.locator('#labDocsQueue .service-review-item')
    .filter({hasText:'SIM-ARCA-UI-AUTO'});
  await queue.waitFor({state:'visible',timeout:20000});
  await queue.locator('textarea').fill('SIMULACION: solicitamos una nueva version ficticia.');
  reviewerPage.once('dialog',dialog=>void dialog.accept());
  await queue.getByRole('button',{name:'Solicitar corrección'}).click();
  await waitText(reviewerPage,'#labDocsQueue','Sin registros pendientes.');

  // The applicant sees the correction, replaces the PDF, and sends it back.
  await proPage.locator('#refreshMyLabDocuments').click();
  await waitText(proPage,'#proDocExpiryList','Documentación adicional solicitada');
  card=proPage.locator('#proDocExpiryList .service-review-item')
    .filter({hasText:'SIM-ARCA-UI-AUTO'});
  await card.getByRole('button',{name:'Reemplazar con PDF ficticio'}).click();
  await waitText(proPage,'#proDocExpiryList','Pendiente de revisión');

  await reviewerPage.locator('#refreshLabDocsQueue').click();
  queue=reviewerPage.locator('#labDocsQueue .service-review-item')
    .filter({hasText:'SIM-ARCA-UI-AUTO'});
  await queue.waitFor({state:'visible',timeout:20000});
  await queue.getByRole('button',{name:'Ver respaldo PDF / imagen'}).click();
  await queue.locator('.lab-doc-preview-pdf').waitFor({state:'visible',timeout:20000});
  checks++;
  await queue.getByRole('button',{name:'Cerrar respaldo'}).click();
  await queue.locator('textarea').fill('SIMULACION: PDF ficticio corregido y revisado.');
  reviewerPage.once('dialog',dialog=>void dialog.accept());
  await queue.getByRole('button',{name:'Revisado para prueba'}).click();
  await waitText(reviewerPage,'#labDocsQueue','Sin registros pendientes.');
  await proPage.locator('#refreshMyLabDocuments').click();
  await waitText(proPage,'#proDocExpiryList','Revisado (SOLO datos ficticios)');

  await adminPage.locator('#refreshLabAudit').click();
  await waitText(adminPage,'#labAuditList','SIM-ARCA-UI-AUTO');
  await waitText(adminPage,'#labAuditList','Corrección solicitada');
  await waitText(adminPage,'#labAuditList','Revisado para prueba');
  await waitText(adminPage,'#adminPendingProfessionalsCount','1');

  const state=await db.query(
    `SELECT pp.verification_status,pp.available FROM professional_profiles pp
      JOIN users u ON u.id=pp.user_id WHERE u.email='zapatero-browser-ci@test.invalid'`
  );
  await check(state.rows[0]?.verification_status==='pending' &&
    state.rows[0]?.available===false,
    'Document review cannot activate professional account');
  console.log('OK: '+checks+
    ' comprobaciones de navegador real (registro, oficios, documentos, corrección, auditoría y permisos)');
}catch(error){
  console.error('FAILED BROWSER AUTOMATION:',error);
  await mkdir('test-results',{recursive:true});
  for(const [name,context] of [['profesional',professional],['administracion',admin],['revisor',reviewer]]){
    if(!context)continue;
    for(const [index,page] of context.pages().entries()){
      await page.screenshot({path:'test-results/'+name+'-'+index+'.png',
        fullPage:true,timeout:4000}).catch(()=>undefined);
    }
  }
  process.exitCode=1;
}finally{
  if(browser)await browser.close().catch(()=>undefined);
  proc.kill('SIGTERM');
  await db.end().catch(()=>undefined);
}
