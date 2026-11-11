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
  // The explicit fixture IDs must also advance the users sequence: later API
  // integration tests create new users in this same disposable CI database.
  await conn.query("SELECT setval(pg_get_serial_sequence('users','id'), (SELECT MAX(id) FROM users))");
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
  // Reviewer ID 8 is a fixture in a disposable CI database, not the Render lab.
  const reviewerOld='Old-Reviewer-Testing-2026!';
  const reviewerNew='New-Reviewer-Testing-2026!';
  const reviewerHash=await argon2.hash(reviewerOld,{type:argon2.argon2id});
  const [labAdmin]= (await conn.query(
    "SELECT id FROM users WHERE email='administracion-lab360@test.invalid'")).rows;
  await conn.query(
    "INSERT INTO users(id,name,email,password_hash,role,status) "+
    "VALUES(8,'Revisor-1 Laboratorio 360','revisor1@test.invalid',$1,'subadmin','active')",
    [reviewerHash]
  );
  await conn.query("INSERT INTO lab_staff_permissions(user_id,document_review,created_by) VALUES(8,true,$1)",[labAdmin.id]);
  await conn.query("SELECT setval(pg_get_serial_sequence('users','id'), (SELECT MAX(id) FROM users))");

  const reviewerEndpoint='/api/lab-documents/staff/8/reset-test-password';
  const reviewerValid={adminPassword,newPassword:reviewerNew};
  check(await request('POST',reviewerEndpoint,null,reviewerValid),401,
    'Reviewer reset requires admin authentication');
  check(await request('POST',reviewerEndpoint,professional.token,reviewerValid),403,
    'Professional cannot reset reviewer password');
  check(await request('POST',reviewerEndpoint,admin.token,{
    adminPassword:'Incorrect-Admin-Test-Password!',newPassword:reviewerNew
  }),403,'Current admin password required for reviewer recovery');
  check(await request('POST',reviewerEndpoint,admin.token,{
    adminPassword,newPassword:'too-short'
  }),400,'Reviewer recovery requires strong new password');
  const reviewerReset=check(await request('POST',reviewerEndpoint,admin.token,reviewerValid),
    200,'General admin changes original reviewer password');
  assert.equal(reviewerReset.reviewerId,'8');checks++;
  assert.equal(reviewerReset.permission,'document_review');checks++;
  check(await request('POST','/api/auth/login',null,{
    email:'revisor1@test.invalid',password:reviewerOld
  }),401,'Old reviewer password rejected after recovery');
  const reviewerLogin=check(await request('POST','/api/auth/login',null,{
    email:'revisor1@test.invalid',password:reviewerNew
  }),200,'Reviewer can log in with new password');
  assert.equal(reviewerLogin.user.role,'subadmin');checks++;
  const reviewerState=(await conn.query(
    "SELECT u.role,u.status,p.document_review FROM users u "+
    "JOIN lab_staff_permissions p ON p.user_id=u.id WHERE u.id=8")).rows[0];
  assert.equal(reviewerState.role,'subadmin');checks++;
  assert.equal(reviewerState.status,'active');checks++;
  assert.equal(reviewerState.document_review,true);checks++;
  const reviewerAudits=(await conn.query(
    "SELECT count(*)::integer AS n FROM audit_events "+
    "WHERE resource_id='8' AND action='lab_subadmin_password_reset'"
  )).rows[0];
  assert.equal(reviewerAudits.n,1);checks++;
  check(await request('POST',reviewerEndpoint,admin.token,reviewerValid),400,
    'Reviewer password cannot be reset to the same value');

  console.log('OK: '+checks+' controles de recuperación segura de contraseñas del profesional y del revisor documental');
} finally {
  server?.kill('SIGTERM');
  await conn.end();
}
