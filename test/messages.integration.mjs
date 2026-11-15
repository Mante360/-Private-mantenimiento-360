// Isolated Postgres test of durable, private post-contract chat.
// Uses only made-up accounts and refuses to start outside ephemeral CI.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as pause } from 'node:timers/promises';
import pg from 'pg';

const dbUrl=process.env.DATABASE_URL||'';
assert.equal(process.env.CI,'true','Only CI may run this fixture');
assert.match(dbUrl,/\/mantenimiento_360_db_pruebas_20261012(?:\?|$)/,
  'Only temporary CI database is permitted');
const base='http://127.0.0.1:45678';
const password='Demo-Messages-CI-2026!';
const adminPassword='Admin-Only-Test-2026-Password!';
const server=spawn(process.execPath,['dist/server.js'],{env:process.env,stdio:['ignore','pipe','pipe']});
let logs='',checks=0;
server.stderr.on('data',b=>{logs+=String(b).slice(0,1300);});
const db=new pg.Client({connectionString:dbUrl});
async function call(method,path,token=null,body){
  const res=await fetch(base+path,{method,headers:{
    'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},
    ...(body===undefined?{}:{body:JSON.stringify(body)})});
  let data;const raw=await res.text();
  try{data=JSON.parse(raw);}catch{data=raw;}
  return {status:res.status,data};
}
function expect(result,status,label){
  assert.equal(result.status,status,label+': '+JSON.stringify(result.data));checks++;
  return result.data;
}
const post=(url,t,body)=>call('POST',url,t,body);
const get=(url,t)=>call('GET',url,t);
const signup=async(role,name,email)=>expect(await post('/api/auth/register',null,{
  role,name,email,password
}),201,'Create '+name);
const query=async(sql,args=[]) =>(await db.query(sql,args)).rows;
try{
  await db.connect();
  const name=(await query('SELECT current_database() AS name'))[0].name;
  assert.equal(name,'mantenimiento_360_db_pruebas_20261012');checks++;
  let up=false;
  for(let i=0;i<110;i++){
    if(server.exitCode!==null)throw Error('Test API did not start: '+logs);
    try{if((await fetch(base+'/health')).ok){up=true;break;}}catch{}
    await pause(125);
  }
  assert.ok(up,'Test API ready');checks++;

  const admin=expect(await post('/api/auth/login',null,{
    email:'administracion-lab360@test.invalid',password:adminPassword
  }),200,'General admin');
  const client=await signup('client','Cliente Mensajes CI','messages-client@test.invalid');
  const outsider=await signup('client','Cliente Ajeno CI','messages-outsider@test.invalid');
  const p1=await signup('professional','Profesional Contratado CI','messages-pro1@test.invalid');
  const p2=await signup('professional','Profesional no Seleccionado CI','messages-pro2@test.invalid');
  const pending=await signup('professional','Profesional Pendiente CI','messages-pending@test.invalid');
  const staff=expect(await post('/api/lab-documents/staff',admin.token,{
    name:'Revisor de Papeles Chat CI',email:'messages-reviewer@test.invalid',password
  }),201,'Create documentary reviewer');
  assert.equal(staff.permission,'document_review');checks++;
  const reviewer=expect(await post('/api/auth/login',null,{
    email:'messages-reviewer@test.invalid',password
  }),200,'Document-only reviewer');
  const [trade]=await query("INSERT INTO specialties(name) VALUES('Refrigeracion Mensajes CI') RETURNING id");
  const [service]=await query("INSERT INTO specialty_services(specialty_id,name) VALUES($1,'Reparar en pruebas') RETURNING id",[trade.id]);
  for(const p of [p1,p2]){
    await query("UPDATE professional_profiles SET verification_status='approved',available=true WHERE user_id=$1",[p.user.id]);
    await query("INSERT INTO professional_specialties(professional_id,specialty_id) VALUES($1,$2)",[p.user.id,trade.id]);
    await query("INSERT INTO professional_services(professional_id,specialty_id,service_id) VALUES($1,$2,$3)",[p.user.id,trade.id,service.id]);
    await query("INSERT INTO lab_service_declarations(professional_id,service_id,status) VALUES($1,$2,'approved')",[p.user.id,service.id]);
  }
  const job=expect(await post('/api/jobs',client.token,{
    specialtyId:Number(trade.id),serviceId:Number(service.id),
    description:'Servicio de prueba de chat privado',locality:'San Isidro'
  }),201,'Create request');
  const url='/api/jobs/'+job.id+'/messages';
  const body={body:'Hola, esta es una prueba interna de contratacion.'};

  expect(await get(url,client.token),404,'No chat before contracting (owner)');
  expect(await post(url,client.token,body),404,'No pre-quote client messaging');
  expect(await get(url,p1.token),404,'No pre-contract professional access');
  expect(await post(url,p1.token,body),404,'No pre-quote professional messages');
  expect(await post(url,pending.token,body),403,'Unverified professional cannot send');
  expect(await get(url),401,'Login is required');
  expect(await get(url,admin.token),403,'Admin has no silent access to private chat');
  expect(await get(url,reviewer.token),403,'Paper reviewer cannot access private chat');

  const quote=expect(await post('/api/jobs/'+job.id+'/quotes',p1.token,{
    amount:64000,description:'Reparacion contratada',warrantyDays:30
  }),201,'Winning quote');
  expect(await post('/api/jobs/'+job.id+'/quotes',p2.token,{
    amount:72000,description:'Otra oferta no seleccionada',warrantyDays:15
  }),201,'Other quote');
  expect(await get(url,client.token),404,'No chat after quote alone');
  expect(await post(url,p2.token,body),404,'No pre-contract chat after quote');

  const accepted=expect(await post('/api/jobs/'+job.id+'/accept-quote',client.token,{
    quoteId:Number(quote.id)
  }),200,'Select contractor');
  assert.equal(accepted.status,'confirmed');checks++;
  const empty=expect(await get(url,client.token),200,'After hiring, private chat exists');
  assert.deepEqual(empty.items,[]);checks++;
  assert.equal(empty.hasMore,false);checks++;
  expect(await get(url,outsider.token),404,'Another client cannot read');
  expect(await post(url,outsider.token,body),404,'Another client cannot send');
  expect(await get(url,p2.token),404,'Unselected professional cannot read');
  expect(await post(url,p2.token,body),404,'Unselected professional cannot send');
  expect(await get(url,reviewer.token),403,'Document reviewer blocked after contracting');
  expect(await get(url,admin.token),403,'Admin does not read private messages silently');

  expect(await post(url,client.token,{body:''}),400,'Reject empty message');
  expect(await post(url,client.token,{body:'  '}),400,'Reject blank message');
  expect(await post(url,client.token,{body:'x'.repeat(3001)}),400,'Reject oversized message');
  expect(await post(url,client.token,{body:'hola',senderId:p2.user.id}),400,
    'No spoofing sender ID');
  expect(await post(url,client.token,{body:'hola',recipientId:p2.user.id}),400,
    'No spoofing recipient ID');
  expect(await get(url+'?beforeId=0',client.token),400,'Invalid paging id rejected');
  expect(await get(url+'?beforeId=abc',client.token),400,'Non-integer paging id rejected');
  expect(await get(url+'?limit=999999',client.token),400,'Uncontrolled limit rejected');

  const first=expect(await post(url,client.token,{body:'  Hola, contratamos la reparacion.  '}),201,
    'Client writes first persistent message');
  assert.equal(first.item.body,'Hola, contratamos la reparacion.');checks++;
  assert.equal(String(first.item.sender_id),String(client.user.id));checks++;
  const second=expect(await post(url,p1.token,{
    body:'Confirmado; coordinamos por el chat privado.'
  }),201,'Contractor replies');
  assert.equal(String(second.item.sender_id),String(p1.user.id));checks++;
  const clientView=expect(await get(url,client.token),200,'Customer reads both messages');
  const professionalView=expect(await get(url,p1.token),200,'Contractor reads both messages');
  assert.deepEqual(clientView.items.map(m=>m.body),
    professionalView.items.map(m=>m.body));checks++;
  assert.deepEqual(clientView.items.map(m=>m.body),[
    'Hola, contratamos la reparacion.',
    'Confirmado; coordinamos por el chat privado.'
  ]);checks++;
  assert.deepEqual(clientView.items.map(m=>m.sender_role),['client','professional']);checks++;
  assert.ok(clientView.items.every(m=>m.id&&m.created_at&&m.sender_name));checks++;
  assert.equal((await query('SELECT count(*)::int AS n FROM job_messages WHERE job_id=$1',[job.id]))[0].n,2);checks++;

  // Client can send only ten messages/minute per job, including first.
  for(let i=0;i<9;i++){
    expect(await post(url,client.token,{body:'Mensaje ficticio '+i}),201,
      'Accept permitted message '+i);
  }
  expect(await post(url,client.token,{body:'No enviar mensaje once'}),429,
    'Repeated clicks are rate limited');
  const count=await query('SELECT count(*)::int AS n FROM job_messages WHERE job_id=$1 AND sender_id=$2',[job.id,client.user.id]);
  assert.equal(count[0].n,10,'No extra message after rate limit');checks++;
  // Message history can be retrieved even after job reported completed;
  // never force user to start new conversation or lose earlier messages.
  expect(await post('/api/jobs/'+job.id+'/start',p1.token),200,'Start contracted work');
  expect(await post('/api/jobs/'+job.id+'/report-completed',p1.token),200,'Report work finished');
  const finished=expect(await get(url,client.token),200,'Chat remains after reported completion');
  assert.equal(finished.items.length,11);checks++;
  expect(await post(url,p1.token,{body:'Terminamos la reparacion simulada.'}),201,
    'Contracted professional may reopen existing conversation after finishing');
  expect(await get(url,client.token),200,'Client continues to see persistent thread');

  // Historic pagination (>50 records), all accessible only to those assigned.
  await query(`INSERT INTO job_messages(job_id,sender_id,body,created_at)
    SELECT $1,$2,'Mensaje historico ' || gs,now()-interval '2 days'
    FROM generate_series(1,59) gs`,[job.id,client.user.id]);
  const latest=expect(await get(url,client.token),200,'Recent 50 messages paged');
  assert.equal(latest.items.length,50);checks++;
  assert.equal(latest.hasMore,true);checks++;
  const firstOld=expect(await get(url+'?beforeId='+latest.items[0].id,p1.token),200,
    'Older pages are visible to contractor');
  assert.ok(firstOld.items.length>0 && firstOld.items.length<=50);checks++;
  assert.ok(firstOld.items.every(m=>Number(m.id)<Number(latest.items[0].id)));checks++;
  const ids=latest.items.map(m=>Number(m.id));
  assert.deepEqual(ids,[...ids].sort((a,b)=>a-b));checks++;
  expect(await call('DELETE',url,client.token,{id:first.item.id}),404,
    'No endpoint to erase historic messages');
  expect(await call('PATCH',url,p1.token,{body:'rewritten'}),404,
    'No endpoint to rewrite historic messages');

  console.log('OK: '+checks+' controles del chat privado persistente, acceso post-contrato, límites e historial');
}finally{
  server.kill('SIGTERM');
  await db.end().catch(()=>undefined);
}
