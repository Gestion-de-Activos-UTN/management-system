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
| Administrar oficina/membresía/settings | No                              | Como OrgAdmin                   | Sí                  | No                                                                                                                | No                                                             |
| Tareas                                 | Leer                            | Todas las acciones OrgAdmin     | Todas               | Crear, leer, editar, tomar/liberar, asignar/reasignar, completar, cancelar, archivar y eliminar dentro de alcance | Leer, tomar/liberar/completar                                  |
| Revisión de seguridad                  | Lectura/visita                  | Según alcance OrgAdmin          | Gestiona respuestas | Gestiona dentro de oficinas                                                                                       | Responde sólo revisiones de activos propios; lectura del resto |

Para cada capacidad: probar la acción normal, intentar abrir directamente la URL como rol sin permiso y repetir la request desde Network/cURL. El layout de Administración actualmente restringe la navegación desde el cliente; recibir 404 al abrir una ruta no demuestra autorización server-side. La prueba de permiso debe invocar el endpoint protegido y comprobar 401/403 sin cambios. La posibilidad futura de crear usuarios por rol amplía esta matriz y debe quedar expresada tanto en el contexto de sesión como en endpoints server-side; no basta con mostrar/ocultar controles.

## 6. Onboarding de organización y usuarios

### ORG-01 — Alta feliz Basic

**Objetivo:** validar el bootstrap completo desde StaffPortal.

1. Entrar como PlatformAdmin → Organizaciones → Crear organización.
2. Completar nombre, rubro/sector, plan Basic, primera oficina con ubicación válida y primer usuario con nombre completo, correo y contraseña.
3. Verificar que el rol inicial es OrgAdmin y no se puede cambiar.
4. Revisar el resumen final y confirmar la creación.
5. Comprobar que la organización figura activa en la lista, con una oficina activa y cantidades coherentes.
6. Cerrar sesión de StaffPortal y entrar con las credenciales iniciales en entorno local/de desarrollo.
7. Consultar settings/sesión y `GET /api/v1/offices/agent-summary`; comprobar oficina, organización, plan, features, límites de oficina/usuarios y `quota.per_office`.

**Esperado:** todos los registros quedan relacionados; Basic muestra límites de 3 oficinas, 1 agente por oficina, 1 OrgAdmin, 2 OfficeManagers y 4 Viewers. El usuario puede acceder inmediatamente en el entorno local/de desarrollo.

### ORG-02 — Alta feliz Premium

**Objetivo:** validar selección de plan y topes iniciales.

1. Repetir el asistente seleccionando Premium.
2. Comprobar en `GET /api/v1/session` que los límites son 10 oficinas, 3 OrgAdmins, 10 OfficeManagers y 20 Viewers; consultar `GET /api/v1/offices/agent-summary` para verificar `quota.per_office: 2`.
3. Revisar la organización y verificar que conserva settings/features y su primera oficina.

**Esperado:** límites de oficinas/usuarios de `/session` y cuota de agentes de `agent-summary` coinciden con Premium; `/session` no incluye el tope de agentes por oficina. El plan no altera el alcance del OrgAdmin.

### ORG-03 — Navegación libre, revisión y validación al confirmar

**Objetivo:** verificar campos requeridos, dependencias y navegación del asistente.

1. Abrir cada pestaña en cualquier orden, incluso antes de completar los pasos anteriores; completar primero el administrador y luego la organización.
2. Ir a Revisar con datos incompletos y comprobar que muestra los campos como “Sin completar” y el aviso breve “Faltan datos obligatorios. Completa los pasos pendientes antes de crear la organización.”
3. Intentar crear con datos incompletos; comprobar que no se envía la creación, que los campos inválidos quedan marcados, que las pestañas con errores muestran un punto rojo y que el asistente lleva a la primera pestaña con errores.
4. Elegir “Otro” y dejar vacía la explicación; después escribir una explicación y volver a un rubro predefinido.
5. Elegir provincia y departamento; cambiar la provincia y verificar que se limpia un departamento incompatible.
6. Editar datos desde cualquier pestaña, volver a Revisar y comprobar que el resumen se actualiza.
7. Cancelar antes de confirmar y volver a abrir el asistente.

**Esperado:** la navegación entre pestañas no valida ni bloquea; la revisión muestra los valores incompletos y un aviso breve, sin listar mensajes técnicos de validación. Al confirmar, cada campo inválido muestra su error, las pestañas afectadas se marcan con un punto rojo y se abre la primera pestaña con errores. Corregir un campo quita su error; los valores se conservan al navegar y cancelar no crea datos.

### ORG-04 — Errores de bootstrap y atomicidad

**Objetivo:** garantizar que un fallo no deja entidades huérfanas.

1. Repetir una creación con correo ya usado y datos de ubicación inválidos.
2. Comprobar mensaje, Network y listas de organizaciones/usuarios.
3. Reintentar con datos válidos.
4. Comprobar atomicidad ante un fallo intermedio sólo con una prueba de integración que inyecte el fallo dentro de la transacción; no hay un paso manual fiable ni un control de fallo en la UI.

**Esperado:** sin organización parcial, suscripción duplicada, usuario sin membresía u oficina huérfana; el reintento válido funciona.

### USER-01 — OrgAdmin crea roles permitidos

**Objetivo:** verificar alta activa, límites y alcance.

1. Como OrgAdmin, crear un OfficeManager y un Viewer con datos válidos.
2. Asignar a cada uno una o más oficinas activas; comprobar que el selector permite oficinas de toda la organización.
3. Cerrar sesión y probar el login inmediato de cada cuenta.
4. Verificar desde cada cuenta navegación, datos y `GET /api/v1/session`.

**Esperado:** el usuario aparece activo, con rol y oficinas guardados; manager/viewer sólo acceden a sus oficinas.

### USER-02 — OfficeManager crea Viewer dentro de su alcance

**Objetivo:** validar creación delegada sin ampliar privilegios.

1. Como OfficeManager asignado a Oficina 1, abrir Portal → Equipo. No debe aparecer Administración → Usuarios.
2. Crear Viewer con Oficina 1.
3. Comprobar que Oficina 2 no es seleccionable; intentar manipular la request para incluirla.
4. Probar también una oficina de otra organización.

**Esperado:** creación válida limitada a Oficina 1; el servidor rechaza oficina fuera de alcance aunque el cliente la envíe.

### USER-03 — OrgAdmin adicional desde StaffPortal

**Objetivo:** validar acceso del StaffPortal y cuota.

1. En una organización Premium, usar la acción del StaffPortal para agregar OrgAdmin.
2. Confirmar que el rol está bloqueado y no hay selector de oficina.
3. Crear hasta el límite de tres OrgAdmins activos.
4. Intentar un cuarto; repetir desde una organización Basic, cuyo OrgAdmin inicial ya consume el cupo.

**Esperado:** altas permitidas respetan el plan; al exceder, error claro sin cuenta/membresía parcial. Esta acción de StaffPortal tiene rol fijo; además, el OrgAdmin de la organización puede crear un OrgAdmin desde su flujo de alta normal, sujeto al mismo límite.

### USER-04 — Errores de alta de miembro

**Objetivo:** comprobar restricciones de identidad, rol, oficinas y cuota.

1. Repetir un correo ya usado en la misma organización y en otra.
2. Desde OfficeManager, intentar crear OrgAdmin y OfficeManager mediante UI y request alterada.
3. Enviar Viewer/Manager sin oficinas, con oficina inactiva, ajena o repetida.
4. Llenar límites por rol y volver a crear.
5. Enviar rol inválido, correo mal formado, contraseña vacía y nombre ausente.

**Esperado:** errores de validación/RBAC/cuota; no se crea ni activa ningún registro en los intentos rechazados.

## 7. Administración de oficinas

Endpoints actuales: `POST /api/v1/offices`, `PATCH /api/v1/offices/:id`, `GET /api/v1/offices/:id/deactivation-impact`, `POST /api/v1/offices/:id/status`.

### OFFICE-01 — Crear y editar

1. Como OrgAdmin, Administración → Oficinas → Nueva oficina.
2. Crear oficina con nombre, provincia y comuna/departamento/partido opcional según la provincia; comparar los campos con los del alta de primera oficina.
3. Editar nombre y ubicación; recargar.
4. Probar nombre vacío, caracteres no permitidos, provincia inválida y departamento de otra provincia.
5. Como OfficeManager y Viewer, intentar abrir el modal/endpoint.

**Esperado:** persistencia y ubicación formateada; datos inválidos reciben 400; sólo OrgAdmin puede escribir.

### OFFICE-02 — Cuota de oficina

1. En Basic, crear oficinas hasta tres activas.
2. Ver el contador y el aviso de límite; el botón queda señalado como no disponible y no abre el modal aunque se haga clic. Actualmente usa `data-disabled`, no el atributo HTML `disabled`, para que el tooltip explique el motivo.
3. Intentar `POST /api/v1/offices` con la cookie de OrgAdmin.
4. Desactivar una oficina y crear otra.

**Esperado:** cuarta oficina activa devuelve 409 `office_limit_reached`; oficina inactiva no ocupa cupo; no hay bypass al saltar la UI.

Reproducción cURL de la creación actual:

```bash
curl -i -b "$SIAM_COOKIE" \
  -H 'Content-Type: application/json' \
  -X POST "$SIAM_URL/api/v1/offices" \
  -d '{"name":"Sucursal E2E","province_id":"82","department_id":null}'
```

### OFFICE-03 — Desactivación con impactos

1. Preparar una organización con al menos dos oficinas activas; en la oficina objetivo, disponer agente, miembros, activo de red, activos manuales, tareas abiertas y revisión abierta.
2. En otra organización con una sola oficina activa, intentar desactivarla y comprobar que la operación se rechaza sin aplicar impactos.
3. En la oficina objetivo normal, abrir desactivación y revisar resumen.
4. Escribir nombre incorrecto; cancelar y volver a abrir.
5. Para cada activo manual, elegir destino válido o retiro.
6. Confirmar; revisar cada cascada.

**Esperado:** la UI incluye todos los impactos; el nombre incorrecto responde `confirmation_mismatch` (400) y no muta; agentes se revocan, activos de red se retiran, activos manuales siguen la decisión. Mover un activo manual conserva su historial y tareas, pero limpia responsable/ubicación; retirarlo cancela sus tareas abiertas. También se cancelan las tareas abiertas de oficina y se cierra su revisión abierta. Los escáneres revocados dejan de operar y no se restauran al reactivar la oficina. La última oficina activa responde `last_active_office` (409) sin cascadas.

Inspeccionar muestra el request real de `GET /api/v1/offices/:id/deactivation-impact` y el `POST /api/v1/offices/:id/status`. Para probar el guardado desde cURL, reutilizar el body capturado en Network con un nombre incorrecto y, sólo en fixture de prueba, con todas las decisiones manuales válidas.

### OFFICE-04 — Impacto obsoleto y destinos inválidos

1. Abrir modal de baja.
2. En otra sesión, crear/mover un activo manual u oficina destino para cambiar el impacto.
3. Confirmar el modal anterior; repetir con destino inactivo, ajeno o igual a la oficina que se baja.

**Esperado:** conflicto `impact_changed` o error equivalente; no se aplica una decisión parcial. El destino inválido no mueve ni retira activos.

### OFFICE-05 — Reactivar

1. Reactivar una oficina inactiva.
2. Comprobar que se abre una nueva revisión de seguridad de oficina.
3. Confirmar que no se restauran automáticamente agentes, usuarios o activos retirados por la baja.

**Esperado:** se reactiva sólo la oficina y se abre un ciclo nuevo; los efectos colaterales anteriores no reaparecen por sorpresa.

## 8. Usuarios, permisos y ciclo de vida

### USER-05 — Editar acceso

1. Como OrgAdmin, cambiar un Viewer a OfficeManager y ajustar oficinas.
2. Como OfficeManager, intentar escalar a un rol de mayor autoridad.
3. Cambiar el propio rol a uno inferior; verificar inmediatamente la pérdida de acceso y que no puede volver a elevarlo.
4. Intentar dejar un rol no administrador sin oficinas activas.

**Esperado:** la UI muestra permisos efectivos nuevos; escalada bloqueada por servidor; rol no admin requiere oficina activa.

Para el paso 3, usar una organización Premium con al menos dos OrgAdmins activos. En Basic sólo hay cupo para el OrgAdmin inicial, por lo que la regla del último administrador impide degradarlo.

### USER-06 — Desactivar miembro y confirmar identidad

1. Abrir baja de una persona con activos/tareas y comprobar el impacto.
2. Escribir correo incorrecto; comprobar que el botón no confirma o el servidor rechaza.
3. Cancelar; confirmar que la cuenta sigue activa.
4. Reabrir, elegir reemplazo que cubra todas las oficinas de sus activos (o explícitamente dejar activos sin responsable) y escribir el correo correcto.
5. Confirmar; intentar usar una sesión anterior de la persona desactivada.

**Esperado:** confirmación correcta, sesiones revocadas, activos elegibles reasignados o los demás sin responsable, tareas en curso reclamadas por la persona vuelven a pendientes y las tareas abiertas asignadas no se reasignan automáticamente. Al reactivar, vuelve el acceso con rol anterior, pero los activos y las tareas no se restauran/reclaman automáticamente. La fila conserva historial y aparece inactiva. Si falla la consulta del impacto, se muestra un error con opción para reintentar y la baja queda bloqueada.

Para comparar UI y servidor, consultar primero la lista/impacto mediante los cURLs de §2.3. El PATCH exige `confirm_email` al desactivar y lo valida server-side junto con `is_active` y `replacement_owner_id`.

### USER-07 — Límites e invariantes de baja/reactivación

1. Intentar desactivar al usuario propio.
2. Intentar desactivar o degradar al último OrgAdmin.
3. Desactivar un miembro y reactivarlo mientras la organización está activa.
4. Llenar el límite del rol y luego intentar reactivar/cambiar a ese rol.
5. Desactivar una oficina que era la única del miembro; reactivarlo sin oficina y luego asignar una activa.

**Esperado:** self-deactivation y último admin se rechazan; reactivación respeta organización, oficinas y cuota; los errores no cambian el estado.

## 9. Ajustes y perfil

### SETTINGS-01 — Configuración de inventario

1. Como OrgAdmin, Administración → Configuración; guardar valores válidos de umbral offline y snapshots.
2. Recargar y corroborar valores.
3. Enviar valores fuera de opciones o formatos mediante formulario/request.
4. Como otros roles, entrar por URL y llamar `GET/PATCH /api/v1/organization-settings`.

**Esperado:** persistencia para Admin; validación del mismo contrato en cliente/servidor; no admin recibe 403.

### SETTINGS-02 — Política de revisión y madurez

1. Como OrgAdmin, cambiar la política entre Essential y Reinforced y confirmar en el modal.
2. Comprobar que quedan guardados la política, versión, actor y fecha; revisar ciclos abiertos/historial y estado del recálculo de riesgo.
3. Repetir enviando una versión no disponible y como rol sin permiso.
4. Guardar las respuestas de madurez; comprobar quién y cuándo actualizó.

**Esperado:** el cambio de política y la reconciliación de ciclos/riesgo ocurren juntos; la versión inválida se rechaza; roles no administradores no pueden cambiarla. La madurez registra actor y fecha.

### SETTINGS-03 — Perfil personal

1. Como usuario, cambiar nombre desde Cuenta y validar texto vacío/incorrecto.
2. Como PlatformAdmin, cambiar perfil desde su cuenta.

**Esperado:** sólo campos permitidos cambian; no se permite escribir relaciones o datos sensibles desde estos formularios.

## 10. Inventario y agentes

### INV-01 — Inventario de red

1. Entrar a Inventario con cada rol y oficina seleccionada.
2. Buscar/filtrar por estado, criticidad y oficina; abrir detalle y editar datos de negocio como OrgAdmin/OfficeManager.
3. Verificar que campos técnicos (IP/MAC/SO/servicios) no son editables.
4. Como Viewer, intentar la edición por UI y `PATCH /api/v1/assets/:id/business`.
5. Revisar activos desconocidos/no identificados y probar identificar/desidentificar con actor permitido.

**Esperado:** scope por oficina; campos de negocio sólo para roles permitidos; técnicos inmutables; asset no se crea manualmente.

### INV-02 — Activos manuales

1. Crear activo manual con alias, categoría, criticidad, oficina, responsable y revisión.
2. Intentar responsable de otra oficina; cambiar de oficina y comprobar que debe elegirse responsable elegible.
3. Editar, retirar y revisar el estado/listado.
4. Marcar alcance de revisión incluido/excluido; probar motivo obligatorio y vencimiento futuro dentro de 90 días.
5. Como OfficeManager, usar únicamente su scope; como Viewer, probar lectura.

**Esperado:** validaciones y acceso coinciden; responsable cubre la oficina; exclusión no retira inventario y deja de aplicar al vencer.

### INV-03 — Incidentes de inventario

1. Preparar un incidente de ubicación y uno de identidad desde un reporte de escáner.
2. Como OrgAdmin, resolver ubicación eligiendo confirmar traslado o mantener ubicación; resolver identidad marcándola revisada.
3. Como OfficeManager, resolver sólo si tiene todas las oficinas involucradas dentro de su alcance. Como Viewer, probar la lectura y el intento de resolución.
4. Repetir con decisión incompatible con el tipo, incidente ya resuelto, activo cambiado y oficina de destino inactiva/ajena.

**Esperado:** confirmar traslado mueve el activo al destino propuesto y conserva responsable sólo si sigue cubriendo esa oficina; mantener ubicación descarta el pendiente; identidad sólo admite “revisado”. Repetir una decisión ya resuelta responde conflicto. `POST /api/v1/inventory-incidents/:id/resolve` valida tenant, oficinas y decisión en servidor.

### INV-04 — Revisión periódica de activo manual

1. Crear activo con frecuencia de revisión.
2. Confirmar/revisar y verificar próxima fecha/estado.
3. Probar frecuencia nunca, revisión vencida y campos ausentes.

**Esperado:** badge y próxima revisión cambian en fecha/estado esperados sin duplicar el activo.

### AGENT-01 — Aprovisionar y revocar escáner

1. Como OrgAdmin, seleccionar una oficina y aprovisionar paquete POSIX; repetir Windows si la UI lo ofrece.
2. Comprobar descarga ZIP, nombre y agente en resumen de oficina.
3. Alcanzar cuota de agentes de la oficina y repetir.
4. Revocar un agente; repetir el intento de uso del token revocado.
5. Como OfficeManager/Viewer, probar aprovisionar o revocar.

**Esperado:** paquete sólo se descarga si el agente se creó; el secreto no aparece en listas; límite Basic de 1 agente por oficina (Premium: 2) devuelve `agent_limit_reached` (409) al exceder; RBAC bloquea sin dejar agente huérfano; token revocado no autentica.

### AGENT-02 — Ingesta y heartbeat por cURL

**Objetivo:** probar el canal Scanner ↔ Platform con token de un agente local de demo/provisión.

1. Obtener el token únicamente desde los logs/paquete del entorno local.
2. Enviar `POST /api/v1/reports` con `Authorization: Bearer <token>`, `X-Agent-ID: <agent-id>`, JSON válido y `report_id` nuevo.
3. Consultar Inventario/escaneos; repetir el mismo `report_id` para idempotencia.
4. Enviar JSON inválido, token incorrecto, agente revocado, ID discordante y un segundo reporte con cambios.
5. Enviar heartbeat válido y revisar estado online.
6. Consultar `GET /api/v1/vendor?mac=44:D4:54:00:00:00` con token válido; probar MAC desconocida y token inválido.

Ejemplo estructural (usar un reporte real de fixture generado por el scanner; no inventar un payload parcial si el contrato local exige más campos):

```bash
curl -i -X POST "$SIAM_URL/api/v1/reports" \
  -H 'Authorization: Bearer <token-local>' \
  -H 'X-Agent-ID: <agent-id-local>' \
  -H 'Content-Type: application/json' \
  --data-binary @/tmp/siam-report-fixture.json
```

**Esperado:** contrato válido procesado una vez; inválido/no autorizado rechazado; la repetición no duplica activos/reporte; la UI refleja último heartbeat. Vendor devuelve un nombre para OUI `44D454` y 404 para uno desconocido; es un catálogo de demo, no una base IEEE completa.

## 11. Escaneos y snapshots

### SNAP-01 — Crear y revisar snapshot

1. Seleccionar oficina activa, Inventario → Instantáneas → generar.
2. Abrir detalle; comprobar inventario, evaluación y fecha congelados.
3. Renombrar snapshot y recargar.
4. Intentar snapshot sin oficina, de oficina ajena/inactiva, y como OfficeManager/Viewer.

**Esperado:** `POST /api/v1/inventory-snapshots/generate` crea snapshot manual autorizado; datos históricos no cambian al editar inventario actual; requests inválidas son rechazadas.

### SCAN-01 — Lista, detalle, evidencia y retención

1. Abrir lista y detalle de escaneos; filtrar oficina/fecha/estado.
2. Como OrgAdmin/OfficeManager, ver evidencia técnica; como Viewer, comprobar que scripts/datos crudos sensibles están redactados.
3. Intentar renombrar desde rol permitido y no permitido.
4. Confirmar que el payload crudo vencido se elimina por job conservando resumen y cobertura.

**Esperado:** scope por tenant/oficina; `read_technical` se refleja de igual forma en UI y API; contenido crudo no reaparece en snapshot.

## 12. Revisión de seguridad y riesgo

### REVIEW-01 — Responder revisión individual

1. Abrir ciclos de organización, oficina, activo de red y activo manual.
2. Guardar borrador parcial, salir y volver.
3. Completar con respuestas conformes/no conformes/desconocidas y evidencia.
4. Reabrir un ciclo completado; comprobar que conserva historia y copia respuestas compatibles como borrador.
5. Como Viewer responsable de un activo revisado, guardar un borrador y responder/completar su revisión de activo; repetir con un activo de otra persona y con revisiones de oficina/organización.

**Esperado:** borrador persiste; completar cierra ciclo; reopen genera versión/historial esperado; `not_evaluable` no se interpreta como conforme ni aumenta score. Viewer puede responder sólo revisiones de activos que tiene asignados; no puede responder revisiones de oficina, organización ni activos ajenos.

### REVIEW-02 — Responder varias revisiones

1. Abrir **Responder varias** como OrgAdmin, OfficeManager y Viewer; probar los alcances permitidos (organización sólo OrgAdmin, oficina propia para Manager y activos propios para Viewer).
2. Generar preview; revisar revisiones compatibles, completadas preservadas e incompatibles.
3. Seleccionar/retirar algunos candidatos, responder y completar.
4. Cambiar el conjunto de candidatos desde otra sesión después del preview y antes de completar.

**Esperado:** sólo el alcance permitido se muestra; preview explica conteos y cuestionario; selección obsoleta recibe 409 y pide volver a revisar, sin completar sólo una parte inesperada.

### REVIEW-03 — Evidencia heredada, expiración y exclusiones

1. Revisar evidencia técnica aplicada desde activo/oficina y verificar fuente/antigüedad.
2. Probar Essential (respuestas 365 días, recuperación 180) y Reinforced (180 días), y evidencia técnica (30 días) con registros vencidos preparados en un fixture de integración. El flujo manual no puede adelantar el reloj del servidor.
3. Excluir temporalmente un activo con motivo y vencimiento dentro de 90 días; probar fecha pasada y más de 90 días.
4. Comprobar la inclusión automática con ese fixture controlado; si no está disponible, dejar este subcaso bloqueado para prueba de integración, no simular el paso del tiempo manualmente.

**Esperado:** vencidos se muestran derivados como vencidos; jobs abren ciclo sólo cuando corresponde; exclusión no borra el inventario.

### REVIEW-04 — Procesos programados

1. Comprobar que los jobs de mantenimiento corren en Payload Jobs dentro del proceso de la app; no asumir un scheduler externo.
2. En local con fixture controlado, invocar `POST /api/v1/internal/jobs/aging-sweep` y `POST /api/v1/internal/jobs/expire-scan-payloads` con `INTERNAL_JOBS_TOKEN`.
3. Para expiración de revisiones y exclusiones, preparar fechas vencidas y esperar/observar el job `maintenance` programado; no hay endpoint HTTP manual para esos dos procesos.
4. Repetir una ejecución segura para comprobar idempotencia y revisar `JobRun` cuando aplique.

**Esperado:** sólo cambia lo vencido, sin duplicar resultados; los dos endpoints internos rechazan requests sin token válido. Los jobs de evaluación/exclusión siguen su programación local de Payload.

### RISK-01 — Risk Score y cambios de evidencia

1. Revisar score/cobertura en organización y oficinas.
2. Generar cambio de evidencia y seguir el estado de recálculo pendiente/en curso/completado.
3. Probar sin evidencia evaluable, con hallazgo vigente y con hallazgo vencido.
4. Como OfficeManager/Viewer, abrir sólo oficinas propias; intentar otra oficina por URL/cURL.

**Esperado:** sólo resultados `non_compliant` vigentes ponderan score; falta de evidencia es “Not evaluable”, no cero; cobertura va separada; ningún tenant ve score ajeno.

## 13. Tareas

### TASK-01 — Crear, asignar, ejecutar y cerrar

1. Crear tarea abierta, asignada a rol y asignada a persona; probar tarea global y por oficinas.
2. Crear tarea relacionada a una oficina, activo, revisión, snapshot o escaneo.
3. Como elegible, tomar, liberar y completar; como OrgAdmin/OfficeManager, reasignar, editar, cancelar con motivo y archivar. Como OrgAdmin (o PlatformAdmin visitando), forzar el cierre de una tarea en curso reclamada por otra persona.
4. Como Viewer, probar sólo leer/tomar/liberar/completar en su scope.
5. Revisar historial de actores y actividad.

**Esperado:** estado efectivo (incluida planificada) y permisos coinciden; no se asignan personas sin cobertura; historial refleja actor/acción. Viewer sólo ejecuta acciones para tareas que le corresponden o puede reclamar; fuerza de cierre queda reservada a OrgAdmin.

### TASK-02 — Validaciones y referencias

1. Probar título corto/vacío, fechas de vencimiento anteriores al inicio, prioridad inválida, oficina duplicada y tarea global con oficina.
2. Referenciar entidad ajena/inexistente o referencia incompleta.
3. Manipular `office_id` en lista y filtros para salir del alcance.

**Esperado:** errores 400/403 sin escritura; las referencias sólo revelan labels legibles autorizados; no mostrar UUID crudo.

## 14. Mensajes de StaffPortal

### MSG-01 — Crear y entregar mensaje

1. Como PlatformAdmin, crear aviso para toda la plataforma, organizaciones seleccionadas y roles/audiencias disponibles.
2. Probar fechas/CTA/entidad destino, guardar, publicar y revisar destinatarios.
3. Entrar como distintos usuarios y verificar lectura/recibo.
4. Resolver el enlace desde la UI y marcar receipt; usar replay cuando corresponda.
5. Intentar crear/editar/publicar como usuario de organización.

**Esperado:** audiencia y organizaciones coinciden; usuario sólo ve mensajes propios; actor no autorizado recibe 403; los errores de formulario no publican mensajes.

## 15. StaffPortal, dashboard y organización desactivada

### PLATFORM-01 — Resumen y lista

1. Revisar métricas del dashboard contra total/activas de organizaciones, oficinas activas, agentes activos/conectados e incidentes pendientes.
2. Buscar/filtrar organizaciones; entrar a modo visita y volver a StaffPortal.
3. Intentar leer dashboard/summary como OrgAdmin.

**Esperado:** totales agregados correctos; PlatformAdmin puede visitar cualquier organización existente por el enlace del StaffPortal, incluso si está inactiva. La visita da contexto/rol efectivo OrgAdmin; cada mutación debe además aplicar sus guardas de ciclo de vida. `asOrganization` inválido falla; un usuario de organización no puede cambiar de tenant enviando ese parámetro. Endpoints de plataforma devuelven 403 a roles de organización. Para organizaciones inactivas, aplicar la comprobación específica de mutaciones indicada a continuación.

**Hallazgo de código a resolver/aceptar explícitamente:** el bloqueo de escrituras en una organización inactiva no es uniforme. Crear oficinas y reactivar miembros llaman al guard de organización activa; en cambio, el PATCH de detalles de oficina, el PATCH de settings y algunas modificaciones de membresía no lo comprueban. Probarlos como PlatformAdmin visitando una organización inactiva en entorno desechable. La expectativa de negocio recomendada es rechazo sin mutación; si alguna operación sigue aceptándose, registrar el endpoint y tratarlo como brecha de ciclo de vida antes de cerrar el estándar.

### ORG-STATUS-01 — Desactivar/reactivar organización

1. Como PlatformAdmin, abrir impacto, confirmar nombre, desactivar organización con datos.
2. Revisar oficinas, cuentas, agentes, activos, tareas y revisiones involucradas.
3. Entrar con usuario que tenía sesión activa; probar endpoint y navegación.
4. Reactivar; comprobar qué elementos vuelven y cuáles permanecen inactivos.
5. Verificar el escenario sin OrgAdmin u oficina disponibles con una prueba de integración y fixture controlado. No puede producirse con las operaciones normales, y no forma parte del recorrido manual.

**Esperado:** baja atómica con impacto confirmado; usuarios pierden acceso y sesiones; features no se resetean por desactivar. Reactivar vuelve a habilitar el OrgAdmin y la oficina elegidos por el preview, y abre revisiones nuevas; no revive automáticamente las demás personas, oficinas, escáneres o activos. El caso sin administrador/oficina disponible se cubre sólo en integración con fixture controlado.

## 16. Aislamiento multi-tenant y límites transversales

Ejecutar como OrgAdmin, OfficeManager y Viewer. Usar IDs válidos de Org ajena C, y también de otra oficina de la propia organización.

1. Sustituir IDs en URL, query y body de listas/detalles/mutaciones.
2. Pedir `/api/organizations`, `/api/offices`, `/api/assets`, `/api/non-network-assets`, `/api/v1/org-members`, `/api/v1/tasks`, `/api/v1/assessments` y los endpoints de detalle relevantes.
3. Intentar crear activo/tarea/revisión usando oficina de otra organización.
4. Intentar modificar relaciones `organization`, `user` o membresía por API REST directa.
5. Comparar UI y status HTTP.

**Esperado:** respuesta vacía/404/403 acorde al endpoint, sin datos filtrados ni mutación. La comprobación de tenant aplica incluso cuando el RBAC del rol permite la acción en abstracto.

## 17. Errores generales y recuperación

1. Enviar JSON mal formado/vacío a endpoints mutables.
2. Enviar campos extra, tipos erróneos, arrays grandes o IDs inválidos.
3. Doble-click sobre Guardar/Confirmar; recargar durante una mutación; repetir request después de timeout.
4. Abrir dos sesiones y cambiar datos entre preview y confirmación (oficinas, miembros, tareas, activos).
5. Verificar atomicidad del bootstrap mediante la prueba de integración con fallo controlado; reiniciar/cortar la app manualmente no es un mecanismo reproducible ni una comprobación confiable.
6. Usar cookie caducada, sesión cerrada, cuenta desactivada y organización inactiva.

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
