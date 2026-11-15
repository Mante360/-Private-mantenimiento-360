// Browser automation for checkout demonstration in isolated CI.
// No real payment, payment provider navigation or personal credentials.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {setTimeout as pause} from 'node:timers/promises';
import {mkdir} from 'node:fs/promises';
import pg from 'pg';
import {chromium} from 'playwright';

const databaseUrl=process.env.DATABASE_URL||'';
assert.equal(process.env.CI,'true','Only disposable GitHub CI may run payment browser tests');
assert.match(databaseUrl,/\/mantenimiento_360_db_pruebas_20261012(?:\?|$)/,
  'Refuse real or persistent databases');
const base='http://127.0.0.1:45678';
const password='Browser-Mock-Checkout-2026!';
const db=new pg.Client({connectionString:databaseUrl});
const proc=spawn(process.execPath,['dist/server.js'],{env:process.env,stdio:['ignore','pipe','pipe']});
let stderr='',browser,context,page,checks=0;
const outgoing=[];
proc.stderr.on('data',data=>{stderr+=String(data).slice(0,1600);});
async function api(method,path,token=null,body){
  const result=await fetch(base+path,{method,
    headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},
    ...(body===undefined?{}:{body:JSON.stringify(body)})});
  const data=await result.json();
  assert.ok(result.ok,method+' '+path+' failed '+JSON.stringify(data));checks++;
  return data;
}
async function expected(selector,text){
  await page.waitForFunction(([selector,text])=>
    document.querySelector(selector)?.textContent?.includes(text),
    [selector,text],{timeout:20000});
  checks++;
}
try{
  await db.connect();
  const name=(await db.query('SELECT current_database() name')).rows[0].name;
  assert.equal(name,'mantenimiento_360_db_pruebas_20261012');checks++;
  let ready=false;
  for(let i=0;i<100;i++){
    if(proc.exitCode!==null)throw Error('API exited: '+stderr);
    try{if((await fetch(base+'/health')).ok){ready=true;break;}}catch{}
    await pause(125);
  }
  assert.ok(ready);checks++;
  const register=(role,name,email)=>api('POST','/api/auth/register',null,{
    role,name,email,password
  });
  const client=await register('client','Cliente Pago Navegador','checkout-browser-client@test.invalid');
  const pro1=await register('professional','Profesional Pago Uno','checkout-browser-pro1@test.invalid');
  const pro2=await register('professional','Profesional Pago Dos','checkout-browser-pro2@test.invalid');
  const pro3=await register('professional','Profesional Pago Tres','checkout-browser-pro3@test.invalid');
  const [specialty]=(await db.query(
    "INSERT INTO specialties(name) VALUES('Refrigeracion Pago Browser CI') RETURNING id")).rows;
  const [service]=(await db.query(
    "INSERT INTO specialty_services(specialty_id,name) VALUES($1,'Servicio Pago Simulado') RETURNING id",
    [specialty.id])).rows;
  for(const p of [pro1,pro2,pro3]){
    await db.query("UPDATE professional_profiles SET verification_status='approved',available=true WHERE user_id=$1",[p.user.id]);
    await db.query("INSERT INTO professional_specialties(professional_id,specialty_id) VALUES($1,$2)",[p.user.id,specialty.id]);
    await db.query("INSERT INTO professional_services(professional_id,specialty_id,service_id) VALUES($1,$2,$3)",
      [p.user.id,specialty.id,service.id]);
    await db.query("INSERT INTO lab_service_declarations(professional_id,service_id,status) VALUES($1,$2,'approved')",
      [p.user.id,service.id]);
  }
  checks++;
  const newJob=description=>api('POST','/api/jobs',client.token,{
    specialtyId:Number(specialty.id),serviceId:Number(service.id),
    description,locality:'San Isidro'
  });
  const one=await newJob('Cotizaciones y Mercado Pago completamente ficticio');
  const quotes=[];
  for(const [pro,amount,desc] of [
    [pro1,50000,'Profesional Uno'],
    [pro2,85000,'Profesional Dos'],
    [pro3,110000,'Profesional Tres']
  ])quotes.push(await api('POST','/api/jobs/'+one.id+'/quotes',pro.token,{
    amount,description:'Reparacion simulada - '+desc,warrantyDays:30
  }));

  browser=await chromium.launch({headless:true,args:['--no-sandbox']});
  context=await browser.newContext({viewport:{width:1280,height:960}});
  page=await context.newPage();
  page.on('request',request=>{
    if(/^https?:/.test(request.url()) && !request.url().startsWith(base+'/'))outgoing.push(request.url());
  });
  page.on('dialog',dialog=>void dialog.accept());
  await page.goto(base+'/pruebas',{waitUntil:'domcontentloaded'});
  await page.locator('#showLogin').click();
  await page.locator('#loginEmail').fill('checkout-browser-client@test.invalid');
  await page.locator('#loginPassword').fill(password);
  await page.locator('#loginButton').click();
  await page.locator('#signedIn').waitFor({state:'visible'});
  checks++;

  await page.locator('#refreshJobs').click();
  await page.locator('#jobsPanel .jobspanel').filter({hasText:one.public_code})
    .getByRole('button',{name:'Ver solicitud'}).click();
  const cards=page.locator('#quoteList .jobspanel');
  await cards.first().waitFor({state:'visible',timeout:20000});
  assert.equal(await cards.count(),3,'All three prices visible before selection');checks++;
  const chosen=cards.filter({hasText:'Profesional Pago Dos'});
  const selector=chosen.getByRole('combobox',{name:'Forma de pago ficticia'});
  await selector.waitFor({state:'visible'});
  assert.equal(await chosen.getByRole('button',{name:'Pagar y contratar (SIMULADO)'}).isDisabled(),true,
    'No option must be preselected');checks++;
  await selector.selectOption('mercado_pago');
  const button=chosen.getByRole('button',{name:'Pagar y contratar (SIMULADO)'});
  assert.equal(await button.isEnabled(),true);checks++;
  await button.click();
  await expected('#jobsPanel','No se realizó ningún pago.');
  await expected('#jobsPanel','Mercado Pago');
  await expected('#jobsPanel',one.public_code);
  const rows=(await db.query(
    'SELECT jc.quote_id FROM job_contracts jc WHERE jc.job_id=$1',[one.id])).rows;
  assert.equal(rows.length,1);checks++;
  assert.equal(String(rows[0].quote_id),String(quotes[1].id));checks++;
  const records=(await db.query(
    "SELECT metadata FROM audit_events WHERE action='lab_payment_method_simulated' AND resource_id=$1",
    [String(one.id)])).rows;
  assert.equal(records.length,1);checks++;
  assert.equal(records[0].metadata.method,'mercado_pago');checks++;
  assert.equal(records[0].metadata.charged,false);checks++;
  assert.equal(Number(records[0].metadata.amount),85000);checks++;

  // Second independent contract validates the simulated transfer alternative.
  const two=await newJob('Transferencia bancaria ficticia y sin cobro');
  const quote=await api('POST','/api/jobs/'+two.id+'/quotes',pro1.token,{
    amount:76500,description:'Transferencia bancaria de laboratorio',warrantyDays:0
  });
  await page.locator('#refreshJobs').click();
  await page.locator('#jobsPanel .jobspanel').filter({hasText:two.public_code})
    .getByRole('button',{name:'Ver solicitud'}).click();
  const card=page.locator('#quoteList .jobspanel').filter({hasText:'Profesional Pago Uno'});
  await card.getByRole('combobox',{name:'Forma de pago ficticia'}).selectOption('bank_transfer');
  await card.getByRole('button',{name:'Pagar y contratar (SIMULADO)'}).click();
  await expected('#jobsPanel','transferencia bancaria');
  await expected('#jobsPanel','No se realizó ningún pago.');
  const last=(await db.query('SELECT quote_id FROM job_contracts WHERE job_id=$1',[two.id])).rows;
  assert.equal(last.length,1);checks++;
  assert.equal(String(last[0].quote_id),String(quote.id));checks++;
  const audit=(await db.query(
    "SELECT metadata FROM audit_events WHERE action='lab_payment_method_simulated' AND resource_id=$1",
    [String(two.id)])).rows;
  assert.equal(audit.length,1);checks++;
  assert.equal(audit[0].metadata.method,'bank_transfer');checks++;
  assert.equal(audit[0].metadata.charged,false);checks++;
  assert.equal(Number(audit[0].metadata.amount),76500);checks++;

  assert.deepEqual(outgoing,[],'The browser must never call an external payment provider');
  checks++;
  console.log('OK: '+checks+
    ' comprobaciones de interfaz de cobro ficticio: Mercado Pago, transferencia, importes y cero cobros externos');
}catch(error){
  console.error('FAKE PAYMENT BROWSER TEST FAILED:',error);
  process.exitCode=1;
  await mkdir('test-results',{recursive:true});
  if(page)await page.screenshot({path:'test-results/payment-browser.png',
    fullPage:true,timeout:5000}).catch(()=>undefined);
}finally{
  if(browser)await browser.close().catch(()=>undefined);
  proc.kill('SIGTERM');
  await db.end().catch(()=>undefined);
}
