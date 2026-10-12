import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as pause } from 'node:timers/promises';
import pg from 'pg';
import argon2 from 'argon2';

const url=new URL(process.env.DATABASE_URL);
url.pathname='/mantenimiento_360_db_pruebas_20261012';
const conn=new pg.Client({connectionString:url.toString()});
const adminPassword='Admin-Only-Test-2026-Password!';
const oldPassword='Old-Professional-Testing-2026!';
const newPassword='New-Professional-Testing-2026!';
const base='http://127.0.0.1:45679';
let checks=0;
let server;
let stderr='';
const request=async(method,path,token=null,body)=>{
  const r=await fetch(base+path,{
    method,headers:{
      'content-type':'application/json',
      ...(token?{authorization:'Bearer '+token}:{})
    },...(body?{body:JSON.stringify(body)}:{})
  });
  let parsed;
  try{parsed=await r.json();}catch{parsed={};}
  return {status:r.status,data:parsed};
};
const check=(r,status,label)=>{
  assert.equal(r.status,status,label+' '+JSON.stringify(r.data));
  checks++;return r.data;
};

await conn.connect();
try {
  const existing=await conn.query("SELECT id,role FROM users ORDER BY id");
  assert.equal(existing.rows.length,1,'Expected a fresh lab admin from the bootstrap');
  assert.equal(existing.rows[0].role,'admin');
  checks+=2;
  const hash=await argon2.hash(oldPassword,{type:argon2.argon2id});
  // Explicit ids 2, 3 and 4 are fake CI fixtures; never modify Render data.
  await conn.query(
    "INSERT INTO users(id,name,email,password_hash,role) VALUES " +
    "(2,'Fixture Cliente Uno','fixture-client-a@test.invalid',$1,'client')," +
    "(3,'Fixture Cliente Dos','fixture-client-b@test.invalid',$1,'client')," +
    "(4,'Sebastián Salva','profesional360@test.invalid',$1,'professional')",
    [hash]
  );
  await conn.query(
    "INSERT INTO professional_profiles(user_id,verification_status,available) VALUES(4,'approved',true)"
  );
  const adminTokenQuery=await conn.query(
    "SELECT email FROM users WHERE role='admin' LIMIT 1"
  );
  assert.equal(adminTokenQuery.rows[0].email,'administracion-lab360@test.invalid');
  checks++;
  server=spawn(process.execPath,['dist/server.js'],{
    env:{
      ...process.env,PORT:'45679',DATABASE_URL:url.toString(),
      TEST_SCHEMA_SETUP:'off',LAB_ADMIN_SETUP_PASSWORD:''
    },stdio:['ignore','pipe','pipe']
  });
  server.stderr.on('data',chunk=>{stderr+=String(chunk).slice(0,1000);});
  let ready=false;
  for(let n=0;n<100;n++){
    if(server.exitCode!==null)throw new Error('API stopped: '+stderr);
    try{if((await fetch(base+'/health')).ok){ready=true;break;}}catch{}
    await pause(120);
  }
  assert.ok(ready,'API running on isolated test database');checks++;

  const admin=check(await request('POST','/api/auth/login',null,{
    email:'administracion-lab360@test.invalid',password:adminPassword
  }),200,'Admin login');
  const professional=check(await request('POST','/api/auth/login',null,{
    email:'profesional360@test.invalid',password:oldPassword
  }),200,'Professional login');

  const endpoint='/api/admin/professionals/4/reset-test-password';
  const valid={adminPassword,newPassword};
  check(await request('POST',endpoint,null,valid),401,'Unauthenticated reset rejected');
  check(await request('POST',endpoint,professional.token,valid),403,'Professional cannot reset own password');
  check(await request('POST',endpoint,admin.token,{
    adminPassword:'invalid-admin-password',newPassword
  }),403,'Wrong admin password rejected');
  check(await request('POST',endpoint,admin.token,{
    adminPassword,newPassword:'123'
  }),400,'Short new password rejected');
  const done=check(await request('POST',endpoint,admin.token,valid),200,'Admin password reset');
  assert.equal(done.professionalId,4);checks++;
  assert.equal(done.verificationStatus,'approved');checks++;
  assert.equal(done.email,'profesional360@test.invalid');checks++;
  check(await request('POST','/api/auth/login',null,{
    email:'profesional360@test.invalid',password:oldPassword
  }),401,'Old password rejected');
  check(await request('POST','/api/auth/login',null,{
    email:'profesional360@test.invalid',password:newPassword
  }),200,'New professional password works');
  check(await request('POST',endpoint,admin.token,valid),400,
    'Reject resetting to same password');

  const pro=await conn.query("SELECT p.verification_status,p.available,u.password_hash "+
    "FROM professional_profiles p JOIN users u ON u.id=p.user_id WHERE p.user_id=4");
  assert.equal(pro.rows[0].verification_status,'approved');checks++;
  assert.equal(pro.rows[0].available,true);checks++;
  assert.ok(await argon2.verify(pro.rows[0].password_hash,newPassword));checks++;
  const audits=await conn.query(
    "SELECT count(*)::integer AS n FROM audit_events WHERE resource_id='4' AND action='lab_professional_password_reset'"
  );
  assert.equal(audits.rows[0].n,1);checks++;
  console.log('OK: '+checks+' controles de cambio seguro de contraseña del profesional ID 4');
} finally {
  server?.kill('SIGTERM');
  await conn.end();
}
