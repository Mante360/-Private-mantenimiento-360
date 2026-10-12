import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as pause } from 'node:timers/promises';
import pg from 'pg';

const rootDatabase = process.env.DATABASE_URL;
if (!rootDatabase) throw new Error('Fixture DATABASE_URL required');
const tempName='mantenimiento_360_db_pruebas_20261012';
const tempUrl=new URL(rootDatabase);
tempUrl.pathname='/'+tempName;
const connectionString=tempUrl.toString();
const root=new pg.Client({ connectionString:rootDatabase });
await root.connect();
try {
  await root.query('CREATE DATABASE '+tempName);
} finally {
  await root.end();
}

let checks=0;
async function spawnApi(databaseUrl,expectAvailable=true) {
  const env={
    ...process.env,DATABASE_URL:databaseUrl,
    TEST_SCHEMA_SETUP:'INSTALL_TEST_SCHEMA_20261012',
    PORT:'45679',
  };
  const proc=spawn(process.execPath,['dist/server.js'],{env,stdio:['ignore','pipe','pipe']});
  let errors='';
  proc.stderr.on('data',chunk=>{errors+=String(chunk);});
  try {
    if (!expectAvailable) {
      for(let attempt=0;attempt<80 && proc.exitCode===null;attempt++)await pause(120);
      assert.notEqual(proc.exitCode,null,'Guarded boot must refuse another database');
      assert.match(errors,/Refusing schema installation on any non-test database/);
      checks+=2;
      return;
    }
    let ready=false;
    for (let i=0;i<100;i++){
      if(proc.exitCode!==null)throw new Error('Unexpected process exit: '+errors);
      try {
        if ((await fetch('http://127.0.0.1:45679/health')).ok){ready=true;break;}
      }catch{}
      await pause(120);
    }
    assert.ok(ready,'Bootstrapped API must be healthy');checks++;
  }finally {
    proc.kill('SIGTERM');
    for(let i=0;i<50 && proc.exitCode===null;i++)await pause(25);
  }
}

await spawnApi(connectionString);
const testClient=new pg.Client({ connectionString });
await testClient.connect();
try {
  let result=await testClient.query(
    "SELECT count(*)::integer AS n FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'");
  assert.equal(result.rows[0].n,21);checks++;
  await testClient.query("INSERT INTO specialties(name) VALUES('Categoria conservada')");checks++;
}finally{
  await testClient.end();
}

await spawnApi(connectionString);
const verifyClient=new pg.Client({connectionString});
await verifyClient.connect();
try{
  const r=await verifyClient.query("SELECT count(*)::integer AS n FROM specialties WHERE name='Categoria conservada'");
  assert.equal(r.rows[0].n,1,'A second start must preserve existing records');checks++;
}finally{
  await verifyClient.end();
}

await spawnApi(rootDatabase,false);
console.log('OK: '+checks+' controles de instalación única, preservación y protección de otras bases');
