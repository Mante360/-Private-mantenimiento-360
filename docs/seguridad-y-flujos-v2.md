# MANTENIMIENTO 360° — modelo de permisos y seguridad v2

**Documento de diseño, no implementación publicada.** El backend actual no comprueba adecuadamente la autorización de las rutas de trabajos/reclamos. No utilizar cuentas reales hasta que sea corregido y probado.

## Permisos obligatorios del servidor

| Recurso | Cliente | Profesional | Administrador |
|---|---|---|---|
| Solicitud | Crear y leer solo las propias | Ver únicamente solicitudes de rubro/zona compatible, sin dirección privada | Gestión auditada |
| Presupuestos | Ver propuestas de su trabajo, elegir una | Crear y consultar solamente su propia propuesta y estado | Intervención justificada y auditada |
| Dirección exacta | Controlada por el cliente | Visible solo al profesional contratado después de la confirmación | Acceso excepcional auditado |
| Chat | Trabajos propios y habilitados | Solamente trabajos adjudicados | Acceso excepcional por gestión/reclamo |
| Garantía | Intervenciones del trabajo propio | Intervenciones asignadas | Ver original + A/B/C y reasignar justificadamente |
| Calificación | Una por original y otra por cada garantía | Lectura de sus evaluaciones, nunca edición | Moderación auditada |
| Reclamos | Presentar y consultar su expediente | Consultar solo reclamos propios | Resolver con motivo, medidas y auditoría |
| Especialidades | Sugerir rubros faltantes | Editar rubros/subrubros aprobados | Aprobar sugerencias |
| DNI y selfie | Sin acceso a terceros | Presentar documentación propia | Solo verificadores autorizados |

NUNCA confiar en \`clientId\`, \`professionalId\`, \`createdBy\`, \`actorId\` ni \`role\` suministrados por el navegador: la API debe obtenerlos de una sesión válida y comprobar propiedad/rol. El selector actual de Cliente/Profesional/Administrador sirve solo para pruebas; no autentica identidades reales.

## Seguridad de las cuentas y archivos

- Contraseñas con Argon2id, acceso por HTTPS, sesiones revocables y tokens de actualización guardados como HASH, jamás en texto plano.
- Registro público únicamente de cliente o profesional. Creación de administradores exclusivamente por personal autorizado.
- Verificar correo; limitar intentos de inicio de sesión, recuperación de contraseña segura, caducidad y rotación de sesiones.
- Validar campos con Zod, consultas SQL parametrizadas, límites de tamaño, CORS restringido y cabeceras seguras.
- DNI y selfies en almacenamiento **privado y cifrado**, no en GitHub ni en rutas públicas. Autorización puntual, retención y eliminación.
- Auditar cambios de rol, aprobaciones, consulta excepcional de datos, bloqueos y resolución de reclamos, sin registrar tokens ni contraseñas.
- Revisar advertencias de dependencias del backend y políticas de protección de datos pertinentes a Argentina (incluida Ley 25.326) antes del lanzamiento.

## Contratación y concurrencia

1. Cliente crea una solicitud; solo el rubro, subrubro, descripción y localidad necesarios son visibles antes de contratar.
2. Los profesionales compatibles y verificados envían propuestas, una cada uno, sin acceso a ofertas ajenas.
3. El cliente compara y confirma una. La API hace \`SELECT ... FOR UPDATE\` sobre el trabajo, verifica estado/propiedad, inserta \`job_contracts\` y marca otras ofertas \`not_selected\` **en una misma transacción**.
4. Los profesionales no seleccionados ven solo ese estado, sin razón, identidad del ganador ni su precio.
5. Chat y dirección exacta se habilitan al contratado; solo el asignado puede iniciar/finalizar el trabajo.
6. Garantías: registradas como hijas, con responsable propio si Administración reasigna. Las calificaciones de garantía nunca cambian el promedio del original.

**Importante:** índices y restricciones SQL no reemplazan verificaciones de propiedad en la API.

## Reclamos y controles administrativos

Reclamos privados, resolución escrita obligatoria y acceso acotado. Bloquear a un profesional requiere un **reclamo identificado** y una decisión explícita de Administración, auditada; no se bloquea por tener un presupuesto no seleccionado.

## Migración del prototipo

El historial está en \`localStorage\` y puede variar entre \`mantenimiento-360.onrender.com\` y \`private-mantenimiento-360.onrender.com\`. Para evitar pérdida de datos:

1. Identificar la dirección del navegador que conserva el historial completo; exportar allí el JSON **con autorización**, sin publicar datos personales.
2. Guardar copias y contar originales, garantías, reclamos, mensajes, presupuestos y calificaciones.
3. Migrar en transacciones con mapeo y deduplicación \`legacy_imports\`; preservar el código público 360-xxxxx y sus garantías A/B.
4. Verificar explícitamente 360-00171, 360-00173, las calificaciones, las garantías y los 15 reclamos resueltos.
5. Probar lectura/escritura desde DOS dispositivos con distintas cuentas y verificar el aislamiento.
6. No eliminar datos del navegador hasta comprobar todas las operaciones y un plan real de restauración.
