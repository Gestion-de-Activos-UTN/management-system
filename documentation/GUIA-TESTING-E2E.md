# Guía de testing E2E manual — SIAM

> Estado: guía actualizada contra el código de `d89d7d6` más los cambios locales de altas de organizaciones y usuarios (20-10-2026). Los flujos de alta y confirmación escrita requieren validación manual en la aplicación.

## 1. Alcance y prerequisitos de producto

La guía cubre los flujos visibles de PlatformPortal y Portal de Organización, los límites por plan, permisos, aislamiento entre organizaciones y oficinas, validaciones y errores. La ejecución combina navegación normal, DevTools → **Inspeccionar** → **Network** y cURL. Es una guía manual/API; el estándar del repo también pide specs Playwright en `management-system/e2e/` para flujos cross-layer, que deberán añadirse después de implementar los prerequisitos.

### 1.1 Altas incorporadas y flujos que requieren validación

Las altas de organización y usuarios están implementadas mediante endpoints específicos y formularios del portal. Las colecciones `Users` y `OrganizationMemberships` siguen cerradas para CRUD directo; las altas pasan por los endpoints de dominio, con validación de permisos, organización, oficinas y límites. El rubro se elige de un catálogo y admite una explicación opcional al seleccionar “Otro”. Antes de dar esta guía por cerrada, ejecutar y registrar los casos `ORG-*` y `USER-*` en una instancia local.

#### REQ-ORG-01 — Alta de organización desde StaffPortal

El asistente por pasos está en `modules/organizations/components/OrganizationCreateModal.tsx` y envía `POST /api/v1/platform-admin/organizations`. Sólo `PlatformAdmin`, desde StaffPortal y sin contexto `asOrganization`, puede iniciarlo.

Datos acordados para el asistente:

1. **Organización:** nombre y rubro/sector de una lista.
2. **Plan:** Basic o Premium.
3. **Primera oficina:** nombre, provincia y departamento/partido opcional.
4. **Primer usuario:** nombre completo, correo y contraseña inicial; el rol es siempre `org_admin` y no se puede cambiar.
5. Revisión/confirmación final antes de crear.

El modelo actual sólo tiene `Users.name`, además de `email` propio del auth y `status`; usar nombre completo en `name`. No hay apellido, teléfono ni otros datos personales en la colección actual.

El alta debe crear organización, settings, suscripción con los límites del plan, oficina inicial, usuario, membresía `org_admin` y ciclos iniciales requeridos, dentro de una operación atómica. La contraseña permite iniciar sesión de inmediato; no hay paso de invitación ni activación pendiente. La contraseña se entrega a la autenticación de Payload, que la almacena usando su mecanismo de hash.

Valores actuales relevantes: settings iniciales con industria seleccionada y política Essential; plan Basic o Premium según la selección; features activas por defecto. La organización siempre nace con una oficina activa y un OrgAdmin activo. Si cualquier paso falla, no debe quedar una organización parcial ni una cuenta sin membresía.

#### REQ-USER-01 — Alta de usuario desde Administración → Usuarios

El alta está en Administración → Usuarios para OrgAdmin y en Portal → Equipo para OfficeManager; ambas usan `POST /api/v1/org-members`. Solicita nombre completo, correo, contraseña inicial, rol y oficinas cuando el rol lo requiere. La cuenta y membresía quedan activas al confirmar.

| Actor                        | Roles que puede crear           | Alcance de oficinas                                                                           |
| ---------------------------- | ------------------------------- | --------------------------------------------------------------------------------------------- |
| OrgAdmin                     | OrgAdmin, OfficeManager, Viewer | OrgAdmin cubre todas; los otros roles requieren una o más oficinas activas de la organización |
| OfficeManager                | Viewer                          | Sólo oficinas activas que el OfficeManager ya tiene asignadas                                 |
| OrgViewer                    | Ninguno                         | No puede administrar usuarios                                                                 |
| PlatformAdmin en StaffPortal | OrgAdmin adicional              | Rol fijado; cubre todas las oficinas                                                          |

**Gestión delegada del estado:** OfficeManager puede desactivar y reactivar únicamente Viewers con una o más oficinas asignadas y todas dentro de su alcance. No puede modificar roles. Puede editar las oficinas de esos Viewers mientras estén activos, seleccionando sólo oficinas activas propias y conservando al menos una. Al reactivar, sólo puede elegir oficinas activas propias si hace falta corregir esa asignación; nunca amplía su alcance. La API valida estas reglas también para el preview de impacto. Se conservan confirmación por correo, cuotas, revocación de sesiones y cascadas de activos/tareas. En Equipo se incluyen los Viewers inactivos que puede gestionar; no se amplía la lectura de personas inactivas fuera de ese alcance.

La ruta general de Administración sigue restringida a OrgAdmin (`app/portal/(protected)/administration/layout.tsx`); OfficeManager recibe un punto de entrada separado y acotado. La API repite las reglas del formulario, aplica límites bajo concurrencia y rechaza correo ya existente sin crear duplicados.

#### REQ-USER-02 — Alta de OrgAdmin adicional desde StaffPortal

Desde StaffPortal se puede agregar un OrgAdmin a una organización activa mediante `POST /api/v1/platform-admin/organizations/:id/org-admins`. Reutiliza nombre, correo y contraseña, fija el rol como OrgAdmin y no solicita oficinas. La operación exige cupo de OrgAdmin en el plan actual. El OrgAdmin de la organización también puede crear OrgAdmins desde Administración → Usuarios cuando la cuota lo permita.

#### REQ-USER-03 — Confirmación escrita al desactivar un usuario

Antes de confirmar la desactivación, la interfaz solicita escribir el correo de la persona, igual que la baja de oficinas solicita el nombre. Muestra nombre, correo y el impacto existente (activos a cargo, tareas en curso y tareas asignadas), además de explicar que los activos no reasignados quedan sin responsable, las tareas reclamadas en curso vuelven a pendientes y las tareas abiertas asignadas no se reasignan automáticamente. Al reactivar, el acceso vuelve con el rol anterior, pero activos y tareas no se restauran ni reclaman por cuenta propia. La API valida el correo dentro de la operación; correo incorrecto o cancelar no cambia datos. Se mantienen las reglas existentes: no desactivarse a sí mismo y no dejar una organización activa sin OrgAdmin.

Las altas con contraseña inicial son temporales: activan la cuenta inmediatamente y Payload almacena la contraseña con hash. El proveedor de autenticación futuro aún no está definido y queda fuera de estos casos; no probar integración de invitación/aceptación en esta ronda.

### 1.2 Límites conocidos de planes

Fuente: `domain/subscriptions/limits.ts`.

| Plan    | Oficinas activas | Agentes por oficina | OrgAdmin | OfficeManager | Viewer |
| ------- | ---------------: | ------------------: | -------: | ------------: | -----: |
| Basic   |                3 |                   1 |        1 |             2 |      4 |
| Premium |               10 |                   2 |        3 |            10 |     20 |

La capacidad de cambiar el plan después del alta queda fuera de esta etapa. Para el recorrido manual, probar los rechazos de cupo en Basic y comprobar los límites de Premium en `/api/v1/session`. La verificación de rechazo al alcanzar los topes Premium queda asignada a integración con fixture de cuotas; llenar manualmente 10 oficinas, 10 managers y 20 Viewers no es un recorrido razonable. No modificar el plan por una API de prueba que el producto no ofrece.

### 1.3 Funciones que no deben darse por existentes

- AuditLog y Notification Bell persistentes todavía no existen. Hay puntos de disparo marcados en comentarios; las notificaciones toast de Mantine no equivalen a una Bell. No exigir entradas visibles de AuditLog/Bell en esta ronda.
- No se encontró una función de IA en el código revisado. No incluirla como caso ejecutable hasta que exista una superficie de producto.
- No hay recuperación/cambio de contraseña para usuarios desde el portal. La contraseña inicial da acceso inmediato; el futuro proveedor de autenticación y la gestión de credenciales quedan para otra etapa.
- **Alcance de autenticación:** el login de las cuentas creadas usa el mecanismo actual de Payload. La definición e integración del proveedor de autenticación futuro se resolverá en otra etapa y no forma parte de esta guía.

La implementación de `REQ-*` debe respetar los comentarios `AUDIT:` y `NOTIFY:` obligatorios de `SYSTEM_PROMPT.md` en cada escritura sensible y evento notificable. Marcar explícitamente, como mínimo, creación de organización, creación de usuario, invitación futura y desactivación de miembro, además de los eventos notificables que correspondan. Son criterios de implementación; no implican que AuditLog o Notification Bell ya existan ni que haya que mostrar eventos persistentes en esta ronda.

### 1.4 Relación con las specs Playwright

La guía manual/API no sustituye los E2E cross-layer que exige `SYSTEM_PROMPT.md` §8. Candidatos al implementar Playwright: `ORG-01` → `e2e/org-onboarding.spec.ts`; inventario → `e2e/asset-inventory-view.spec.ts`; permisos/navegación por rol → spec de RBAC-gated views. Las specs y la infraestructura Playwright aún no están en el repo. Validaciones aisladas y errores de contrato corresponden a unit/integration tests, no a Playwright.

### 1.5 Definición pendiente del nombre del sistema

Revisar y definir el nombre del sistema antes de actualizar de forma transversal la interfaz y la documentación. Las opciones consideradas válidas hasta el momento son **SARA** y **SIMA**; la decisión final sigue pendiente.

## 2. Preparar el entorno y conservar evidencia

### 2.1 Arranque

1. Seguir `README.md` y `COMMANDS.md` para levantar el stack local en Docker. La app local se expone en `http://localhost:3001`.
2. Verificar en los logs que terminaron `seed:navigation` y `seed:demo`; obtener de los logs las credenciales de demo, sin copiarlas a este documento ni a tickets públicos.
3. Usar un entorno local/desechable. Para volver a cero, bajar el stack eliminando el volumen de Postgres y levantarlo de nuevo; esto borra todos los datos.
4. Preferir los perfiles de seed existentes para recorridos repetibles. El perfil `expanded` ofrece más escenarios de inventario/tareas; `standard` es más compacto. El seed es idempotente y no sustituye ediciones hechas desde la UI.
5. Registrar fecha, build/commit, plan, organización, rol, oficina seleccionada, resultado, captura y request/response relevante por caso.

### 2.2 Capturar requests con Inspeccionar

1. Abrir DevTools antes de iniciar el recorrido, seleccionar **Network**, activar **Preserve log** y filtrar por `v1/` o por el recurso (`offices`, `org-members`, `tasks`, etc.).
2. Ejecutar una acción desde la UI y abrir la request correspondiente: comprobar método, URL, payload, status HTTP y cuerpo de respuesta.
3. Para un error, guardar el mensaje visible y el código/status devuelto. Para éxito, recargar la página y comprobar que el dato persiste.
4. No copiar ni publicar el valor de la cookie `payload-token`, contraseñas, API keys de agentes ni reportes crudos. La cookie de sesión es `httpOnly`; usar el flujo de login para Inspeccionar y el jar local para cURL.
5. Comprobar que las mutaciones de UI usan `/api/v1/...` cuando corresponda y que las lecturas de lista están correctamente acotadas. No asumir que ocultar un botón prueba la autorización del servidor.

### 2.3 Sesión cURL para reproducir requests

El login establece cookie de sesión. Guardar un jar separado por cuenta, para no mezclar sesiones de Admin y User.

```bash
SIAM_URL='http://localhost:3001'
SIAM_COOKIE='/tmp/siam-org-admin.cookies'

read -r -p 'Correo: ' SIAM_EMAIL
read -r -s -p 'Contraseña: ' SIAM_PASSWORD
printf '\n'
export SIAM_EMAIL SIAM_PASSWORD
SIAM_LOGIN_BODY=$(node -e 'process.stdout.write(JSON.stringify({email:process.env.SIAM_EMAIL,password:process.env.SIAM_PASSWORD}))')
curl -i -c "$SIAM_COOKIE" \
  -H 'Content-Type: application/json' \
  --data "$SIAM_LOGIN_BODY" \
  "$SIAM_URL/api/users/login"
unset SIAM_EMAIL SIAM_PASSWORD SIAM_LOGIN_BODY

curl -i -b "$SIAM_COOKIE" "$SIAM_URL/api/v1/session"
```

Para PlatformAdmin, usar otro archivo de cookies y `/api/admins/login`. Cerrar sesión desde la UI entre actores o usar jars distintos. Las requests siguientes usan `-b "$SIAM_COOKIE"`.

Ejemplo genérico de operación JSON:

```bash
curl -i -b "$SIAM_COOKIE" \
  -H 'Content-Type: application/json' \
  -X GET "$SIAM_URL/api/v1/offices/agent-summary"
```

Para revisar miembros y el preview de baja actual:

```bash
curl -i -b "$SIAM_COOKIE" \
  "$SIAM_URL/api/v1/org-members?include_inactive=1"

curl -i -b "$SIAM_COOKIE" \
  "$SIAM_URL/api/v1/org-members/<user-id>/deactivation-impact"
```

Para comprobar que el servidor rechaza un correo incorrecto:

```bash
curl -i -b "$SIAM_COOKIE" \
  -H 'Content-Type: application/json' \
  -X PATCH "$SIAM_URL/api/v1/org-members/<user-id>" \
  -d '{"is_active":false,"confirm_email":"correo-incorrecto@example.com"}'
```

El servidor debe responder `400 confirmation_mismatch` y conservar activa la cuenta. Para una baja válida, enviar en `confirm_email` el correo de la persona.

Para una llamada autenticada sin cookie o con cookie de otra cuenta, quitar `-b` o usar otro jar. Las llamadas internas de mantenimiento requieren `INTERNAL_JOBS_TOKEN`; no exponerlo en capturas ni en el historial compartido.

## 3. Cuentas y fixtures de prueba

Crear desde la interfaz:

- **Org Basic A:** una oficina inicial, OrgAdmin inicial, plan Basic.
- **Org Premium B:** una oficina inicial, OrgAdmin inicial, plan Premium.
- Usar Org Basic A para recorrer cuotas manualmente; en Org Premium B comprobar los límites entregados en sesión y crear un segundo OrgAdmin para los casos que lo necesitan. Los rechazos en los topes Premium quedan para fixtures de integración.
- En Org A o B: al menos dos oficinas activas, un OfficeManager asignado a sólo una de ellas y Viewers distribuidos en una o ambas.
- **Org ajena C:** conservar un recurso identificable para comprobar aislamiento entre tenants.
- Inventario demo de red y manual, una tarea, una revisión y un escáner por oficina cuando los seeds ya los provean.

Usar correos únicos para cada alta. Marcar los IDs obtenidos durante las pruebas localmente, pero no presentarlos como identificadores al usuario final.

## 4. Casos de autenticación y contexto

### AUTH-01 — Login de cada portal

**Objetivo:** comprobar que el login común enruta según el tipo de cuenta.

1. Iniciar sesión como PlatformAdmin.
2. Confirmar que abre StaffPortal (`/`) y muestra Resumen, Organizaciones y Mensajes.
3. Cerrar sesión; entrar como OrgAdmin, OfficeManager y Viewer, uno por vez.
4. Confirmar que abre el Portal de Organización (`/portal`) y muestra navegación acorde al rol.

**Esperado:** una sesión de Admin no se confunde con Users; no se conserva sesión de la cuenta anterior.

### AUTH-02 — Credenciales inválidas y cuenta inactiva

**Objetivo:** comprobar errores de autenticación y bloqueo nativo.

1. Intentar iniciar sesión con contraseña incorrecta y luego correo inexistente.
2. Probar una cuenta desactivada con contraseña correcta y, después de una baja, reutilizar una sesión que había quedado abierta.
3. Comprobar el bloqueo tras cinco intentos fallidos; verificar que dura diez minutos y se libera solo.

**Esperado:** correo inexistente o contraseña incorrecta muestra “El correo o la contraseña no son correctos”; una cuenta desactivada con contraseña correcta muestra el mensaje específico de cuenta desactivada. La cuenta inactiva no obtiene contexto ni conserva sesiones válidas. Evitar bloquear cuentas útiles salvo en el entorno local.

### AUTH-03 — Contexto de sesión

**Objetivo:** contrastar rol, tenant, alcance, permisos y cuotas que consume el frontend.

1. Como cada rol, pedir `GET /api/v1/session` en Inspeccionar o cURL.
2. Comparar `role`, `organizationId`, `officeIds`, `orgWide`, `permissions`, `features` y `limits` con lo que muestra la UI.
3. Como PlatformAdmin, comparar StaffPortal normal con visita a una organización; volver al portal de plataforma.

**Esperado:** organización y oficinas corresponden a la membresía; el Admin sólo recibe alcance de organización cuando la está visitando.

## 5. Permisos: matriz de recorridos

Fuente: `access/rbac/permissions.ts`, `access/tenant/resolveTenantContext.ts` y controles server-side de cada endpoint.

| Capacidad                              | PlatformAdmin en StaffPortal    | PlatformAdmin visitando una org | OrgAdmin            | OfficeManager                                                                                                     | Viewer                                                         |
| -------------------------------------- | ------------------------------- | ------------------------------- | ------------------- | ----------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Crear organización                     | Sí, REQ-ORG-01                  | No desde el contexto de visita  | No                  | No                                                                                                                | No                                                             |
| Alta de oficina                        | No en StaffPortal normal        | Como OrgAdmin                   | Sí                  | No                                                                                                                | No                                                             |
| Alta de usuario                        | OrgAdmin adicional, REQ-USER-02 | Según REQ-USER-01               | Sí                  | Sólo Viewer en sus oficinas, por el punto de entrada REQ-USER-01                                                  | No                                                             |
| Leer inventario                        | Resumen de plataforma           | Alcance de org visitada         | Sí                  | Sólo sus oficinas                                                                                                 | Sólo lectura de su alcance                                     |
| Editar negocio del activo de red       | No                              | Como OrgAdmin                   | Sí                  | Sí, dentro de oficina                                                                                             | No                                                             |
| Crear activo manual                    | No                              | Como OrgAdmin                   | Sí                  | Sí, dentro de oficina                                                                                             | No                                                             |
| Administrar oficina/membresía/settings | No                              | Como OrgAdmin                   | Sí                  | Sólo oficinas de Viewers activos completamente dentro de su alcance; no roles, settings ni estructura de oficinas | No                                                             |
| Desactivar/reactivar personas | No | Como OrgAdmin | Sí, con invariantes de baja | Sólo Viewers con todas sus oficinas dentro del alcance del Manager | No |
| Tareas                                 | Leer                            | Todas las acciones OrgAdmin     | Todas               | Crear, leer, editar, tomar/liberar, asignar/reasignar, completar, cancelar, archivar y eliminar dentro de alcance | Leer, tomar/liberar/completar                                  |
| Revisión de seguridad                  | Lectura/visita                  | Según alcance OrgAdmin          | Gestiona respuestas | Gestiona dentro de oficinas                                                                                       | Responde sólo revisiones de activos propios; lectura del resto |

### 5.1 Modalidad y alcance de esta ronda

Sin Playwright, los recorridos E2E de esta sección se ejecutan manualmente desde el navegador. No requieren DevTools, cURL, edición de requests ni inspección de JSON. Se verifica la experiencia completa de cada actor, incluidos navegación, acciones disponibles, resultado visible y persistencia tras recargar. La cobertura exhaustiva de cada funcionalidad continúa en sus secciones específicas; aquí se comprueba un recorrido representativo por contexto/rol.

El bloqueo server-side, la manipulación de IDs y los intentos de ampliar privilegios quedan asignados a integración según §5.3. Ocultar un botón, redirigir o mostrar una página 404 no demuestra autorización del servidor. Aprobar estos E2E manuales no cierra los controles de integración pendientes.

### 5.2 Recorridos E2E manuales — seguimiento de ejecución

**Avance informado:** el usuario completó `PERM-M01` a `PERM-M05` e informó que los permisos funcionan. Se aprueba el comportamiento de permisos observado en estos recorridos. Las mejoras y hallazgos puntuales conservan su revalidación específica; esto no certifica toda la matriz server-side. Se reportó que, al editar el detalle de un activo de red, «Guardar cambios» permanecía bloqueado al modificar responsable u otros campos, con distintos roles. El usuario identificó el error en la ubicación sembrada: «Finanzas — puesto 4» contiene un guion largo que el contrato de texto no permite. Se corrigieron cinco ubicaciones del seed para usar guion simple y se agregó validación de alias/ubicación del seed con el contrato compartido. Los formularios de activos de red y manuales permiten intentar guardar para mostrar todos los errores; mantienen la validación durante la edición y no envían datos inválidos. Esto no implica habilitar acciones bloqueadas por permisos, carga o confirmación. La corrección del seed no reescribe los activos ya identificados ni las ediciones existentes. **Pendiente de revalidación E2E:** corregir la ubicación del activo existente desde la UI, cambiar responsable y otro campo válido, guardar y recargar; comprobar también que los campos inválidos muestran errores accionables. No considerar resuelto el hallazgo manual hasta repetir este recorrido.

**Hallazgo de validación de activo manual:** al intentar crear sin categoría, el formulario enumeraba los identificadores internos de todas las categorías. Se reemplazó por «Selecciona una categoría.» y se agregó un mensaje genérico breve para los selectores que no tengan texto propio. **Pendiente de revalidación E2E:** intentar crear sin categoría, comprobar el mensaje, seleccionar una categoría y verificar que el error desaparezca; completar los demás campos y confirmar el alta. El resultado de permisos de `PERM-M04` se registra por separado de esta validación de formulario.

**Criterio de presentación de validaciones:** los errores de datos se muestran debajo del campo correspondiente, sin duplicarlos en alertas generales. Al enviar se muestran todos los campos inválidos y al corregirlos se actualiza su mensaje. Las alertas/notificaciones generales quedan para errores sin campo asociado (red, permisos, cuotas). Se aplicó al alta de personas, la selección de oficinas en edición de acceso y los formularios de activos; el perfil personal actualiza el error al corregir el nombre. **Pendiente de revalidación E2E:** enviar «Crear persona» vacío, comprobar los errores bajo nombre/correo/contraseña y oficinas cuando corresponda, corregir cada valor y comprobar que su mensaje desaparezca sin borrar los demás datos ni crear una cuenta inválida.

**Consistencia de mensajes de título:** en alta y edición de tareas, un título vacío o compuesto sólo por espacios muestra «Escribe un título.», igual que el título obligatorio de mensajes. Con uno o dos caracteres muestra «Escribe al menos 3 caracteres.». El mensaje general de longitud mínima tampoco debe confundir un valor vacío con uno corto. **Pendiente de revalidación E2E:** probar vacío, espacios, dos caracteres y un título válido; comprobar que el mensaje cambia según corresponda y desaparece al corregirlo.

**Confirmaciones de eliminación:** prohibidos los diálogos nativos del navegador (`alert`, `confirm`, `prompt`). Se reemplazó la confirmación de eliminar tarea en listado y detalle por un mismo modal Mantine con nombre de la tarea, consecuencia y botones «Cancelar»/«Eliminar tarea». **Pendiente de revalidación E2E:** desde ambas superficies, cancelar y verificar que la tarea siga presente; luego confirmar sobre tareas de prueba distintas y comprobar que desaparecen tras recargar. Al eliminar desde el detalle, debe volver al listado conservando el contexto de organización visitante cuando corresponda.

**Estilo de errores de campos:** usar instrucciones breves y con punto final: «Escribe un alias.», «Escribe un título.», «Selecciona un responsable.» o «Selecciona una oficina.». Para campos sin mensaje específico, «Completa este campo.». Se unificaron también los mensajes de oficinas de personas, datos dependientes de categoría y exclusión de evaluación. **Pendiente de revalidación E2E:** enviar formularios incompletos y comprobar que los mensajes debajo de cada campo indican qué acción realizar; corregirlos y verificar que desaparezcan.

**Preparación:** organización activa con dos oficinas, OrgAdmin, OfficeManager limitado a Oficina 1 y Viewer de Oficina 1. Preparar activos, tareas elegibles y un activo cuyo responsable sea el Viewer, con revisión abierta. Usar datos de prueba y cupo disponible; si falta un requisito, marcar el recorrido dependiente como bloqueado. Cerrar sesión al cambiar de actor o utilizar sesiones de navegador separadas.

#### PERM-M01 — PlatformAdmin en StaffPortal

**Objetivo:** distinguir las funciones de plataforma de las de una organización.

1. Entrar a StaffPortal y abrir Organizaciones → Crear organización; recorrer el asistente y cancelar.
2. Comprobar que cancelar no agrega una organización al listado.
3. Visitar una organización desde el listado y comprobar que se identifica el contexto visitado; volver a StaffPortal.

**Esperado:** el alta se ofrece desde plataforma y la navegación permite distinguir ambos contextos. El alta completa se prueba en `ORG-01/02`.

#### PERM-M02 — PlatformAdmin visitando una organización

**Objetivo:** comprobar que el contexto de visita permite trabajar como administrador de la organización.

1. Visitar la organización y abrir inventario, oficinas, personas y configuración.
2. Cambiar un dato de negocio permitido de un activo de prueba, guardar y recargar su detalle.
3. Volver a StaffPortal y visitar otra organización preparada, comprobando que las pantallas muestran sus datos.

**Esperado:** las acciones administrativas de organización están disponibles, la edición persiste y la navegación muestra los datos del contexto seleccionado. Esto no sustituye las pruebas de aislamiento server-side.

#### PERM-M03 — OrgAdmin

**Objetivo:** comprobar que puede administrar y consultar toda su organización.

1. Abrir Administración y comprobar los accesos a oficinas, personas y configuración.
2. Seleccionar Oficina 1 y Oficina 2 y revisar el inventario de cada una.
3. Cambiar el nombre de una oficina de prueba, guardar y recargar.

**Esperado:** ambas oficinas están disponibles y el cambio guardado se refleja en la interfaz. Los formularios y ciclos de vida completos se prueban en las secciones siguientes.

#### PERM-M04 — OfficeManager

**Objetivo:** comprobar la gestión delegada dentro de su oficina.

1. Entrar con el Manager de Oficina 1; revisar selector e inventario. Oficina 2 no debe ofrecerse como contexto accesible.
2. Abrir Portal → Equipo y el formulario de alta: sólo debe ofrecer Viewer y oficinas propias. Cancelar. No debe aparecer Administración general.
3. Crear un activo manual en Oficina 1, guardar y recargar. Editar un dato de negocio de un activo de red identificado de esa oficina y recargar.
4. Crear una tarea de prueba en Oficina 1 y comprobar que aparece tras recargar.
5. Sobre un Viewer cuyas oficinas estén todas dentro de su alcance, abrir la baja, revisar impactos, cancelar, volver a abrir y confirmar con su correo. Recargar Equipo y reactivarlo. No deben ofrecerse estas acciones sobre Managers, OrgAdmins ni Viewers compartidos con oficinas ajenas. Este paso nuevo queda pendiente de revalidación manual.

**Esperado:** las operaciones permitidas funcionan de extremo a extremo y los controles no ofrecen ampliar rol ni alcance. Si una operación devuelve error inesperado, registrar mensaje y datos del escenario sin manipular requests.

#### PERM-M05 — Viewer

**Objetivo:** comprobar la lectura y participación permitida sin controles de administración.

1. Revisar inventario y detalle de Oficina 1: no deben ofrecer creación/edición de activos ni Administración o gestión de Equipo.
2. Abrir una tarea elegible, tomarla, recargar, liberarla y recargar. Tomarla nuevamente y completarla; comprobar el resultado tras recargar.
3. Abrir la revisión del activo propio, guardar un borrador y volver a abrirlo. Completarla y recargar.
4. Abrir, si existe, una revisión de activo ajeno que pueda consultar dentro de su oficina: no debe permitir responder. Las revisiones de organización no deben estar disponibles.

**Esperado:** tareas y revisión propia reflejan los cambios confirmados. La lectura de información autorizada no ofrece acciones administrativas ni permite responder por otras personas.

**Registro manual:** ID, actor, organización/oficina, resultado esperado y observado, persistencia tras recargar, captura de desvíos y estado (`OK`, `Falla`, `Bloqueado por prerequisito`, `No aplica`). No marcar estos casos como aprobados hasta ejecutarlos.

### 5.3 Integración — cobertura a completar y ejecutar

Hay pruebas existentes de permisos, alcance y ciclos de vida; su presencia no demuestra cobertura completa ni ejecución satisfactoria. Revisar y reutilizar lo existente antes de agregar casos. Estos pendientes no se trasladan al recorrido E2E manual.

| Tipo de chequeo | Objetivo pendiente de completar y verificar mediante integración |
| --- | --- |
| Autorización por rol/contexto | Cubrir las acciones de la matriz para PlatformAdmin normal/visitante, OrgAdmin, Manager y Viewer; rechazar solicitudes sin sesión o sin permiso. |
| Alcance de organización y oficina | Sustituir IDs en URL, query y body; impedir lecturas o escrituras fuera del alcance, incluso cuando el rol permite la acción en abstracto. |
| Altas y escalada de privilegios | Verificar alta de organización sólo desde plataforma; Manager crea sólo Viewer en sus oficinas; rechazo de roles, relaciones y oficinas manipulados. |
| Cuotas e invariantes | Comprobar límites al crear/reactivar/cambiar roles, último administrador y ausencia de registros parciales en intentos rechazados. |
| Inventario y configuración | Verificar permisos de creación manual y edición de negocio/settings, así como rechazo de cambios técnicos o relaciones no permitidas. |
| Datos de prueba | Verificar que los alias y ubicaciones generados por el seed satisfacen los contratos de edición; repetir el seed sin sobrescribir cambios del usuario. |
| Tareas | Cubrir rol × acción × alcance × elegibilidad/estado, incluido rechazo de acciones administrativas del Viewer. |
| Revisiones | Probar mediante endpoints lectura/respuesta según alcance y responsabilidad; Viewer responde sólo revisiones de activos propios. |

En cada rechazo comprobar también que los datos persistidos no cambiaron y que no se revelaron datos ajenos. Las pruebas deben usar entradas válidas para distinguir un rechazo de autorización de un error de formato. Concurrencia y rollback requieren fixtures controlados. Registrar por separado la cobertura implementada, su ejecución y los resultados pendientes.

### 5.4 Observaciones del cierre de recorridos y cambios a revalidar

- **Geografía:** los formularios usan `management-system/lib/argentina-geo.json`. Sus metadatos declaran Georef AR, IGN/INDEC, snapshot del 11-10-2026. Contiene 24 jurisdicciones y 529 departamentos/partidos/comunas (15 comunas de CABA). No incluye un catálogo de localidades. Es un archivo local, sin consulta ni actualización automática del servicio durante el uso de la aplicación.
- **Edición de organizaciones:** se incorporó en StaffPortal la acción «Editar organización» para organizaciones activas. Permite nombre, rubro y explicación opcional de «Otro». Probar abrir, cancelar, guardar, recargar y volver a editar; cambiar de «Otro» a un rubro del catálogo debe limpiar su explicación. Los datos se guardan juntos y la operación no cambia el plan. La acción «Añadir OrgAdmin» queda en «Más acciones». No se permite editar desde el contexto de visita ni como usuario de organización.
- **Equipo:** ahora reutiliza la misma vista, tabla, métricas, filtros y formulario de Usuarios. Probar como Manager búsqueda por nombre/correo, filtro por rol, nombres de oficinas y alta de Viewer. Sus contadores son de las personas visibles de sus oficinas, no consumo global del plan. El rol de los Viewers se muestra como dato de sólo lectura; se permite editar sus oficinas cuando estén activos y todas sus asignaciones estén dentro del alcance del Manager. Se ofrecen baja y reactivación sólo para Viewers íntegramente dentro del mismo alcance; las oficinas de alta siguen limitadas al mismo alcance. Repetir un recorrido corto como OrgAdmin para verificar su administración habitual.
- **Modo oscuro:** se suavizaron fondos y colores de badges, el acento principal, los bordes de acciones sutiles y las sombras de tarjetas. Revisar Tareas, Equipo y Usuarios, incluyendo estados, prioridades, filtros, botones y foco con teclado; comprobar legibilidad y diferenciación de estados. Cambiar a modo claro y comprobar que siga siendo legible. Ajuste pendiente de aceptación visual del usuario; no se da por verificado mediante pruebas de backend.
- **Criterio de permisos en UI:** las acciones no autorizadas no deben ofrecer edición seguida de un rechazo al guardar. Mostrar datos de sólo lectura u ocultar acciones que no correspondan; deshabilitar con explicación cuando un bloqueo sea temporal o sea útil conocer su causa (cupo, estado o confirmación). No confundir esos bloqueos con errores de validación de campos. El servidor debe repetir sus controles en cada operación.

**Integración ejecutada para la edición nueva:** seis casos en PostgreSQL desechable con Node 22: sin sesión/roles de organización, PlatformAdmin visitante, edición y limpieza de «Otro», entradas inválidas/campos ajenos, rollback ante fallo de settings y organización inactiva. Todos aprobados; dos pruebas unitarias adicionales del dominio también aprobadas. Estos resultados no reemplazan las revalidaciones manuales de las nuevas pantallas ni cierran las combinaciones restantes de §5.3.

**Nueva delegación y desplegables — revalidación manual pendiente:**

1. Como Manager, en Equipo, verificar que los Viewers propios muestran Desactivar/Reactivar y, si están activos, Editar oficinas. En esa edición el rol debe permanecer como dato de sólo lectura. Revisar el preview, probar cancelar y correo incorrecto, confirmar sobre una cuenta de prueba y recargar. La persona inactiva debe seguir disponible para reactivarla. Un Viewer con alguna oficina fuera de alcance no debe ofrecer estas acciones.
2. Reactivar y comprobar el acceso con un nuevo login. Los activos no se restauran ni las tareas se reclaman automáticamente. Las cuotas se mantienen.
3. Con una oficina de nombre largo seleccionada, pasar el cursor y enfocar el selector con Tab: debe mostrarse el nombre completo. Abrirlo y comprobar que las opciones largas se leen completas en varias líneas.
4. Revisar selectores de oficina, provincia, categoría, rol y filtros, además de menús: separación sutil entre opciones, hover/selección distinguibles y navegación con teclado. Repetir en claro y oscuro.

**Integración de la delegación:** implementada en `endpoints/member-manager-status.audit.integration.test.ts`; verifica permisos específicos de estado sin edición general, lectura de inactivos gestionables, rechazo de otros roles/oficinas/tenants y oficinas mixtas, conservación del alta de Viewer, bloqueo de cambios de rol y oficinas ajenas, edición delegada de oficinas activas con liberación de responsabilidades sólo en las retiradas, revalidación del alcance del actor dentro de la transacción para no reutilizar permisos obsoletos, confirmación de correo, revocación de acceso, liberación de tareas, activos sin responsable o reasignados, reactivación y cuotas. El criterio de alcance tiene además seis pruebas unitarias. Ejecución completada: once casos de integración en PostgreSQL desechable y seis pruebas unitarias de alcance, todos aprobados. También pasaron las regresiones de permisos, contexto y responsabilidades de miembros. Estas verificaciones no sustituyen el chequeo visual anterior.

**Edición delegada de acceso — pendiente de E2E manual:** preparar un Manager con dos oficinas activas asignadas y un Viewer activo dentro de ese alcance. En Equipo → Editar oficinas, comprobar el rol Viewer de sólo lectura. Agregar la segunda oficina, guardar y recargar; retirar una y comprobar el aviso de consecuencias antes de guardar. Verificar que los activos de esa oficina queden sin responsable y las tareas tomadas allí vuelvan a pendientes, conservando los de la oficina restante. Intentar dejar el selector vacío: debe mostrar «Selecciona al menos una oficina.» debajo del campo y no guardar. Viewers con alguna oficina fuera del alcance, Managers, OrgAdmins e inactivos no deben ofrecer esta edición delegada. Las once integraciones y seis pruebas unitarias del flujo ampliado pasaron en entorno desechable; falta este recorrido visual.

**Correcciones de la revisión del PR #38 — integración ejecutada:** consolidado del Manager con caché invalidada por la señal de evidencia de la organización (vida máxima 60 s), estado de recálculo compartido con OrgAdmin, error `risk_unavailable` (503) sin detalles internos y sin contadores en 0 en la UI, permisos de miembros desde la matriz y por rango (1 = máxima autoridad), lectura única de funciones del plan y dos pruebas de integración actualizadas al comportamiento vigente. Pendiente E2E: RISK-01 pasos 2, 4 y 5, ERROR-02 (Panel y Revisiones sin conexión), USER-07 paso 3 y PERM-M04 paso 5.

**Fallo de arranque del seed expanded:** la validación de alias detectó el separador «·» en nombres generados. Se normalizaron únicamente los textos de presentación de fixtures (separadores «·», «—» y «–» pasan a guion simple) para activos de red, manuales y títulos de tareas. Se aplican los contratos compartidos antes de escribir. Las etiquetas originales siguen formando las claves de seed para conservar la identidad de escenarios, evitar duplicados y respetar ediciones existentes. En PostgreSQL desechable se verificaron `standard`, `expanded`, su reejecución y la conservación de alias/títulos personalizados y claves históricas. Pasaron los once casos de la suite de integración de seguridad/seed, las pruebas unitarias relacionadas, tipos y formato. **Pendiente E2E:** próximo arranque local con el código actualizado, comprobar que termina «Seed demo integral OK» y que los nombres generados se pueden editar desde el portal. El warning de adaptador de correo es independiente del fallo de validación.

## 6. Onboarding de organización y usuarios

Esta ronda se ejecuta como **E2E manual desde la UI**, sin Network, cURL, JSON ni manipulación de IDs. No hay Playwright. Usar correos únicos, datos de prueba y las contraseñas iniciales de esas cuentas; cerrar sesión entre actores. Registrar cada caso como `OK`, `Falla`, `Bloqueado por prerequisito` o `No aplica`, con resultado visible, persistencia tras recargar y captura si hay desvíos. El usuario informó que ejecutó todos los casos de esta sección. Se registraron observaciones de presentación y mensajes; las correcciones requieren revalidación manual.

**Hallazgos de la ronda y revalidación pendiente:**

- **Correo duplicado (`ORG-04` / `USER-04`):** mostrar «Ese correo ya está asociado a una cuenta. Escribe otro correo.» debajo del correo, conservando el resto del formulario. Repetir el alta con un correo utilizado, corregirlo y comprobar el alta sin duplicados.
- **Notificaciones:** título obligatorio para el resultado de cada acción; descripción opcional para explicar la causa o el siguiente paso. Repetir una creación exitosa y una reactivación rechazada por límite del plan; comprobar títulos y detalle sin repeticiones.
- **Dashboard sin pendientes:** presentación compacta con icono alineado y texto «Sin pendientes detectados». Revisar con distintos anchos de ventana.
- **Riesgo sin evaluación:** un solo aviso que distingue ausencia de evaluación, cálculo en espera/en curso y cálculo fallido. No mencionar un puntaje anterior si no existe. Revisar el primer cálculo y una actualización con evaluación previa.

**Automatización:** las combinaciones de estado del mensaje de riesgo y la traducción/presentación de errores se verifican con pruebas unitarias. Mantener en integración la detección real de correo duplicado y la ausencia de altas parciales; comprobar en E2E la ubicación del error y la conservación del formulario. Verificación de estas correcciones: 9 pruebas unitarias aprobadas (`http-client.audit.test.ts` y `risk-calculation-message.audit.test.ts`) y `tsc --noEmit` sin errores. No se ejecutó una nueva integración de altas ni una revalidación visual automática.

**Revisión de claridad de toast:** revisadas las 65 llamadas de los 21 archivos que emiten notificaciones (34 directas y 31 mediante `showApiError`), más el traductor compartido de errores. Se conservaron los mensajes que ya identificaban bien el resultado.

| Área revisada | Criterio aplicado |
| --- | --- |
| Tareas | El título identifica reclamar, liberar, completar, cancelar, archivar, eliminar o reasignar; el detalle explica conflictos y restricciones sin términos como «terminal» o «elegible». |
| Organizaciones, personas y oficinas | Diferenciar creación, edición, desactivación y reactivación; explicar organización inactiva, oficinas no disponibles, confirmación incorrecta, último administrador/oficina y cupos del plan. Correo duplicado sigue debajo del campo. |
| Escáneres | Distinguir descargar el instalador de instalarlo; explicar cupo agotado y revocación del acceso. |
| Activos y revisiones | Distinguir crear, actualizar e identificar; explicar revisión todavía no habilitada, selección desactualizada y preguntas cambiadas sin mostrar claves internas. |
| Escaneos e instantáneas | Indicar a qué elemento corresponde el nombre guardado. La notificación de nuevo escaneo conserva oficina, fecha y acceso al inventario. |
| Mensajes del portal | Explicar qué respuesta no se guardó, por qué un enlace no está disponible y cuándo un mensaje está inactivo o vencido. |
| Sesión, perfil y configuración | Conservar confirmaciones breves y específicas. Explicar sesión vencida, falta de permiso, conexión fallida, demasiados intentos y fallos del servidor cuando no haya una causa de negocio conocida. |

**Verificación de esta revisión:** 30 pruebas unitarias de mensajes aprobadas y chequeo de tipos sin errores. La revisión es de código y presentación de errores; no demuestra nuevamente el rechazo de cada operación en el servidor. Para integración siguen pendientes los casos de la matriz inferior. Revalidar manualmente la claridad, ubicación y lectura de los toast al ejecutar esos recorridos.

### 6.1 Controles para completar y ejecutar mediante integración

| Chequeo | Objetivo de integración | Cobertura revisada y pendiente |
| --- | --- | --- |
| Alta de organización Basic/Premium (`ORG-01/02`) | Verificar organización, settings, suscripción, oficina, usuario, membresía y ciclos relacionados; permisos del endpoint y límites exactos de ambos planes. | `createOrgWithAdmin.test.ts` cubre orden/transacciones con dependencias simuladas. La suite del seed ejercita bootstrap real, pero no sustituye la matriz del endpoint de alta para ambos planes. Completar esa integración específica. |
| Errores y atomicidad del bootstrap (`ORG-04`) | Rechazar correo existente y ubicaciones inválidas sin registros parciales; inyectar un fallo intermedio y comprobar rollback real y reintento. | Hay prueba unitaria de rollback simulado. Falta comprobar ese fallo del bootstrap con base real. El rollback probado al editar nombre/rubro no demuestra atomicidad del alta. |
| Alta de miembros (`USER-01/02/04`) | Cubrir actores y roles admitidos, oficinas activas propias/ajenas/mixtas, correo duplicado y ausencia de cuentas/membresías parciales. | `member-manager-status.audit.integration.test.ts` prueba creación de Viewer por Manager y rechazo de alta de OrgAdmin. Completar demás roles, oficinas manipuladas y duplicados del alta. |
| OrgAdmin adicional y cuotas (`USER-03/04`) | Verificar ambos puntos de entrada, rol fijo desde StaffPortal, Basic/Premium, rechazo al alcanzar topes y concurrencia sin exceder cupos. | Las integraciones de miembros comprueban cuotas de reactivación. No sustituyen los escenarios completos de creación y concurrencia: completar casos específicos de alta. |
| Contratos y errores de entrada (`ORG-03`, `USER-04`) | Verificar que los endpoints apliquen los contratos compartidos y rechacen entradas inválidas sin escribir datos. | Las reglas aisladas corresponden a unitarias de schemas; completar su aplicación en endpoints. La presentación del mensaje, los campos marcados y la conservación del formulario siguen siendo E2E. |

**Estado:** revisión de cobertura, sin ejecución nueva de suites en esta revisión. Reutilizar lo existente y registrar implementación/ejecución pendiente por separado. No llenar manualmente todos los cupos Premium ni cortar el servidor para intentar demostrar rollback.

### ORG-01 — Alta feliz Basic

**Objetivo E2E:** comprobar que el asistente crea una organización utilizable y que su administrador puede entrar inmediatamente.

1. Como PlatformAdmin en StaffPortal, ir a Organizaciones → Crear organización.
2. Completar nombre, rubro, plan Basic, primera oficina con provincia/departamento válidos y primer administrador con nombre, correo único y contraseña inicial. Comprobar que el rol inicial es OrgAdmin y no se puede cambiar.
3. Revisar el resumen y confirmar una sola vez. Comprobar que el asistente se cierra y aparece la organización activa en la lista; recargar.
4. Cerrar sesión y entrar con el primer administrador creado. Abrir Oficinas y Usuarios: deben aparecer la oficina y el propio administrador, con los datos guardados. Si se muestran contadores de plan, deben corresponder a Basic.

**Esperado:** alta completa visible, persistencia y acceso inmediato a la organización correcta. Los límites exactos y las relaciones internas quedan asignados a integración; no consultar `/session` ni `agent-summary` manualmente en este caso.

### ORG-02 — Alta feliz Premium

**Objetivo E2E:** comprobar la elección de Premium y el mismo recorrido completo de alta/acceso.

1. Volver a StaffPortal como PlatformAdmin y repetir el alta con otra organización y otro correo, eligiendo Premium.
2. Confirmar que el resumen muestra Premium antes de crear. Guardar y recargar la lista.
3. Entrar con su administrador inicial y comprobar la oficina y la cuenta creadas. En los contadores visibles de Usuarios/Oficinas, revisar que corresponden a Premium.

**Esperado:** selección y datos persistidos coherentes con Premium, sin cambiar el alcance administrativo. La comparación exacta de todos los límites y sus rechazos se prueba con integración y fixtures.

### ORG-03 — Navegación, revisión, validación y cancelación

**Objetivo E2E:** evaluar si el asistente permite completar/corregir datos y explica claramente los errores.

1. Abrir el asistente y recorrer las pestañas en otro orden. Escribir datos, ir a otra pestaña y volver: deben conservarse.
2. Ir a Revisar sin completar todo. Comprobar “Sin completar” y el aviso breve de datos pendientes. Pulsar Crear: deben aparecer los errores debajo de sus campos, marcarse las pestañas afectadas y abrirse la primera con errores.
3. Corregir los valores y comprobar que sus errores desaparecen. Elegir “Otro”, escribir un detalle opcional y cambiar a un rubro del catálogo: el detalle anterior no debe conservarse como información de ese rubro. Elegir “Otro” sin detalle es válido.
4. Elegir provincia y departamento; cambiar la provincia y comprobar que se limpia el departamento incompatible.
5. Modificar datos, volver a Revisar y comprobar que el resumen coincide. Cancelar y verificar en la lista que no se creó una organización; volver a abrir y comprobar el reinicio del formulario.

**Esperado:** navegación libre, datos conservados entre pestañas, errores accionables junto al campo, revisión actualizada y cancelación sin alta. Las combinaciones inválidas del contrato se cubren en unitarias/integración.

### ORG-04 — Alta rechazada y recuperación desde la UI

**Objetivo E2E:** comprobar la explicación del error y la posibilidad de corregir/reintentar.

1. Completar un alta usando el correo de una cuenta de prueba existente y un nombre de organización nuevo y reconocible.
2. Confirmar. Comprobar que se explica el rechazo, se mantienen los datos y no se muestra éxito. Si el mensaje es genérico o no explica el correo duplicado, registrar la falla.
3. Corregir el correo por uno único y volver a confirmar. Comprobar que aparece una sola organización con ese nombre y recargar.
4. Entrar con el nuevo administrador para completar el recorrido.

**Esperado:** error comprensible, formulario recuperable y un único alta visible después del reintento. La ausencia de registros huérfanos y el rollback real se comprueban mediante integración, no mirando solamente la lista.

### USER-01 — OrgAdmin crea Manager y Viewer

**Objetivo E2E:** comprobar el alta de personas y su acceso inmediato con la asignación elegida.

1. Como OrgAdmin, abrir Administración → Usuarios → Crear persona. Crear un OfficeManager con correo único y una oficina activa.
2. Crear un Viewer con otro correo y una oficina activa. Comprobar filas, roles, oficinas y estado activo; recargar.
3. Cerrar sesión y entrar con cada cuenta creada, una por vez. Comprobar identidad, navegación y oficina disponibles según la asignación realizada.

**Esperado:** las cuentas creadas pueden entrar inmediatamente y la UI refleja su acceso. Los intentos de escalada y las relaciones manipuladas quedan para integración.

### USER-02 — OfficeManager crea Viewer

**Objetivo E2E:** comprobar que el alta delegada ofrece únicamente las opciones admitidas.

1. Entrar con un Manager asignado sólo a Oficina 1. Abrir Portal → Equipo → Crear persona.
2. Comprobar el rol Viewer de sólo lectura y que el selector de oficinas ofrece únicamente las propias. Administración → Usuarios no debe aparecer.
3. Crear con datos válidos; comprobar la fila y recargar.
4. Cerrar sesión y entrar con el Viewer creado; comprobar su identidad y Oficina 1.

**Esperado:** recorrido completo sin opciones que amplíen sus privilegios. Manipular roles/oficinas o probar IDs de otra organización corresponde a integración.

### USER-03 — OrgAdmin adicional desde StaffPortal

**Objetivo E2E:** comprobar el punto de entrada específico de plataforma y la claridad del rechazo por cuota.

1. Como PlatformAdmin, en una organización Premium con cupo, abrir Más acciones → Añadir OrgAdmin.
2. Comprobar que el rol es fijo y no se pide oficina. Crear con datos únicos y recargar el listado de Usuarios de la organización visitada.
3. Cerrar sesión y entrar con la cuenta nueva: debe acceder como administrador de esa organización.
4. Desde StaffPortal, en la organización Basic cuyo administrador inicial ocupa el único cupo, intentar un alta adicional con datos de prueba únicos. Comprobar que se explica el límite y no se informa éxito.

**Esperado:** alta utilizable cuando hay cupo y rechazo claro en Basic. No completar manualmente tres administradores Premium ni otros topes: su enforcement y concurrencia quedan para integración.

### USER-04 — Validaciones del formulario de persona

**Objetivo E2E:** comprobar mensajes por campo, corrección dinámica y cancelación.

1. Como OrgAdmin, abrir Crear persona, seleccionar Viewer e intentar crear con nombre/correo/contraseña/oficinas sin completar.
2. Comprobar todos los errores debajo de sus campos, con instrucciones breves; no deben aparecer alertas nativas ni listas de identificadores internos.
3. Probar un correo mal formado y contraseña menor a ocho caracteres; corregir cada campo y seleccionar una oficina. Comprobar que los errores se actualizan sin borrar los otros datos.
4. Cancelar y verificar que no aparece una persona nueva. Reabrir, completar datos válidos, crear y recargar: debe aparecer una sola persona activa.

**Esperado:** guía clara para corregir, cancelación sin alta y guardado válido visible. Correo duplicado, cuotas exhaustivas, roles/IDs inválidos y oficinas ajenas/inactivas/repetidas deben completarse mediante integración. La verificación de UI de un rechazo de cuota ya se incluye en `USER-03`.

## 7. Administración de oficinas

**Modalidad:** E2E manual desde la interfaz, sin Network, cURL ni edición de requests. Hay cuatro recorridos manuales (`OFFICE-01/02/03/05`); `OFFICE-04` queda asignado a integración. No repetir los recorridos de permisos de §5 ya aprobados, salvo que haya un cambio o un comportamiento nuevo. El usuario informó que completó esta sección manual (sin nuevas observaciones comunicadas). Esto no cierra los controles de integración pendientes ni acredita las ramas que no tuvieron fixtures disponibles.

### 7.1 Controles para completar y ejecutar mediante integración

Cobertura inspeccionada: `management-system/endpoints/offices.integration.test.ts` utiliza Payload con base de datos y llama a los handlers con requests construidos en la prueba. No demuestra por sí sola el enrutamiento ni la autenticación real mediante cookies. `management-system/modules/offices/schema.test.ts` comprueba contratos de cambio de estado, no todos los campos del alta/edición. **No se ejecutaron estas suites en esta revisión.**

| Chequeo | Objetivo | Cobertura existente y pendiente |
| --- | --- | --- |
| Alta y edición (`OFFICE-01`) | Persistir nombre/ubicación y rechazar contratos inválidos sin escritura. | La integración crea una oficina con provincia y rechaza departamento de otra provincia. Completar edición, campos obligatorios, provincia inexistente y ausencia de cambios tras rechazos. |
| Permisos y aislamiento (`OFFICE-01`) | Rechazar actores no autorizados y oficinas ajenas, independientemente de la interfaz. | Se comprueba rechazo de alta por Manager. Completar Viewer, falta de sesión, edición/estado/impacto, organizaciones ajenas y autenticación por el enrutador. |
| Cuotas (`OFFICE-02`) | Contar solo oficinas activas, aplicar límites de alta/reactivación y evitar excederlos ante solicitudes concurrentes. | Se verifica rechazo de un alta con un tope de prueba de dos oficinas. Completar Basic/Premium reales, liberación/reutilización del cupo, reactivación y concurrencia. No llenar Premium manualmente. |
| Baja con impactos (`OFFICE-03`) | Aplicar juntas las decisiones de activos, miembros, agentes, tareas y revisiones, o revertir toda la operación. | Se comprueban resumen, traslado/retiro de activos manuales, responsables/ubicación, tareas, persona sin oficina, agente revocado y cierre de revisión. Completar rollback ante fallo intermedio y otras combinaciones de miembros/oficinas/tareas. |
| Última oficina y confirmación (`OFFICE-03`) | Rechazar la baja de la última oficina activa y la confirmación incorrecta sin efectos parciales. | Hay rechazos por confirmación incorrecta y última oficina. Completar comprobación explícita de ausencia de cambios en todas las entidades afectadas. |
| Impacto obsoleto y destinos (`OFFICE-04`) | Rechazar decisiones incompletas u obsoletas y destinos iguales, inactivos o ajenos, sin movimientos parciales. | Se rechazan lista de decisiones incompleta y destino igual al origen. Completar cambios concurrentes reales, destinos inactivos/ajenos y atomicidad de cada rechazo. |
| Reactivación (`OFFICE-05`) | Abrir un ciclo nuevo sin restaurar efectos de la baja; respetar cuota y evitar duplicar ciclos. | Se comprueba nuevo ciclo, persona inactiva, activo de red retirado y activo manual que permanece en destino. Completar escáneres y activos manuales retirados después de reactivar, repetición/concurrencia y cuota. |

**Separación de objetivos:** la integración verifica reglas, persistencia interna y atomicidad; el E2E verifica que la persona entienda el recorrido, pueda completarlo y vea sus efectos tras recargar. Para rechazos automatizados, comprobar también que no se modifican datos ni se exponen oficinas ajenas.

### Preparación de los recorridos manuales

- Entrar como **OrgAdmin** en una organización de prueba activa. Para el ciclo de baja/reactivación, conservar otra oficina activa y usar únicamente datos descartables.
- Tener cupo para crear una oficina; si no lo hay, registrar el bloqueo y comenzar por `OFFICE-02`. No desactivar oficinas con datos útiles solo para liberar cupo.
- Para la baja, preparar dos activos manuales identificables: uno para mover y otro para dar de baja, y anotar sus responsables, ubicación y tareas abiertas. Si hay un escáner, activos de red, una revisión abierta o una persona asignada exclusivamente a esa oficina, anotar también su estado inicial. Marcar como no verificadas las ramas sin datos disponibles.
- Registrar por recorrido: resultado (`OK`, `Falla`, `Bloqueado por prerequisito` o `No aplica`), observación/captura y comprobación tras recargar. No declarar aprobada una rama que no pudo ejercitarse.

### OFFICE-01 — Crear, validar y editar desde la interfaz

**Objetivo:** comprobar un formulario comprensible, errores junto a los campos y datos visibles que se conservan al volver a entrar.

1. Ir a **Administración → Oficinas → Nueva oficina**. Intentar crear con nombre y provincia vacíos. Deben aparecer errores debajo de ambos campos y el modal debe permanecer abierto.
2. Escribir un nombre de prueba, por ejemplo `Sucursal E2E`, y elegir provincia. Los errores deben desaparecer al corregir sus campos; si permanecen hasta volver a guardar, registrar la falla de validación dinámica.
3. Elegir una comuna/partido/departamento y después cambiar de provincia. La selección dependiente debe limpiarse y ofrecer únicamente opciones de la nueva provincia. Dejar ese campo vacío: es opcional. No intentar introducir identificadores de otra provincia manualmente.
4. Crear la oficina. Deben cerrarse el modal y aparecer la fila con nombre y ubicación legibles. Buscarla por nombre y recargar para comprobar que continúa guardada.
5. Abrir **Editar**, cambiar nombre y ubicación y guardar. Recargar y volver a abrir: deben conservarse los nuevos valores.
6. Abrir **Editar** otra vez, modificar el nombre y pulsar **Cancelar**. Al reabrir, debe seguir el último nombre guardado.

**Motivo/esperado:** distinguir cambios guardados de cambios descartados y comprobar dependencias de ubicación. La validación de todas las entradas manipuladas y los rechazos de permisos quedan en integración; no repetir manualmente la matriz de roles de §5.

### OFFICE-02 — Límite visible del plan

**Objetivo:** entender por qué no se puede crear otra oficina y comprobar que el contador acompaña los cambios de estado.

1. Revisar el contador de oficinas activas y el máximo del plan. Si la organización de prueba ya está al límite, usar ese estado; en Basic puede aprovecharse el límite de tres oficinas. No llenar todos los cupos de Premium para este chequeo.
2. En ese estado, pasar el cursor por **Nueva oficina**. Debe explicar que se alcanzó el máximo y que desactivar una oficina libera cupo. Hacer clic: el modal no debe abrirse.
3. Después de la baja de prueba de `OFFICE-03`, regresar a Oficinas y recargar. El contador debe disminuir y **Nueva oficina** debe volver a estar disponible.
4. Si luego vas a ejecutar `OFFICE-05`, conservar ese cupo libre para reactivar la oficina. No hace falta crear una oficina adicional para demostrar el contador.

**Motivo/esperado:** comprobar la explicación y disponibilidad de la acción en la UI. El cómputo exacto, crear usando el cupo liberado, los límites de reactivación y el intento de saltar el bloqueo visual se verifican mediante integración. Si no hay un estado al límite, registrar esa parte como bloqueada por prerequisito.

### OFFICE-03 — Revisar el impacto, cancelar y desactivar

**Objetivo:** comprender las consecuencias antes de confirmar y comprobar desde las pantallas que se aplican las decisiones elegidas.

1. En una oficina de prueba con otra oficina activa disponible, pulsar **Desactivar**. Comparar el resumen con los datos anotados: escáneres, activos, personas afectadas, tareas y revisión abierta, según lo que exista. No confirmar si el resumen no carga o muestra un error.
2. En la tabla de activos manuales, elegir **Mover** para uno y seleccionar la oficina destino; elegir **Dar de baja** para otro. Cambiar una decisión con **Volver a decidir** para comprobar que puede corregirse. Si se usan casillas de selección, comprobar que la acción en bloque afecta solo a las filas elegidas.
3. Dejar un activo sin decisión o escribir un nombre de oficina incorrecto. La confirmación debe permanecer bloqueada; no debe aplicarse ningún cambio. Aquí se prueba la prevención visual, no el rechazo del servidor.
4. Pulsar **Cancelar**. Revisar que la oficina y los activos siguen en su estado inicial. Volver a abrir: las decisiones anteriores deben haberse descartado.
5. Elegir nuevamente los destinos, escribir el nombre correcto y confirmar una sola vez. El modal debe cerrarse, aparecer una notificación clara y la oficina debe figurar inactiva también tras recargar. Usar **Todas / Inactivas** si hace falta.
6. Buscar los dos activos manuales: el trasladado debe estar en destino, sin responsable ni ubicación anterior, conservando su historial y tareas; el retirado debe figurar dado de baja y sus tareas abiertas, canceladas. Usar los filtros de estado y oficina necesarios para encontrarlos.
7. Para las ramas preparadas, comprobar en sus pantallas: activos de red retirados, tareas propias de la oficina canceladas, revisión de oficina cerrada, escáner revocado y persona que quedó sin oficinas desactivada. Una persona que conserva otra oficina activa no debe desactivarse por este motivo. No instalar ni esperar un escáner solo para completar este recorrido: su parada y el rechazo de futuras comunicaciones quedan para integración.

**Motivo/esperado:** evitar decisiones ambiguas o cambios al cancelar. El modal debe anticipar los mismos efectos que después se observan; la atomicidad y todas las combinaciones de cascadas quedan para integración. Si una rama no está visible o no tiene datos, dejarla identificada como pendiente.

### OFFICE-04 — Impacto obsoleto y destinos inválidos: integración

**Sin recorrido manual obligatorio.** La manipulación de destinos, la sincronización de dos sesiones y la comprobación de ausencia de cambios parciales se implementan y ejecutan con fixtures controlados, según §7.1. Si aparece un conflicto durante un uso normal, registrar si el mensaje explica qué revisar y si el resumen se actualiza antes de reintentar; no es necesario provocarlo manualmente.

### OFFICE-05 — Reactivar sin restauraciones inesperadas

**Objetivo:** comprobar que reactivar la oficina recupera su disponibilidad y explica qué efectos de la baja se conservan.

1. Con cupo disponible, localizar la oficina inactiva de `OFFICE-03` y pulsar **Reactivar**. Leer el aviso: vuelve la oficina y se abre una nueva revisión; escáneres, personas y activos no se restauran automáticamente.
2. Pulsar **Cancelar**. La oficina debe seguir inactiva. Volver a abrir y confirmar **Reactivar oficina**.
3. Recargar Oficinas: debe aparecer activa y el contador aumentar. Comprobar que vuelve a estar disponible en el selector de oficinas.
4. Abrir las revisiones de seguridad de esa oficina. Debe existir una nueva revisión abierta y conservarse la anterior como historia; si no hay forma de distinguirlas en la UI, registrar la limitación y dejar la comprobación exacta a integración.
5. Volver a los elementos verificados en la baja: la persona desactivada sigue inactiva, el escáner sigue revocado, los activos retirados siguen retirados y el activo trasladado permanece en destino. Comprobar las ramas con datos disponibles, sin reactivar ni reinstalar nada adicional.

**Motivo/esperado:** distinguir reactivar la oficina de revertir una baja completa. Los rechazos por cupo y la ausencia exacta de ciclos duplicados se verifican mediante integración.

## 8. Usuarios, permisos y ciclo de vida

**Modalidad:** E2E manual desde la UI. No repetir los recorridos ya aprobados en §4/§5, salvo cambios posteriores o hallazgos pendientes. **Seguimiento:** el usuario informó que terminó esta sección sin nuevas observaciones; el reporte previo de USER-08 se conserva como antecedente, sin atribuir una causa técnica a su resolución. La prioridad de revalidación es `USER-08`: no considerar cerrado el guardado de oficinas de personas inactivas solo por ver un toast de éxito. Registrar estado, datos visibles y resultado tras recargar.

### 8.1 Controles para completar y ejecutar mediante integración

Cobertura inspeccionada: `endpoints/orgMembers.integration.test.ts` llama a handlers con Payload; `endpoints/member-manager-status.audit.integration.test.ts` ejercita el enrutador local y autenticación con cookie. Esta última tiene once casos cuyo resultado previo se conserva abajo. **No se ejecutaron suites nuevamente en esta revisión.**

| Chequeo | Objetivo | Cobertura existente y pendiente |
| --- | --- | --- |
| Edición y alcance (`USER-05`) | Aplicar rol/oficinas y permisos efectivos sin escalamiento ni acceso a oficinas ajenas. | Hay pruebas de delegación a Viewers activos, oficinas retiradas y rechazo de cambios de rol por Manager; la suite de handlers comprueba degradación propia y rechazo de volver a elevarse. Completar matriz de actores/roles/tenants por enrutador y actualización de contexto con sesión existente. |
| Baja y confirmación (`USER-06`) | Validar correo, responsables elegibles, impactos y revocación de acceso, sin efectos al rechazar. | La suite de once casos cubre confirmación, impactos, acceso revocado y reemplazo elegible. Completar todas las combinaciones de activos/oficinas y rollback ante fallos intermedios. La claridad del modal y Cancelar siguen siendo E2E. |
| Invariantes y cuotas (`USER-07`) | Impedir baja propia/último administrador, exigir oficinas activas y respetar organización y cupos. | Hay casos de baja propia/último administrador en handlers, cuota de reactivación y oficinas ajenas en el enrutador. Completar matriz Basic/Premium, cambios de rol activo con cuota, persona sin oficinas y concurrencia, comprobando ausencia de cambios en rechazos. |
| Preparar acceso inactivo (`USER-08`) | Guardar rol/oficinas sin activar ni ocupar cuota; aplicar los límites al reactivar. | La suite de once casos incluye persistencia de oficinas manteniendo rol, cambio de rol inactivo, cupos y organización inactiva. No reemplaza la revalidación del fallo observado desde la aplicación. |

### USER-05 — Editar acceso activo

**Objetivo E2E:** comprobar que los cambios guardados se reflejan en la tabla y en lo que puede ver la persona afectada.

1. Como OrgAdmin, ir a Usuarios y abrir **Editar acceso** de un Viewer de prueba. Anotar rol y oficinas actuales.
2. Cambiar oficinas, guardar y recargar. Reabrir el lápiz: deben conservarse las elegidas. Con sesión de esa persona en otro perfil de navegador, recargar el portal y comprobar el alcance nuevo, sin datos de oficinas retiradas.
3. Si hay cupo de Manager, cambiar ese Viewer a OfficeManager y asignar una oficina activa. Guardar, recargar y comprobar el rol en la tabla; en su sesión, comprobar las acciones nuevas que corresponden al rol. Si no hay cupo, registrar esa rama como bloqueada por prerequisito.
4. Abrir edición otra vez, cambiar datos y cancelar. Reabrir: debe seguir el último acceso guardado.
5. Con un rol no administrador, quitar todas las oficinas e intentar guardar. Debe aparecer el error debajo del selector, conservarse el acceso anterior y desaparecer el error al seleccionar una oficina.

**Esperado:** coherencia entre formulario, tabla y sesión del usuario. Los intentos de escalar privilegios, modificar oficinas ajenas y degradar/restaurar el propio administrador quedan en integración; no bajar el propio rol solo para este recorrido.

### USER-06 — Desactivar, cancelar y revisar efectos

**Objetivo E2E:** entender el impacto y confirmar que cancelar no cambia nada y que la baja afecta a la persona correcta.

1. Como OrgAdmin, elegir una persona de prueba activa con activos y, si están disponibles, tareas reclamadas/asignadas. Anotar su estado y abrir **Desactivar**. El resumen debe coincidir con lo preparado. Si el impacto no carga, no debe permitirse confirmar; el mensaje debe ofrecer reintento. No provocar una caída del servidor manualmente.
2. Escribir un correo incorrecto y comprobar que la confirmación queda bloqueada. Seleccionar un nuevo responsable elegible si se quiere reasignar, o dejar explícitamente los activos sin responsable.
3. Cancelar. La persona debe seguir activa y sus responsabilidades sin cambios. Reabrir, revisar el impacto y confirmar con el correo correcto.
4. Recargar Usuarios: debe aparecer inactiva. Comprobar que los activos elegibles pasan al responsable elegido o quedan sin responsable; las tareas reclamadas en curso vuelven a pendientes y las asignadas no pasan automáticamente a otra persona. Si existe una sesión previa de la persona, intentar navegar o recargar: debe perder el acceso.

**Esperado:** consecuencias comprensibles y coherentes con el modal. Si ya se completó este recorrido en §4/§5 sin cambios posteriores relevantes, registrar la evidencia existente; no volver a desactivar personas solo para repetirlo. Las ramas sin datos preparados quedan identificadas como no verificadas.

### USER-07 — Explicación de bloqueos y reactivación

**Objetivo E2E:** comprobar que un rechazo explica el motivo y conserva el estado anterior.

1. Revisar las acciones disponibles para la propia cuenta: la UI debe impedir desactivarse. No intentar saltar el bloqueo desde requests. La protección del último administrador se comprueba mediante integración.
2. Si ya existe una persona inactiva cuyo rol está al límite, intentar reactivarla. Debe aparecer «No se pudo reactivar a la persona» y explicar el límite de personas activas de ese rol; después de recargar debe seguir inactiva. No llenar cupos manualmente para preparar el escenario.
3. Con una persona inactiva y cupo disponible, abrir reactivación y cancelar: debe seguir inactiva. Volver a abrir y confirmar; comprobar estado activo y acceso al portal. Si necesita oficinas, «Reactivar» sigue disponible: confirmarlo sin elegir oficina debe mostrar «Selecciona al menos una oficina.» debajo del selector y no enviar nada. Las responsabilidades anteriores no se restauran automáticamente.

**Esperado:** mensajes específicos y estados persistidos. Si estas ramas ya se probaron con el código actual, reutilizar su resultado; si faltan fixtures, registrar el bloqueo y dejar su regla exacta para integración. No desactivar una oficina adicional únicamente para forzar una persona sin oficinas.

### USER-08 — Editar acceso de persona inactiva sin reactivarla

**Objetivo E2E:** cerrar el fallo reportado: un toast de éxito no basta si las oficinas vuelven al valor anterior.

1. Como OrgAdmin en una organización activa, localizar una persona inactiva y anotar su rol y oficinas. El lápiz de **Editar acceso** debe estar disponible.
2. Cambiar **solo las oficinas**, manteniendo el rol, y guardar. Recargar Usuarios y volver a abrir el lápiz: deben conservarse exactamente las oficinas elegidas y el estado **Inactivo**. Este paso reproduce directamente el fallo anterior.
3. Cambiar también el rol y guardar. Recargar y reabrir: debe conservar el rol nuevo y seguir inactiva. Si ya hay un rol con cupo completo, se puede usar para comprobar que editar no exige activar ni consume cupo; no llenar el plan para ello. Intentar iniciar sesión con esa persona: debe seguir sin acceso.
4. Si el rol nuevo está al límite, intentar reactivar: debe explicar el límite y mantener la cuenta inactiva. Con cupo disponible, reactivar y comprobar login, rol y oficinas preparados. No se restauran activos ni se reclaman tareas automáticamente.
5. Si aparece éxito pero se pierden las oficinas al recargar, registrar **Falla**, conservando captura de la selección guardada y del valor reabierto. No atribuirlo automáticamente a falta de reinicio ni dar por resuelto el caso por la integración. No reiniciar el servidor para esta revisión.

**Esperado:** edición y activación independientes. La delegación de OfficeManager para editar oficinas continúa limitada a Viewers activos; esa matriz y el rechazo de organización inactiva quedan en integración o en la evidencia ya obtenida en §5.

**Verificación automática:** once integraciones del flujo de miembros y seis pruebas unitarias de alcance aprobadas, incluyendo el bloqueo por cuota anterior, edición inactiva sin ocupar cupo, persistencia de oficinas, límite del rol nuevo, reactivación con cupo, último administrador y rechazo de organización inactiva. **Seguimiento manual:** ejecución de §8 informada como completada por el usuario, sin nuevas observaciones. No se ejecutaron nuevamente estas suites.

**Antecedente de USER-08 — falla observada antes de completar §8:** el usuario informó que editar oficinas de una persona inactiva muestra toast de éxito pero no conserva el cambio. El código fuente y el bundle del contenedor contienen la corrección que persiste oficinas explícitas en miembros inactivos; el contenedor se inició antes de esa corrección. Payload mantiene una instancia/configuración de endpoints en memoria: la hipótesis pendiente es un handler anterior todavía cargado, no una causa confirmada. No se reinició la aplicación. Repetir el caso con el proceso actualizado y comprobar la fila tras recargar; si continúa, investigar el guardado y la lectura en ejecución. La integración aprobada no demostraba por sí sola la resolución en UI; posteriormente el usuario informó que completó §8 sin nuevas observaciones. No se confirmó la hipótesis técnica del proceso anterior.

## 9. Ajustes y perfil

**Modalidad:** E2E manual, sin requests ni valores manipulados. Tres casos; `SETTINGS-02` se divide en política y perfil de la organización. Usar OrgAdmin para Configuración y una cuenta de cada tipo para el perfil personal. Anotar los valores iniciales para poder restaurarlos al terminar. El usuario informó que ejecutó todos los recorridos de esta sección. Se registraron tres observaciones y se aplicaron correcciones; posteriormente el usuario informó que completó la revalidación sin nuevas observaciones.

**Observaciones de la ejecución y correcciones a revalidar:**

- **Botones de inventario:** Guardar y Restaurar compartían el indicador de carga. Solo el botón que inicia la operación debe mostrar la animación; ambos y los campos quedan bloqueados mientras se guarda, evitando acciones simultáneas. Repetir ambas operaciones por separado.
- **Restaurar predeterminados:** restablecer umbral/intervalo y desmarcar «Tomar una instantánea antes de cada escaneo». Debe estar disponible aunque los selectores ya estén en predeterminados si la casilla está marcada. Tras guardar y recargar, comprobar 72 h, 7 días, casilla desmarcada e intervalo editable. Ante un fallo, no presentar el formulario como restaurado.
- **Card de riesgo:** cuando cobertura y confiabilidad saltan debajo del puntaje, deben ocupar el ancho disponible. Revisar con ventana amplia y estrecha que la barra se adapte, sin una columna angosta aislada ni desbordamiento del texto.

### 9.1 Controles para completar y ejecutar mediante integración

**Revisión de cobertura, sin ejecución nueva de suites.** Mantener separadas presencia de pruebas, ejecución y aprobación.

| Chequeo | Objetivo y cobertura inspeccionada |
| --- | --- |
| Configuración de inventario (`SETTINGS-01`) | Verificar GET/PATCH, valores admitidos, valores predeterminados, aislamiento y rechazo a roles sin permiso sin escrituras. `remaining-corroboration.audit.test.ts` tiene una prueba unitaria del schema que rechaza opciones fuera de rango; no sustituye integración de persistencia/permisos del endpoint. Completar esa matriz. La aplicación real del umbral y la programación de instantáneas también corresponden a integración con tiempo/escaneos controlados. |
| Política (`SETTINGS-02A`) | Verificar versiones, actores, reconciliación de ciclos y cola de riesgo en la misma transacción, más permisos y tenants. `audit-fixes.audit.integration.test.ts` incluye rollback de política y conservación de trabajos previos al fallar la creación de un trabajo. `assessments.integration.test.ts` comprueba reconciliación/visibilidad de ciclos, pero no demuestra por sí sola toda la matriz del endpoint de cambio de política. Completar los escenarios restantes y su ejecución. |
| Perfil de organización (`SETTINGS-02B`) | Verificar respuestas válidas, permisos, actor/fecha y que cambie recomendaciones sin modificar el puntaje por esta acción. `organizationSettings.integration.test.ts` prueba rechazo de Manager, valor inválido y guardado con actor/fecha mediante handlers. `domain/organizations/maturity.test.ts` prueba el cálculo del nivel de forma unitaria. Completar otros roles/tenants, autenticación por enrutador y efectos persistidos. |
| Perfil personal (`SETTINGS-03`) | Verificar que usuario y PlatformAdmin solo actualicen su propio nombre y no alteren correo, roles, relaciones ni otras cuentas. `orgMembers.integration.test.ts` contiene guardado/lectura del nombre del usuario; no acredita la matriz del perfil de PlatformAdmin. Completar ambos endpoints, entradas inválidas y ausencia de efectos ajenos. |

### SETTINGS-01 — Configuración de inventario

**Objetivo E2E:** comprobar que las opciones se entienden, sus dependencias son visibles y los valores guardados se conservan.

1. Como OrgAdmin, abrir **Administración → Configuración** y anotar el umbral sin conexión, la casilla de instantánea por escaneo y el intervalo actuales.
2. Con la casilla desmarcada, elegir **48 h** y **3 días**; pulsar **Guardar cambios**. Salir de la pantalla, volver y recargar: deben conservarse ambos valores.
3. Marcar **Tomar una instantánea antes de cada escaneo**. El intervalo debe quedar bloqueado y la ayuda explicar que se ignora mientras la opción está activa. Guardar, salir y volver: la casilla debe seguir marcada.
4. Desmarcarla y guardar. Comprobar que el intervalo vuelve a ser editable. No esperar horas/días ni lanzar escaneos para demostrar su aplicación: eso se verifica con integración.
5. Pulsar **Restaurar valores predeterminados** y recargar. Umbral e intervalo deben volver al predeterminado de plataforma (72 h y 7 días). Este botón guarda inmediatamente los tres valores: umbral/intervalo predeterminados y casilla de instantánea por escaneo desmarcada. El intervalo debe volver a ser editable. Comprobar también el caso en que los dos selectores ya estaban en predeterminados y solo quedaba marcada la casilla.
6. Restaurar los valores de prueba originales si se quieren conservar y guardar. No forzar opciones que el selector no ofrece ni repetir la matriz de permisos de §5.

**Esperado:** coherencia entre selección, explicación, disponibilidad del intervalo y valores al reabrir. Si se ve éxito pero los datos anteriores vuelven, registrar falla.

### SETTINGS-02A — Política de revisión

**Objetivo E2E:** comprobar una elección deliberada y persistida, conservando el historial.

1. Anotar si la política actual es **Esencial** o **Reforzada**. En una organización de prueba, elegir la otra.
2. En el modal **¿Cambiar la política de revisión?**, leer las consecuencias y pulsar **Cancelar**. La política actual debe permanecer igual incluso al recargar.
3. Volver a elegirla y pulsar **Confirmar cambio**. El modal debe cerrarse y la tarjeta elegida mostrar **Política actual**. Recargar para comprobar persistencia.
4. Abrir las revisiones de seguridad: comprobar que la política nueva se refleja en los ciclos aplicables y que las revisiones completadas siguen disponibles como historial. Si faltan revisiones completadas en el fixture, dejar esa rama sin verificar.
5. Consultar Puntaje de riesgo: si se observa una actualización en espera/en curso, el aviso debe ser comprensible y coherente con la existencia o ausencia de evaluación previa. Un cálculo rápido puede terminar antes de abrir la pantalla; no exigir ver el estado intermedio ni provocar un fallo.

**Esperado:** cancelar no cambia la elección; confirmar sí y conserva historia. Versiones, actor/fecha internos, cantidad exacta de ciclos y atomicidad con riesgo quedan para integración. No exigir metadatos que la UI no muestra. Volver a la política original crea otro cambio real, no deshace los ciclos anteriores.

### SETTINGS-02B — Perfil de la organización

**Objetivo E2E:** comprobar que las dos respuestas producen un nivel comprensible y quedan guardadas.

1. En **Perfil de la organización**, anotar las respuestas actuales. Si aún no hay respuestas, intentar **Guardar perfil**: debe señalar debajo de cada pregunta la opción faltante. Si ya está completo, no manipular requests para vaciarlo.
2. Elegir **Sí** para una persona a cargo de sistemas y **Sí, de forma regular** para presupuesto. Debe mostrarse **Nivel: Avanzado** antes de guardar.
3. Guardar, salir de Configuración, volver y recargar. Deben conservarse respuestas/nivel y mostrarse la fecha de última actualización.
4. Probar **No / No**: debe mostrarse **Nivel: Inicial**. Si se guardan esas respuestas, comprobar también persistencia al reabrir. Restaurar las iniciales cuando corresponda.
5. Revisar la explicación: este perfil orienta recomendaciones y no modifica por sí solo el puntaje de riesgo. No usar una comparación visual del puntaje como prueba de causalidad, porque podría haber recálculos de otras acciones.

**Esperado:** nivel y ayudas claros, respuestas persistidas y fecha legible. El autor no se muestra actualmente en este formulario; comprobar su registro en integración.

### SETTINGS-03 — Perfil personal de usuario y PlatformAdmin

**Objetivo E2E:** comprobar que ambas cuentas pueden cambiar su nombre, manteniendo el correo como dato de solo lectura.

1. Como usuario de organización, abrir **Cuenta**, anotar el nombre y borrar su contenido. Intentar guardar: debe aparecer el error debajo del campo y conservarse el nombre guardado.
2. Escribir un nombre con un carácter inválido, por ejemplo `Nombre <prueba>`. Debe mostrar una indicación comprensible; corregirlo y comprobar que el error desaparece.
3. Escribir un nombre válido y guardar. Salir de Cuenta, volver y recargar: debe conservarse el nombre nuevo. El correo debe continuar visible y sin posibilidad de editarse.
4. Cambiar otra vez el texto sin guardar, salir y volver: debe aparecer el último nombre guardado. No esperar un modal de descarte si no existe.
5. Cerrar sesión y repetir el recorrido desde la cuenta de **PlatformAdmin en StaffPortal**. Cada cuenta debe conservar su propio nombre; restaurarlos al terminar si corresponde.

**Esperado:** errores bajo el campo, persistencia del nombre propio y consistencia de ambos formularios. El rechazo de otros campos o de modificaciones a otra cuenta queda en integración. Si ya se verificó un paso con el código actual, reutilizar su evidencia.

## 10. Inventario y agentes

**Modalidad:** E2E manual desde la interfaz. Cinco recorridos (`INV-01/02/03/04`, `AGENT-01`), algunos dependientes de fixtures. `AGENT-02` queda para integración; no extraer tokens ni enviar requests manuales. No repetir la matriz de roles ya aprobada en §5. El usuario informó que completó los recorridos de Inventario y Agente y posteriormente confirmó la finalización de la sección tras las correcciones. Se conservan abajo los hallazgos y la evidencia automática; esto no cierra los controles de integración pendientes.

**Selector de oficinas y consolidado de riesgo — cambios a revalidar:** se conserva «Todas las oficinas» sin sustituirla por Córdoba. Con OrgAdmin, se muestra la evaluación global persistida de la organización; con OfficeManager, un consolidado de las oficinas activas que tiene asignadas. Ambos explican que es un cálculo conjunto sobre activos y controles, no un promedio de los porcentajes de oficinas. Viewer conserva la consulta de riesgo por oficina concreta.

El alcance de OfficeManager se deriva de la membresía en el servidor; no acepta un conjunto de oficinas enviado por el cliente. El consolidado reutiliza el mismo motor y evidencia vigente, es de solo lectura y no crea una evaluación histórica ni un ID persistido. Por eso no ofrece crear una tarea vinculada a una evaluación histórica desde ese resultado transitorio; se mantienen las acciones sobre elementos con referencia real.

**Legibilidad:** tooltip del nombre solo cuando está truncado y el selector permanece cerrado, mediante hover o foco de teclado. Divisores en Select/MultiSelect/Autocomplete/Combobox/Menu: trazo fino centrado de hasta el 24 % del ancho (máximo 3 rem) y menor contraste en ambos temas. Se verificó que ese estilo corto está presente en el CSS servido; aceptación visual pendiente. No se reinició la aplicación.

**Verificación automática de este cambio:** 8 integraciones en PostgreSQL desechable mediante enrutador local y cookies (consolidado distinto de promedio simple, consistencia entre resumen/detalle, ausencia de escrituras, oficinas/tenants ajenos, membresía actual, oficinas inactivas, historia global no autorizada, Viewer, autenticación/paginación/orden, funcionalidad deshabilitada y ocultamiento de puntajes). Además, 12 unitarias de autorización/alcance/modelo de lectura y chequeo de tipos aprobados. Estas pruebas no cierran el resto de §10.1.

**Revalidación E2E:**

1. Recargar y entrar como Sofía con Palermo y Córdoba asignadas. Elegir «Todas las oficinas»: debe mantenerse la selección y aparecer el riesgo conjunto de sus oficinas, sin pedir una oficina concreta.
2. Comparar Panel general, Puntaje de riesgo y Revisiones: deben explicar el alcance asignado y mostrar datos coherentes. Alternar cada oficina y volver a Todas; no exigir que el consolidado sea la media aritmética.
3. Como OrgAdmin con Todas, comprobar la leyenda de evaluación global y la aclaración de que no es un promedio.
4. Revisar opciones de oficina/provincia y menús en ambos temas: línea central corta, discreta y sin atravesar el ancho completo. Comprobar hover, selección y teclado.

**Segunda corrección del divisor — revalidación visual pendiente en la aplicación:** el usuario todavía observó una línea de borde completa. Se elimina explícitamente ese borde con una regla de mayor especificidad y se cambia la clase compartida para evitar que coincida con la versión anterior. El único divisor nuevo es un pseudoelemento centrado del 24 % (máximo 3 rem). Se verificó en Chrome headless, con una reproducción aislada usando el CSS servido y las variables reales del tema: opciones de 190 px, borde superior de 0 px, trazo de 45,6 × 1 px y centrado en ambos temas. Se inspeccionaron las capturas; chequeo de tipos aprobado. Esto no equivale a una navegación E2E autenticada. Recargar y repetir el selector de oficinas, provincias y menús. No se cambió el seed ni se reinició la aplicación.

**Hover claro — mejora a revalidar:** se aplica fondo `bone-2` al pasar por opciones y al seleccionar con teclado en modo claro; el texto de la opción enfocada conserva contraste. Los estilos del modo oscuro permanecen como estaban y las opciones deshabilitadas no reciben el nuevo resaltado. Se comprobó con Chrome sobre una reproducción que usa el CSS servido: fondo claro resaltado `rgb(234, 229, 218)`, texto `rgb(58, 52, 42)`, selección de teclado legible y opción deshabilitada sin ese fondo. Esta comprobación de estilos no reemplaza el recorrido manual autenticado. Revisar oficina/provincia y menús con mouse y teclado.

**Observaciones del cierre de Inventario y Agente:**

- **Búsqueda sin tildes:** `portatil` y `portátil` deben encontrar los mismos activos, también con mayúsculas o acentos Unicode descompuestos. Se comparte la comparación en inventario de red/manual, tareas, personas, oficinas, organizaciones, revisiones, selección masiva y selectores/autocompletados buscables. Se conservan los textos y valores originales; no se aplica esta normalización a credenciales ni a confirmaciones de identidad. Revalidar `Portátil de recepción`, `Córdoba` y una persona con apellido acentuado; comprobar búsqueda en ambas direcciones.
- **Pestaña técnica:** quitar el contador de «Red y puertos» y conservar el acceso al detalle de red. Verificar un activo con servicios y otro sin servicios.
- **Incidente de ubicación:** mostrar carga únicamente en «Confirmar traslado» o «Mantener ubicación», según la acción pulsada y el incidente correspondiente. Las demás acciones quedan bloqueadas durante la petición; «Marcar como revisado» también limita su carga al incidente elegido. El error de resolución se muestra solo en el aviso afectado. Probar ambas decisiones sobre incidentes de prueba diferentes y comprobar que otros avisos no muestran carga.

**Automatización de búsqueda:** 14 pruebas unitarias aprobadas para comparación sin diacríticos, campos ausentes, IP/correo, etiquetas/valores originales, grupos, opciones deshabilitadas y límite global de resultados. El comportamiento visual y la carga de botones requieren revalidación manual; no se ejecutó una integración nueva del endpoint de resolución en esta corrección.

### 10.1 Controles para completar y ejecutar mediante integración

**Cobertura inspeccionada, sin ejecución nueva de suites.** Las integraciones específicas de identificación, revisión y provisión citadas debajo utilizan Payload/base real con requests construidos y llamadas a handlers; no acreditan por sí solas toda la autenticación/enrutamiento de producción.

| Chequeo | Objetivo y cobertura existente/pendiente |
| --- | --- |
| Inventario de red (`INV-01`) | `assetIdentify.integration.test.ts` comprueba autenticación, Viewer sin permiso, oficina fuera del alcance y persistencia de identificación autorizada/no autorizada. `assetUnidentify.integration.test.ts` comprueba retorno a pendiente conservando datos. Completar edición de negocio, campos técnicos inmutables, filtros/aislamiento y matriz completa por enrutador. |
| Activos manuales y exclusión (`INV-02`) | Completar alta/edición/retiro por actor, categoría, responsable y oficina; rechazar responsables ajenos sin escribir. `audit-fixes.audit.integration.test.ts` contiene validación de exclusión de red/manual y expiración repetible. Verificar la ejecución y completar fechas límite, cambios de oficina y efectos sobre evaluaciones/tareas. |
| Incidentes (`INV-03`) | `remaining-corroboration.audit.integration.test.ts` comprueba que mantener ubicación permite actualizar presencia sin mover el activo. Completar decisiones de traslado/identidad, responsables compatibles, permisos de ambas oficinas, incidente resuelto/activo cambiado y destinos inválidos, sin cambios parciales. |
| Revisión periódica (`INV-04`) | `nonNetworkAssetReview.integration.test.ts` comprueba que una revisión vencida queda al día. Completar frecuencias, ventana de habilitación, fechas límite, nunca, permisos y repetición/concurrencia. No esperar días manualmente ni cambiar el reloj del sistema. |
| Escáneres (`AGENT-01`) | `agentProvisioning.integration.test.ts` cubre falta de sesión, Viewer, organización ajena, paquetes POSIX/Windows, plataforma inválida y cuota agotada. `agentRevoke.integration.test.ts` cubre revocación idempotente; `officeAgentSummary.integration.test.ts` cubre alcance del resumen. Completar cuota de oficina/organización Basic/Premium, concurrencia, fallo del empaquetado sin credenciales huérfanas y uso rechazado tras revocación. |
| Canal del escáner (`AGENT-02`) | `reports.integration.test.ts` cubre ingesta/idempotencia, reporte degradado seguido de completo conservando datos de negocio, campos técnicos ausentes admitidos y token inválido. `remaining-corroboration.audit.integration.test.ts` incluye rollback de un reporte y reintento sin duplicar instantáneas; la suite unitaria contiene límites del contrato heartbeat. Completar y ejecutar matriz de token revocado/ID discordante, heartbeat, vendor y límites/errores del contrato. La comunicación real del programa escáner con la aplicación es una validación E2E adicional si se dispone de equipo y entorno preparados. |

### Preparación

Entrar como OrgAdmin a una organización de prueba con dos oficinas. Disponer de un activo de red identificado, otro sin identificar, activos manuales y responsables elegibles. Incidentes y revisiones vencidas deben existir como fixtures: si faltan, registrar el recorrido dependiente como bloqueado, sin inventar requests ni esperar a que venza. Para escáneres, usar una oficina con cupo y credenciales de prueba descartables; no revocar un escáner útil solo para liberar un cupo.

### INV-01 — Inventario de red

**Objetivo E2E:** encontrar un equipo, interpretar su detalle y conservar cambios de negocio sin poder editar evidencia técnica.

1. Abrir Inventario en una oficina con datos. Buscar un equipo conocido y probar los filtros disponibles de estado/criticidad/oficina. Limpiarlos: deben volver los registros esperados. Si una opción no está disponible para ese listado, no exigirla.
2. Abrir un activo identificado. Cambiar alias o ubicación y responsable por otra persona elegible; guardar, recargar y reabrir. Deben persistir los cambios y poder leerse el responsable y la ubicación.
3. Revisar IP, MAC, sistema operativo y servicios: deben presentarse como información de solo lectura, sin controles que inviten a editarlos.
4. Abrir un activo sin identificar, pulsar **Identificar**, completar tipo, autorización y los campos requeridos; confirmar. Recargar: debe cambiar su identificación y habilitar los datos de negocio correspondientes.
5. En un activo de prueba identificado, abrir **Quitar identificación**, cancelar y comprobar que sigue identificado. Repetir y confirmar: debe volver a no identificado. Al identificarlo de nuevo, los datos de negocio conservados deben permitir completar el recorrido sin crear un equipo duplicado.

**Esperado:** búsqueda, filtros y formularios coherentes, persistencia y ausencia de edición técnica. No repetir el recorrido de Viewer de §5 ni intentar eludir controles desde la API.

### INV-02 — Activos manuales

**Objetivo E2E:** crear/editar un activo comprensible, elegir un responsable válido y distinguir exclusión de evaluación de retiro del inventario.

1. Abrir **Crear activo** en el inventario manual e intentar guardar vacío. Deben aparecer errores claros bajo los campos requeridos; en particular, categoría no debe mostrar una lista técnica de identificadores.
2. Completar alias, categoría, criticidad, oficina y responsable, además de campos específicos que pida la categoría. Guardar, buscar el activo y recargar: debe existir una sola fila con los valores elegidos.
3. Editar y cambiar de oficina. Revisar que el responsable elegido siga siendo elegible o deba reemplazarse si perdió cobertura; el selector debe ofrecer personas compatibles. Guardar y comprobar persistencia de oficina/responsable al reabrir.
4. Elegir **Excluido** en «Alcance de la evaluación de seguridad». Intentar guardar sin motivo y sin fecha: deben marcarse los campos. Elegir motivo y una fecha futura dentro de 90 días; si el motivo es «Otro», completar la nota requerida. Guardar y recargar: debe conservar la exclusión y seguir visible en el inventario. Volver a **Incluido**, guardar y comprobar el estado.
5. En un activo manual descartable, cambiar Estado para darlo de baja, guardar y buscarlo con el filtro correspondiente: debe figurar retirado conservando el historial, sin aparecer duplicado.

**Esperado:** mensajes junto a los campos, valores persistidos y diferencia clara entre excluir y retirar. El vencimiento automático de la exclusión, todas las categorías y las combinaciones de responsable/oficina se verifican mediante integración.

**Cambio de interfaz pendiente:** reemplazar el dropdown de alcance por un toggle. Hasta que se implemente, probar el selector actual. La elección del estado inicial debe definirse al implementar; no mezclar ese cambio de producto con la ejecución de esta sección.

### INV-03 — Incidentes de inventario (condicionado a fixtures)

**Objetivo E2E:** comprender un aviso y ver el resultado de una decisión, sin fabricar reportes manuales.

1. Si existen incidentes pendientes, abrir el panel desde Inventario/detalle. Para ubicación, revisar el equipo, la oficina actual y la propuesta. Para identidad, leer qué debe revisarse antes de confirmar.
2. En un incidente de ubicación preparado para traslado, elegir **Confirmar traslado**. Recargar y comprobar la oficina destino; conservar responsable solo si cubre esa oficina. El aviso debe dejar de aparecer como pendiente.
3. En otro incidente de ubicación, elegir **Mantener ubicación**. Recargar: el equipo debe seguir en la oficina original y el incidente no debe continuar pendiente.
4. Para identidad, después de la revisión indicada del equipo y con la evidencia de prueba disponible, elegir **Marcar como revisado**. Recargar y comprobar que el aviso se resuelve; no interpretar esa acción como autorización para aplicar automáticamente los datos contradictorios.

**Esperado:** decisión y efecto visible coherentes. Si no hay incidentes adecuados, registrar los pasos dependientes como bloqueados. Decisiones incompatibles, repetición, cambios concurrentes y destinos ajenos quedan en integración.

### INV-04 — Revisión periódica de activo manual

**Objetivo E2E:** entender cuándo puede confirmarse una revisión y ver la próxima fecha actualizada.

1. Crear o editar un activo manual de prueba y elegir una **Frecuencia de revisión** distinta de «Nunca». Guardar y recargar: comprobar frecuencia, próxima revisión y estado visibles.
2. Con un activo de fixture cuya revisión ya esté habilitada, pulsar **Marcar como revisado**. Esperar el guardado y recargar: debe quedar al día y mostrar próxima fecha actualizada, manteniendo una sola fila.
3. Si el activo todavía no permite revisión, pasar el cursor por la acción: debe explicar que se habilita cerca del vencimiento. No cambiar el reloj ni esperar días para completar la prueba.
4. Editar la frecuencia a **Nunca**, guardar y recargar. No debe exigir una próxima revisión periódica. Si no existe fixture vencido/habilitado, dejar el paso 2 pendiente y completar los demás.

**Esperado:** fechas y acciones comprensibles y persistidas. La fecha exacta de cada frecuencia y los límites temporales quedan para integración.

### AGENT-01 — Descargar y desactivar un escáner

**Objetivo E2E:** comprobar una descarga utilizable y una revocación deliberada, con resumen y cupos coherentes.

1. Como OrgAdmin, abrir **Administración → Oficinas** y pulsar **Instalar escáner / Administrar escáneres** en una oficina de prueba. Revisar nombre de oficina, cupos y opciones de sistema operativo.
2. Elegir **Linux / macOS** y pulsar **Generar y descargar** una sola vez. Comprobar el ZIP descargado con nombre de oficina/plataforma y el escáner nuevo en el resumen al reabrir. No es necesario ejecutar el paquete para validar este recorrido.
3. Abrir el ZIP desde el explorador de archivos y comprobar que contiene `start-agent.sh`. Para Windows, comprobar `start-agent.cmd`/`start-agent.ps1` solo si se genera otro paquete con cupo disponible; cada descarga crea una credencial nueva. No generar repetidamente para llenar el plan ni copiar tokens a la evidencia.
4. Si la oficina ya está al límite, comprobar que **Generar y descargar** está bloqueado y el resumen explica el cupo. Si no se alcanza ese estado con los fixtures existentes, dejar esa rama pendiente.
5. En el escáner de prueba, pulsar **Desactivar** y cancelar el modal. Debe seguir vigente. Repetir y confirmar: el resumen debe mostrarlo revocado/desactivado al recargar y actualizar los cupos. No debe ofrecer una reactivación automática de esa credencial.

**Esperado:** descarga, resumen y confirmación claros. La integridad completa del paquete y el rechazo de credenciales revocadas quedan en integración; instalar el escáner y esperar un análisis real requiere un entorno preparado adicional.

### AGENT-02 — Ingesta, heartbeat y vendor: integración

**Sin recorrido manual de requests.** Idempotencia, JSON inválido, tokens, ID discordante, heartbeat y catálogo vendor se verifican con fixtures y contratos en §10.1. No obtener credenciales de logs ni repetir cURL para esta ronda.

Si ya hay un escáner de prueba funcionando, puede observarse como E2E adicional que un análisis real aparece en Escaneos e Inventario y que la conectividad se actualiza. Su ausencia no se reemplaza por una simulación manual de requests ni acredita el canal real Scanner ↔ Platform por haber pasado pruebas aisladas del servidor.

## 11. Escaneos y snapshots

**Modalidad:** dos recorridos E2E manuales, `SNAP-01` y `SCAN-01`. Usar OrgAdmin, una oficina activa con datos y un activo de prueba cuyo alias pueda cambiarse. Para revisar un informe, debe existir un escaneo; si falta, registrar ese caso como bloqueado por prerequisito. No enviar reportes, manipular tokens, llamar endpoints ni esperar días para completar esta sección. El usuario informó que completó las pruebas y posteriormente confirmó los ajustes de presentación de textos largos y tooltips. Esto no cierra los controles de integración pendientes.

**Observación de cierre — textos largos:** los nombres de escaneos/instantáneas y los encabezados no deben envolver por falta de espacio. Se utiliza el componente compartido `OneLineText` con elipsis y tooltip del contenido completo solo cuando está truncado, mediante hover o foco de teclado. La tabla comparte un layout de columnas acotado; se conservan las líneas secundarias deliberadas de fecha/antigüedad y el ordenamiento por fecha.

**Validación de presentación:** reproducción aislada en Chrome con los componentes React reales (`DataTable`, `DateTimeCell`, `OneLineText`) y el tema de la aplicación. Se comprobaron altura de una línea, desbordamiento con elipsis, tooltip completo al pasar el cursor y al enfocar, ordenamiento cronológico y ausencia de foco extra para etiquetas cortas; se inspeccionaron capturas en ambos temas. Chequeo de tipos aprobado. No equivale a navegación E2E autenticada. Revalidar en Informes de escaneo e Instantáneas con un nombre extenso y encabezados como «Hosts detectados», usando mouse y teclado y variando el ancho.

**Unificación de tooltips — revalidación pendiente:** se elimina la flecha y las demoras locales que diferenciaban texto truncado de acciones. El preset compartido del tema define apariencia, radio, posición superior, apertura a 300 ms y soporte de foco de teclado. Se mantiene la visibilidad condicional del texto truncado. Comprobación en Chrome con los componentes reales: tooltip de título y de acción con idéntico fondo/texto, radio de 4 px, fuente de 14 px, altura de línea de 21,7 px y sin flecha, tanto en claro como en oscuro. Chequeo de tipos aprobado; revisar el título y «Crear tarea relacionada» en la aplicación.

### 11.1 Controles para completar y ejecutar mediante integración

**Cobertura inspeccionada, sin ejecutar suites nuevamente.** Reutilizar las pruebas existentes y completar sus faltantes; no interpretar su presencia como una nueva aprobación.

| Chequeo | Objetivo y cobertura existente/pendiente |
| --- | --- |
| Generación y congelado (`SNAP-01`) | `domain/inventories/createInventorySnapshot.integration.test.ts` prueba inventario/riesgo congelados, activos sin identificar, copia por valor y cálculo de riesgo al tomar la instantánea. Completar el endpoint de generación con sesiones/roles, oficina ausente/ajena/inactiva, aislamiento por enrutador y ausencia de registros parciales al fallar. |
| Automatización y atomicidad de instantáneas | `autoSnapshot.test.ts` contiene controles unitarios; `remaining-corroboration.audit.integration.test.ts` incluye reintentos concurrentes sin duplicados, rollback ante fallo de activo/instantánea y captura coherente ante cambios concurrentes. Verificar ejecución/cobertura de cada combinación de configuración. No provocar concurrencia ni fallos del servidor manualmente. |
| Renombrado de evidencia (`SNAP-01` / `SCAN-01`) | Completar permisos, pertenencia, nombre opcional/contrato y rechazo de modificaciones de contenido a través del endpoint de nombres. Las pruebas unitarias de acceso de `collections/InventorySnapshots/index.test.ts` verifican bloqueo genérico de escritura; no demuestran por sí solas que el renombrado autorizado preserve el contenido histórico. |
| Evidencia y aislamiento (`SCAN-01`) | `security-policy.audit.integration.test.ts` comprueba resumen visible para Viewer con evidencia cruda/sensible omitida, permisos técnicos resueltos y ausencia de datos de otra oficina mediante IDs/relaciones para Manager. Completar matriz de roles/tenants, detalle/listado/renombrado e instantáneas derivadas. La UI de Viewer no sustituye esa comprobación del servidor. |
| Retención (`SCAN-01`) | La misma suite incluye expiración a 30 días, conservación de resumen, repetición del job y protección ante evidencia recién observada. Verificar límites temporales y ausencia de reaparición de datos crudos en instantáneas. La presentación de un informe ya archivado es E2E solo si existe el fixture; no cambiar el reloj ni lanzar limpieza manualmente. |

### SNAP-01 — Generar, renombrar y comprobar una instantánea

**Objetivo E2E:** comprobar que la instantánea identifica una oficina y un momento, conserva datos históricos y admite cambiar su nombre sin alterar su contenido.

1. Como OrgAdmin, seleccionar **una oficina activa concreta** en la barra superior. Anotar el alias y la criticidad de un activo de prueba visible en esa oficina.
2. Ir a **Inventario → Instantáneas** y pulsar **Generar instantánea** una sola vez. Deben aparecer la notificación de éxito y una fila nueva; recargar y comprobar que sigue allí. Si se elige «Todas las oficinas», la generación debe estar bloqueada con explicación: cada instantánea corresponde a una oficina concreta.
3. Abrir la fila nueva. Revisar fecha, oficina indicada en el listado, cantidades, pestañas **Red / Activos manuales** y puntaje/cobertura de ese momento. Localizar el activo anotado. «No evaluable» es válido si faltaban datos; no exigir un porcentaje cuando el resultado no permite mostrarlo.
4. Desde el lápiz del título, escribir `Inventario antes de la revisión` y guardar. Salir al listado, recargar y volver a abrir: debe conservarse el nombre. La fecha y el contenido histórico no deben cambiar.
5. Abrir el lápiz otra vez, escribir otro nombre y cancelar con **X** o **Escape**. Debe mantenerse el anterior. Probar un carácter inválido, por ejemplo `<`, y comprobar el error debajo del campo. Corregirlo; dejar el nombre vacío es válido y debe volver al título predeterminado al guardar.
6. Volver al inventario actual, cambiar el alias del activo de prueba y guardar. Recargar el inventario para comprobar el cambio. Volver a abrir **la misma instantánea**: debe conservar el alias anterior, las cantidades, fecha y resumen de riesgo originales. No generar otra instantánea para esa comparación. Restaurar el alias del inventario si corresponde.
7. En el historial, probar el filtro **Origen → Manual** y luego **Todos los orígenes**. La instantánea nueva debe aparecer como manual y conservar los datos que la identifican.

**Esperado:** separar claramente inventario vivo y registro histórico. No repetir la matriz de permisos ya aprobada en §5; oficina ajena/inactiva, escritura técnica de datos congelados y rollback corresponden a integración.

### SCAN-01 — Consultar, renombrar y entender un informe de escaneo

**Objetivo E2E:** encontrar un informe, comprender su resultado y leer la información disponible según el acceso y la antigüedad de la evidencia.

1. Como OrgAdmin, ir a **Inventario → Informes de escaneo** con una oficina que tenga informes. Probar el filtro **Estado** y volver a **Todos los estados**. Cambiar de oficina con el selector superior y comprobar que el listado acompaña la selección. No buscar filtros de fecha que esta pantalla no ofrece.
2. Abrir un informe. Revisar fecha/ventana del escaneo, oficina, estado, red, equipos detectados y la explicación de ejecución/cobertura. Si existe uno parcial, debe explicar sus limitaciones; no asumir que «parcial» equivale a un informe rechazado completamente.
3. Abrir **Aceptados** y **Rechazados**. Si hay rechazos, el motivo debe poder leerse; si no hay, debe aparecer un estado vacío claro. No fabricar un reporte inválido para crear rechazos.
4. Cambiar el nombre con el lápiz, guardar, salir y recargar: debe conservarse en listado y detalle, sin modificar fecha, estado ni cantidades. Probar cancelar un cambio y corregir un carácter inválido. Un nombre vacío vuelve al título predeterminado.
5. Si el acceso de Viewer a esta evidencia no se verificó ya en §5, entrar con ese rol y abrir un informe de su oficina. Debe poder leer el resumen permitido y no ofrecer renombrado ni contenido técnico restringido. Si el mensaje confunde falta de permiso con vencimiento de evidencia, registrarlo como observación de claridad; la ausencia de datos no demuestra por sí sola que el job de retención se haya ejecutado.
6. **Solo con un informe archivado preparado:** abrirlo y comprobar que conserva fecha, red, resumen y cobertura, y explica que la lista original ya no está disponible por retención. Si no hay ese fixture, dejar esta rama pendiente y mantener el control temporal en integración.

**Esperado:** listado y detalle coherentes, renombrado independiente del contenido, estados vacíos comprensibles y evidencia restringida según permisos. El borrado real por antigüedad, la redacción de datos y el acceso por IDs manipulados se verifican mediante integración.

## 12. Revisión de seguridad y riesgo

**Modalidad:** cuatro recorridos con parte manual (`REVIEW-01/02/03`, `RISK-01`). `REVIEW-04` queda para integración. Usar datos de prueba y anotar respuestas/estados antes de completar ciclos. Preparar revisiones abiertas, dos computadoras compatibles para respuesta masiva y, si existen, ejemplos de evidencia heredada/vencida y activos excluidos. Si falta un fixture, registrar la rama como bloqueada; no cambiar el reloj, invocar jobs ni fabricar requests.

**Falla observada en REVIEW-01 — «Casa central - Almacenamiento en la nube»:** el formulario y la creación de ciclos admitían nube, licencias y repositorios manuales, pero el hook de resultados conservaba un rechazo exclusivo de categorías distintas de computadora. Se reemplazó por la misma regla compartida `isManualCategoryAssessable`; también se corrigió el mensaje antiguo de validación de ciclos. No se modificó el seed ni la categoría del activo del usuario.

**Verificación de la corrección:** 7 integraciones con PostgreSQL desechable, enrutador y cookies: cierre real de computadora/licencia/nube/repositorio, reintento sin duplicar resultados, rechazo de Viewer sin propiedad y rollback conservando el borrador previo. Pasaron también 10 unitarias del hook (categorías admitidas/no admitidas y aislamiento), 20 regresiones de traducción de errores y tipos. **Revalidación manual pendiente:** volver al mismo activo de nube y completar su revisión; comprobar estado completado y respuestas conservadas al recargar.

### 12.1 Controles para completar y ejecutar mediante integración

**Detalle del activo desde Dispositivos:** el nombre de cada dispositivo enlaza a su detalle de inventario; los manuales de la colección anterior abren su ficha mediante `nonNetworkAsset`. Se conserva `asOrganization` y la acción «Abrir revisión» mantiene su función. Revalidar manualmente con un activo detectado y uno manual.

**Ajustes de presentación y navegación durante esta sección:** títulos de riesgo/cobertura alineados; distribución de la tarjeta adaptada a móvil; nombres destacados en las alertas con el mismo color que el texto y subrayado para identificar el enlace. Al pulsar un activo, se abre Revisión de seguridad en Dispositivos, filtrada por su identificador (incluidos los manuales), conservando `asOrganization`; «Ver todos los dispositivos» retira ese filtro. El menú móvil usa el mismo botón del encabezado para abrir/cerrar, con transición menú → X; también cierra con Escape o al navegar. Chequeo con componentes reales y datos/routing ficticios en Chrome aislado: alineación, enlace por ID, restauración del listado, contexto, mismo botón visible y cierre; sin desborde horizontal a 390 px. Tipos aprobados. **Pendiente manual:** confirmar estos comportamientos con las sesiones/datos reales y ambos temas; este chequeo visual aislado no sustituye integración ni el recorrido E2E manual.

**Cobertura revisada:** la nueva ejecución de categorías está detallada arriba; no se volvieron a ejecutar todas las demás suites de esta tabla. Las pruebas unitarias con dependencias simuladas no sustituyen transacciones y autorización reales.

| Chequeo | Objetivo y cobertura existente/pendiente |
| --- | --- |
| Ciclo individual (`REVIEW-01`) | `assessmentLifecycle.test.ts` prueba copia compatible, borrador idempotente, completar/reintentar y rollback con dependencias simuladas. `assessmentAccess.test.ts` prueba acceso y propiedad de Viewer de forma unitaria; `assessments.integration.test.ts` cubre alcance/visibilidad de ciclos. La nueva suite `manual-assessment-categories.audit.integration.test.ts` cubre las cuatro categorías manuales evaluables con persistencia real, reintento, propiedad y rollback. Completar el resto de la matriz de campos/actores, reapertura, concurrencia y ausencia de escrituras al rechazar. |
| Respuesta masiva (`REVIEW-02`) | `assessments.integration.test.ts` cubre sobrescritura de borradores abiertos conservando ciclos cerrados. `remaining-corroboration.audit.test.ts` contiene preview amplio sin truncamiento arbitrario. Completar en base real alcance, selección obsoleta, permisos, reintento y rollback de todo el lote. No usar dos sesiones manuales para demostrar atomicidad. |
| Herencia, vigencia y exclusión (`REVIEW-03`) | Hay unitarias de expiración/alcance/reconciliación; `audit-fixes.audit.integration.test.ts` verifica validación de exclusiones y expiración repetible. `remaining-corroboration.audit.integration.test.ts` cubre reconciliación de vencimientos históricos. Completar precedencia de evidencia de organización/oficina/activo, plazos de cada política, fecha límite y efectos coherentes entre cuestionario y riesgo. No esperar 30/90/180/365 días manualmente. |
| Mantenimiento (`REVIEW-04`) | Verificar tareas locales de Payload, autorización de endpoints internos, expiración/aging, reintentos, idempotencia y rollback con tiempo/fixtures controlados. La presencia de configuración o una pantalla con datos antiguos no demuestra que un job corrió. Completar la matriz y registrar ejecuciones; sin recorrido manual de tokens ni consola. |
| Puntaje y alcance (`RISK-01`) | Las unitarias del motor cubren criticidad, eficacia, cobertura y clasificación; las integraciones de riesgo cubren aislamiento/ocultamiento. Las 8 integraciones de `assigned-office-risk.audit.integration.test.ts` se ejecutaron durante el cambio de OfficeManager (ver §10), no nuevamente aquí. Completar cambios de evidencia/expiración, visibilidad y consistencia entre vistas. **Actualizar la expectativa antigua** de `risk.integration.test.ts` que exige oficina concreta también a Manager: ahora este puede consultar el consolidado asignado; Viewer conserva la restricción. |

### REVIEW-01 — Responder una revisión y comenzar un nuevo ciclo

**Objetivo E2E:** comprobar borrador, validaciones, confirmación e historial sin perder respuestas anteriores.

1. Como OrgAdmin, abrir **Revisión de seguridad** y elegir una revisión abierta de prueba. Anotar a qué corresponde: organización, oficina o activo. Usar un activo con categoría evaluable: computadora, licencia de software, activo de nube o repositorio de información; no todas las categorías manuales tienen cuestionario.
2. Responder solo algunas preguntas y pulsar **Guardar borrador**. Salir, volver y recargar: deben conservarse esas respuestas sin mostrar el ciclo como completado.
3. Intentar **Completar revisión** dejando preguntas sin responder. El modal debe informar cuántas faltan y bloquear la confirmación; volver con **Seguir revisando**.
4. Completar las preguntas con combinaciones disponibles de **Sí / No / No lo sé**. Si se ofrece **No aplica**, comprobar que exige justificación bajo su campo. Corregir cualquier error y comprobar que desaparece. No exigir campos de evidencia que el formulario no ofrece.
5. Abrir la confirmación y revisar los conteos. Cancelar una vez: debe permanecer abierta. Volver y confirmar; recargar: debe figurar completada y conservar sus respuestas.
6. Como OrgAdmin en el último ciclo completado, pulsar **Iniciar nuevo ciclo de revisión**. Debe existir un ciclo nuevo con respuestas compatibles copiadas, sin sobrescribir el anterior. Abrir **Ver historial** y **Volver a la última** para comprobar la navegación y los estados. Si el tipo de ciclo no ofrece esa acción, registrar el caso y revisar la elegibilidad en integración.
7. Con las ramas que tengan fixtures, revisar que el formulario se entiende para organización, oficina, activo de red y computadora manual; no repetir todas las combinaciones de respuestas en cada uno. Si el recorrido de Viewer responsable no se ejecutó ya en §5, probarlo con un activo propio: debe poder guardar/completar; las revisiones ajenas o de organización/oficina no deben ofrecerle responder.

**Esperado:** borrador recuperable, confirmación clara e historial conservado. No exigir que el puntaje suba o baje una cantidad fija después de responder: se verifica con el motor en integración.

### REVIEW-02 — Responder varias revisiones

**Objetivo E2E:** entender el alcance y aplicar un mismo cuestionario únicamente a la selección elegida.

1. Como OrgAdmin, abrir **Responder varias**. Elegir un tipo de activo y **Agrupar por** responsable, oficina o toda la organización, según lo que permita la pantalla.
2. Revisar la previsualización y sus conteos: candidatas compatibles, completadas que se conservan e incompatibles. No asumir que todas las computadoras comparten cuestionario.
3. Seleccionar **solo dos revisiones pendientes compatibles** de prueba y anotar sus activos; retirar las demás. Probar la búsqueda con/sin tildes y confirmar que el contador de selección coincide. Si hay menos candidatas, registrar la limitación y usar las disponibles sin inventarlas.
4. Pulsar **Responder cuestionario**. Volver con **Cambiar alcance** una vez y comprobar que puede corregirse la selección antes de completar.
5. Responder, revisar el modal de confirmación y cancelar una vez. Volver y confirmar el lote elegido.
6. Recargar la lista y abrir las revisiones seleccionadas: deben quedar completadas con las respuestas aplicadas. Las candidatas desmarcadas y los ciclos ya cerrados deben conservar su estado previo.
7. Si no se verificó en §5, comprobar solo los alcances que ofrece la UI de Manager/Viewer; no enviar organizaciones/oficinas ajenas manualmente.

**Esperado:** selección explícita y consecuencias acotadas. Cambiar candidatas desde otra sesión, forzar selección obsoleta y comprobar rollback de lote corresponden a integración.

### REVIEW-03 — Entender evidencia heredada y exclusiones

**Objetivo E2E:** distinguir respuesta propia, evidencia heredada, información vencida y un activo excluido.

1. Con un fixture que tenga evidencia heredada, abrir la revisión y leer el aviso de origen/respuesta anterior. Debe indicar de dónde viene y permitir responder localmente cuando ese ámbito se comporte distinto. Si se guarda un cambio de prueba, comprobar que reaparece al reabrir, sin editar la revisión de origen por accidente.
2. Si hay evidencia vencida preparada, abrirla y comprobar que se presenta como vencida o sin información vigente, sin hacerse pasar por una respuesta conforme. Si no existe ese fixture, dejar la rama pendiente.
3. Con una computadora de prueba excluida, comprobar que sigue en Inventario y que su cuestionario explica o impide la respuesta según su exclusión. No debe borrarse ni retirarse solo por excluirla.
4. Si no se hizo ya en §10, incluirla nuevamente desde el formulario del activo, guardar y comprobar que el estado de revisión se actualiza al volver. Si ese formulario ya fue aprobado, reutilizar su resultado; no repetir fechas y motivos aquí.

**Esperado:** fuente y vigencia comprensibles. La reinclusión automática por fecha, todos los vencimientos y su efecto exacto en los cálculos quedan para integración.

### REVIEW-04 — Procesos programados: integración

**Sin recorrido manual obligatorio.** Preparar tiempo y evidencia en pruebas controladas para aging, retención, expiración de revisiones/exclusiones e idempotencia. No invocar endpoints internos, copiar tokens ni esperar al scheduler desde la UI para dar este caso por aprobado.

### RISK-01 — Leer el riesgo y observar cambios

**Objetivo E2E:** comprender qué alcance se está viendo, separar riesgo de cobertura y observar una actualización coherente.

1. Como OrgAdmin, abrir **Puntaje de riesgo** con «Todas las oficinas». Debe explicar que es una evaluación conjunta de la organización, no un promedio de porcentajes de oficinas. Seleccionar una oficina y comprobar el cambio de alcance.
2. Como OfficeManager con dos oficinas asignadas, elegir Todas: debe mostrar su consolidado asignado, sin sustituir el filtro por una oficina ni exigir una selección concreta. Revisar la misma explicación en Panel general y Revisiones. Si se acaba de comprobar este recorrido en §10, reutilizar su evidencia.
3. Revisar **puntaje**, **cobertura**, **confiabilidad** y avisos. La cobertura informa cuánta evidencia está disponible; un resultado sin datos suficientes debe mostrar una ausencia/preliminaridad clara, sin presentar automáticamente 0 % como si todo estuviera controlado.
4. Completar una revisión de prueba de `REVIEW-01` y volver al riesgo. Si se observa cálculo pendiente/en curso, el mensaje debe distinguir primer cálculo de actualización de uno existente. Si termina rápido, no exigir ver estados intermedios. El Manager comparte el estado de recálculo de la organización: mientras éste está pendiente o en curso ve el mismo aviso «Actualizando riesgo» que el OrgAdmin, y al terminar su consolidado se recalcula.
5. Comprobar que conteos, activos destacados y explicaciones del nuevo resultado son legibles y corresponden al alcance elegido. Usar paginación/ordenamiento si hay suficientes filas; como Manager, cambiar de página u orden debe responder sin demoras, porque reutiliza el consolidado mientras la evidencia no cambie. No esperar una variación fija del porcentaje ni compararlo con una media simple de oficinas.
6. Si hay fixtures sin evidencia o con evidencia vencida, revisar sus mensajes; de lo contrario dejar esas ramas pendientes. No esperar vencimientos ni intentar oficinas ajenas por URL/request.

**Esperado:** alcance claro y diferencia comprensible entre falta de información y riesgo detectado. El cálculo incluye controles evaluables no conformes o parcialmente efectivos según su peso y eficacia; «No lo sé»/información no evaluable no equivale a cumplimiento ni añade por sí sola riesgo. Fórmulas, umbrales, fechas y aislamiento completo corresponden a integración.

## 13. Tareas

**Observaciones adicionales — asignación, detalle y calendario:**

**Revalidación contra la app local:** se reprodujo con una sesión temporal de la cuenta demo de Diego: `Mis tareas` devuelve las dos tareas globales sin filtro de oficina y cero al incluir su oficina. Se cerró únicamente la sesión temporal. Los datos están pendientes, sin archivar, con inicio pasado y destinatario correcto. El filtro corregido existe en fuente y compilados, pero la API activa conserva el comportamiento anterior; Payload reutiliza su configuración/handlers en memoria. Queda pendiente cargar la corrección en el proceso activo y repetir este chequeo; las 11 integraciones anteriores no acreditan que ese proceso se haya actualizado. No se reinició la aplicación. El detalle ahora usa «Global» / «Por oficina» y el listado muestra un error con Reintentar cuando falla la consulta, en lugar de presentarlo como una lista vacía.

- Las tareas de **Toda la organización** se incluyen al filtrar cualquier oficina autorizada. Se reproducía su desaparición para un Viewer con una sola oficina; el filtro ahora incluye la oficina seleccionada y las tareas sin oficina. Se mantienen organización, permisos, destinatario, estado, búsqueda y archivado. Elegir varias oficinas genera tareas independientes; no convierte cada una en una tarea global.
- Las tareas «Tarea de Prueba No. 1» y «No. 2» se consultaron en modo lectura y estaban guardadas como globales y asignadas a Diego. Esa asignación es válida y no demuestra una omisión del control de oficinas. Las tareas de oficina siguen ofreciendo/requiriendo destinatarios con cobertura.
- El detalle agrega alcance, oficina, tipo de asignación, rol/persona destinataria y reclamante cuando corresponda. Los nombres se resuelven en el servidor después de autorizar la lectura, sin enviar documentos completos para estos nuevos datos.
- El selector de destinatarios explica carga, falta de alcance y ausencia de candidatos; los errores de consulta ofrecen Reintentar. No se reprodujo el catálogo de roles vacío sin entidad: las pruebas autenticadas y el formulario con dos oficinas ofrecen roles comunes, aunque los integrantes de ese rol sean personas diferentes en cada oficina. **Pendiente manual:** repetir el caso reportado y registrar si aparece un mensaje de carga, error o ausencia de candidatos.
- Calendario compacto para mouse, objetivos táctiles conservados en móvil y marca de hoy visible incluso al seleccionar ese día; se mantiene DD-MM-AAAA.

**Verificación de estas observaciones:** 11 integraciones reales en PostgreSQL desechable mediante router y cookies: opciones por oficina/múltiples oficinas; asignación directa a Viewer; tareas globales con/sin filtro para Viewers distintos; exclusión/rechazo de destinatarios sin cobertura al crear/reasignar, sin escrituras parciales; detalle de destinatario; separación entre oficinas y organizaciones. Chrome aislado con componentes/hooks reales y respuestas ficticias verificó el selector de roles, sus mensajes, datos del detalle y tamaño/marca de hoy en ambos temas y móvil. **Revalidación E2E manual:** como Diego, mantener su única oficina seleccionada y comprobar las dos tareas globales en Mis tareas; revisar detalle y probar una tarea con oficina concreta para comprobar que solo ofrece personas elegibles.

**Observación corregida — formato de fechas:** los campos nativos dependían del idioma del navegador y podían mostrar mes/día/año. Se unificaron los seis campos de fecha del portal (crear/editar tareas, exclusión compartida de activos y expiración de mensajes) con `DateField` de Mantine: presentación DD-MM-AAAA, calendario en español y semana desde lunes. La página declara `es-AR`. Se conserva el formato interno y la conversión al inicio/final del día local. Tipos y regresiones de `format-date` aprobados; componente verificado en Chrome aislado con locale en-US y zona argentina: presentación, selección, borrado, año bisiesto y ancho móvil en ambos temas. **Pendiente manual:** repetir selección/guardado/reapertura de inicio y vencimiento durante este recorrido; reutilizar el componente en exclusiones/mensajes sin repetir toda su lógica aquí.

**Modalidad:** E2E manual desde la interfaz. Usar OrgAdmin, OfficeManager y Viewer con acceso a una oficina de prueba; crear tareas identificadas como pruebas. Reutilizar permisos ya verificados en §5 y registrar ramas sin datos preparados como pendientes. No manipular requests, IDs ni relojes.

### TASK-01 — Crear, asignar, ejecutar y cerrar: E2E manual

**A. Crear y encontrar tareas. Objetivo:** comprobar que alcance, destinatario y fechas se entienden y persisten.

1. Como OrgAdmin, abrir **Tareas → Nueva tarea**. Crear una tarea para una oficina, con asignación **Pool abierto**, título reconocible y prioridad. Reabrirla y revisar los valores.
2. Crear otra para esa oficina con asignación **Rol** y otra con **Persona**, usando las opciones ofrecidas. Crear además una para **Toda la organización**; si hay dos oficinas de prueba, crear una tarea para ambas y revisar las tareas resultantes por oficina.
3. Crear una con inicio futuro y vencimiento posterior: debe verse como **Planificada**. No esperar la fecha; el cambio temporal se prueba en integración.
4. Buscar los títulos en **Todas**. Probar filtros de estado/prioridad, cambiar la oficina superior y limpiar los filtros; comprobar que los listados responden y los estados vacíos se entienden.

**Esperado:** valores conservados, alcance legible y tareas localizables; una tarea planificada no se ofrece para ejecución inmediata. No confundir una tarea que se oculta por filtros con una creación fallida.

**B. Reclamar, liberar y completar. Objetivo:** recorrer la ejecución de una tarea como destinatario elegible.

1. Como Viewer de la oficina, abrir **Pool disponible** y encontrar la tarea abierta; usar el filtro **Ahora** si corresponde.
2. Pulsar **Reclamar**. Revisar en **Mis tareas** que queda **En progreso** y que la ficha identifica quién la tomó.
3. Usar **Liberar tarea**; comprobar que vuelve a estar disponible. Reclamarla otra vez y completarla desde la ficha.
4. Buscarla con estado **Completada** en Mis tareas/Todas según las pestañas disponibles para el rol: los filtros iniciales de Mis tareas excluyen las completadas. Reabrir y revisar **Actividad**.
5. Con una persona elegible del rol elegido, localizar/reclamar la tarea asignada a ese rol; con la persona elegida, revisar la asignada directamente. Reutilizar estos casos para las siguientes acciones, sin completar todas antes de probar reasignación/cancelación.

**Esperado:** transiciones comprensibles, sin botones administrativos para Viewer. La actividad distingue reclamo, liberación y cierre con sus actores. No hace falta probar todas las combinaciones de roles manualmente.

**C. Administrar tareas. Objetivo:** verificar edición, delegación y cierre desde los controles visibles.

**Ajuste de presentación:** cuando una reasignación libera el reclamo, Actividad agrupa ambos registros en un único paso «Reasignada», con la nota «Se liberó el reclamo anterior.». Se conservan los dos registros internos. Las liberaciones independientes siguen visibles y una reasignación de tarea pendiente no muestra esa nota. Revalidar que no se repita el mismo cambio en dos pasos visuales.

**Corrección de alineación y actividad de reasignación:** las ayudas de los campos de asignación ahora van después del input; el largo de un hint no desplaza los títulos ni los controles respecto de la otra columna. La reasignación agrega un evento `Reasignada` con actor/fecha; si la tarea estaba reclamada, agrega también `Liberada por reasignación` antes de limpiar el reclamo. Ambos eventos y la nueva asignación se guardan en la misma transacción y el orden de actividad es estable aun si comparten timestamp. No se reconstruyen eventos históricos que nunca se guardaron. Verificado con 14 integraciones (incluyen los 11 casos anteriores, reasignación pendiente/en curso y rollback), 3 pruebas de actividad, tipos y Chrome aislado con ayudas cortas/largas y distintos anchos en ambos temas. **Pendiente manual tras cargar el backend actualizado:** reclamar una tarea, reasignarla y volver a reclamarla; confirmar en Actividad los pasos intermedios y sus actores. No se reinició la aplicación durante esta corrección.

**Observación corregida — diálogo de reasignación:** se inicializaba siempre en Pool abierto, sin reflejar la asignación guardada. Ahora copia el tipo y destinatario actual al abrir; cancela los cambios locales al reabrir y solo cierra después de guardar correctamente. Durante el envío bloquea cambios/cierre; ante error conserva la selección para reintentar. Verificación en Chrome aislado con TaskDetail, hooks, servicios y cliente HTTP reales, pero respuestas simuladas: rol poblado/ID, persona, pool, cancelación, payload enviado, error/reintento y actualización por invalidación. Tipos y 2 regresiones de schema aprobados. **Pendiente manual:** reasignar la tarea real, reabrir el diálogo y recargar la página para confirmar persistencia del destinatario.

1. Como OrgAdmin, abrir una tarea pendiente de prueba, editar título/prioridad y guardar. Recargar y comprobar los valores.
2. Reasignarla a otra persona elegible; entrar como destinataria y comprobar que puede encontrarla en Mis tareas. Si no se verificó en §5, repetir edición/reasignación como OfficeManager dentro de su oficina.
3. Cancelar otra tarea con un motivo, abrir su actividad y comprobar estado/motivo. Probar cancelar el diálogo antes de confirmar una acción para comprobar que no modifica la tarea.
4. Archivar una tarea completada o cancelada. Debe salir de **Sin archivar** y reaparecer al incluir archivadas, sin perder su estado final ni actividad.
5. Con una tarea reclamada por otra persona, usar como OrgAdmin **Completar como administrador** e indicar motivo. Comprobar cierre y actividad. Si ya se verificó en §5, reutilizar ese resultado.

**Esperado:** cambios persistentes, confirmaciones propias de la aplicación y actividad coherente. OfficeManager no debe ofrecer cierre forzado administrativo.

### TASK-02 — Validaciones y referencias: E2E manual

**A. Errores de formulario. Objetivo:** comprobar claridad y recuperación desde la UI.

1. Intentar crear con título vacío y luego con uno de menos de tres caracteres. Los mensajes deben aparecer bajo el campo y cambiar al corregirlo.
2. Elegir inicio y un vencimiento anterior; intentar guardar. Corregir las fechas y revisar que el error desaparece.
3. Elegir asignación **Persona/Rol** sin seleccionar destinatario, o un tipo de entidad relacionada sin elegir entidad; intentar guardar y corregir los campos indicados.
4. Guardar el formulario corregido y comprobar que se crea la tarea una sola vez y conserva los valores.

**Esperado:** errores breves junto al campo, valores conservados y posibilidad de corregir sin cerrar el formulario. Prioridades inventadas y combinaciones que la UI no permite se prueban en integración.

**B. Entidades relacionadas. Objetivo:** comprobar que la tarea ofrece contexto y enlaces útiles.

**Simplificación de referencias:** «Cálculo histórico de riesgo» ahora se presenta como «Evaluación de riesgo», con la ayuda «Vincula la tarea al resultado guardado que motivó su creación». «Resultado de un control» se oculta únicamente del selector general; el contrato, las etiquetas y enlaces de tareas existentes se conservan. En el consolidado de oficinas asignadas, quienes pueden crear tareas ven la indicación de seleccionar una oficina para vincularla a su evaluación; una evaluación guardada conserva Crear tarea. Se agrega Crear tarea relacionada en acciones de activos de red vigentes, con la entidad fija; los accesos existentes desde activos manuales y revisiones se mantienen. Verificado en Chrome aislado con componentes y hooks reales/datos ficticios: opciones, ayuda, consolidado/evaluación guardada, ausencia del aviso para Viewer y formulario contextual de activo. Tipos y 2 pruebas de compatibilidad de enlaces aprobados. **Pendiente manual:** repetir estos accesos con la sesión real; no crear tareas nuevas desde resultados de control individuales en esta etapa.

**Nombres de evidencia:** las referencias a instantáneas e informes priorizan `display_name`; si no hay nombre, muestran la fecha. Conservan el sufijo de oficina. Aplica al selector, la referencia en la ficha y los listados de tareas que usan el mismo resolvedor. Verificadas ambas categorías con nombre, sin nombre y nombre en blanco mediante pruebas del resolvedor. Revalidar manualmente con una evidencia renombrada.

1. Desde un activo de prueba, usar **Crear tarea** y revisar que la entidad queda identificada y fija; crearla, abrir su ficha y seguir el enlace de la entidad. Debe abrir el activo correcto.
2. Repetir desde una revisión y desde una instantánea o un escaneo disponible. Si no se cubrió antes, comprobar también la referencia a una oficina. Revisar nombres legibles y alcance derivado de la entidad, sin UUID crudo en la presentación.
3. Si hay tareas preparadas con referencias antiguas, abrirlas: activo retirado, ciclo reemplazado o evaluación histórica. Comprobar si explican su condición y si distinguen evidencia de origen de estado vigente. No retirar activos ni reemplazar ciclos solo para fabricar este caso.

**Esperado:** enlace al destino correcto y contexto conservado. Si una referencia antigua no explica su condición, registrar una observación; si falta el fixture, dejar la rama pendiente.

### 13.1 Controles para completar y ejecutar mediante integración

**Objetivos reservados:** autorizaciones completas por rol/oficina/tenant; IDs ajenos o inexistentes; referencias parciales; prioridades inválidas; oficinas duplicadas; alcance global incompatible con oficinas; destinatarios sin cobertura o sin permiso para la entidad; inicio/vencimiento controlados; reclamos concurrentes; reintentos/idempotencia y rollback sin escrituras parciales; liberación al perder acceso o desactivar una persona; integridad de actividad e historial.

**Cobertura revisada, no ejecutada en este recorrido:** `endpoints/tasks.integration.test.ts` tiene casos de creación multi-oficina, reclamo, reprogramación, completado/borrado y rechazo de un rol sin lectura de la entidad; invoca handlers con Payload y usuario preparado, no demuestra por sí solo el recorrido HTTP/cookies completo. `domain/tasks/task-state.test.ts`, `task-eligibility.test.ts`, `task-reference.test.ts` y `task-actions.audit.test.ts` cubren piezas de estado, elegibilidad, referencias y autorización/transacciones; los schemas y enlaces tienen unitarias en `modules/tasks/`. Completar los objetivos que falten con persistencia real, solicitudes autenticadas y comprobación de ausencia de escrituras al rechazar; no marcar toda la matriz como cubierta por encontrar esos archivos.

## 14. Mensajes de StaffPortal

**Búsqueda y filtros del listado:** barra compartida con búsqueda por título/descripción (ignora mayúsculas y tildes), selección múltiple de tipo y estado, y ordenación. Los filtros se combinan, muestran cantidad visible/total y permiten Limpiar filtros; sin coincidencias se explica la causa en lugar de aparentar un listado sin mensajes creados. Revalidar manualmente una búsqueda con/sin tilde, tipo + estado, ordenación y limpieza, también en móvil.

**Observaciones de presentación corregidas:** administración de mensajes pasa de una tabla de ocho columnas a un listado adaptable de ancho completo, sin altura interna fija ni desplazamiento horizontal. Agrupa contenido, audiencia y vigencia; conserva vista previa, edición, activación y reenvío, y ofrece ordenación por antigüedad, título y vencimiento. Las tablas compartidas ahora usan un único contenedor nativo de scroll, evitando la combinación de viewport interno y overflow exterior que desubicaba la barra. La bandeja personal identifica sin leer con punto discreto, título destacado y un contador textual, sin badges Nuevo/Leído por fila. Verificado en Chrome aislado con componentes/hooks reales y respuestas ficticias a 390/820/1280 px, ambos temas: ausencia de desborde horizontal, altura natural, ordenación, acciones, actualización de lectura y scroll bidireccional de una tabla con altura limitada. Tipos aprobados. **Revalidación manual:** revisar esta presentación con mensajes reales y confirmar los recorridos de esta sección; no sustituye las pruebas de audiencia/autorización.

**Modalidad:** E2E manual. Usar mensajes con títulos de prueba, cuentas de miembro reales (OrgAdmin/OfficeManager/Viewer) y PlatformAdmin para administrarlos. Una visita de PlatformAdmin a una organización no sustituye la bandeja personal de un miembro. Al finalizar, dejar inactivos los avisos de prueba. No fabricar requests ni esperar vencimientos para aprobar la sección.

### MSG-01 — Crear y entregar mensajes: E2E manual

**A. Crear y previsualizar. Objetivo:** comprobar el formulario y la presentación antes de entregar.

1. Como PlatformAdmin, abrir **Mensajes del portal → Nuevo mensaje**. Elegir tipo **Aviso**, escribir título/descripción de prueba y abrir **Vista previa**.
2. En **Audiencia**, elegir **Organizaciones específicas**, una organización de prueba y todas sus personas. En **Enlace y vigencia**, dejar **Mensaje activo** apagado y guardar con **Crear mensaje**.
3. Reabrir el mensaje y comprobar que conserva contenido, audiencia y fecha si se eligió una. Verificar estado **Inactivo** en el listado.
4. Probar un envío con título vacío y corregirlo; el error debe aparecer junto al campo y permitir conservar el resto de valores. Si se usa una plantilla sobre contenido modificado, comprobar la confirmación antes de reemplazarlo.

**Esperado:** vista previa legible, errores comprensibles y guardado persistente. No existe un paso separado de «Publicar»: el control **Mensaje activo** y la vigencia determinan si se entrega.

**B. Destinatarios y entrega. Objetivo:** comprobar que el mensaje llega a las cuentas elegidas.

1. Activar el aviso del paso A. Entrar como un miembro real de la organización destinataria, abrir/recargar Panel general y comprobar el aviso y la bandeja personal de mensajes.
2. Si existe una cuenta de otra organización preparada, comprobar que no recibe ese aviso. Si falta, dejar esa comparación pendiente; el aislamiento completo se prueba en integración.
3. Crear un aviso dirigido a **Personas con roles específicos** (por ejemplo Viewer). Comprobar con un Viewer destinatario y un OrgAdmin de la misma organización que la selección se respeta.
4. Crear otro dirigido a **Personas específicas** y comprobar con la persona elegida y otra no elegida de la misma organización.
5. Probar **Todas las organizaciones** con un aviso de prueba si hay cuentas de dos organizaciones disponibles; de lo contrario registrar esta variante como pendiente.

**Esperado:** contenido y audiencia correctos, sin confundir la cuenta de miembro con PlatformAdmin en modo visita. Revisar recepción desde la UI, sin consultar recibos ni endpoints manualmente.

**C. Leer, posponer y navegar. Objetivo:** distinguir una lectura, una respuesta definitiva y una navegación.

1. En un aviso, pulsar **Entendido**. Navegar/recargar y comprobar que no se abre automáticamente otra vez; revisar su estado **Leído** al abrirlo desde la bandeja.
2. Crear un mensaje **Accionable** con texto de acción y una **Sección del portal** accesible para su destinatario (por ejemplo Inventario). Recibirlo como miembro y pulsar la acción: debe abrir el destino correcto.
3. Con otro accionable, elegir **Recordarme más tarde** o cerrar con X. Debe cerrar sin registrarse como una negativa definitiva y seguir disponible en la bandeja; no exigir un nuevo popup inmediato en esa misma sesión.
4. Con otro mensaje, elegir **No gracias**. Debe quedar como respondido y dejar de abrirse automáticamente. Si hay varios mensajes, comprobar que la cola avanza sin repetir el actual y que sus contadores son coherentes.
5. Si hay una entidad concreta compartida y accesible, vincular un mensaje a ella y seguir el enlace; debe abrir esa entidad. Si falta ese dato preparado, dejar la variante pendiente.

**Esperado:** acciones con significado claro, navegación autorizada y estado de lectura/respuesta persistente. Abrir un mensaje visto desde la bandeja no debe confundirse con recibirlo otra vez como nuevo.

**D. Editar, volver a mostrar y desactivar. Objetivo:** comprobar el control del ciclo del mensaje.

1. Como PlatformAdmin, editar un aviso de prueba y comprobar que la vista previa y la bandeja reflejan el texto guardado al actualizar.
2. En un mensaje vigente ya respondido, pulsar **Volver a mostrar a todos**. Cancelar primero la confirmación y comprobar que no provoca una nueva entrega. Repetir y confirmar; actualizar la vista del destinatario: debe poder recibirlo nuevamente aunque hubiera respondido la versión anterior.
3. Desactivar el mensaje y actualizar la vista del destinatario. Ya no debe entregarse ni seguir ofrecido entre los mensajes vigentes.
4. Si hay un mensaje vencido preparado, revisar estado y la explicación del botón de reenvío no disponible. No esperar a que transcurra un vencimiento ni cambiar el reloj para fabricar el caso.
5. Comprobar que OrgAdmin/OfficeManager/Viewer no ofrecen administración de mensajes. Reutilizar la matriz de permisos de §5 si ya se verificó; no manipular rutas o llamadas para provocar un 403.

**Esperado:** cancelación sin cambios, reenvío explícito, desactivación efectiva y controles restringidos a StaffPortal. Terminar con los mensajes de prueba inactivos.

### 14.1 Controles para completar y ejecutar mediante integración

**Objetivos:** matriz completa de organizaciones/roles/personas y usuarios inactivos; autorización de crear/editar/activar/reenviar y acceso a entidades enlazadas; IDs ajenos/inexistentes; expiración exacta y fin del día local; retención de leídos durante 30 días; idempotencia de recibos, versiones antiguas tras reenviar, concurrencia y ausencia de escrituras al rechazar. La UI manual comprueba la experiencia de leer/responder; no se pide emitir recibos técnicos a mano.

**Cobertura revisada, no ejecutada en este recorrido:** `endpoints/portalMessages.integration.test.ts` cubre entrega por organización, recibos, reenvío, enlace y desactivación con Payload/handlers y actores preparados; `domain/portal-messages/targeting.test.ts` y `modules/portal-messages/portal-message-labels.test.ts` tienen pruebas de selección/presentación. Completar las variantes faltantes con persistencia real y solicitudes autenticadas antes de dar por cubierta toda la matriz.

## 15. StaffPortal, dashboard y organización desactivada

**Modalidad:** E2E manual desde la UI. La baja se prueba con una organización prescindible preparada, no con la organización principal usada para los demás recorridos: revoca escáneres, retira activos y cancela tareas; reactivar no deshace todo eso. Si no existe ese fixture, ejecutar PLATFORM-01 y dejar la baja/reactivación pendiente. No ejecutar seeds, manipular requests ni cambiar el reloj.

### PLATFORM-01 — Resumen, organizaciones y visita: E2E manual

**Objetivo:** comprender las métricas del StaffPortal y navegar entre sus organizaciones sin perder el contexto.

1. Como PlatformAdmin, abrir el panel de StaffPortal y anotar organizaciones totales/activas, oficinas activas, escáneres activos/conectados e incidentes pendientes. Comprobar que no confunde total con activos ni conectado con instalado. Contrastar los conteos que puedan verificarse con los listados disponibles; las agregaciones exactas quedan en integración.
2. Abrir **Organizaciones**, buscar una organización de prueba, probar estados y limpiar filtros. Debe poder encontrarse sin perder el acceso a sus acciones. Si este caso ya se aprobó en §5, reutilizar el resultado.
3. Usar **Abrir portal de la organización**. Comprobar nombre/contexto, oficinas correspondientes y navegación de administración de esa organización. Volver con **Volver al portal de la plataforma** y visitar otra organización preparada, si existe.
4. Como OrgAdmin normal, comprobar que no se ofrecen administración global ni métricas de StaffPortal. Reutilizar §5 si ya se verificó; no acceder por endpoints para provocar un 403.

**Esperado:** métricas comprensibles, listados coherentes y navegación con contexto correcto. Verificar IDs ajenos, parámetros manipulados y autorización de endpoints mediante integración.

### ORG-STATUS-01 — Desactivar/reactivar organización: E2E manual

**Preparación:** anotar las personas/oficinas activas de la organización prescindible y, si tiene, escáneres, activos, una tarea abierta y una revisión abierta. Mantener una sesión de un miembro iniciada en otro contexto de navegador; PlatformAdmin administra desde su propia sesión. Las categorías sin datos preparados quedan pendientes.

**A. Impacto y cancelación. Objetivo:** entender el efecto antes de confirmar.

1. Desde Organizaciones, abrir **Desactivar organización**. Revisar los conteos de oficinas, personas, escáneres, activos y tareas, y la explicación de cierre de revisiones.
2. Escribir un nombre incorrecto o dejarlo vacío: la confirmación debe permanecer bloqueada.
3. Pulsar **Cancelar** y comprobar que la organización sigue activa y sus datos no cambian.

**B. Confirmar y comprobar acceso. Objetivo:** observar una baja coherente desde ambas sesiones.

1. Reabrir el impacto, escribir el nombre exacto y confirmar. Comprobar que la organización queda **Inactiva** en StaffPortal.
2. En la sesión de miembro que estaba abierta, actualizar o intentar navegar a una pantalla protegida: debe perder acceso y no permitir seguir operando. Comprobar también que no puede volver a iniciar sesión mientras la organización siga inactiva.
3. Como PlatformAdmin, visitar la organización inactiva desde su acción normal. Revisar los estados visibles de oficinas/personas, escáneres revocados, activos retirados, tareas canceladas y revisiones cerradas/reemplazadas según los datos preparados. Puede ser necesario incluir estados inactivos o terminales en los filtros; una fila ausente no demuestra por sí sola su eliminación.
4. Si la UI invita a modificar la organización inactiva, registrar pantalla/acción como observación. Las comprobaciones de escritura sin efectos parciales se reservan para integración en datos desechables.

**Esperado:** organización inactiva y miembros sin acceso; PlatformAdmin mantiene la posibilidad de inspeccionarla. No interpretar la baja como borrado de históricos ni como cancelación automática de las funcionalidades del plan.

**C. Reactivar y comprobar la recuperación parcial. Objetivo:** distinguir reactivación de restauración completa.

1. Desde StaffPortal, abrir **Reactivar organización** y anotar la persona administradora y oficina indicadas por el aviso. Las elige el sistema; no asumir que el modal permite elegirlas manualmente.
2. Confirmar y comprobar que la organización vuelve a estar activa.
3. Iniciar una sesión nueva como el administrador indicado: debe poder entrar y acceder a la oficina reactivada. Comprobar las nuevas revisiones si existen datos que las generen.
4. Revisar que las demás personas/oficinas siguen inactivas, los escáneres siguen revocados, los activos retirados y las tareas canceladas no se restauran automáticamente. Reutilizar las anotaciones iniciales para distinguir estados anteriores de los efectos de esta operación.
5. Volver al panel de StaffPortal y comprobar que la organización vuelve a contar como activa. Las métricas exactas y efectos concurrentes se prueban en integración.

**Esperado:** recuperación del administrador y oficina anunciados, sin revivir automáticamente el resto. Las sesiones invalidadas no deben recuperarse por sí solas.

### 15.1 Controles para completar y ejecutar mediante integración

**Objetivos:** agregaciones exactas de métricas y umbrales de conectividad; endpoints de plataforma restringidos al contexto de plataforma; `asOrganization` inválido/ajeno; revocación de sesiones; baja atómica, idempotencia, rollback y cambios del impacto entre preview/confirmación; conservación de features; elección determinista del administrador/oficina de reactivación y no reactivación de personas dadas de baja previamente. El escenario sin administrador u oficina recuperable requiere un fixture controlado y no se fabrica manualmente.

**Revisión prioritaria de ciclo de vida:** hubo un hallazgo previo de bloqueo de escrituras no uniforme en organizaciones inactivas. Verificar las rutas de edición de oficina/configuración/membresía y las demás mutaciones usando la implementación actual; ya existen guardas adicionales en membresías, por lo que la observación histórica no acredita por sí sola qué rutas siguen fallando. Exigir rechazo sin escritura cuando corresponda y registrar cualquier excepción de negocio explícita. No dar la matriz por aprobada solo porque se ocultan botones.

**Cobertura revisada, no ejecutada en este recorrido:** `endpoints/platformOrganizations.integration.test.ts` contiene pruebas de baja y reactivación, falta de OrgAdmin y preservación de su baja previa. `endpoints/organization-details.audit.integration.test.ts` cubre permisos y rechazo de edición de organizaciones inactivas. Completar y ejecutar los objetivos faltantes con persistencia real y autenticación; no equiparar estas pruebas parciales con una auditoría completa del ciclo de vida.

## 16. Aislamiento multi-tenant y límites transversales

Ejecutar como OrgAdmin, OfficeManager y Viewer. Usar IDs válidos de Org ajena C, y también de otra oficina de la propia organización.

1. Sustituir IDs en URL, query y body de listas/detalles/mutaciones.
2. Pedir `/api/organizations`, `/api/offices`, `/api/assets`, `/api/non-network-assets`, `/api/v1/org-members`, `/api/v1/tasks`, `/api/v1/assessments` y los endpoints de detalle relevantes.
3. Intentar crear activo/tarea/revisión usando oficina de otra organización.
4. Intentar modificar relaciones `organization`, `user` o membresía por API REST directa.
5. Comparar UI y status HTTP.

**Esperado:** respuesta vacía/404/403 acorde al endpoint, sin datos filtrados ni mutación. La comprobación de tenant aplica incluso cuando el RBAC del rol permite la acción en abstracto.

**Revalidación E2E manual — mensajes de acceso:** abrir un enlace de tarea, revisión y activo fuera del alcance del usuario. Un 404 debe explicar que el enlace puede no estar disponible o que no se tiene acceso, sin confirmar la existencia ni revelar la organización/oficina. Un 403 debe indicar que no se tiene permiso. En ambos casos debe ofrecer volver al listado. Los fallos de conexión o del servidor deben ofrecer «Reintentar» y recuperar la vista cuando la consulta vuelva a funcionar. Reservar para integración la comprobación de los códigos HTTP, la ausencia de filtraciones y el rechazo sin escrituras; el texto visible no acredita esas garantías.

## 17. Errores generales y recuperación

Usar tareas y cuentas de prueba. Los siguientes recorridos son E2E manuales; no requieren construir requests ni reiniciar el servidor. Si un escenario ya fue comprobado en otra sección, registrar esa evidencia sin repetirlo.

### ERROR-01 — Evitar envíos repetidos desde la interfaz

1. Abrir «Nueva tarea», completar los campos y usar un título identificable.
2. Hacer doble clic rápido en «Crear tarea».
3. Comprobar que el botón indica la operación en curso y no permite nuevos envíos mientras espera.
4. Volver al listado y recargar.

**Objetivo/esperado:** la interfaz comunica el progreso y aparece una sola tarea. Esto no acredita idempotencia del servidor ante requests concurrentes o reintentos, que corresponde a integración.

**Regresión detectada en la ronda manual:** varios clics creaban dos tareas y dos avisos de éxito. La consulta de sólo lectura confirmó dos «Tarea No. 12» pendientes en Centro Logístico Rosario, separadas por 1,18 segundos, y otra duplicación de «Tarea No. 13». El bloqueo inicial impedía envíos simultáneos pero se liberaba al terminar la mutación, antes de desmontar el modal. Ahora se adquiere antes de validar y permanece después de un éxito, incluida la animación de cierre; sólo un fallo permite reintentar desde ese formulario. Revalidar creación global, por oficinas y desde una entidad relacionada, manteniendo los clics también después del aviso de éxito. La prueba de navegador aislada con API simulada comprueba la cantidad de envíos y avisos; no acredita deduplicación del servidor. Los registros de la base real se consultaron sin modificarlos.

**Revalidación transversal de modales:** altas/ediciones de tareas y activos manuales; identificación de activos; creación/edición/ciclo de vida de personas, oficinas y organizaciones; escáneres; mensajes; renombrado y confirmaciones. Comprobar en ventanas angostas y de poca altura, en ambos temas y con errores visibles: los campos de la misma fila se alinean, los hints quedan debajo del input, cada obligatorio muestra asterisco también al aparecer condicionalmente y el pie de acciones permanece visible mientras sólo el contenido se desplaza. En activos manuales, probar categorías con producto, cloud y repositorio, y exclusión con motivo «Otro». No confundir la revisión del componente compartido con la ejecución E2E de todas las operaciones.

### ERROR-02 — Pérdida de conexión y recuperación

1. Abrir el formulario de una tarea de prueba y completar sus datos.
2. Activar «Offline» en las herramientas de desarrollo del navegador, sin detener la aplicación.
3. Intentar guardar y esperar el resultado.
4. Comprobar que se informa el fallo, se conservan los campos y el botón deja de mostrar carga.
5. Restaurar la conexión y volver a guardar. Recargar el listado para comprobar el resultado.

**Objetivo/esperado:** no se informa éxito sin guardar; se puede corregir el problema y continuar sin volver a escribir los datos. Dejar el navegador conectado al terminar.

**Panel y Revisiones sin conexión:** con «Offline» activo, recargar el Panel general y Revisión de seguridad sin datos previos. La tarjeta de riesgo debe indicar «No se pudo cargar el riesgo. Intenta de nuevo en unos minutos.» y no deben aparecer «0 controles requieren atención», «0 equipos sin identificar» ni una cobertura de 0 %. Restaurar la conexión: los datos vuelven solos en la siguiente consulta automática.

### ERROR-03 — Datos modificados por otra persona

1. Crear una tarea de prueba disponible para dos personas autorizadas.
2. Abrirla en dos contextos de navegador independientes.
3. Reclamarla desde el primero.
4. Desde el segundo, intentar reclamarla si la acción sigue visible.
5. Comprobar el mensaje y recargar ambos detalles.

**Objetivo/esperado:** si la segunda vista ya se actualizó, no ofrece reclamar; si quedó desactualizada, explica el rechazo y permite actualizar. Ambos detalles terminan mostrando la misma persona responsable del reclamo. La exclusión mutua bajo concurrencia se valida mediante integración.

**Variante — finalización administrativa:** abrir una tarea reclamada por un responsable de oficina en dos contextos. Completarla como administrador de la organización, indicando un motivo. Desde la vista anterior del responsable, intentar completarla o liberarla, incluyendo clics repetidos. Debe haber un solo envío en curso y un solo aviso que explique «La tarea ya fue completada por un administrador»; tras el rechazo se actualizan el detalle/listado y desaparecen las acciones que ya no corresponden. Distinguir este conflicto de una tarea aún en curso reclamada por otra persona. Repetir con una cancelación para comprobar que se informa su estado real.

**Integración ejecutada para esta regresión:** `endpoints/task-assignment-regressions.audit.integration.test.ts` pasó sus 17 casos en PostgreSQL aislado, incluidos finalización forzada, intento posterior del responsable, finalización repetida, cancelación y ausencia de escrituras tras los rechazos. Se comprobó también que una persona ajena a la oficina recibe 404 sin revelarle el estado de la tarea.

### ERROR-04 — Sesión cerrada o acceso revocado

1. Con una cuenta de prueba, abrir el portal en dos pestañas del mismo contexto de navegador.
2. Cerrar sesión en una; desde la otra, navegar a una pantalla protegida o intentar guardar un cambio de prueba.
3. Comprobar que se solicita iniciar sesión y no se informa un guardado exitoso.
4. Volver a iniciar sesión y comprobar que se puede continuar.
5. Reutilizar la evidencia de las secciones 8 y 15 para cuenta desactivada y organización inactiva; no repetir sus bajas sólo para este caso.

**Objetivo/esperado:** el usuario comprende que perdió la sesión o el acceso y dispone de una salida; la aplicación no queda cargando indefinidamente. No se exige que una vista ya renderizada desaparezca sin interacción.

### 17.1 Controles para completar y ejecutar mediante integración

**Objetivos:** JSON mal formado/vacío; campos extra, tipos incorrectos, arrays grandes e IDs inválidos según cada contrato; requests repetidos o concurrentes; reintentos tras timeout con resultado incierto; recarga durante una mutación; impacto obsoleto entre preview/confirmación en oficinas, miembros y activos; cookies caducadas y rechazo efectivo de escrituras tras cierre de sesión, baja de cuenta u organización. Comprobar los datos persistidos, la ausencia de duplicados y los errores normalizados, sin equiparar la protección visual del botón con garantías del servidor.

Verificar atomicidad y rollback del bootstrap y demás operaciones compuestas mediante fallos controlados en una base aislada. Reiniciar/cortar la app manualmente no es un mecanismo reproducible ni una comprobación confiable.

**Esperado:** error normalizado y accionable; no se duplican operaciones; no hay estado parcialmente aplicado; el cliente puede reintentar después de corregir el problema.

## 18. Criterio de cierre de caso

Registrar para cada caso: **ID, actor, tenant, oficinas, plan, datos previos, pasos, resultado de UI, request/status/response, resultado tras recargar, evidencia y estado** (`OK`, `Falla`, `Bloqueado por prerequisito`, `No aplica`). En una falla, detener sólo el flujo dependiente; conservar la evidencia y seguir con casos independientes.

Para un desvío visual/API, revisar en este orden: sesión/contexto (`/api/v1/session`), permisos/tenant del actor, request (payload y status), respuesta del servidor, persistencia tras recarga y finalmente cascadas relacionadas. La UI no debe considerarse evidencia suficiente de autorización o persistencia.

## 19. Referencias de implementación

- Reglas del repositorio: `SYSTEM_PROMPT.md` (especialmente §§2, 7 y 8).
- Bootstrap actual y transacción: `domain/organizations/createOrgWithAdmin.ts`.
- Alta de oficina y cuota: `endpoints/offices.ts`, `domain/offices/office-lifecycle.ts`.
- Membresías y ciclo de vida: `endpoints/orgMembers.ts`, `domain/organizations/member-admin.ts`, `collections/OrganizationMemberships/`.
- Matriz de permisos: `access/rbac/permissions.ts`.
- Contexto/plan/features: `endpoints/session.ts`, `domain/subscriptions/limits.ts`, `domain/subscriptions/plan-limits.ts`.
- Seeds y credenciales locales: `README.md`, `scripts/seed-navigation.ts`, `scripts/seed-demo.ts`.
- Inventario de pantallas y endpoints: `app/portal/`, `app/(dashboard)/`, `payload.config.ts` y `endpoints/`.
