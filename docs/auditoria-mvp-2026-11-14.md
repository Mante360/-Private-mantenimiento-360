# MANTENIMIENTO 360° — auditoría de preparación del MVP

**Fecha de revisión:** 14 de noviembre de 2026 (Argentina)  
**Alcance:** revisión de código y pruebas de la rama de laboratorio `desarrollo-base-datos-seguridad-20261011`.  
**Sin modificaciones de producción ni migraciones de datos.**

## Dictamen

**MVP apto para seguir validando en laboratorio con datos ficticios. NO habilitar clientes, profesionales, documentos ni cobros reales todavía.** Las pruebas automáticas confirman los recorridos cubiertos, pero no constituyen una auditoría integral de seguridad o disponibilidad.

Última ejecución comprobada: [GitHub Actions, run 43665371929](https://github.com/Mante360/-Private-mantenimiento-360/actions/runs/43665371929): compilación y pruebas de API y navegador aprobadas. Incluye 77 controles de pago ficticio/contratación y 35 controles de navegador de pagos; también pruebas de roles, documentación, reclamos, presupuestos y garantías.

## Matriz resumida de preparación

| Función | Estado verificado en rama de desarrollo | Requisito pendiente para operación real |
|---|---|---|
| Cuentas y roles | JWT, Argon2id, validación de roles; profesional pendiente no trabaja | Verificar correo/identidad; mitigar fuerza bruta; sesiones revocables de uso real; recuperación segura de cuenta |
| Oficios y profesionales | Sugerencias y aprobación separada, con pruebas | Verificación auténtica de documentos y procedimiento administrativo protegido |
| Solicitudes, presupuestos y contratos | 3 presupuestos; una contratación atómica; privacidad por rol | Unir frontend público y backend; migrar datos previos con respaldo y validación |
| Pagos | Mercado Pago/transferencia **simulados**, sin cobro ni proveedor externo | Pasarela real, conciliación, confirmación autenticada, reembolsos y operaciones de cobro; NO inferir pago desde una selección ficticia |
| Garantías y reclamos | Recorridos y bloqueo/desbloqueo verificados en CI | Comprobar operación real de soporte, conservación de expedientes y políticas de resolución |
| Fotos/documentos | Endpoints de prueba con archivos ficticios y límites | Almacenamiento privado duradero, cifrado, control de retención, restauración y auditoría de acceso |
| Dirección exacta | Separada en esquema, excluida de respuestas públicas | API explícita y consentimiento para compartir solo después de contratar |
| Chat y notificaciones | La demo usa `localStorage`; hay tabla `job_messages` | API de mensajería privada persistente y avisos reales/operativos; los recordatorios actuales son registros internos, sin envíos |
| Datos históricos | `legacy_imports` disponible en diseño | Inventario, backup independiente, migración ensayada, mapeo/deduplicación, reconciliación y plan de reversión |
| Respaldo y respuesta ante incidentes | No auditados por esta revisión | Verificar backups reales, prueba de restauración, monitoreo y procedimiento de incidentes |
| Accesibilidad, rendimiento y seguridad general | Pruebas de API y Chromium de flujos específicos | Auditoría de dependencias, pruebas de carga, accesibilidad, permisos extremo a extremo y revisión legal/privacidad |

## Evidencia técnica concreta

1. **Dos interfaces separadas.** `index.html` y `app.js` del prototipo oficial utilizan almacenamiento `localStorage` para trabajos y mensajes, sin llamadas `fetch` a la API nueva. `src/server.ts` expone por separado la consola de pruebas `/pruebas`. **No asumir** que ejecutar exitosamente CI convierte la demo pública en un producto multiusuario persistente.
2. **Pagos no implementados como cobros.** `src/routes/quotes.ts` confirma un único `job_contracts` bajo transacción con bloqueo de fila; el método ficticio queda en auditoría `lab_payment_method_simulated`, explícitamente `charged:false` y `paymentProcessed:false`. El esquema `database/001_new_install.sql` no define una tabla de pagos ni conciliación.
3. **Cuentas no verificadas de extremo a extremo.** `src/routes/auth.ts` permite registrar con contraseña y correo pero no exige `email_verified_at`; no se identificó protección de intentos masivos en esas rutas. `src/auth.ts` emite JWT limitados temporalmente y usa renovación acotada, pero no utiliza `user_sessions` para revocación por dispositivo.
4. **Archivos limitados a la base de laboratorio.** `src/routes/photos.ts`, `src/routes/claim-evidence.ts` y `src/routes/lab-document-files.ts` declaran explícitamente el uso de datos ficticios y base temporal de pruebas. No equivalen a un sistema de documentos legales privados en producción. En `src/routes/lab-document-files.ts`, reemplazar respaldo conserva la trazabilidad de decisiones, pero el `ON CONFLICT(document_id) DO UPDATE` sustituye el contenido anterior del PDF; no hay conservación comprobada de cada versión binaria.
5. **Dirección y chat.** `src/routes/jobs.ts` no expone `exact_address` ni ofrece API de consentimiento y compartición después del contrato. `job_messages` está en el esquema, pero `src/server.ts` no registra un router de chat. No afirmar que chat multiusuario ya funciona.
6. **Avisos.** `src/routes/claim-reminders.ts` registra recordatorios internos y el propio código especifica que no envía WhatsApp ni correos.
7. **Pruebas.** `.github/workflows/verificar-backend-desarrollo.yml` ejecuta API/Chromium sobre PostgreSQL temporal. Su éxito no incluye respaldo-restauración, pasarela real, mensajería, cargas altas ni el frontend oficial antiguo.

## Orden recomendado de cierre — sin agregar funciones ajenas al MVP

- [ ] **1. Preservar información existente:** identificar dónde está el historial original del prototipo; hacer exportación/backups probados y definir rollback. No tocar los datos reales existentes.
- [ ] **2. Unificar el frontend comercial con la API protegida:** registro, solicitudes, presupuestos, contratación, historial, reclamos, garantías y perfiles, usando datos persistentes y no `localStorage` como fuente de verdad.
- [ ] **3. Cerrar seguridad necesaria para usuarios reales:** verificación de correo y profesionales, almacenamiento privado, controles contra abuso, sesiones revocables, permisos y procedimientos de privacidad.
- [ ] **4. Cerrar operación de contratación:** forma segura de compartir dirección, mensajería entre partes contratadas, notificaciones indispensables y conservación del expediente.
- [ ] **5. Diseñar e integrar pagos reales al final de la cadena:** elegir proveedor y condiciones, confirmación server-to-server, conciliación, cobro fallido, reembolsos, estados y auditoría; nunca marcar “pagado” por el botón de simulación.
- [ ] **6. Validar lanzamiento:** migración en entorno de ensayo, backup y restauración comprobados, pruebas multiusuario y de seguridad, revisión legal/privacidad, y piloto controlado.

## Criterios de aceptación antes de recibir clientes reales

- Todos los estados mostrados al cliente y al profesional provienen de la misma base de datos, no de archivos locales del navegador.
- Un usuario de otro rol y un profesional pendiente no pueden ver, modificar ni contratar trabajos ajenos.
- Ninguna dirección, documento de identidad, foto o conversación privada puede filtrarse mediante enlaces públicos.
- La confirmación de un contrato no equivale a confirmar un pago; un pago real requiere evidencia autenticada del proveedor.
- Existen respaldo probado, procedimiento de restauración, monitoreo y trazabilidad de incidentes.
- Se validan los trabajos y reclamos históricos antes de cualquier migración, sin destruir el origen.

**Nota:** Este informe describe el código revisado y sus pruebas, no certifica seguridad absoluta, operatividad comercial ni cumplimiento legal. Los documentos de diseño anteriores en `docs/` tienen estados históricos y no deben usarse como indicadores de progreso actualizado.
