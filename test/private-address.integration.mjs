// Private home addresses: visible only to the client and selected contracted
// professional (including a separately accepted diagnostic visit). CI-only.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import pg from 'pg';

const database=process.env.DATABASE_URL||'';
assert.equal(process.env.CI,'true','Never use a persistent database for this test');
assert.match(database,/\/mantenimiento_360_db_pruebas_20261012(?:\?|$)/);
const host='http://127.0.0.1:45678';
const password='Private-Address-CI-Only-2026!';
const main=spawn(process.execPath,['dist/server.js'],{env:process.env,stdio:['ignore','pipe','pipe']});
const db=new pg.Client({connectionString:database});
let errors='',checks=0;
main.stderr.on('data',d=>errors+=String(d).slice(0,1300));
async function req(method,url,token=null,body){
 const r=await fetch(host+url,{method,headers:{
  'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},
  ...(body===undefined?{}:{body:JSON.stringify(body)})});
 const text=await r.text();let value;try{value=JSON.parse(text);}catch{value=text;}
 return {status:r.status,data:value};
}
function check(res,expected,label){
 assert.equal(res.status,expected,label+': '+JSON.stringify(res.data));
 checks++;return res.data;
}
const get=(path,t)=>req('GET',path,t);
const post=(path,t,b)=>req('POST',path,t,b);
async function user(role,name,email){
 return check(await post('/api/auth/register',null,{role,name,email,password}),201,'Register '+name);
}
async function activate(pro,category,service){
 await db.query("UPDATE professional_profiles SET verification_status='approved',available=true WHERE user_id=$1",[pro.user.id]);
 await db.query('INSERT INTO professional_specialties(professional_id,specialty_id) VALUES($1,$2)',[pro.user.id,category.id]);
 await db.query('INSERT INTO professional_services(professional_id,specialty_id,service_id) VALUES($1,$2,$3)',[pro.user.id,category.id,service.id]);
 await db.query("INSERT INTO lab_service_declarations(professional_id,service_id,status) VALUES($1,$2,'approved')",[pro.user.id,service.id]);
}
const absent=(obj,needle,label)=>{
 assert.ok(!JSON.stringify(obj).includes(needle),label+' must not expose the private address');
 checks++;
};
try {
 await db.connect();
 assert.equal((await db.query('SELECT current_database() name')).rows[0].name,
 'mantenimiento_360_db_pruebas_20261012');checks++;
 let ready=false;
 for(let i=0;i<110;i++){
  if(main.exitCode!==null)throw Error('Test server exited: '+errors);
  try{if((await fetch(host+'/health')).ok){ready=true;break;}}catch{}
  await delay(130);
 }
 assert.ok(ready,'CI API healthy');checks++;
 const owner=await user('client','Cliente Domicilio Privado','address-client@test.invalid');
 const stranger=await user('client','Cliente Ajeno Privado','address-stranger@test.invalid');
 const p1=await user('professional','Profesional No Seleccionado','address-pro1@test.invalid');
 const p2=await user('professional','Profesional Contratado','address-pro2@test.invalid');
 const pending=await user('professional','Aspirante Sin Aprobar','address-pending@test.invalid');
 const admin=check(await post('/api/auth/login',null,{
  email:'administracion-lab360@test.invalid',password:'Admin-Only-Test-2026-Password!'
 }),200,'General admin login');
 check(await post('/api/lab-documents/staff',admin.token,{
  name:'Revisor Domicilios Sin Acceso',email:'address-reviewer@test.invalid',password
 }),201,'Create documentary reviewer');
 const reviewer=check(await post('/api/auth/login',null,{
  email:'address-reviewer@test.invalid',password
 }),200,'Reviewer login');
 const [category]=(await db.query("INSERT INTO specialties(name) VALUES('Direcciones Privadas CI') RETURNING id")).rows;
 const [service]=(await db.query("INSERT INTO specialty_services(specialty_id,name) VALUES($1,'Reparacion direccion ficticia') RETURNING id",[category.id])).rows;
 await activate(p1,category,service);
 await activate(p2,category,service);
 const address='Calle Inventada 987, piso 5, departamento B - PRIVADO';
 const base={specialtyId:Number(category.id),serviceId:Number(service.id),
   description:'Revisión ficticia de instalación',locality:'San Isidro'};
 check(await post('/api/jobs',owner.token,base),400,'Address required for new job');
 check(await post('/api/jobs',owner.token,{...base,exactAddress:'x'}),400,
   'Reject too short address');
 check(await post('/api/jobs',owner.token,{...base,exactAddress:'X'.repeat(241)}),400,
   'Reject too long address');
 check(await post('/api/jobs',owner.token,{...base,exactAddress:address,clientId:stranger.user.id}),400,
   'Never accept client identity override');
 const created=check(await post('/api/jobs',owner.token,{...base,exactAddress:address}),201,
   'Create request storing exact address privately');
 absent(created,address,'Creation response');
 const path='/api/jobs/'+created.id;
 const addr=path+'/private-address';
 const [row]=(await db.query('SELECT exact_address FROM jobs WHERE id=$1',[created.id])).rows;
 assert.equal(row.exact_address,address);checks++;
 const own=check(await get(addr,owner.token),200,'Client can see their own address');
 assert.equal(own.exactAddress,address);checks++;
 check(await get(addr,null),401,'No unauthenticated access');
 check(await get(addr,p1.token),404,'Professional cannot see address before contract');
 check(await get(addr,p2.token),404,'Another professional cannot see address before contract');
 check(await get(addr,pending.token),403,'Unverified professional cannot see address');
 check(await get(addr,stranger.token),404,'Unrelated client cannot see address');
 check(await get(addr,admin.token),403,'General admin has no silent address access');
 check(await get(addr,reviewer.token),403,'Document reviewer denied private address');
 absent(check(await get('/api/jobs',p1.token),200,'Open feed first pro'),address,'Open pro feed');
 absent(check(await get('/api/jobs',p2.token),200,'Open feed second pro'),address,'Open pro feed');
 absent(check(await get('/api/jobs',owner.token),200,'Client summary'),address,'Client list');
 absent(check(await get('/api/jobs',admin.token),200,'Admin summary'),address,'Admin list');
 absent(check(await get(path,owner.token),200,'Client general job detail'),address,'Client detail');
 absent(check(await get(path,admin.token),200,'Admin job detail'),address,'Admin detail');

 const q1=check(await post(path+'/quotes',p1.token,{amount:52000,
  description:'Reparación ficticia uno',warrantyDays:30}),201,'First quote');
 const q2=check(await post(path+'/quotes',p2.token,{amount:54000,
  description:'Reparación ficticia dos',warrantyDays:30}),201,'Second quote');
 absent(check(await get(path+'/quotes',owner.token),200,'Owner views quotes'),address,'Quotes');
 check(await get(addr,p1.token),404,'Offer submission does not release address');
 check(await get(addr,p2.token),404,'Other offer still blocked');
 const selection=check(await post(path+'/accept-quote',owner.token,{quoteId:Number(q2.id)}),200,
  'Owner selects one professional');
 assert.equal(selection.paymentProcessed,false);checks++;
 const chosen=check(await get(addr,p2.token),200,'Only hired professional sees address');
 assert.equal(chosen.exactAddress,address);checks++;
 check(await get(addr,p1.token),404,'Rejected professional cannot see address');
 check(await get(addr,stranger.token),404,'Unrelated client stays blocked');
 check(await get(addr,admin.token),403,'Admin still denied after hiring');
 absent(check(await get('/api/jobs/mine',p2.token),200,'Hired pro contracts list'),address,
  'Contract list');
 absent(check(await get(path,p2.token),200,'Hired pro general details'),address,
  'Public detail remains private');
 await post(path+'/start',p2.token).then(r=>check(r,200,'Job starts'));
 assert.equal(check(await get(addr,p2.token),200,'Address during work').exactAddress,address);checks++;
 await post(path+'/report-completed',p2.token).then(r=>check(r,200,'Professional reports completion'));
 assert.equal(check(await get(addr,p2.token),200,'Address remains available in own contract').exactAddress,address);checks++;
 const otherOwner=check(await get(addr,owner.token),200,'Client keeps access to own address');
 assert.equal(otherOwner.exactAddress,address);checks++;

 // An accepted technical visit is a *separate* selected engagement;
 // it grants only that visitor the address while the visit is active.
 const visitAddress='Pasaje Imaginario 456, local 7 - SOLO VISITA';
 const visitJob=check(await post('/api/jobs',owner.token,{
  ...base,description:'Diagnóstico técnico ficticio',exactAddress:visitAddress
 }),201,'Second request for diagnostic visit');
 const vUrl='/api/jobs/'+visitJob.id;
 const offer=check(await post(vUrl+'/visits',p1.token,{
  amount:12000,description:'Visita técnica de diagnóstico ficticia'
 }),201,'First professional offers technical visit');
 check(await post(vUrl+'/visits',p2.token,{
  amount:14000,description:'Otra visita técnica no seleccionada'
 }),201,'Second professional also offers visit');
 check(await get(vUrl+'/private-address',p1.token),404,'No address before accepted visit');
 const hiredVisit=check(await post(vUrl+'/visits/'+offer.id+'/accept',owner.token),
  200,'Client accepts first technical visit only');
 assert.equal(hiredVisit.status,'visit_accepted');checks++;
 assert.equal(check(await get(vUrl+'/private-address',p1.token),200,
  'Selected technician can reach visit location').exactAddress,visitAddress);checks++;
 check(await get(vUrl+'/private-address',p2.token),404,'Other visiting offer denied');
 check(await get(vUrl+'/private-address',admin.token),403,'No admin silent visit address access');
 absent(check(await get('/api/jobs/mine',p2.token),200,'Unselected contract list'),visitAddress,
  'Other pro contract list');

 console.log('OK: '+checks+' pruebas de dirección privada, seguridad de acceso y visita contratada');
}finally{
 main.kill('SIGTERM');
 await db.end().catch(()=>undefined);
}
