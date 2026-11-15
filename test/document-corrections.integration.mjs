// End-to-end HTTP tests of the fictitious documentation workflow.
// The API and fixture Postgres instance both run exclusively in GitHub Actions.
// NEVER point this at a Render database or upload personal information.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {setTimeout as sleep} from 'node:timers/promises';
import pg from 'pg';

const dbUrl=process.env.DATABASE_URL||'';
assert.match(dbUrl,/\/mantenimiento_360_db_pruebas_20261012(?:\?|$)/,
  'Refusing to run document workflow outside the named disposable CI database');
assert.equal(process.env.CI,'true','These tests run only in ephemeral CI');

const host='http://127.0.0.1:45678';
const adminPassword='Admin-Only-Test-2026-Password!';
const fixturePassword='Autotest-Doc-Only-2026!';
const db=new pg.Client({connectionString:dbUrl});
const server=spawn(process.execPath,['dist/server.js'],{env:process.env,stdio:['ignore','pipe','pipe']});
let stderr='',checks=0;
server.stderr.on('data',b=>{stderr+=String(b).slice(0,900);});
const request=async(method,path,token=null,data)=>{
  const response=await fetch(host+path,{
    method,
    headers:{'Content-Type':'application/json',
      ...(token?{Authorization:'Bearer '+token}:{})},
    ...(data===undefined?{}:{body:JSON.stringify(data)})
  });
  const body=await response.text();
  let parsed;
  try{parsed=JSON.parse(body);}catch{parsed=body;}
  return {status:response.status,data:parsed};
};
const check=(r,expected,label)=>{
  assert.equal(r.status,expected,label+': '+JSON.stringify(r.data));
  checks++;return r.data;
};
const row=(items,id)=>items.find(x=>String(x.id)===String(id));
async function readPdf(id,token){
  const response=await fetch(host+'/api/lab-documents/'+id+'/evidence',{
    headers:{Authorization:'Bearer '+token}
  });
  assert.equal(response.status,200,'Reviewer can open current fictitious PDF');
  assert.match(response.headers.get('content-type')||'',/application\/pdf/);
  assert.equal(response.headers.get('cache-control'),'private, no-store');
  const text=Buffer.from(await response.arrayBuffer()).toString('latin1');
  assert.ok(text.startsWith('%PDF-1.'),'The response is a PDF');
  assert.match(text,/SIM-ARCA-AUTO/,'Correct reference is embedded in PDF');
  checks+=5;
}

try{
  await db.connect();
  let healthy=false;
  for(let i=0;i<100;i++){
    if(server.exitCode!==null)throw Error('CI test API failed to start: '+stderr);
    try{if((await fetch(host+'/health')).ok){healthy=true;break;}}catch{}
    await sleep(120);
  }
  assert.ok(healthy,'The disposable API must start');checks++;

  const admin=check(await request('POST','/api/auth/login',null,{
    email:'administracion-lab360@test.invalid',password:adminPassword
  }),200,'General admin fixture');
  const professional=check(await request('POST','/api/auth/register',null,{
    name:'Auto Test Zapatero Doc',email:'autotest-zapatero-doc@test.invalid',
    password:fixturePassword,role:'professional'
  }),201,'Create pending professional');
  const anotherPro=check(await request('POST','/api/auth/register',null,{
    name:'Auto Test Other Pro',email:'autotest-other-doc@test.invalid',
    password:fixturePassword,role:'professional'
  }),201,'Second independent professional');
  const client=check(await request('POST','/api/auth/register',null,{
    name:'Auto Test Client Doc',email:'autotest-client-doc@test.invalid',
    password:fixturePassword,role:'client'
  }),201,'Client fixture');

  assert.equal(professional.user.verificationStatus,'pending');
  checks++;
  const createdStaff=check(await request('POST','/api/lab-documents/staff',admin.token,{
    name:'Revisor Automatico de Documentos',
    email:'autotest-reviewer-doc@test.invalid',password:fixturePassword
  }),201,'General admin creates document-only reviewer');
  assert.equal(createdStaff.permission,'document_review');checks++;
  const reviewer=check(await request('POST','/api/auth/login',null,{
    email:'autotest-reviewer-doc@test.invalid',password:fixturePassword
  }),200,'Reviewer signs in');
  assert.equal(reviewer.user.role,'subadmin');checks++;

  // Server-side separation: hiding buttons in the browser is not enough.
  check(await request('GET','/api/admin/professionals',reviewer.token),403,
    'Document reviewer cannot approve professionals');
  check(await request('GET','/api/lab-profession-requests/pending',reviewer.token),403,
    'Document reviewer cannot approve new occupations');
  check(await request('GET','/api/jobs',reviewer.token),403,
    'Document reviewer cannot access jobs');
  check(await request('GET','/api/claims',reviewer.token),403,
    'Document reviewer cannot access work claims');
  check(await request('GET','/api/lab-documents/audit',reviewer.token),403,
    'Only general admin may read full audit history');
  check(await request('GET','/api/lab-documents/queue',anotherPro.token),403,
    'Professionals cannot review paperwork of other people');
  check(await request('POST','/api/lab-documents/mine',client.token,{
    type:'fiscal',reference:'SIM-ARCA-AUTO',expiresOn:null
  }),403,'Client cannot submit professional documents');

  const first=check(await request('POST','/api/lab-documents/mine',professional.token,{
    type:'fiscal',reference:'SIM-ARCA-AUTO',expiresOn:null
  }),201,'Professional submits fictitious ARCA reference');
  const id=first.item.id;
  assert.equal(first.item.status,'pending');checks++;
  const doubleClick=check(await request('POST','/api/lab-documents/mine',professional.token,{
    type:'fiscal',reference:'SIM-ARCA-AUTO',expiresOn:null
  }),200,'Double-click does not create duplicate pending document');
  assert.equal(doubleClick.item.id,id);checks++;

  const otherMine=check(await request('GET','/api/lab-documents/mine',anotherPro.token),200,
    'Different professional sees no document');
  assert.ok(!row(otherMine.items,id));checks++;
  const queued=check(await request('GET','/api/lab-documents/queue',reviewer.token),200,
    'Document-only reviewer sees fictitious queue');
  assert.ok(row(queued.items,id));checks++;

  // Evidence really is required for a positive review, and must be opened.
  const positive={decision:'reviewed_test_only',note:'SIMULACION: respaldo examinado y referencia coincidente.'};
  const correctionNote='SIMULACION: se pide una nueva version del PDF ficticio.';
  const reviewPath='/api/lab-documents/queue/'+id+'/review';
  check(await request('POST',reviewPath,reviewer.token,positive),409,
    'Cannot review positively without attached evidence');
  check(await request('POST','/api/lab-documents/mine/'+id+'/evidence/demo',
    professional.token),201,'Generate private fictitious PDF');
  check(await request('POST',reviewPath,reviewer.token,positive),409,
    'Cannot review positively without inspecting current PDF');
  const noAccess=await fetch(host+'/api/lab-documents/'+id+'/evidence',{
    headers:{Authorization:'Bearer '+anotherPro.token}
  });
  assert.equal(noAccess.status,404,'Second professional must not read first professional PDF');checks++;
  const clientAccess=await fetch(host+'/api/lab-documents/'+id+'/evidence',{
    headers:{Authorization:'Bearer '+client.token}
  });
  assert.equal(clientAccess.status,403,'Client cannot inspect private professional PDF');checks++;
  await readPdf(id,reviewer.token);

  const correction=check(await request('POST',reviewPath,reviewer.token,{
    decision:'needs_more',note:correctionNote
  }),200,'Reviewer requests fictitious correction');
  assert.equal(correction.item.status,'needs_more');checks++;
  const correctionMine=check(await request('GET','/api/lab-documents/mine',professional.token),200,
    'Professional receives correction and reviewer note');
  assert.equal(row(correctionMine.items,id)?.status,'needs_more');checks++;
  assert.equal(row(correctionMine.items,id)?.reviewer_note,correctionNote);checks++;

  check(await request('POST','/api/lab-documents/mine/'+id+'/evidence/demo',
    professional.token),201,'Professional replaces PDF and resubmits for review');
  const afterResubmit=check(await request('GET','/api/lab-documents/mine',professional.token),200,
    'Same document returns to pending state');
  assert.equal(row(afterResubmit.items,id)?.status,'pending');checks++;
  assert.equal(row(afterResubmit.items,id)?.reviewer_note,null);checks++;
  const backInQueue=check(await request('GET','/api/lab-documents/queue',reviewer.token),200,
    'Corrected PDF returns to reviewer queue');
  assert.equal(row(backInQueue.items,id)?.status,'pending');checks++;
  check(await request('POST',reviewPath,reviewer.token,positive),409,
    'Previous PDF view cannot authorize review of replacement');
  await readPdf(id,reviewer.token);
  const accepted=check(await request('POST',reviewPath,reviewer.token,positive),200,
    'Second review of corrected document');
  assert.equal(accepted.item.status,'reviewed_test_only');checks++;
  const finalMine=check(await request('GET','/api/lab-documents/mine',professional.token),200,
    'Professional sees completed document review');
  assert.equal(row(finalMine.items,id)?.status,'reviewed_test_only');checks++;
  assert.equal(row(finalMine.items,id)?.reviewer_note,positive.note);checks++;
  check(await request('POST',reviewPath,reviewer.token,positive),409,
    'A completed review cannot be overwritten');
  check(await request('POST','/api/lab-documents/mine/'+id+'/evidence/demo',
    professional.token),409,'Approved document PDF cannot be altered');

  const audit=check(await request('GET','/api/lab-documents/audit',admin.token),200,
    'General admin can inspect immutable review decisions');
  const events=audit.items.filter(event=>String(event.document_id)===String(id)
    && event.action==='lab_doc_reviewed');
  assert.equal(events.length,2,'Correction and subsequent approval must both appear');checks++;
  assert.equal(events[0].decision,'reviewed_test_only');checks++;
  assert.equal(events[0].review_note,positive.note);checks++;
  assert.equal(events[1].decision,'needs_more');checks++;
  assert.equal(events[1].review_note,correctionNote);checks++;
  assert.ok(events.every(event=>event.actor_name==='Revisor Automatico de Documentos'),
    'Audit identifies which reviewer decided');checks++;
  assert.equal(new Set(events.map(event=>event.document_id)).size,1);checks++;

  const profile=await db.query(
    'SELECT verification_status,available FROM professional_profiles WHERE user_id=$1',
    [professional.user.id]
  );
  assert.equal(profile.rows[0].verification_status,'pending',
    'Positive document review never approves the professional');checks++;
  assert.equal(profile.rows[0].available,false);checks++;
  check(await request('GET','/api/jobs',professional.token),403,
    'Still cannot work after corrected document was reviewed');
  const trades=await db.query(
    'SELECT count(*)::int AS n FROM professional_specialties WHERE professional_id=$1',
    [professional.user.id]
  );
  assert.equal(trades.rows[0].n,0,'Document review must not assign a profession');checks++;

  console.log('OK: '+checks+
    ' controles integrales de documentación, corrección, privacidad, historial y permisos');
} finally {
  server.kill('SIGTERM');
  await db.end().catch(()=>undefined);
}
