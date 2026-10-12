-- Validaciones READ ONLY, para ejecutar solamente en una base de PRUEBAS
-- donde el esquema v2 ya fue creado. No modifica datos.
SELECT count(*) AS tablas_v2
FROM information_schema.tables
WHERE table_schema='public' AND table_type='BASE TABLE'
  AND table_name IN (
  'users','user_sessions','professional_profiles','professional_verifications',
  'specialties','specialty_services','professional_specialties','professional_services',
  'specialty_suggestions','jobs','job_attachments','job_quotes','job_contracts',
  'job_status_events','job_messages','warranty_visits','ratings','claims',
  'professional_restrictions','audit_events','legacy_imports');
-- Resultado esperado: 21.

SELECT indexname FROM pg_indexes
WHERE schemaname='public'
AND indexname IN ('only_one_accepted_quote_idx','ratings_original_unique',
                  'ratings_warranty_unique','professional_restriction_active')
ORDER BY indexname;
-- Resultado esperado: cuatro indices.

SELECT table_name FROM information_schema.views
WHERE table_schema='public' AND table_name='warranty_display_codes';
-- Resultado esperado: una vista.

-- Tests de identidad, autorizacion y concurrencia requieren la API;
-- este archivo comprueba estructura, no seguridad operacional.
