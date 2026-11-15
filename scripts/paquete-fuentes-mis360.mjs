/**
 * MIS 360 — Prepare a registration source snapshot from an existing
 * Git commit, without touching production or downloading live data.
 * Usage: node scripts/paquete-fuentes-mis360.mjs
 *
 * Intentional allowlist. Never archive the .git directory, .env,
 * real data, logs, GitHub Actions artifacts, node_modules or users' files.
 */
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {
  copyFileSync, existsSync, lstatSync, mkdirSync,
  readFileSync, readdirSync, rmSync, statSync, utimesSync,
  writeFileSync
} from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const commit=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
if(!/^[0-9a-f]{40}$/.test(commit))throw Error('Invalid Git commit');
const branch=execFileSync('git',['branch','--show-current'],{cwd:root,encoding:'utf8'}).trim();
if(branch!=='desarrollo-base-datos-seguridad-20261011'){
  throw Error('Only the approved development branch may generate this package');
}
const files=execFileSync('git',['ls-files','-z'],{cwd:root}).toString('utf8')
  .split('\0').filter(Boolean).sort();
const rootSourceFiles=new Set([
  'README.md','package.json','tsconfig.json',
  'app.js','auth.ts','auth (1).ts','claims.ts','db.ts',
  'jobs.ts','server.ts','schema.sql','index.html','styles.css'
]);
const allowedFile=f=>
  rootSourceFiles.has(f) ||
  (/^src\/[a-z0-9/_-]+\.ts$/i.test(f)) ||
  (/^database\/[a-z0-9/_-]+\.(?:sql|md)$/i.test(f)) ||
  (/^test-ui\/[a-z0-9/_-]+\.(?:js|css|html)$/i.test(f)) ||
  f==='docs/registro-software-argentina-mis360-2026.md';
const selected=files.filter(allowedFile);
if(selected.length<35)throw Error('Unexpectedly few source files selected');
const forbidden=[
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /(?:ghp_|github_pat_)[A-Za-z0-9_]{20,}/,
  /(?:sk_live_|pk_live_)[A-Za-z0-9]{10,}/,
  /(?:AKIA|ASIA)[A-Z0-9]{16}/
];
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const dirName='MIS360_Mantenimiento_Integral_Service_fuentes_'+commit.slice(0,12);
const output=path.resolve(root,'dist-registro');
const folder=path.join(output,dirName);
if(existsSync(output))rmSync(output,{recursive:true,force:true});
mkdirSync(folder,{recursive:true});
const manifest=[];
const reproducibleTime=new Date('2026-11-15T12:00:00.000Z');
for(const file of selected){
  const full=path.join(root,file);
  const stats=lstatSync(full);
  if(!stats.isFile()||stats.isSymbolicLink())
    throw Error('Reject nonregular file: '+file);
  if(stats.size>3_000_000)throw Error('Unexpectedly large file: '+file);
  const contents=readFileSync(full);
  const asText=contents.toString('utf8');
  if(forbidden.some(regex=>regex.test(asText)))
    throw Error('Potential embedded credential found. Review file manually: '+file);
  const target=path.join(folder,file);
  mkdirSync(path.dirname(target),{recursive:true});
  copyFileSync(full,target);
  utimesSync(target,reproducibleTime,reproducibleTime);
  manifest.push(sha(contents)+'  '+file);
}
const info=[
  'MIS 360 — Mantenimiento Integral Service',
  'Código fuente — corte técnico de desarrollo para preparación de registro',
  '',
  'Nombre anterior del proyecto: MANTENIMIENTO 360°',
  'Repositorio: Mante360/-Private-mantenimiento-360 (PRIVADO)',
  'Rama: '+branch,
  'Git commit SHA: '+commit,
  'Versión declarada en package.json: 0.1.0 (NO es versión comercial definitiva)',
  'Archivos de código/documentación: '+selected.length,
  '',
  'El registro DNDA NO fue presentado por generar este paquete.',
  'No contiene contraseñas reales, base de datos ni documentación de clientes.',
  'El archivo original del logo MIS 360 se incorporará solo cuando se haya',
  'verificado su archivo y su titularidad; el logo no está en este paquete.',
  'La autorización para comercializar y el registro de marca son distintos.',
  ''
].join('\n');
writeFileSync(path.join(folder,'IDENTIFICACION_OBRA.txt'),info,'utf8');
writeFileSync(path.join(folder,'MANIFIESTO_ARCHIVOS_SHA256.txt'),manifest.join('\n')+'\n','utf8');
for(const name of ['IDENTIFICACION_OBRA.txt','MANIFIESTO_ARCHIVOS_SHA256.txt'])
 utimesSync(path.join(folder,name),reproducibleTime,reproducibleTime);
const archive=path.join(output,dirName+'.zip');
execFileSync('zip',['-q','-X','-r','-9',path.basename(archive),dirName],{
  cwd:output,stdio:['ignore','pipe','pipe']
});
const contents=readFileSync(archive);
const digest=sha(contents);
writeFileSync(path.join(output,'HASH_DEL_PAQUETE_SHA256.txt'),
  digest+'  '+path.basename(archive)+'\n','utf8');
console.log('MIS 360 source package ready');
console.log('Commit: '+commit);
console.log('Files: '+selected.length);
console.log('ZIP: '+archive);
console.log('ZIP SHA256: '+digest);
console.log('ZIP bytes: '+contents.length);
