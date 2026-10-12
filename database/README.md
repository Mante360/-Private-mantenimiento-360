# MANTENIMIENTO 360° — diseño de base de datos v2

**Estado: diseño para desarrollo. NO aplicado a Render ni a la aplicación oficial.**

El archivo [001_new_install.sql](001_new_install.sql) define 21 tablas y una vista para PostgreSQL 15+. **Está destinado solamente a una base nueva y vacía de pruebas.** No reemplaza automáticamente el \`schema.sql\` actual, ni es una migración para ejecutar sobre una base ya existente.

## Qué se modeló

- **Cuentas:** clientes, profesionales y administradores, sesiones revocables y verificación de correo.
- **Profesionales:** especialidades y subrubros múltiples, disponibilidad, verificación y sugerencias que Administración aprueba.
- **Solicitudes:** descripción, localidad, fotos y dirección exacta separada (nunca pública antes de contratar).
- **Presupuestos:** varias propuestas independientes por solicitud; una por profesional; una única aceptada por trabajo.
- **Contratos:** oferta elegida, fecha de confirmación y registro de cambios de estado.
- **Mensajería:** vinculada al trabajo y al autor autenticado.
- **Garantías:** registros hijos del trabajo original, con sufijos A/B/C. No consumen un número de trabajo nuevo.
- **Calificaciones:** separadas entre trabajo original y garantía; una por cada caso, válidas únicamente tras finalizar.
- **Reclamos:** motivo, resolución, responsables y restricciones administrativas vinculadas a reclamos.
- **Auditoría e importación:** historial administrativo y tabla para evitar duplicados al importar el prototipo.

## Restricciones técnicas

La base impone claves foráneas, importes positivos, días de garantía no negativos, restricciones de estado y unicidad. En particular: \`UNIQUE(job_id,professional_id)\` en ofertas; índice parcial que permite un solo presupuesto aceptado; \`job_contracts\` vincula el contrato a una oferta de ese mismo trabajo; y la garantía queda relacionada con su original. Un código como \`360-00173-A\` se genera para consultar la garantía sin crear un nuevo trabajo original.

**Esto no es seguridad de cuentas terminada.** Todavía hace falta programar autenticación, permisos por propietario y rol, control de archivos y transacciones atómicas en la API. Ver [seguridad-y-flujos-v2.md](../docs/seguridad-y-flujos-v2.md).

## Para probarlo más adelante, sin tocar producción

1. Crear una base PostgreSQL **de desarrollo** distinta de cualquier base conectada a Render oficial. No crear servicios que generen gastos sin autorización específica.
2. Revisar el SQL con un motor PostgreSQL y ejecutarlo en esa base vacía.
3. Ejecutar [verify_schema.sql](verify_schema.sql), que contiene consultas de solo lectura.
4. Programar y probar autenticación, permisos y rechazo de peticiones de otro usuario.
5. Probar una solicitud con tres presupuestos desde dispositivos diferentes: uno elegido, dos no seleccionados, finalización, calificación, garantía y reclamo.
6. Preparar un respaldo **local**, autorizado por el usuario, del \`localStorage\` del origen correcto antes de cualquier migración. El repositorio de GitHub y la base vacía NO contienen los trabajos reales del navegador.
7. Importar respetando IDs, sufijos y referencias; registrar cada correspondencia en \`legacy_imports\`. Ajustar la secuencia de IDs después de importar para no duplicar códigos. Confirmar los trabajos 360-00171, 360-00173 y los 15 reclamos resueltos.
8. Mantener un plan de restauración y no activar el backend compartido antes de pasar las pruebas de permisos.

**Pagos:** en esta fase no existe cobro real. La integración con Mercado Pago o transferencias será posterior.
