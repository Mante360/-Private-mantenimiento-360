import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {setTimeout as pause} from 'node:timers/promises';
import pg from 'pg';

const host='http://127.0.0.1:45678';
const database=new pg.Client({connectionString:process.env.DATABASE_URL});
const api=spawn(process.execPath,['dist/server.js'],{env:process.env,stdio:['ignore','pipe','pipe']});
let stderr='';
api.stderr.on('data',data=>{stderr+=String(data).slice(0,1000);});
const password='Fixture-Profession-Requests-2026!';
let checks=0;
const request=async(method,path,token=null,data)=>{
  const response=await fetch(host+path,{
    method,headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},
    ...(data===undefined?{}:{body:JSON.stringify(data)})
  });
  const result=await response.json().catch(()=>({}));
  return {status:response.status,data:result};
};
const check=(result,status,label)=>{
  assert.equal(result.status,status,label+': '+JSON.stringify(result.data));
  checks++;return result.data;
};

try{
  await database.connect();
  let ready=false;
  for(let i=0;i<100;i++){
    if(api.exitCode!==null)throw Error('API stopped: '+stderr);
    try{if((await fetch(host+'/health')).ok){ready=true;break;}}catch{}
    await pause(120);
  }
  assert.ok(ready,'Isolated fixture server must start');checks++;
  const admin=check(await request('POST','/api/auth/login',null,{
    email:'administracion-lab360@test.invalid',password:'Admin-Only-Test-2026-Password!'
  }),200,'Lab admin login');
  const pro=check(await request('POST','/api/auth/register',null,{
    name:'Profesional Solicitudes',email:'oficio-pro@test.invalid',role:'professional',password
  }),201,'Professional account');
  const outsider=check(await request('POST','/api/auth/register',null,{
    name:'Otro Profesional',email:'oficio-other@test.invalid',role:'professional',password
  }),201,'Second professional');
  const client=check(await request('POST','/api/auth/register',null,{
    name:'Cliente Solicitudes',email:'oficio-client@test.invalid',role:'client',password
  }),201,'Client');

  const catalog=check(await request('GET','/api/catalog/professions'),200,'Catalog');
  assert.ok(catalog.some(p=>p.title==='Peluquero Canino'));checks++;
  assert.ok(!catalog.some(p=>p.title==='Peluquero'));checks++;

  check(await request('POST','/api/lab-profession-requests/mine',client.token,{name:'Peluquero'}),403,
    'Client must not propose professional occupation');
  check(await request('POST','/api/lab-profession-requests/mine',null,{name:'Peluquero'}),401,
    'Anonymous requests denied');
  check(await request('POST','/api/lab-profession-requests/mine',pro.token,{name:' a '}),400,
    'Invalid name denied');
  const proposed=check(await request('POST','/api/lab-profession-requests/mine',pro.token,{name:'Peluquero'}),201,
    'Professional proposes human hairdresser despite dog groomer match');
  assert.equal(proposed.request.status,'pending');checks++;
  const duplicate=check(await request('POST','/api/lab-profession-requests/mine',pro.token,{name:'peluquero'}),200,
    'Repeated proposal is idempotent');
  assert.equal(duplicate.request.id,proposed.request.id);checks++;
  assert.equal(duplicate.alreadyPending,true);checks++;

  const own=check(await request('GET','/api/lab-profession-requests/mine',pro.token),200,
    'Professional reads own proposals');
  assert.ok(own.items.some(x=>x.id===proposed.request.id));checks++;
  const privateList=check(await request('GET','/api/lab-profession-requests/mine',outsider.token),200,
    'Professional cannot read other professional proposals');
  assert.equal(privateList.items.length,0);checks++;

  check(await request('GET','/api/lab-profession-requests/pending',pro.token),403,
    'Professional forbidden from admin inbox');
  check(await request('GET','/api/lab-profession-requests/pending',client.token),403,
    'Client forbidden from admin inbox');
  const pending=check(await request('GET','/api/lab-profession-requests/pending',admin.token),200,
    'Admin inbox receives proposed occupation');
  assert.ok(pending.items.some(x=>x.id===proposed.request.id));checks++;
  check(await request('POST','/api/lab-profession-requests/'+proposed.request.id+'/decision',
    pro.token,{decision:'approved'}),403,'Professional cannot approve own proposal');

  const accepted=check(await request('POST','/api/lab-profession-requests/'+proposed.request.id+'/decision',
    admin.token,{decision:'approved'}),200,'Admin explicitly adds profession');
  assert.equal(accepted.status,'approved');checks++;
  assert.ok(accepted.specialtyId);checks++;
  check(await request('POST','/api/lab-profession-requests/'+proposed.request.id+'/decision',
    admin.token,{decision:'approved'}),409,'Admin cannot review same request twice');
  const afterCatalog=check(await request('GET','/api/catalog/professions'),200,
    'Approved profession displayed in catalog');
  assert.ok(afterCatalog.some(p=>p.title==='Peluquero'));checks++;
  check(await request('POST','/api/lab-profession-requests/mine',pro.token,{name:'Peluquero'}),409,
    'Existing occupation cannot be requested again');
  const rights=await database.query(
    `SELECT pp.verification_status,COUNT(DISTINCT ps.specialty_id)::int AS specialties,
            COUNT(DISTINCT pts.service_id)::int AS services
     FROM professional_profiles pp
     LEFT JOIN professional_specialties ps ON ps.professional_id=pp.user_id
     LEFT JOIN professional_services pts ON pts.professional_id=pp.user_id
     WHERE pp.user_id=$1 GROUP BY pp.user_id,pp.verification_status`,[pro.user.id]
  );
  assert.equal(rights.rows[0].verification_status,'pending');
  assert.equal(rights.rows[0].specialties,0);
  assert.equal(rights.rows[0].services,0);
  checks+=3;

  const rejected=check(await request('POST','/api/lab-profession-requests/mine',
    outsider.token,{name:'Oficio Ficticio Extra'}),201,'Second proposed occupation');
  check(await request('POST','/api/lab-profession-requests/'+rejected.request.id+'/decision',
    admin.token,{decision:'rejected'}),200,'Admin declines occupation');
  const denied=check(await request('GET','/api/lab-profession-requests/mine',outsider.token),200,
    'Declined state visible only to requester');
  assert.equal(denied.items.find(x=>x.id===rejected.request.id)?.status,'rejected');checks++;
  const empty=check(await request('GET','/api/lab-profession-requests/pending',admin.token),200,
    'Admin inbox empty after decisions');
  assert.ok(!empty.items.some(x=>[rejected.request.id,proposed.request.id].includes(x.id)));checks++;
  const audit=await database.query(
    `SELECT action,count(*)::int AS count FROM audit_events
     WHERE resource_type='lab_profession_request' GROUP BY action`
  );
  assert.equal(audit.rows.find(x=>x.action==='lab_profession_requested')?.count,2);checks++;
  assert.equal(audit.rows.find(x=>x.action==='lab_profession_request_reviewed')?.count,2);checks++;

  console.log('OK: '+checks+' controles del circuito de nuevas profesiones y permisos');
}finally{
  api.kill('SIGTERM');
  await database.end().catch(()=>undefined);
}
