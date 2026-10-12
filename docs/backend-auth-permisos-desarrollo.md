# Autenticación y permisos — primer módulo implementado (solo DESARROLLO)

**Rama:** desarrollo-base-datos-seguridad-20261011
**Estado:** código preparado, no desplegado, no integrado al frontend y sin pruebas de extremo a extremo. No usar usuarios reales todavía.

Este módulo está diseñado **exclusivamente** para el esquema nuevo de desarrollo
\`database/001_new_install.sql\`. No funciona automáticamente con las tres tablas del
\`schema.sql\` anterior, ni debe apuntarse a una base de producción.

## Rutas implementadas en la rama

| Método y ruta | Acceso | Comportamiento |
| --- | --- | --- |
| POST /api/auth/register | Público | Crea cliente o profesional; administrador no permitido; contraseña Argon2id; profesional comienza pendiente y no disponible |
| POST /api/auth/login | Público | Verifica contraseña y estado activo; token HS256 firmado, 30 minutos |
| GET /api/auth/me | Autenticado | Devuelve identidad y rol actuales consultados desde DB |
| POST /api/jobs | Cliente | Crea solicitud usando ID del token, no \`clientId\` del cuerpo |
| GET /api/jobs | Cliente | Solo sus solicitudes |
| GET /api/jobs | Profesional | Solo solicitudes abiertas de especialidades/subrubros aprobados, si cuenta verificada y sin restricciones; sin direcciones |
| GET /api/jobs | Admin | Resumen de trabajos, sin direcciones privadas |
| GET /api/jobs/mine | Profesional | Solo los contratos adjudicados a su propia cuenta |
| GET /api/jobs/:id | Cliente / Profesional adjudicado / Admin | Consulta limitada a propiedad/contratación |
| POST /api/claims | Cliente | Puede reclamar sobre un trabajo propio completado; profesional se determina desde contrato, no desde cuerpo |
| GET /api/claims | Autenticado | Solo reclamos del cliente o profesional vinculado; Admin puede revisar |
| PATCH /api/claims/:id/resolve | Admin | Resolver con texto obligatorio y evento de auditoría en una transacción |

## Protecciones aplicadas

- \`requireAuth\` exige \`Authorization: Bearer <token>\`; JWT con issuer, audience, algoritmo HS256 fijo, caducidad 30 minutos y secreto aleatorio de al menos 32 bytes.
- Rol y estado de cuenta se vuelven a consultar en PostgreSQL en cada petición. Cambiar el rol del frontend o alterar el token no otorga permisos.
- Validación de solicitudes con Zod \`.strict()\`; no se permite crear registros para otro cliente cambiando \`clientId\`.
- Consultas parametrizadas. Los profesionales solo reciben campos públicos; \`exact_address\`, identidad del cliente y ofertas de otros profesionales no salen en el feed.
- Verificación de profesionales antes de ver nuevas solicitudes. Restricciones activas vinculadas a reclamos bloquean su acceso al feed.
- Resolución de reclamos exclusiva de administrador autenticado y auditada.
- CORS solamente para orígenes explícitos configurados; cabeceras básicas de seguridad; no se publican errores SQL al usuario.

## Cómo preparar una prueba futura

1. Crear una base PostgreSQL **aislada**; no modificar DATABASE_URL del backend existente. Aplicar \`database/001_new_install.sql\` solo sobre una base vacía.
2. Configurar \`DATABASE_URL\`, \`JWT_SECRET\` aleatorio de al menos 32 bytes y \`FRONTEND_ORIGIN\` limitado a la URL de desarrollo. **No subir secretos a GitHub**.
3. Ejecutar \`npm install\` y \`npm run build\`. Revisar \`npm audit\` y sus alertas ANTES del despliegue público.
4. Crear un cliente A, un cliente B y un profesional P en una base de pruebas.
5. Comprobar que peticiones sin token dan 401, tokens vencidos/alterados dan 401, cuentas suspendidas dan 403 y rol incorrecto da 403.
6. El cliente A crea trabajo; B no puede leer su detalle; no puede enviar un \`clientId\` ajeno. P no ve solicitudes sin aprobación.
7. Un administrador de pruebas verifica a P, le asigna especialidad/subrubros, y P ve solamente solicitudes compatibles; no obtiene dirección exacta.
8. El cliente no puede ver reclamaciones de otro; un profesional no puede resolver un reclamo; solo Admin resuelve con motivo y queda evento auditado.
9. Revisar que consultas funcionen con **dos dispositivos y dos sesiones distintas** antes de conectar el frontend.

## Seguridad todavía PENDIENTE — bloqueo para usuarios reales

- Verificación efectiva de email, confirmación de identidad del profesional y comprobación de documentos privados.
- Limitación de intentos y protección antifuerza bruta para login/registro; rotación/revocación de sesiones y recuperación de contraseña.
- Endpoints protegidos para ofertar, elegir presupuesto con transacción atómica, chat, garantías A/B, calificaciones y aprobaciones del administrador.
- Acceso justificado/auditado a expedientes completos, fotografías y dirección exacta; permisos mínimos para la base y archivos.
- Pruebas automatizadas integradas sobre PostgreSQL real, auditoría de dependencias y revisión de protección de datos.
- Migración consentida del historial de \`localStorage\` (trabajos 360-00171, 360-00173 y 15 reclamos) con respaldo, conteo y rollback.

**No publicar esta rama ni conectar la aplicación oficial hasta completar y comprobar estas tareas.**
