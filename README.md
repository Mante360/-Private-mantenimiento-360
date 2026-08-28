# Backend Mantenimiento 360°

Backend inicial listo para Render + PostgreSQL.

Incluye:
- `GET /health`
- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/jobs`
- `GET /api/jobs`
- `POST /api/claims`

## Render
Si se sube esta carpeta dentro del repositorio principal como `backend/`:
- Root Directory: `backend`
- Build Command: `npm install && npm run build`
- Start Command: `npm start`
- Variables: `DATABASE_URL`, `JWT_SECRET`, `FRONTEND_ORIGIN`

## Base de datos
Ejecutar `sql/schema.sql` una sola vez sobre PostgreSQL antes de usar los endpoints.

No usar datos sensibles reales hasta completar autenticación/autorización por roles y revisión de producción.
