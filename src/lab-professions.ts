// Catálogo de oficios propuesto para el laboratorio de MANTENIMIENTO 360°.
// La selección de un oficio NO certifica matrícula ni habilita al profesional.
import { pool } from './db.js';

const EXPECTED_DATABASE='mantenimiento_360_db_pruebas_20261012';

type Profession={
  key:string;
  title:string;
  existingNames:string[];
  category:string;
  description:string;
  aliases:string[];
  credentialNote:string|null;
};
const REQUIRED_REGISTRATION_NOTE='La selección del oficio no acredita matrícula ni habilitación. Administración deberá verificar la documentación cuando corresponda.';
export const LAB_PROFESSIONS:readonly Profession[]=[
  {key:'refrigeracion',title:'Técnico en Refrigeración',existingNames:['Refrigeración','Técnico en Refrigeración','Refrigeracion'],category:'Instalaciones y mantenimiento',description:'Instalación, reparación y mantenimiento de aires acondicionados, heladeras y equipos de refrigeración.',aliases:['refrigeracion','refrigeracion comercial','aire acondicionado','aires acondicionados','heladeras','frigorista','tecnico frigorista'],credentialNote:null},
  {key:'electricista',title:'Electricista',existingNames:['Electricidad','Electricista'],category:'Instalaciones y mantenimiento',description:'Instalaciones, tableros, reparaciones eléctricas y trabajos habilitados según su acreditación.',aliases:['electricidad','instalador electrico','electricista matriculado','tableros electricos','cableado'],credentialNote:REQUIRED_REGISTRATION_NOTE},
  {key:'gasista',title:'Gasista',existingNames:['Gasista','Gas'],category:'Instalaciones y mantenimiento',description:'Instalaciones, reparación y revisión de gas y artefactos según habilitación correspondiente.',aliases:['gas','gasista matriculado','instalaciones de gas','artefactos de gas'],credentialNote:REQUIRED_REGISTRATION_NOTE},
  {key:'plomero',title:'Plomero',existingNames:['Plomería','Plomeria','Plomero','Sanitaria'],category:'Instalaciones y mantenimiento',description:'Instalaciones y reparaciones de agua, desagües y sanitarios.',aliases:['plomeria','sanitarista','sanitario','fontanero','cañerias','desagues'],credentialNote:null},
  {key:'albanil',title:'Albañil',existingNames:['Albañilería','Albañil','Albanileria'],category:'Construcción y refacciones',description:'Construcción, refacciones, mampostería y reparaciones de obra.',aliases:['albanileria','mamposteria','obra','refacciones','construccion'],credentialNote:null},
  {key:'pintor',title:'Pintor de Obra',existingNames:['Pintura','Pintor de Obra','Pintor'],category:'Construcción y refacciones',description:'Pintura de interiores, exteriores, frentes y revestimientos.',aliases:['pintura','pintor','pintura de casas','frentes','revestimientos'],credentialNote:null},
  {key:'durlquero',title:'Durlquero',existingNames:['Durlquero','Construcción en seco','Construccion en seco','Durlock'],category:'Construcción y refacciones',description:'Construcción en seco, tabiques, cielorrasos y placas de yeso.',aliases:['durlock','placas de yeso','yesero','construccion en seco','cielorrasos'],credentialNote:null},
  {key:'carpintero',title:'Carpintero',existingNames:['Carpintería','Carpinteria','Carpintero'],category:'Construcción y refacciones',description:'Fabricación, reparación y mantenimiento de muebles y trabajos en madera.',aliases:['carpinteria','muebles','madera','reparacion de muebles'],credentialNote:null},
  {key:'herrero',title:'Herrero',existingNames:['Herrería','Herreria','Herrero'],category:'Construcción y refacciones',description:'Trabajos en metal, rejas, portones, soldadura y estructuras.',aliases:['herreria','soldador','metalurgica','rejas','portones'],credentialNote:null},
  {key:'mecanico',title:'Mecánico',existingNames:['Mecánica','Mecanica','Mecánico'],category:'Automotores',description:'Diagnóstico y reparación de automóviles y motocicletas.',aliases:['mecanica','automotor','autos','motocicletas','motos','taller mecanico'],credentialNote:null},
  {key:'informatica',title:'Técnico Informático',existingNames:['Informática','Informatica','Técnico Informático','Computación'],category:'Tecnología',description:'Reparación de computadoras, redes y soporte informático.',aliases:['tecnico informatico','computadoras','pc','notebooks','redes','soporte tecnico','computacion'],credentialNote:null},
  {key:'celulares',title:'Técnico de Celulares',existingNames:['Técnico de Celulares','Reparación de Celulares','Telefonía Celular'],category:'Tecnología',description:'Reparación de teléfonos, módulos de pantalla, conectores y microelectrónica.',aliases:['celulares','telefonos','smartphones','reparacion de celulares','microelectronica','pantallas'],credentialNote:null},
  {key:'fumigador',title:'Fumigador',existingNames:['Fumigación','Fumigacion','Fumigador','Control de Plagas'],category:'Control de plagas',description:'Control de plagas en hogares y comercios, sujeto a habilitaciones aplicables.',aliases:['fumigacion','control de plagas','desinsectacion','roedores','desratizacion'],credentialNote:REQUIRED_REGISTRATION_NOTE},
  {key:'techista',title:'Techista',existingNames:['Techos','Techista','Reparación de Techos'],category:'Construcción y refacciones',description:'Reparación de techos, filtraciones, cubiertas y membranas.',aliases:['techos','filtraciones','goteras','membranas','cubiertas'],credentialNote:null},
  {key:'piletero',title:'Piletero',existingNames:['Piletas','Piletero','Piscinas','Mantenimiento de Piscinas'],category:'Instalaciones y mantenimiento',description:'Mantenimiento de piscinas, limpieza, filtrado y control químico.',aliases:['piletas','piscinas','mantenimiento de piletas','limpieza de piscinas','agua de piscina'],credentialNote:null},
  {key:'cerrajero',title:'Cerrajero',existingNames:['Cerrajería','Cerrajeria','Cerrajero'],category:'Instalaciones y mantenimiento',description:'Cerrajería, aperturas autorizadas, reparación de cerraduras y copias de llaves.',aliases:['cerrajeria','llaves','cerraduras','apertura de puertas'],credentialNote:null},
  {key:'jardinero',title:'Jardinero',existingNames:['Jardinería','Jardineria','Jardinero','Espacios verdes'],category:'Jardines y exteriores',description:'Mantenimiento de jardines, podas, césped y paisajismo.',aliases:['jardineria','espacios verdes','paisajismo','podas','parquero','cortar pasto'],credentialNote:null},
  {key:'peluqueria-canina',title:'Peluquero Canino',existingNames:['Peluquero Canino','Peluquería Canina'],category:'Servicios para mascotas',description:'Baño, corte y estética de perros.',aliases:['peluqueria canina','estetica canina','baño de perros','baño canino','grooming'],credentialNote:null},
  {key:'adiestramiento-canino',title:'Adiestrador Canino',existingNames:['Adiestrador Canino','Adiestramiento Canino'],category:'Servicios para mascotas',description:'Educación, obediencia y entrenamiento de perros.',aliases:['adiestramiento canino','educador canino','entrenador de perros','conducta canina'],credentialNote:null},
  {key:'paseador-perros',title:'Paseador de Perros',existingNames:['Paseador de Perros','Paseo de Perros'],category:'Servicios para mascotas',description:'Paseos y recreación de perros.',aliases:['paseo de perros','paseador','dog walker','paseos caninos'],credentialNote:null}
];

function normalized(value:string):string{
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .toLocaleLowerCase('es-AR').replace(/\s+/g,' ').trim();
}

// No deletes or renames: existing IDs remain linked to jobs and professionals.
// All changes are additive and confined to the named laboratory PostgreSQL DB.
export async function ensureLabProfessionCatalog():Promise<void>{
  const db=await pool.connect();
  let transaction=false;
  try{
    await db.query('BEGIN');transaction=true;
    const current=await db.query('SELECT current_database() AS name');
    if(current.rows[0]?.name!==EXPECTED_DATABASE)throw new Error('Professions catalog is lab-only');
    await db.query('SELECT pg_advisory_xact_lock($1::bigint)',[36020261023]);
    await db.query(`CREATE TABLE IF NOT EXISTS lab_profession_catalog(
      profession_key VARCHAR(80) PRIMARY KEY,
      specialty_id BIGINT NOT NULL UNIQUE REFERENCES specialties(id) ON DELETE RESTRICT,
      title VARCHAR(100) NOT NULL,
      category VARCHAR(80) NOT NULL,
      description TEXT NOT NULL,
      aliases TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
      credential_note TEXT
    )`);
    const present=await db.query('SELECT id,name,active FROM specialties ORDER BY id');
    const existing=present.rows as {id:string;name:string;active:boolean}[];
    let newlyCreated=0;
    for(const profession of LAB_PROFESSIONS){
      const targets=new Set(profession.existingNames.map(normalized));
      const match=existing.find(s=>targets.has(normalized(s.name)));
      let specialtyId:string;
      if(match){
        specialtyId=match.id;
        if(!match.active)await db.query('UPDATE specialties SET active=true WHERE id=$1',[specialtyId]);
      }else{
        const inserted=await db.query(
          `INSERT INTO specialties(name,active) VALUES($1,true)
           ON CONFLICT(name) DO UPDATE SET active=true RETURNING id`,
          [profession.title]
        );
        specialtyId=String(inserted.rows[0].id);
        existing.push({id:specialtyId,name:profession.title,active:true});
        newlyCreated++;
      }
      await db.query(
        `INSERT INTO lab_profession_catalog
          (profession_key,specialty_id,title,category,description,aliases,credential_note)
         VALUES($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT(profession_key) DO UPDATE
           SET title=EXCLUDED.title,category=EXCLUDED.category,
             description=EXCLUDED.description,aliases=EXCLUDED.aliases,
             credential_note=EXCLUDED.credential_note`,
        [profession.key,specialtyId,profession.title,profession.category,
         profession.description,profession.aliases,profession.credentialNote]
      );
    }
    await db.query('COMMIT');transaction=false;
    console.log('Laboratory professions catalog ready:',LAB_PROFESSIONS.length,
      'professions; new specialties:',newlyCreated);
  }catch(error){
    if(transaction)await db.query('ROLLBACK').catch(()=>undefined);
    throw error;
  }finally{db.release();}
}
