import { Router } from 'express';
import argon2 from 'argon2';
import { z } from 'zod';
import { pool } from '../db.js';
import { requireAuth, requireRole } from '../security.js';

export const adminRouter = Router();
adminRouter.use(requireAuth, requireRole('admin'));

const ADMIN_LAB_DB = 'mantenimiento_360_db_pruebas_20261012';
const isLabDatabase = (name: string) => name === ADMIN_LAB_DB ||
  (process.env.CI === 'true' && name === 'mantenimiento360_test');
const idParam = (input: unknown) => z.coerce.number().int().positive().safeParse(input);
const catalogInput = z.object({
  name: z.string().trim().min(3).max(100),
  services: z.array(z.string().trim().min(3).max(120)).min(1).max(12),
}).strict();
const approvalInput = z.object({ specialtyId: z.number().int().positive() }).strict();

adminRouter.get('/professionals', async (_req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT u.id,u.name,pp.verification_status,pp.available
       FROM users u JOIN professional_profiles pp ON pp.user_id=u.id
       WHERE u.role='professional' AND u.status='active'
       ORDER BY u.id ASC LIMIT 100`
    );
    res.json(result.rows);
  } catch (error) { next(error); }
});

adminRouter.get('/specialties', async (_req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT s.id,s.name,COALESCE(
         json_agg(json_build_object('id',ss.id,'name',ss.name)
           ORDER BY ss.id) FILTER (WHERE ss.id IS NOT NULL),'[]'::json
       ) AS services
       FROM specialties s LEFT JOIN specialty_services ss
         ON ss.specialty_id=s.id AND ss.active=true
       WHERE s.active=true
       GROUP BY s.id,s.name ORDER BY s.name`
    );
    res.json(result.rows);
  } catch (error) { next(error); }
});

// Lab only, admin-only: create category and its tasks.
adminRouter.post('/specialties', async (req, res, next) => {
  const input=catalogInput.safeParse(req.body);
  if(!input.success) { res.status(400).json({error:'invalid_input'}); return; }
  const db=await pool.connect().catch(next);
  if(!db) return;
  try {
    await db.query('BEGIN');
    const identity=await db.query('SELECT current_database() AS name');
    if(!isLabDatabase(identity.rows[0]?.name)) {
      await db.query('ROLLBACK');
      res.status(403).json({error:'test_database_only'});return;
    }
    const category=await db.query(
      `INSERT INTO specialties(name,active) VALUES($1,true)
       ON CONFLICT(name) DO UPDATE SET active=true RETURNING id,name`,
      [input.data.name]
    );
    for(const name of [...new Set(input.data.services)]) {
      await db.query(
        `INSERT INTO specialty_services(specialty_id,name,active)
         VALUES($1,$2,true)
         ON CONFLICT(specialty_id,name) DO UPDATE SET active=true`,
        [category.rows[0].id,name]
      );
    }
    await db.query(
      `INSERT INTO audit_events(actor_id,action,resource_type,resource_id,metadata)
       VALUES($1,'lab_specialty_configured','specialty',$2,$3::jsonb)`,
      [req.authUser!.id,String(category.rows[0].id),
       JSON.stringify({scope:'test_only'})]
    );
    await db.query('COMMIT');
    res.status(201).json(category.rows[0]);
  } catch(error) {
    await db.query('ROLLBACK').catch(()=>undefined);
    next(error);
  } finally { db.release(); }
});

// Administration alone may approve a *pending* test professional.
// Full real-world document verification is NOT implemented by this lab.
adminRouter.post('/professionals/:id/approve', async(req,res,next)=>{
  const id=idParam(req.params.id);
  const input=approvalInput.safeParse(req.body);
  if(!id.success||!input.success){res.status(400).json({error:'invalid_input'});return;}
  const db=await pool.connect().catch(next);
  if(!db)return;
  try {
    await db.query('BEGIN');
    const identity=await db.query('SELECT current_database() AS name');
    if(!isLabDatabase(identity.rows[0]?.name)){
      await db.query('ROLLBACK'); res.status(403).json({error:'test_database_only'});return;
    }
    const person=await db.query(
      `SELECT u.id,u.name,pp.verification_status
       FROM users u JOIN professional_profiles pp ON pp.user_id=u.id
       WHERE u.id=$1 AND u.role='professional' AND u.status='active'
       FOR UPDATE OF pp`,[id.data]
    );
    if(!person.rows[0]) {
      await db.query('ROLLBACK');res.status(404).json({error:'professional_not_found'});return;
    }
    if(person.rows[0].verification_status!=='pending'){
      await db.query('ROLLBACK');res.status(409).json({error:'professional_not_pending'});return;
    }
    const category=await db.query(
      `SELECT id,name FROM specialties WHERE id=$1 AND active=true`,
      [input.data.specialtyId]
    );
    if(!category.rows[0]){
      await db.query('ROLLBACK');res.status(400).json({error:'invalid_specialty'});return;
    }
    await db.query(
      `INSERT INTO professional_specialties(professional_id,specialty_id)
       VALUES($1,$2) ON CONFLICT DO NOTHING`,
      [id.data,category.rows[0].id]
    );
    await db.query(
      `INSERT INTO professional_specialties(professional_id,specialty_id)
       SELECT $1,ss.specialty_id
       FROM lab_service_declarations d
       JOIN specialty_services ss ON ss.id=d.service_id
       WHERE d.professional_id=$1 AND d.status='approved'
       ON CONFLICT DO NOTHING`,
      [id.data]
    );
    // Nunca atribuir todos los trabajos del rubro por defecto.
    // Solo los servicios declarados individualmente y revisados se habilitan.
    await db.query(
      `INSERT INTO professional_services(professional_id,specialty_id,service_id)
       SELECT $1,ss.specialty_id,ss.id
       FROM lab_service_declarations d
       JOIN specialty_services ss ON ss.id=d.service_id
       WHERE d.professional_id=$1 AND d.status='approved'
       ON CONFLICT DO NOTHING`,
      [id.data]
    );
    await db.query(
      `UPDATE professional_profiles
       SET verification_status='approved',verified_at=now(),available=true
       WHERE user_id=$1`,[id.data]
    );
    await db.query(
      `INSERT INTO audit_events(actor_id,action,resource_type,resource_id,metadata)
       VALUES($1,'lab_professional_approved','professional',$2,$3::jsonb)`,
      [req.authUser!.id,String(id.data),
       JSON.stringify({specialtyId:Number(category.rows[0].id),scope:'test_only'})]
    );
    await db.query('COMMIT');
    res.json({
      professionalId:id.data,
      name:person.rows[0].name,
      status:'approved',
      specialty:category.rows[0].name,
      testOnly:true
    });
  } catch(error){
    await db.query('ROLLBACK').catch(()=>undefined);next(error);
  } finally{db.release();}
});

const resetTestPasswordInput = z.object({
  adminPassword: z.string().min(1).max(128),
  newPassword: z.string().min(12).max(128),
}).strict();

// Laboratorio solamente. Nunca habilitar en el sitio oficial:
// autorización de admin + comprobación de contraseña actual del admin,
// usuario objetivo fijo ID 4, email ficticio y auditoría sin secretos.
adminRouter.post('/professionals/4/reset-test-password', async (req, res, next) => {
  const parsed = resetTestPasswordInput.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid_input' });
    return;
  }
  if (req.authUser!.email !== 'administracion-lab360@test.invalid') {
    res.status(403).json({ error: 'lab_admin_only' });
    return;
  }
  const db = await pool.connect().catch(next);
  if (!db) return;
  try {
    await db.query('BEGIN');
    const identity = await db.query('SELECT current_database() AS name');
    if (!isLabDatabase(identity.rows[0]?.name)) {
      await db.query('ROLLBACK');
      res.status(403).json({ error: 'test_database_only' });
      return;
    }
    const admin = await db.query(
      "SELECT password_hash FROM users WHERE id=$1 AND role='admin' AND status='active'",
      [req.authUser!.id]
    );
    if (!admin.rows[0] || !await argon2.verify(admin.rows[0].password_hash, parsed.data.adminPassword)) {
      await db.query('ROLLBACK');
      res.status(403).json({ error: 'admin_password_incorrect' });
      return;
    }
    const result = await db.query(
      `SELECT u.id,u.name,u.email,u.password_hash,p.verification_status
       FROM users u JOIN professional_profiles p ON p.user_id=u.id
       WHERE u.id=4 AND u.role='professional' AND u.status='active'
       FOR UPDATE OF u`
    );
    const person = result.rows[0];
    if (!person || !person.email.endsWith('@test.invalid')) {
      await db.query('ROLLBACK');
      res.status(404).json({ error: 'lab_professional_not_found' });
      return;
    }
    if (await argon2.verify(person.password_hash, parsed.data.newPassword)) {
      await db.query('ROLLBACK');
      res.status(400).json({ error: 'password_must_change' });
      return;
    }
    const hash = await argon2.hash(parsed.data.newPassword, { type: argon2.argon2id });
    await db.query(
      'UPDATE users SET password_hash=$1,updated_at=now() WHERE id=4',
      [hash]
    );
    await db.query(
      `INSERT INTO audit_events(actor_id,action,resource_type,resource_id,metadata)
       VALUES($1,'lab_professional_password_reset','professional','4',$2::jsonb)`,
      [req.authUser!.id, JSON.stringify({scope:'test_only',resetBy:'admin'})]
    );
    await db.query('COMMIT');
    res.json({
      ok:true,
      professionalId:4,
      name:person.name,
      email:person.email,
      verificationStatus:person.verification_status,
      testOnly:true
    });
  } catch(error) {
    await db.query('ROLLBACK').catch(()=>undefined);
    next(error);
  } finally {
    db.release();
  }
});
