import { Router } from 'express';
import { pool } from '../db.js';

// Public list only: a prospective professional may look for an occupation before
// creating a laboratory account. No user/job/document information is exposed.
export const professionsRouter=Router();
professionsRouter.get('/',async(_req,res,next)=>{
  try{
    const rows=await pool.query(
      `SELECT s.id AS specialty_id,
              COALESCE(c.title,s.name) AS title,
              COALESCE(c.category,'Otros oficios') AS category,
              COALESCE(c.description,'') AS description,
              COALESCE(c.aliases,ARRAY[]::text[]) AS aliases,
              c.credential_note,
              c.profession_key
       FROM specialties s
       LEFT JOIN lab_profession_catalog c ON c.specialty_id=s.id
       WHERE s.active=true
       ORDER BY COALESCE(c.title,s.name),s.id
       LIMIT 200`
    );
    res.json(rows.rows);
  }catch(error){next(error);}
});
