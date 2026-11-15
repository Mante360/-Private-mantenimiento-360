// Fictitious checkout regression suite. No payment provider, bank transfers or
// credentials are used, and this script refuses a non-ephemeral CI database.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {setTimeout as pause} from 'node:timers/promises';
import pg from 'pg';

const dbUrl=process.env.DATABASE_URL||'';
assert.equal(process.env.CI,'true','This suite runs only in CI');
assert.match(dbUrl,/\/mantenimiento_360_db_pruebas_20261012(?:\?|$)/,
  'Refuse to run simulated payments outside disposable GitHub Actions database');
const db=new pg.Client({connectionString:dbUrl});
const base='http://127.0.0.1:45678';
const pass='Fictional-Checkout-CI-2026!';
const server=spawn(process.execPath,['dist/server.js'],{
  env:{...process.env,PORT:'45678'},stdio:['ignore','pipe','pipe']
});
let errors='',checks=0;
server.stderr.on('data',data=>{errors+=String(data).slice(0,1600);});
async function request(method,path,token=null,body){
  const res=await fetch(base+path,{method,
    headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},
    ...(body===undefined?{}:{body:JSON.stringify(body)})});
  const raw=await res.text();
  let data;try{data=JSON.parse(raw);}catch{data=raw;}
  return {status:res.status,data};
}
function expect(result,status,label){
  assert.equal(result.status,status,label+': '+JSON.stringify(result.data));
  checks++;return result.data;
}
const post=(path,token,data)=>request('POST',path,token,data);
const get=(path,token)=>request('GET',path,token);
const query=async(sql,args=[]) => (await db.query(sql,args)).rows;
const signup=async(role,name,email)=>{
  const user=expect(await post('/api/auth/register',null,{
    role,name,email,password:pass
  }),201,'Create fictitious '+role);
  assert.ok(user.token && user.user.id);checks++;
  return user;
};
try{
  await db.connect();
  const [{name}]=await query('SELECT current_database() AS name');
  assert.equal(name,'mantenimiento_360_db_pruebas_20261012');checks++;
  let online=false;
  for(let i=0;i<120;i++){
    if(server.exitCode!==null)throw Error('API exit: '+errors);
    try{online=(await fetch(base+'/health')).ok;if(online)break;}catch{}
    await pause(120);
  }
  assert.ok(online);checks++;

  const client=await signup('client','Cliente Pago Ficticio','checkout-client@test.invalid');
  const outside=await signup('client','Cliente Ajeno Pago Ficticio','checkout-outside@test.invalid');
  const p1=await signup('professional','Profesional Cotizador Uno','checkout-pro1@test.invalid');
  const p2=await signup('professional','Profesional Cotizador Dos','checkout-pro2@test.invalid');
  const p3=await signup('professional','Profesional Cotizador Tres','checkout-pro3@test.invalid');
  const pending=await signup('professional','Profesional Sin Verificar','checkout-pending@test.invalid');
  const [category]=await query("INSERT INTO specialties(name) VALUES('Refrigeracion Pago Ficticio CI') RETURNING id");
  const [service]=await query(
    "INSERT INTO specialty_services(specialty_id,name) VALUES($1,'Servicio sin pago real') RETURNING id",
    [category.id]
  );
  for(const pro of [p1,p2,p3]){
    await query("UPDATE professional_profiles SET verification_status='approved',available=true WHERE user_id=$1",
      [pro.user.id]);
    await query("INSERT INTO professional_specialties(professional_id,specialty_id) VALUES($1,$2)",
      [pro.user.id,category.id]);
    await query("INSERT INTO professional_services(professional_id,specialty_id,service_id) VALUES($1,$2,$3)",
      [pro.user.id,category.id,service.id]);
    await query("INSERT INTO lab_service_declarations(professional_id,service_id,status) VALUES($1,$2,'approved')",
      [pro.user.id,service.id]);
  }
  checks++;
  const work={specialtyId:Number(category.id),serviceId:Number(service.id),
    description:'Simulacion de contratacion con medio ficticio',locality:'Vicente Lopez',exactAddress:'Calle Ficticia 123, Piso 2'};
  const job=expect(await post('/api/jobs',client.token,work),201,'Client requests test job');
  const path='/api/jobs/'+job.id;
  const q1=expect(await post(path+'/quotes',p1.token,{
    amount:80000,description:'Alternativa uno',warrantyDays:30
  }),201,'First quote');
  const q2=expect(await post(path+'/quotes',p2.token,{
    amount:95000,description:'Alternativa dos',warrantyDays:60
  }),201,'Second quote');
  const q3=expect(await post(path+'/quotes',p3.token,{
    amount:120000,description:'Alternativa tres',warrantyDays:90
  }),201,'Third quote');
  const target={quoteId:Number(q2.id),simulatedPaymentMethod:'mercado_pago'};
  expect(await post(path+'/accept-quote',null,target),401,'No login cannot simulate payment');
  expect(await post(path+'/accept-quote',p2.token,target),403,'Professional cannot simulate a client payment');
  expect(await post(path+'/accept-quote',pending.token,target),403,'Unapproved professional cannot simulate payment');
  expect(await post(path+'/accept-quote',outside.token,target),404,'Another client cannot hire on this job');
  expect(await post(path+'/accept-quote',client.token,{
    ...target,simulatedPaymentMethod:'external_checkout'
  }),400,'Unknown payment provider forbidden');
  expect(await post(path+'/accept-quote',client.token,{
    ...target,paymentProcessed:true
  }),400,'Client cannot assert real money was charged');
  expect(await post(path+'/accept-quote',client.token,{
    ...target,amount:1
  }),400,'Client cannot replace quoted amount');
  expect(await post(path+'/accept-quote',client.token,{
    ...target,cardNumber:'4111111111111111'
  }),400,'Payment card fields are never accepted');
  expect(await post(path+'/accept-quote',client.token,{
    quoteId:Number(q2.id),simulatedPaymentMethod:null
  }),400,'Null cannot sneak in as a payment method');
  expect(await post(path+'/accept-quote',client.token,{
    quoteId:Number(q2.id),simulatedPaymentMethod:'bank_transfer',iban:'fictional'
  }),400,'No real bank-account information accepted');
  const otherJob=expect(await post('/api/jobs',outside.token,work),201,'Other client job');
  const otherQuote=expect(await post('/api/jobs/'+otherJob.id+'/quotes',p1.token,{
    amount:110000,description:'Otra solicitud',warrantyDays:30
  }),201,'Other client quote');
  expect(await post(path+'/accept-quote',client.token,{
    quoteId:Number(otherQuote.id),simulatedPaymentMethod:'bank_transfer'
  }),404,'Do not accept another job\'s quote');

  const selected=expect(await post(path+'/accept-quote',client.token,target),200,
    'Customer chooses Mercado Pago simulated for second quote');
  assert.equal(selected.jobId,Number(job.id));checks++;
  assert.equal(selected.quoteId,Number(q2.id));checks++;
  assert.equal(selected.status,'confirmed');checks++;
  assert.equal(selected.paymentProcessed,false);checks++;
  assert.equal(selected.simulatedPayment?.charged,false);checks++;
  assert.equal(selected.simulatedPayment?.method,'mercado_pago');checks++;
  assert.equal(Number(selected.simulatedPayment?.amount),95000);checks++;
  assert.match(selected.simulatedPayment.notice,/Ningun dinero fue cobrado/i);checks++;
  const quotes=expect(await get(path+'/quotes',client.token),200,'Client sees final quote states');
  assert.deepEqual(quotes.map(q=>q.status),['not_selected','accepted','not_selected']);checks++;
  const winner=expect(await get('/api/jobs/mine',p2.token),200,'Winner sees contract');
  assert.ok(winner.some(j=>String(j.id)===String(job.id)));checks++;
  const loser=expect(await get('/api/jobs/mine',p1.token),200,'Unselected pro does not see contract');
  assert.ok(!loser.some(j=>String(j.id)===String(job.id)));checks++;

  // Double-click and repeated confirmation cannot generate a second contract
  // or payment-simulation audit event.
  expect(await post(path+'/accept-quote',client.token,target),409,'Repeated hire forbidden');
  expect(await post(path+'/accept-quote',client.token,{
    quoteId:Number(q1.id),simulatedPaymentMethod:'bank_transfer'
  }),409,'Cannot switch contracted professional');
  const contract=await query('SELECT quote_id FROM job_contracts WHERE job_id=$1',[job.id]);
  assert.equal(contract.length,1);checks++;
  assert.equal(String(contract[0].quote_id),String(q2.id));checks++;
  const audit=await query(
    "SELECT actor_id,metadata FROM audit_events WHERE action='lab_payment_method_simulated' AND resource_type='job' AND resource_id=$1",
    [String(job.id)]
  );
  assert.equal(audit.length,1,'One simulated payment choice for one real test contract');checks++;
  assert.equal(String(audit[0].actor_id),String(client.user.id));checks++;
  assert.equal(audit[0].metadata.method,'mercado_pago');checks++;
  assert.equal(Number(audit[0].metadata.amount),95000);checks++;
  assert.equal(audit[0].metadata.charged,false);checks++;
  assert.equal(audit[0].metadata.scope,'lab_only');checks++;
  assert.ok(!JSON.stringify(audit).includes('cardNumber'));checks++;

  // Test the second mock method and genuine parallel attempts independently.
  const job2=expect(await post('/api/jobs',client.token,{
    ...work,description:'Prueba de doble clic con transferencia ficticia'
  }),201,'Second test job');
  const q4=expect(await post('/api/jobs/'+job2.id+'/quotes',p1.token,{
    amount:42500,description:'Presupuesto por transferencia ficticia',warrantyDays:15
  }),201,'Quote for bank transfer');
  const q5=expect(await post('/api/jobs/'+job2.id+'/quotes',p2.token,{
    amount:46000,description:'Opcion alternativa',warrantyDays:20
  }),201,'Competing quote in concurrent test');
  const attempts=await Promise.all([
    post('/api/jobs/'+job2.id+'/accept-quote',client.token,{
      quoteId:Number(q4.id),simulatedPaymentMethod:'bank_transfer'
    }),
    post('/api/jobs/'+job2.id+'/accept-quote',client.token,{
      quoteId:Number(q5.id),simulatedPaymentMethod:'mercado_pago'
    })
  ]);
  assert.deepEqual(attempts.map(r=>r.status).sort((a,b)=>a-b),[200,409]);checks++;
  const successful=attempts.find(a=>a.status===200).data;
  assert.equal(successful.paymentProcessed,false);checks++;
  assert.equal(successful.simulatedPayment.charged,false);checks++;
  const contract2=await query('SELECT quote_id FROM job_contracts WHERE job_id=$1',[job2.id]);
  assert.equal(contract2.length,1);checks++;
  assert.equal(String(contract2[0].quote_id),String(successful.quoteId));checks++;
  const event2=await query(
    "SELECT metadata FROM audit_events WHERE action='lab_payment_method_simulated' AND resource_id=$1",
    [String(job2.id)]
  );
  assert.equal(event2.length,1);checks++;
  assert.equal(event2[0].metadata.method,successful.simulatedPayment.method);checks++;
  assert.equal(event2[0].metadata.charged,false);checks++;

  // Guarantee that the transfer option succeeds by itself, even if the race
  // winner above was Mercado Pago.
  const thirdJob=expect(await post('/api/jobs',client.token,{
    ...work,description:'Prueba exclusiva de transferencia simulada'
  }),201,'Third job for guaranteed bank option');
  const thirdQuote=expect(await post('/api/jobs/'+thirdJob.id+'/quotes',p3.token,{
    amount:105000,description:'Transferencia bancaria simulada',warrantyDays:0
  }),201,'Third quote');
  const transfer=expect(await post('/api/jobs/'+thirdJob.id+'/accept-quote',client.token,{
    quoteId:Number(thirdQuote.id),simulatedPaymentMethod:'bank_transfer'
  }),200,'Bank transfer mock choice');
  assert.equal(transfer.paymentProcessed,false);checks++;
  assert.equal(transfer.simulatedPayment.method,'bank_transfer');checks++;
  assert.equal(transfer.simulatedPayment.charged,false);checks++;
  assert.equal(Number(transfer.simulatedPayment.amount),105000);checks++;

  // API has no "mark paid" endpoint and no real provider credentials or
  // remote redirect. The only supported result is a fictitious choice.
  const record=await query(
    "SELECT count(*)::int AS total FROM audit_events WHERE action='lab_payment_method_simulated' AND resource_id=$1",
    [String(thirdJob.id)]
  );
  assert.equal(record[0].total,1);checks++;
  console.log('OK: '+checks+
    ' controles de cobro ficticio sin dinero, tres presupuestos, doble clic, privacidad y contratación única');
} finally {
  server.kill('SIGTERM');
  await db.end().catch(()=>undefined);
}
