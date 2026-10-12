# Lista de pruebas de autorización de API — pendiente de ejecución integrada

Estas pruebas requieren una **base de desarrollo** instalada y usuarios ficticios.
No se ejecutan ni afectan la aplicación oficial.

| Escenario | Resultado esperado |
| --- | --- |
| GET /api/jobs sin Bearer | 401 |
| GET /api/jobs con token alterado o vencido | 401 |
| GET /api/jobs de una cuenta suspendida | 403 |
| POST /api/auth/register con role=admin | 400 |
| POST /api/auth/register con password corto | 400 |
| POST /api/jobs con clientId ajeno | 400 (\`strict\`) |
| POST /api/jobs con token de profesional | 403 |
| GET /api/jobs de Cliente A | Solo trabajos de A |
| GET /api/jobs/:id de B, siendo trabajo de A | 404 |
| Profesional pendiente no verificado | 0 solicitudes |
| Profesional aprobado para Plomería | No ve solicitud de Refrigeración |
| Profesional aprobado para Refrigeración/Reparación | Ve solo solicitudes compatibles |
| Profesional bloqueado por reclamo | No ve solicitudes nuevas |
| Profesional consulta /api/jobs/mine | Solo sus contratos adjudicados |
| Profesional consulta detalle adjudicado a otro | 404 |
| Profesional solicita exact_address en feed | El campo no se devuelve |
| Cliente presenta reclamo en trabajo ajeno | 404 |
| Cliente presenta reclamo en trabajo no finalizado | 404 |
| Profesional intenta resolver reclamo | 403 |
| Admin resuelve reclamación abierta | 200 y evento auditado |
| Admin resuelve el mismo reclamo de nuevo | 409 |

**Estado actual:** revisión estática del código, todavía no hay base aislada ni
integración con frontend. Una API con 401/403 correcto no implica que todo el
producto tenga seguridad terminada; deben revisarse todos los endpoints restantes.
