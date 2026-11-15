# MANTENIMIENTO 360° — guía para registro de software en Uruguay

**Revisión:** 14 de noviembre de 2026  
**Objetivo:** preparar inscripción de una versión identificable del software en Uruguay, sin modificar producción ni afirmar derechos no acreditados.  
**Estado:** requisitos oficiales identificados; expediente NO presentado.

## Autoridad competente (cambio importante desde 2025)

El Registro de Software funciona en la **Dirección Nacional de la Propiedad Industrial (DNPI)** del **Ministerio de Industria, Energía y Minería (MIEM)**, **no en la Biblioteca Nacional**. Ley 20.212 (art. 271), Decreto 39/025 y Circular 01/025. Presentación por plataforma en línea.

- MIEM, introducción: https://www.gub.uy/ministerio-industria-energia-mineria/politicas-y-gestion/registro-software
- Portal para la solicitud (con inscripción, seguimiento y notificaciones): https://www.gub.uy/ministerio-industria-energia-mineria/tramites-y-servicios/servicios/sistema-presentacion-linea-recepcion-automatica-marcas-patentes
- Formulario 2026 oficial (actualizado): https://www.gub.uy/ministerio-industria-energia-mineria/sites/ministerio-industria-energia-mineria/files/2026-01/Formulario%20Solicitud%20Registro%20de%20Software%202026.pdf
- Decreto completo: https://www.impo.com.uy/bases/decretos-originales/39-2025
- Circular de depósito de ejemplares: https://www.gub.uy/ministerio-industria-energia-mineria/sites/ministerio-industria-energia-mineria/files/2025-02/Circular%20N1%202025%20obras%20registro%20software_0.pdf

## Lista de documentación

- [ ] Datos del titular (persona física o jurídica) y respaldo de titularidad/autoria, según corresponda.
- [ ] Si persona física: nombre, documento (DNI extranjero u otro equivalente), nacionalidad, estado civil, fecha de nacimiento, domicilio real, teléfono. Confirmar si la fecha de nacimiento se aporta como información adicional dado que el Decreto la exige.
- [ ] **Domicilio constituido en Uruguay** para notificaciones; definir si se usará representante/apoderado.
- [ ] Si persona jurídica extranjera: documentos vigentes de la sociedad y, de corresponder, traducción, legalización o apostilla según el Decreto. Verificar con DNPI.
- [ ] Formulario 2026 completo y firmado; el propio formulario permite firma electrónica avanzada validable.
- [ ] Título de la obra: **MANTENIMIENTO 360° – Plataforma de Servicios Integrales** (confirmar versión del título).
- [ ] Clasificación principal propuesta: **Programa de Ordenador**. No marcar otras categorías sin justificación.
- [ ] Descripción breve **no confidencial** de la obra.
- [ ] Lenguajes, entornos de ejecución y sistemas operativos; indicar versiones verdaderas del artefacto registrado.
- [ ] Lugar/fecha de publicación: comprobar evidencia verificable. La fecha **28/08/2026** corresponde a un dato de proyecto comunicado, pero debe constatarse qué versión se puso efectivamente al público y cuál se registra.
- [ ] Identificar autores/coautores reales y titularidad de cada parte; comprobar contratos de desarrolladores y licencias de terceros. No asumir titularidad simplemente porque el código se encuentre en GitHub o fue generado con asistencia de IA.
- [ ] Dos ejemplares inalterables de la obra, o partes suficientes para caracterizarla (Decreto 39/025, art. 1 IV). Preparar versión fechada, commit/tag, SHA-256 y manifiesto de archivos para integridad. Excluir credenciales, claves, datos reales de clientes y secretos de entorno.
- [ ] Coordinar entrega del soporte de depósito según Circular 01/025: medio físico en DNPI previa coordinación a **registro.software@miem.gub.uy** o transferencia electrónica coordinada por **soportednpi@miem.gub.uy**, con copia al primero. En ambos casos indicar número de seguimiento asignado por la plataforma.
- [ ] Confirmar con MIEM importe/tasa actual del **registro de software**, método de pago y si hay costo adicional por publicación. **No reutilizar** los aranceles de obras generales de Biblioteca Nacional ni las tarifas de marcas/patentes.
- [ ] Guardar comprobantes: formulario presentado, número de expediente, evidencia del depósito, recibos, publicaciones y certificado final.

## Descripción no confidencial propuesta para el formulario

> MANTENIMIENTO 360° es una plataforma informática de gestión de solicitudes de servicios de mantenimiento y reparaciones, que organiza la interacción entre clientes, profesionales y personal administrativo. Contempla registro de usuarios, especialidades profesionales, presentación y comparación de presupuestos, contratación, seguimiento de trabajos, documentación de verificaciones, reclamos, garantías y calificaciones, mediante interfaces web y servicios de aplicación con control de acceso por roles y persistencia de información.

**Atención:** describir **solo funciones presentes en el código de la versión depositada**. No afirmar que pagos reales, verificación documental real, notificaciones comerciales o aplicación móvil nativa estén terminados.

## Reglas legales principales

- Registro **no es requisito para la existencia del derecho de autor** (Decreto 39/025, art. 14). Sirve de constancia registral para la obra depositada y titularidad declarada.
- Programa fuente, programa objeto y otras obras concretas están contempladas. La idea comercial abstracta o el nombre por sí solo no equivalen a proteger mediante el depósito del código.
- El contenido depositado tiene confidencialidad general; se publica la **descripción no confidencial**, título, clasificación y datos del solicitante en el Boletín de la Propiedad Industrial (arts. 3 y 5).
- Hay **30 días corridos** para oposición tras la publicación (art. 6). Si DNPI observa defectos formales, concede **15 días hábiles** para subsanarlos (art. 4).
- Se puede actuar por representante acreditado, y se admite documento equivalente para extranjero no residente (art. 1).
- En el portal de DNPI, las notificaciones se consideran realizadas si no se atienden en tres días hábiles; consultar regularmente el expediente.
- El formulario 2026 solicita un único PDF de formulario y anexos, incluidos respaldos de representación si corresponden.

## Datos del proyecto a preservar

- Proyecto: **MANTENIMIENTO 360° – servicios integrales**.
- Trabajo actual: desarrollo web, laboratorio en Render, rama `desarrollo-base-datos-seguridad-20261011` del repositorio `Mante360/-Private-mantenimiento-360`.
- **No presentar aún:** primero seleccionar una versión completa y reproducible; el laboratorio separado no acredita por sí solo que el frontend de comercialización esté conectado. No subir el `.env` ni archivos con información identificable.

## Consultas pendientes para DNPI

**Contacto oficial:** registro.software@miem.gub.uy. Soporte para transferencia electrónica de los ejemplares: **soportednpi@miem.gub.uy** (con copia a registro.software@miem.gub.uy).

1. Si titular persona física con DNI argentino y residencia en Argentina puede crear usuario en el portal y firmar electrónicamente sin identificación digital uruguaya; documentos y representación necesarios.
2. Modalidad aceptada de **domicilio constituido en Uruguay** (representante profesional, domicilio de notificaciones, etc.).
3. Monto y forma de pago del registro de software vigentes en noviembre 2026 y existencia de tasas adicionales.
4. Entrega totalmente remota de dos ejemplares y formato preferido de código fuente parcial/completo, manifiesto SHA-256 y resguardos.
5. Cómo declarar lugar/fecha de publicación de una **demo pública con datos ficticios** y versiones posteriores, sin atribuir a la demo comercialización real.
6. Si se requiere depositar una versión por separado cuando haya mejoras sustanciales.
7. Cómo acreditar titularidad cuando el desarrollo involucró herramientas de IA y posibles bibliotecas de terceros.

## Distinciones relevantes

El **registro de software** no constituye una habilitación tributaria o comercial para vender servicios y tampoco registra automáticamente la **marca** MANTENIMIENTO 360°. Las obligaciones fiscales y contractuales del negocio, el tratamiento de datos personales y, en su caso, una solicitud separada de marca, requieren análisis independientes.

**Estado:** investigación y preparación documental solamente. No se ha registrado la obra, contratado representante ni presentado la solicitud. No comprometer pagos o declaraciones juradas sin autorización expresa.
