import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as pause } from 'node:timers/promises';
import pg from 'pg';

const server = spawn(process.execPath, ['dist/server.js'], { env:process.env, stdio:['ignore','pipe','pipe'] });
let errors = '';
server.stderr.on('data', chunk => errors+=String(chunk).slice(0,2000));
const db = new pg.Client({ connectionString:process.env.DATABASE_URL });
const host = 'http://127.0.0.1:45678';
const password = 'Pruebas-Seguridad-2026!';
let checks=0;

async function api(method, path, token, body) {
  const response=await fetch(host+path,{
    method,headers:{
      'content-type':'application/json',
      ...(token?{authorization:'Bearer '+token}:{})
    },body:body===undefined?undefined:JSON.stringify(body)
  });
  const raw=await response.text();
  let data;
  try{data=raw?JSON.parse(raw):null;}catch{data=raw;}
  return {status:response.status,data};
}
function expect(result,status,label){
  assert.equal(result.status,status,label+': '+JSON.stringify(result.data));
  checks++; return result.data;
}
const post=(path,token,body)=>api('POST',path,token,body);
const get=(path,token)=>api('GET',path,token);
const query=async(sql,args=[]) => (await db.query(sql,args)).rows;
const createAccount=async(email,name,role)=>{
  const response=expect(await post('/api/auth/register',null,{email,name,password,role}),201,'Registrar '+name);
  assert.ok(response.token); checks++;
  return response;
};
const authorize=async(account,specialtyId,serviceId,approved=true)=>{
  await query("UPDATE professional_profiles SET verification_status=$2,available=$3 WHERE user_id=$1",
    [account.user.id,approved?'approved':'pending',approved]);
  if(approved){
    await query("INSERT INTO professional_specialties(professional_id,specialty_id) VALUES($1,$2)",
      [account.user.id,specialtyId]);
    await query("INSERT INTO professional_services(professional_id,specialty_id,service_id) VALUES($1,$2,$3)",
      [account.user.id,specialtyId,serviceId]);
  }
};

try{
  await db.connect();
  let up=false;
  for(let i=0;i<60;i++){
    if(server.exitCode!==null)throw new Error('API exited: '+errors);
    try{if((await fetch(host+'/health')).ok){up=true;break;}}catch{}
    await pause(150);
  }
  assert.ok(up,'Server online'); checks++;

  const client=await createAccount('pres-cliente@test.invalid','Presupuestos Cliente','client');
  const outsider=await createAccount('pres-otro@test.invalid','Otro Cliente','client');
  const pro1=await createAccount('pres-pro1@test.invalid','Profesional Uno','professional');
  const pro2=await createAccount('pres-pro2@test.invalid','Profesional Dos','professional');
  const pro3=await createAccount('pres-pro3@test.invalid','Profesional Tres','professional');
  const pending=await createAccount('pres-pending@test.invalid','Profesional Pendiente','professional');
  const mismatch=await createAccount('pres-mismatch@test.invalid','Profesional Electricidad','professional');

  const [category]=await query("INSERT INTO specialties(name) VALUES('Refrigeracion Presupuestos') RETURNING id");
  const [service]=await query("INSERT INTO specialty_services(specialty_id,name) VALUES($1,'Reparacion cotizada') RETURNING id",[category.id]);
  const [otherCategory]=await query("INSERT INTO specialties(name) VALUES('Electricidad Presupuestos') RETURNING id");
  const [otherService]=await query("INSERT INTO specialty_services(specialty_id,name) VALUES($1,'Instalacion electrica') RETURNING id",[otherCategory.id]);
  for(const professional of [pro1,pro2,pro3])await authorize(professional,category.id,service.id);
  await authorize(mismatch,otherCategory.id,otherService.id);

  const job=expect(await post('/api/jobs',client.token,{
    specialtyId:Number(category.id),serviceId:Number(service.id),
    description:'Reparacion de camara frigorifica',locality:'Beccar'
  }),201,'Cliente inicia solicitud de presupuestos');
  const path='/api/jobs/'+job.id;

  expect(await get(path+'/quotes'),401,'No autenticado no lee precios');
  expect(await get(path+'/quotes',outsider.token),404,'Otro cliente no ve las cotizaciones');
  expect(await get(path+'/quotes',pro1.token),404,'Profesional sin oferta no ve ofertas ajenas');
  expect(await post(path+'/quotes',client.token,{
    amount:85000,description:'Intento cliente',warrantyDays:30
  }),403,'Cliente no puede actuar como profesional');
  expect(await post(path+'/quotes',pending.token,{
    amount:85000,description:'Profesional pendiente',warrantyDays:30
  }),403,'Profesional no verificado no puede cotizar');
  expect(await post(path+'/quotes',mismatch.token,{
    amount:85000,description:'Rubro no compatible',warrantyDays:30
  }),403,'Profesional de otro rubro no puede cotizar');
  expect(await post(path+'/quotes',pro1.token,{
    amount:0,description:'Importe invalido',warrantyDays:30
  }),400,'Importe mayor que cero obligatorio');
  expect(await post(path+'/quotes',pro1.token,{
    amount:85000,description:'Inyectar otro profesional',warrantyDays:30,
    professionalId:pro2.user.id
  }),400,'No permite adjudicar oferta a otro profesional');

  const offerBody=(amount,warrantyDays,name)=>({
    amount,description:'Reparacion del equipo por '+name,warrantyDays
  });
  const q1=expect(await post(path+'/quotes',pro1.token,offerBody(85000,30,'uno')),201,'Presupuesto uno');
  const q2=expect(await post(path+'/quotes',pro2.token,offerBody(90000,60,'dos')),201,'Presupuesto dos');
  const q3=expect(await post(path+'/quotes',pro3.token,offerBody(110000,120,'tres')),201,'Presupuesto tres');
  for(const q of [q1,q2,q3])assert.equal(q.status,'submitted');
  checks++;

  const all=expect(await get(path+'/quotes',client.token),200,'Cliente ve las 3 ofertas');
  assert.equal(all.length,3);checks++;
  assert.deepEqual(all.map(x=>Number(x.amount)),[85000,90000,110000]);checks++;
  assert.ok(all.every(x=>typeof x.professional_name==='string'));checks++;

  for(const [pro,q] of [[pro1,q1],[pro2,q2],[pro3,q3]]){
    const own=expect(await get(path+'/quotes',pro.token),200,'Profesional consulta su cotizacion');
    assert.equal(own.length,1);checks++;
    assert.equal(String(own[0].id),String(q.id));checks++;
    assert.ok(!('professional_name' in own[0])&&!('professional_id' in own[0]));checks++;
  }
  expect(await post(path+'/quotes',pro1.token,offerBody(100,1,'duplicado')),409,'Prohibido presupuesto duplicado');
  expect(await post(path+'/accept-quote',pro1.token,{quoteId:Number(q2.id)}),403,'Profesional no contrata');
  expect(await post(path+'/accept-quote',outsider.token,{quoteId:Number(q2.id)}),404,'Cliente ajeno no contrata');
  expect(await post(path+'/accept-quote',client.token,{quoteId:0}),400,'Id invalido');

  const jobOther=expect(await post('/api/jobs',outsider.token,{
    specialtyId:Number(category.id),serviceId:Number(service.id),
    description:'Reparacion de otra heladera',locality:'Olivos'
  }),201,'Otra solicitud para cotizacion de otro cliente');
  const qOther=expect(await post('/api/jobs/'+jobOther.id+'/quotes',pro1.token,offerBody(40000,10,'otro')),201,'Oferta de otro trabajo');
  expect(await post(path+'/accept-quote',client.token,{quoteId:Number(qOther.id)}),404,'No permite seleccionar oferta de otro trabajo');

  const accepted=expect(await post(path+'/accept-quote',client.token,{quoteId:Number(q2.id)}),200,'Aceptacion cliente');
  assert.equal(accepted.status,'confirmed');checks++;
  assert.equal(accepted.paymentProcessed,false);checks++;
  const after=expect(await get(path+'/quotes',client.token),200,'Cliente consulta estados');
  const statuses=new Map(after.map(q=>[String(q.id),q.status]));
  assert.deepEqual([...statuses.values()],['not_selected','accepted','not_selected']);checks++;
  const rejected=expect(await get(path+'/quotes',pro1.token),200,'No ganador consulta estado');
  assert.equal(rejected[0].status,'not_selected');checks++;
  assert.ok(!JSON.stringify(rejected).includes('90000'));checks++;
  const winner=expect(await get(path+'/quotes',pro2.token),200,'Ganador consulta estado');
  assert.equal(winner[0].status,'accepted');checks++;
  const mine1=expect(await get('/api/jobs/mine',pro1.token),200,'No ganador no tiene contrato');
  const mine2=expect(await get('/api/jobs/mine',pro2.token),200,'Ganador tiene contrato');
  assert.ok(!mine1.some(x=>String(x.id)===String(job.id)));checks++;
  assert.ok(mine2.some(x=>String(x.id)===String(job.id)));checks++;

  expect(await post(path+'/accept-quote',client.token,{quoteId:Number(q1.id)}),409,'No se permite contratar dos veces');
  expect(await post(path+'/quotes',pro1.token,offerBody(200000,100,'postconfirmacion')),409,'No cotizar trabajo confirmado');
  const [contracts]=await query("SELECT count(*)::integer AS total FROM job_contracts WHERE job_id=$1",[job.id]);
  assert.equal(contracts.total,1);checks++;
  const events=await query("SELECT old_status,new_status FROM job_status_events WHERE job_id=$1 ORDER BY created_at,id",[job.id]);
  assert.deepEqual(events.map(x=>x.new_status),['quoted','confirmed']);checks++;

  // Real concurrent clicks from one client: exactly one succeeds.
  const raceJob=expect(await post('/api/jobs',client.token,{
    specialtyId:Number(category.id),serviceId:Number(service.id),
    description:'Prueba doble clic',locality:'Beccar'
  }),201,'Solicitar segundo trabajo para concurrencia');
  const racePath='/api/jobs/'+raceJob.id;
  const race1=expect(await post(racePath+'/quotes',pro1.token,offerBody(30000,3,'raceuno')),201,'Primera oferta carrera');
  const race2=expect(await post(racePath+'/quotes',pro2.token,offerBody(40000,5,'racedos')),201,'Segunda oferta carrera');
  const raceResults=await Promise.all([
    post(racePath+'/accept-quote',client.token,{quoteId:Number(race1.id)}),
    post(racePath+'/accept-quote',client.token,{quoteId:Number(race2.id)})
  ]);
  assert.deepEqual(raceResults.map(x=>x.status).sort((a,b)=>a-b),[200,409]);checks++;
  const [raceCount]=await query("SELECT count(*)::integer AS total FROM job_contracts WHERE job_id=$1",[raceJob.id]);
  assert.equal(raceCount.total,1);checks++;

  // Active complaint restriction means no new quote can be submitted.
  const restrictionJob=expect(await post('/api/jobs',client.token,{
    specialtyId:Number(category.id),serviceId:Number(service.id),
    description:'Trabajo para probar bloqueo',locality:'Beccar'
  }),201,'Trabajo para bloqueo por reclamo');
  const [admin]=await query("SELECT id FROM users WHERE role='admin' LIMIT 1");
  const [claim]=await query(
    "INSERT INTO claims(job_id,created_by,professional_id,reason,description) VALUES($1,$2,$3,'Reclamo previo','Se revisa el servicio') RETURNING id",
    [restrictionJob.id,client.user.id,pro3.user.id]);
  await query(
    "INSERT INTO professional_restrictions(professional_id,claim_id,imposed_by,reason) VALUES($1,$2,$3,'Pendiente de revisar')",
    [pro3.user.id,claim.id,admin.id]);
  expect(await post('/api/jobs/'+restrictionJob.id+'/quotes',pro3.token,offerBody(10000,0,'bloqueado')),403,'Reclamo activo impide nueva oferta');

  console.log('OK: '+checks+' comprobaciones de presupuestos, tres profesionales, privacidad y contratacion unica');
} finally {
  server.kill('SIGTERM');
  await db.end().catch(()=>undefined);
}
