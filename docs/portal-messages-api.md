# API de mensajes del portal

Referencia técnica del feature `portal-messages`: contrato HTTP, audiencia, estado por destinatario, enlaces con control de acceso, concurrencia y la cadena que lo conecta con el frontend. Dirigida a quien mantiene o extiende el feature.

Verificado contra el código el 2026-10-31. Si algo de este documento contradice el código, gana el código: corregir el documento.

La identidad, `TenantContext` y los códigos transversales (`unauthenticated`, `forbidden`) están en `session-and-access.md`. Los mensajes los publica un administrador de plataforma y los reciben las personas de las organizaciones.

## 1. Capas y archivos

| Capa | Archivo | Responsabilidad |
|---|---|---|
| Contrato | `modules/portal-messages/schema.ts` | Schemas Zod de entrada, secciones, roles, tipos de entidad. Los usan el formulario y el servidor. Fuente de verdad. |
| Endpoints | `endpoints/portalMessages.ts` | Autenticación, validación de audiencia, entrega, recibos, resolución de enlaces. Registrados en `payload.config.ts` vía `portalMessageEndpoints`. |
| Dominio | `domain/portal-messages/targeting.ts` | `messageTargetsUser`: si un mensaje alcanza a una persona. |
| | `domain/tasks/task-actions.ts` (`loadTask`, `assertCanReadTask`) y `domain/tasks/task-reference.ts` (`resolveTaskReference`, `tenantCanReadTaskReference`) | Resolución y permisos de la entidad enlazada. Reutilizan las reglas de `task-api.md`. |
| Persistencia | `collections/PortalMessages/index.ts` | Colección `portal-messages`, cerrada al acceso directo. |
| | `collections/PortalMessageReceipts/index.ts` | Colección `portal-message-receipts` (estado por persona), cerrada al acceso directo. |
| Cliente HTTP | `modules/portal-messages/service.ts` | Funciones sobre `lib/http-client.ts`; tipos `PortalMessageDTO`, `PortalMessageRecord`. |
| Estado de servidor | `modules/portal-messages/hooks/use-portal-messages.ts`, `use-portal-message-actions.ts` | TanStack Query y acciones de la persona destinataria. |
| Estado de sesión del navegador | `modules/portal-messages/session-state.ts` | Marcas en `sessionStorage` para la cola. |
| Etiquetas y plantillas | `modules/portal-messages/portal-message-labels.ts`, `templates.ts` | Textos, íconos, estados, ventana de historial, plantillas. |
| UI destinatario | `modules/portal-messages/components/PortalMessagesRuntime.tsx`, `PortalMessageDialog.tsx`, `PortalMessagesList.tsx` | Cola modal, diálogo, bandeja del Panel general. |
| UI administración | `modules/portal-messages/components/PortalMessagesAdminPage.tsx`, `PortalMessageForm.tsx`, `RowActions.tsx`, `app/(dashboard)/(protected)/portal-messages/page.tsx` | Gestión por el administrador de plataforma. |

Cadena de un mensaje: formulario → `useSavePortalMessage` → `service.ts` → `httpClient` → `endpoints/portalMessages.ts` → `payload.create` o `payload.update` sobre `portal-messages`. Cadena de entrega: `PortalMessagesRuntime` → `usePortalMessages` → `GET /v1/portal-messages` → `messageTargetsUser` + `resolveMessageLink`.

## 2. Modelo

### 2.1 Colección `portal-messages`

Acceso: `create`, `read`, `update` y `delete` son `() => false`. Todo pasa por los endpoints, que escriben con `overrideAccess: true`.

| Campo | Tipo | Notas |
|---|---|---|
| `title` | text, requerido, ≤ 100 | |
| `description` | textarea, requerido, ≤ 500 | |
| `message_type` | `notice` \| `actionable` | Etiquetas: "Aviso" y "Accionable" (para quien recibe, "Aviso" y "Acción requerida"). |
| `template_key` | text, solo lectura en el admin de Payload | Clave informativa de la plantilla usada; el servidor no la valida. |
| `cta_label` | text, ≤ 30 | Texto de la acción principal. Solo tiene sentido en `actionable`. |
| `scope` | `global` \| `organizations`, requerido | |
| `target_organizations` | relación múltiple a `organizations` | Vacío si `scope = global`. |
| `target_kind` | `all` \| `role` \| `user`, requerido | `all` si `scope = global`. |
| `target_roles` | select múltiple (`org_admin`, `office_manager`, `org_viewer`) | Solo con `target_kind = role`. |
| `target_users` | relación múltiple a `users` | Solo con `target_kind = user`. |
| `linked_section` | `dashboard`, `risk-score`, `security-review`, `tasks`, `inventory`, `administration` | Sección del portal enlazada. |
| `linked_entity_type` | `tasks` más las colecciones de referencia de tareas | Tipo de la entidad concreta. |
| `linked_entity` | relación polimórfica a `tasks`, `offices`, `assets`, `non-network-assets`, `assessment-instances`, `compliance-results`, `inventory-snapshots`, `scan-reports`, `risk-evaluations`, `agents` | Entidad concreta enlazada. |
| `expires_at` | date, opcional | Sin fecha, no vence. |
| `is_active` | checkbox, por defecto `true` | |
| `delivery_version` | number, requerido, por defecto 1, solo lectura | Versión de entrega; sube con el reenvío (§5.4). |
| `created_by` | relación a `admins`, solo lectura, `update` bloqueado | Solo se escribe al crear. |
| `createdAt`, `updatedAt` | timestamps | |

El documento **no** guarda estado de lectura. No tiene campo de organización propio: la organización se deriva de `target_organizations`.

### 2.2 Colección `portal-message-receipts`

Estado de una persona sobre un mensaje. Acceso cerrado igual que la anterior. Índice único `(message, user)`: hay **un solo recibo por mensaje y persona**.

| Campo | Tipo | Notas |
|---|---|---|
| `message` | relación a `portal-messages`, requerido, indexado | |
| `user` | relación a `users`, requerido, indexado | Solo personas de organización; los administradores no tienen recibos. |
| `delivery_version` | number, requerido, por defecto 1 | Versión de entrega a la que corresponde el recibo. |
| `seen_at` | date | Momento en que se mostró el mensaje. |
| `dismissed_at` | date | Momento en que la persona respondió (descartó). |
| `createdAt`, `updatedAt` | timestamps | |

### 2.3 Estados

**Estado de un mensaje** (`portalMessageStatus`, `portal-message-labels.ts`; solo informa la UI de administración, el servidor aplica la misma lógica al entregar):

| Estado | Condición | Etiqueta |
|---|---|---|
| `inactive` | `is_active = false` | Inactivo |
| `expired` | activo y `expires_at <= ahora` | Vencido |
| `active` | activo, sin `expires_at` o con `expires_at` futuro | Vigente |

`inactive` gana sobre `expired`. Un mensaje se entrega solo en estado `active`.

**Estado por destinatario**, derivado del recibo de la versión vigente (`seen`, `dismissed`):

| Situación | `seen` | `dismissed` |
|---|---|---|
| Sin recibo, o recibo de otra `delivery_version` | `false` | `false` |
| Recibo vigente con `seen_at` | `true` | según `dismissed_at` |
| Recibo vigente con `dismissed_at` | `true` (`dismissed` fija ambos) | `true` |

"Recordarme más tarde" **no** tiene estado en el servidor (§8.2).

### 2.4 Flujos

**Publicación y entrega.** El administrador crea el mensaje con audiencia, vigencia y, opcionalmente, un enlace. Queda disponible de inmediato para quienes la audiencia alcanza: no hay un envío ni un job; cada persona lo recibe cuando su cliente consulta `GET /v1/portal-messages` (al cargar el portal y luego cada 60 s). La entrega se evalúa en cada consulta contra la membresía vigente de la persona, no contra una lista congelada: una persona que entra a la organización después de la publicación también lo recibe, y una que sale deja de recibirlo.

**Lectura y respuesta.** Al mostrarse un mensaje en el modal, el cliente envía un recibo `seen`. Cuando la persona responde (descarta, usa la acción principal o confirma un aviso), envía un recibo `dismissed`, que además fija `seen_at`. Un mensaje descartado deja de entrar en la cola modal, pero sigue en la bandeja del Panel general (los leídos, hasta 30 días desde su creación) y puede volver a abrirse en modo de consulta.

**Reenvío.** El administrador puede "volver a mostrar" un mensaje activo. Eso sube `delivery_version`; los recibos de la versión anterior dejan de contar (la entrega vuelve a figurar sin leer ni descartada para todos) y el mensaje reaparece como nuevo en la cola. Los recibos viejos no se borran: se pisan cuando la persona vuelve a responder.

**Edición.** Editar título, texto, audiencia o enlace **no** cambia `delivery_version`: quienes ya descartaron el mensaje no lo ven de nuevo con el texto nuevo. Para resurgirlo hay que reenviar.

**Desactivar y vencer.** Un mensaje inactivo o vencido sale de la entrega y de los recibos: las consultas de la persona (lista, recibo, `resolve-link`) responden como si no existiera. La audiencia de un mensaje inactivo no se revalida al editarlo; sí al reactivarlo (§5.2).

## 3. Permisos y alcance

No hay acciones de `portal-messages` en la matriz de `access/rbac/permissions.ts`: los endpoints no llaman a `canDo`. La autorización es por **tipo de identidad**, con dos funciones locales.

| Función | Quién pasa | Respuestas |
|---|---|---|
| `platformAdmin(req)` | Contexto activo, `isPlatformAdmin`, **sin** `organizationId` y `req.user.collection === 'admins'` | Sin contexto o inactivo: 401 `unauthenticated`. Cualquier otro caso: 403 `forbidden`. |
| `orgUser(req)` | Contexto activo, no administrador de plataforma, con `organizationId` y con `role` | Sin contexto o inactivo: 401 `unauthenticated`. Cualquier otro caso: 403 `forbidden`. |

Consecuencias:
- Un administrador de plataforma que visita una organización (`?asOrganization=`) tiene `organizationId`; por eso `platformAdmin` lo rechaza (403) y `orgUser` también lo rechaza (403). Mientras visita no administra ni recibe mensajes.
- Los tres roles de organización (`org_admin`, `office_manager`, `org_viewer`) usan los mismos endpoints de persona destinataria y no hay diferencia de permisos entre ellos. Lo que cambia entre roles es la **audiencia** (`target_kind = role`) y la **posibilidad de abrir el enlace** (§6).
- No se consulta el feature flag de plan ni el estado de la organización de la persona destinataria. Los mensajes funcionan aunque `tasks` u otras funciones estén apagadas.
- La organización de la persona sale de `ctx.organizationId`; no hay parámetro de organización en los endpoints de destinatario.

### 3.1 Audiencia (`messageTargetsUser`)

En orden:
1. `scope = global`: llega a cualquier persona de cualquier organización.
2. `scope = organizations`: la organización de la persona debe estar en `target_organizations` (acepta ids o relaciones pobladas). Si no, no llega.
3. `target_kind = all`: llega a toda la organización.
4. `target_kind = role`: el rol de la persona debe estar en `target_roles`; sin rol no llega.
5. `target_kind = user` (otro valor): la persona debe estar en `target_users`.

Un mensaje a roles o personas **no** distingue oficinas: no hay audiencia por oficina.

### 3.2 Quién ve qué

| Actor | Gestión (`/v1/platform-admin/*`) | Entrega (`/v1/portal-messages*`) |
|---|---|---|
| Administrador de plataforma, sin organización | Sí | 403 |
| Administrador de plataforma visitando una organización | 403 | 403 |
| `org_admin`, `office_manager`, `org_viewer` | 403 | Sí, si la audiencia los alcanza |

En el cliente, `PortalMessagesRuntime` y `PortalMessagesList` solo consultan si `session.collection === 'users'`; un administrador visitante ni dispara la request, y la bandeja muestra el texto "La bandeja de mensajes es personal de cada miembro de la organización."

## 4. Contrato HTTP

Prefijo `/api`. Cuerpos JSON. Un cuerpo ausente o inválido se parsea como `{}`. El cliente agrega `?asOrganization=` a toda request cuando está en la URL del portal; en estos endpoints no tiene efecto útil (§3).

| Método y ruta | Identidad | Entrada | Respuesta OK |
|---|---|---|---|
| `GET /v1/platform-admin/portal-messages` | plataforma | query `organization_id` (opcional, repetible o separada por comas) | 200 `AdminPortalMessageOptions` |
| `POST /v1/platform-admin/portal-messages` | plataforma | `PortalMessageInputSchema` | 201 documento creado |
| `PATCH /v1/platform-admin/portal-messages/:id` | plataforma | `PortalMessageInputSchema` | 200 documento actualizado |
| `POST /v1/platform-admin/portal-messages/:id/replay` | plataforma | — | 200 `{ ok: true, delivery_version }` |
| `GET /v1/platform-admin/portal-message-entities` | plataforma | query `scope`, `organization_id`, `type` | 200 `{ docs }` |
| `GET /v1/portal-messages` | organización | — | 200 `{ docs: PortalMessageDTO[] }` |
| `PATCH /v1/portal-messages/:id/receipt` | organización | `{ status, delivery_version? }` | 200 `{ ok: true }` o `{ ok: true, stale: true }` |
| `GET /v1/portal-messages/:id/resolve-link` | organización | — | 200 `{ url: string \| null }` |

No hay `DELETE`: los mensajes no se eliminan por la API; se desactivan.

### 4.1 Entrada: `PortalMessageInputSchema`

La edición usa el **mismo schema completo** que la creación (no es parcial: un `PATCH` reemplaza todos los campos).

| Campo | Regla |
|---|---|
| `title` | texto recortado, 1–100, `TEXT_RULES.title` |
| `description` | texto recortado, 1–500, `TEXT_RULES.free` |
| `message_type` | `notice` \| `actionable` |
| `template_key` | texto opcional, mínimo 1 |
| `cta_label` | texto recortado, ≤ 30, `TEXT_RULES.title`; opcional o `null` |
| `audience` | unión discriminada por `scope` (abajo) |
| `linked_section` | una de las seis secciones; opcional o `null` |
| `linked_entity_type` | `tasks` o una colección de referencia de tareas; opcional o `null` |
| `linked_entity` | `{ relationTo, value }`; opcional o `null` |
| `expires_at` | ISO 8601 con offset; opcional o `null` |
| `is_active` | booleano, por defecto `true` |

`audience`:
- `{ scope: 'global' }`.
- `{ scope: 'organizations', target_kind: 'all', organization_ids }`.
- `{ scope: 'organizations', target_kind: 'role', organization_ids, role_slugs }`: `role_slugs` de `org_admin`, `office_manager`, `org_viewer`, 1 a 10.
- `{ scope: 'organizations', target_kind: 'user', organization_ids, user_ids }`: 1 a 500 UUID.
- `organization_ids`: 1 a 500 UUID.

Reglas cruzadas (`superRefine`):
- Con `linked_entity` o `linked_entity_type` es obligatoria `linked_section`.
- `linked_entity.relationTo` debe coincidir con `linked_entity_type`.
- `linked_entity_type` debe pertenecer a la sección elegida (`PORTAL_MESSAGE_ENTITY_SECTION`): `tasks` → `tasks`; `offices` y `agents` → `administration`; `assets`, `non-network-assets`, `inventory-snapshots`, `scan-reports` → `inventory`; `assessment-instances` y `compliance-results` → `security-review`; `risk-evaluations` → `risk-score`.
- Un `notice` no admite `cta_label`.

Un cuerpo inválido responde 400 `{ error: 'invalid_message', issues }`.

### 4.2 `GET /v1/platform-admin/portal-messages`

Sin `organization_id`: devuelve todos los mensajes (`pagination: false`, `sort: '-createdAt'`) con la forma de `PortalMessageRecord`, más las opciones. Con `organization_id`: `docs` es `[]` y solo se calculan las opciones; el formulario lo usa para cargar destinatarios sin resolver la etiqueta de cada entidad enlazada.

Respuesta `AdminPortalMessageOptions`:
- `docs`: `PortalMessageRecord[]` (abajo).
- `organizations`: organizaciones activas, ordenadas por nombre, solo `id` y `name`.
- `roles`: roles no de plataforma (`is_platform_role = false`) filtrados a los tres roles de organización; `{ id, slug, name }`.
- `users`: con `organization_id`, las membresías con `is_active = true` y `status = 'active'` de esas organizaciones, como `{ id, organization_id, name, email, role }`. Sin `organization_id`, `[]`. No incluye membresías en `onboarding`.

`PortalMessageRecord` (`messageInputFromDoc`): `id`, `title`, `description`, `message_type`, `template_key` (o `undefined`), `cta_label` (o `null`), `audience` (reconstruida desde los campos planos; un `scope` o `target_kind` desconocido se normaliza a `organizations` y `all`), `linked_section`, `linked_entity_type`, `linked_entity` (`{ relationTo, value }` o `null`), `expires_at`, `is_active`, `linked_entity_label` (`adminEntityLabel`: título de la tarea o etiqueta de la entidad; `null` si no se puede resolver), `delivery_version` (mínimo 1), `createdAt`. No incluye `created_by` ni `updatedAt`.

### 4.3 `POST` y `PATCH` de mensajes

Orden en la creación: parseo (400 `invalid_message`), `validateAudience`, creación con `created_by = auth.ctx.userId`. En la edición: parseo, `validateAudience` **solo si `is_active` es `true`**, actualización (sin tocar `created_by` ni `delivery_version`).

`payloadData` aplana la entrada: `template_key`, `cta_label`, `linked_section`, `linked_entity_type`, `linked_entity` y `expires_at` quedan en `null` si faltan; `target_organizations` solo se llena con `scope = organizations`; `target_kind` es `all` en un mensaje global; `target_roles` y `target_users` solo se llenan con su `target_kind`.

Cualquier excepción dentro del `try` (validación de audiencia, error de base de datos, id inexistente en el `PATCH`) se devuelve como 400 `{ error: <mensaje de la excepción> }`. Ver §6 y §10.

La respuesta de `POST` y `PATCH` es el documento crudo de Payload (`depth: 0`), no `PortalMessageRecord`: incluye `updatedAt`, `created_by` y los campos planos `scope`, `target_*`. El cliente la tipa como `PortalMessageRecord`, pero solo se usa para invalidar el caché.

### 4.4 `POST /v1/platform-admin/portal-messages/:id/replay`

1. Busca el mensaje; no existe: 404 `message_not_found`.
2. Inactivo o vencido (`expires_at <= ahora`): 409 `message_inactive_or_expired`.
3. `delivery_version` pasa a `max(1, actual) + 1` y responde `{ ok: true, delivery_version }`.

### 4.5 `GET /v1/platform-admin/portal-message-entities`

Opciones de entidad para el formulario. Parámetros: `scope` (`global`; cualquier otro valor se trata como `organizations`), `organization_id` (repetible o separado por comas) y `type`.

- `type` ausente, o distinto de `tasks` y fuera de `TASK_REFERENCE_COLLECTIONS`: 400 `invalid_entity_scope`.
- Con `scope = global`, las organizaciones destinatarias son **todas las activas**; si no, las de `organization_id`.
- Si el conjunto de organizaciones **no tiene exactamente una**, responde `{ docs: [] }`: una entidad concreta pertenece a una sola organización, así que solo se ofrecen opciones cuando el destino es una sola.
- `tasks`: hasta 200 tareas de esa organización, sin archivar y no canceladas, ordenadas por `title`. Etiqueta: título de la tarea.
- Otros tipos: hasta 200 documentos de la colección, ordenados por `updatedAt` descendente, acotados a la organización (`scan-reports` por las oficinas de la organización; el resto por `organization`). Cada uno pasa por `resolveTaskReference` y se descarta si no resuelve o está no disponible (`unavailable`). El tope de 200 se aplica **antes** de descartar los no disponibles.

Respuesta: `{ docs: [{ relationTo, value, label }] }`. No se verifica que la organización pedida exista o esté activa; si no existe, las consultas devuelven vacío.

### 4.6 `GET /v1/portal-messages` (bandeja de la persona)

1. Carga los mensajes con `is_active = true` y sin `expires_at` o con `expires_at` posterior a ahora (`pagination: false`, `sort: '-createdAt'`).
2. Filtra en memoria con `messageTargetsUser` para la organización, el rol y el usuario del contexto.
3. Carga los recibos de esa persona para esos mensajes.
4. Para cada mensaje arma `PortalMessageDTO`: el recibo solo cuenta si su `delivery_version` coincide con la versión actual del mensaje.

`PortalMessageDTO`:

| Campo | Contenido |
|---|---|
| `id` | id del mensaje |
| `delivery_version` | versión vigente (mínimo 1) |
| `title`, `description`, `message_type`, `createdAt` | del mensaje |
| `cta_label` | `string` o `null` |
| `seen` | `Boolean(receipt.seen_at)` |
| `dismissed` | `Boolean(receipt.dismissed_at)` |
| `entity` | `MessageLink` o `null` |

`MessageLink`: `{ kind: 'section' \| 'entity', relationTo, value?, label?, href?, access: 'allowed' \| 'denied' \| 'unavailable' }`. Detalle en §6.

El DTO no expone la audiencia, los demás destinatarios, `is_active`, `expires_at` ni `created_by`.

### 4.7 `PATCH /v1/portal-messages/:id/receipt`

Cuerpo: `{ status: 'seen' | 'dismissed', delivery_version?: number }`. No se valida con Zod.

Orden de verificaciones:
1. `status` distinto de `seen` y `dismissed`: 400 `invalid_receipt`.
2. El mensaje debe existir, estar activo, no vencido y alcanzar a la persona (`messageTargetsUser`); si no, 404 `message_not_found`. No se distingue entre "no existe" y "no es para ti".
3. `requestedVersion = body.delivery_version ?? versión actual`. Si no es un entero mayor o igual a 1: 400 `invalid_receipt`.
4. Si `requestedVersion` no coincide con la versión actual: 200 `{ ok: true, stale: true }` **sin escribir**. Un recibo de una entrega anterior no descarta la nueva.
5. Escritura (§7.2).

Datos escritos:
- `dismissed`: `{ delivery_version, seen_at: ahora, dismissed_at: ahora }`.
- `seen`: `{ delivery_version, seen_at: ahora }`, más `dismissed_at: null` cuando el recibo existente es de otra versión o no existe. Con un recibo de la misma versión no toca `dismissed_at`: un `seen` tardío no deshace un descarte.

### 4.8 `GET /v1/portal-messages/:id/resolve-link`

Mismo control de existencia, vigencia y audiencia que el recibo (404 `message_not_found`). Resuelve el enlace con `resolveMessageLink`. Responde `{ url }`: el `href` si `access = allowed`, y `null` en cualquier otro caso (sin enlace, denegado o no disponible). Es la verificación que se repite al hacer clic, porque el acceso puede haber cambiado desde que se listó el mensaje.

## 5. Reglas por operación

### 5.1 Validación de audiencia (`validateAudience`)

Se ejecuta al crear y al editar un mensaje que quedará activo. Lanza `Error` con un texto en español (se devuelve como 400, §6).

1. **Organizaciones.**
   - `scope = organizations`: todas las `organization_ids` deben existir y estar activas (se compara la cantidad encontrada con la cantidad de ids únicos). Falla con "Una organización no existe o está inactiva."
   - `scope = global`: el conjunto de organizaciones es todas las activas; no falla.
2. **Personas** (`target_kind = user`): cada `user_ids` debe tener una membresía con `is_active = true` y `status = 'active'` en alguna de las organizaciones destinatarias. La verificación es "en alguna de ellas", no un emparejamiento de persona y organización específica. Falla con "Cada persona seleccionada debe pertenecer a una organización destinataria y estar activa."
3. **Entidad enlazada** (`linked_entity`):
   - `tasks`: `loadTask` debe encontrarla (si no, falla con la excepción de la tarea) y las organizaciones destinatarias deben ser **exactamente una**, la de la tarea. Falla con "La tarea debe estar disponible para todas las organizaciones destinatarias."
   - Otras: `resolveTaskReference` debe resolverla, las organizaciones destinatarias deben ser exactamente una, igual a la de la entidad, y no estar `unavailable`. Falla con "La entidad debe estar disponible para todas las organizaciones destinatarias."

Consecuencia: un mensaje con entidad concreta solo puede dirigirse a una organización; un mensaje global con entidad solo es válido si hay exactamente una organización activa. Con solo la sección enlazada no hay esa restricción.

No se valida que el rol de `role_slugs` exista en la organización, ni que `template_key` corresponda a una plantilla conocida, ni que `linked_entity_type` sin `linked_entity` tenga sentido.

### 5.2 Activar, desactivar y editar

- Desactivar (`is_active: false`) no revalida la audiencia: un mensaje cuya organización se desactivó, o cuya persona salió de la organización, o cuya entidad se eliminó, se puede desactivar igual.
- Reactivar o editar un mensaje activo revalida la audiencia completa: si quedó obsoleta, 400 con el texto correspondiente.
- La interfaz envía el registro completo con `is_active` invertido (`toggleActive` en `PortalMessagesAdminPage`); los campos extra del registro (`id`, `delivery_version`, `linked_entity_label`, `createdAt`) los descarta el parseo de Zod.
- Un `PATCH` no cambia `delivery_version`.

### 5.3 Resolución de enlaces (`resolveMessageLink`)

Se ejecuta por mensaje, para la persona que consulta (`ctx`). Ver §6 para el resultado y los motivos.

### 5.4 Reenvío

Lee `delivery_version`, suma 1 y escribe. No hay lock ni escritura condicional: dos reenvíos simultáneos podrían leer el mismo valor y escribir el mismo número. El efecto observable (sube al menos una versión) se mantiene.

### 5.5 Recibos (`PATCH receipt`)

Es un *upsert* por `(message, user)`:
- Busca el recibo existente. Si existe, lo actualiza; si no, lo crea con `message`, `user` y los datos.
- La búsqueda y la escritura corren en una transacción (`withTransaction`) que empieza con un lock bloqueante por `(mensaje, persona)` (`transactionLock`, clave `portal-message-receipt:<mensaje>:<persona>`). Los recibos simultáneos de la misma persona, desde varias pestañas o desde el modal y la bandeja, se aplican de a uno. Cada uno lee lo que confirmó el anterior.
- Así, un `seen` que se procesa junto a un `dismissed` nunca decide `dismissed_at: null` con una lectura previa al descarte. Las personas distintas no comparten el lock.
- El índice único `(message, user)` queda como garantía de base. Con el lock, la creación ya no compite.

## 6. Enlaces con control de acceso

Un mensaje puede enlazar una **sección** del portal, o una **entidad concreta** (no ambas: si hay `linked_entity`, tiene prioridad). El servidor no confía en el enlace guardado: lo resuelve para cada persona y devuelve `access`.

| `kind` | Origen | Resultado |
|---|---|---|
| `section` | `linked_section` | `access: 'allowed'` y `href` de `PORTAL_MESSAGE_SECTION_LINKS` si la sección existe en el mapa; `'unavailable'` y `href: null` si no (por ejemplo, un valor guardado que ya no existe). `relationTo` es la sección y `label` su nombre. |
| `entity` (tarea) | `linked_entity` con `relationTo = tasks` | `loadTask` + `assertCanReadTask` (las mismas reglas de lectura de tareas: permiso, alcance, entidad relacionada legible, involucrado o elegible; ver `task-api.md` §3.3). Si pasa: `allowed`, `label` = título, `href` = `/portal/tasks/<id>`. Cualquier excepción: `denied`. |
| `entity` (otra) | `linked_entity` con otra colección | `resolveTaskReference`; `unavailable` si está retirada o eliminada (`unavailable`) o si falla la resolución; `denied` si `tenantCanReadTaskReference` es falso para la persona (permiso `read` de la colección y alcance de su oficina); `allowed` con `label` y `href` (`getTaskReferenceHref`) en otro caso. |

Sin revelar datos fuera de alcance:
- `denied` y `unavailable` no incluyen `value`, `label` ni `href`: solo `kind`, `relationTo` y `access`. La persona sabe qué tipo de elemento era, no cuál ni cómo se llama.
- En una tarea, **cualquier fallo** (no existe, otra organización, oficina fuera de alcance, sin elegibilidad) se reporta como `denied`; no se distingue "no existe" de "no tienes acceso".
- En otras entidades, un fallo de resolución (por ejemplo, la entidad no existe más) se reporta como `unavailable`, y `denied` solo aparece cuando la entidad existe pero el rol no puede leerla.
- `resolve-link` devuelve `url: null` para todo lo que no sea `allowed`.

En el cliente:
- `PortalMessageDialog` deshabilita la acción principal si `entity.access !== 'allowed'` (`linkBlocked`).
- El texto de la tarjeta de entidad es "No tienes acceso a este elemento" (`denied`) o "Este elemento ya no está disponible" (`unavailable`).
- Los enlaces de entidad no incluyen `asOrganization`; las personas de organización no lo usan.
- El enlace a una tarea o sección no verifica el feature flag; si la función está apagada, el destino responde con su propio 403 `feature_disabled`.

## 7. Concurrencia y atomicidad

### 7.1 Escrituras de mensajes

Creación, edición y reenvío son escrituras simples con `overrideAccess`, sin transacción propia ni lock. La validación de audiencia y la escritura no son atómicas entre sí: una organización o persona puede cambiar de estado entre ambas.

### 7.2 Recibos

Los recibos de una misma persona sobre un mismo mensaje se serializan con un lock transaccional, y el índice único `(message, user)` respalda la unicidad (§5.5). El campo `delivery_version` evita que un recibo de una entrega anterior pise a la nueva (§4.7).

### 7.3 Cambios iniciados por el sistema

No hay efectos automáticos sobre mensajes o recibos. Desactivar una organización, una persona o una oficina no modifica los mensajes: la entrega los filtra al consultar (la persona deja de resolver contexto o de pertenecer a la audiencia). Los recibos no se limpian.

### 7.4 Puntos de enganche pendientes

Los endpoints de creación, edición y reenvío llevan comentarios `// AUDIT:` y `// NOTIFY:`. AuditLog y Notification Bell **no existen aún**: son marcas, no código. El comentario `NOTIFY` aclara que publicar el mensaje ya entrega un modal en el producto y que una entrada persistente en la campana sería otro feature. Ver `SYSTEM_PROMPT.md` §2.

## 8. Frontend

### 8.1 Cadena

- Administración: `app/(dashboard)/(protected)/portal-messages/page.tsx`, con `PortalMessagesAdminPage`, `PortalMessageForm` y `RowActions` de `modules/portal-messages/components/`.
- Entrega al portal: `app/portal/(protected)/layout.tsx` monta `PortalMessagesRuntime`, y `app/portal/(protected)/dashboard/page.tsx` muestra `PortalMessagesList` en el slot `messages`.
- Hooks: `use-portal-messages` y `use-portal-message-actions`.
- Cliente: `service.ts` del módulo, que usa `lib/http-client.ts` contra `/api/v1/portal-messages...`.

La página de administración vive bajo el layout del portal de plataforma (`app/(dashboard)/(protected)/layout.tsx`, solo `admins`), con entrada "Mensajes" en su menú. El cliente de destinatario se monta en el layout del portal de organización.

### 8.2 Cola modal y recibos (`PortalMessagesRuntime`)

El componente está en el layout del portal y consulta con `usePortalMessages(session?.collection === 'users')`.

**Selección.** Cuando no hay mensaje activo, la cola no está pausada, `isPortalMessageQueueStoppedThisSession()` es falso y hay datos, calcula los pendientes: los que no están `dismissed` y no se mostraron en esta sesión del navegador para esa `(id, delivery_version)` (`wasPortalMessageShownThisSession`). Toma el primero, lo marca como mostrado (`markPortalMessageShown`) y lo abre. El contador "n de m" usa el total de pendientes fijado al abrir el primero.

**Un solo recibo `seen` por mensaje.** Cuando el mensaje activo no tiene `seen` y su clave `id:delivery_version` no está en un `Set` de referencia, se agrega la clave y se envía **una** vez `PATCH receipt { status: 'seen', delivery_version }`. Un cambio de `delivery_version` (reenvío) produce una clave nueva y un nuevo recibo. Al terminar la mutación se invalida `['portal-messages', 'mine']` y el mensaje pasa a `seen = true`.

**Avance.** `advance` (llamado por las acciones al terminar) abre el siguiente mensaje que no sea el actual, no esté descartado y no se haya mostrado en la sesión; si no hay, cierra la cola y reinicia el contador, de modo que un mensaje que llegue luego por el polling abre una cola nueva ("1 de n").

**Detener la cola.** `advance({ stopQueue: true })` cierra el diálogo, escribe `portal-message-session:v2:queue-stopped` en `sessionStorage`, y pausa la cola. Mientras la marca exista, la cola no abre más mensajes en esa pestaña, aunque se recargue. Lo usa la acción principal (§8.3).

**Fin de sesión.** Cuando `useSession()` pasa a `null`, el componente limpia el `Set`, despausa y llama `resetPortalMessageSessionState()` (borra las claves `portal-message-session:v2:*`). `useLogin` también la llama al iniciar sesión.

**Estado solo del navegador.** `session-state.ts` usa `sessionStorage` (por pestaña). Si no está disponible (modo privado, bloqueo), la cola funciona igual: las funciones capturan el error y asumen "no mostrado" y "no detenida".

### 8.3 Acciones de la persona (`usePortalMessageActions`)

Compartido por el Runtime y la bandeja. Recibe el mensaje y un `onDone({ stopQueue? })`.

| Acción | Efecto en el servidor | Efecto en el cliente |
|---|---|---|
| `acknowledge` ("Entendido", solo avisos) | Recibo `dismissed` (si no está descartado ya) | `onDone()` |
| `remindLater` ("Recordarme más tarde", solo accionables) | **Ninguno** | `onDone()`; el mensaje sigue sin descartar, se marcó como mostrado en esta sesión y volverá en la próxima sesión del navegador (nueva pestaña o ventana) |
| `noThanks` ("No gracias", solo accionables) | Recibo `dismissed` | `onDone()` |
| `primaryAction` (acción principal / "Abrir") | Si hay enlace, primero `resolve-link`; luego **siempre** recibo `dismissed` | Con URL: `onDone({ stopQueue: true })` y `router.push(url)`. Con enlace pero sin URL: aviso "No se pudo abrir el enlace" y `onDone({ stopQueue: true })`. Sin enlace: `onDone({ stopQueue: true })` |
| `close` (X, ESC, fondo) | Mensaje ya descartado: ninguno. Accionable: ninguno. Aviso: recibo `dismissed` | Descartado: `onDone()`. Accionable: equivale a `remindLater`. Aviso: equivale a `acknowledge` |

Si guardar el descarte falla, se avisa "No se pudo guardar tu respuesta" ("El mensaje podría volver a aparecer.") y el flujo continúa igual (se cierra, o navega, aunque el recibo no se guardó). Un accionable **sin enlace** muestra la acción principal ("Ver" o `cta_label`), y al usarla solo descarta y detiene la cola.

### 8.4 Diálogo (`PortalMessageDialog`)

Componente de presentación con dos variantes: `dialog` (modal) e `inline` (vista previa dentro del formulario).
- Cabecera: ícono y etiqueta de tipo (para quien recibe, "Aviso" o "Acción requerida") y, con cola, "n de m".
- Cuerpo: descripción (respeta saltos de línea) y, si corresponde, la tarjeta de entidad enlazada. En un accionable que solo enlaza una sección la tarjeta se omite (repetiría el botón); se muestra con una entidad concreta o cuando el enlace no está disponible. En un aviso siempre se muestra, con un botón "Abrir".
- Pie, accionable sin descartar: "No gracias", "Recordarme más tarde" y la acción principal (`cta_label` o "Ver", con flecha si hay enlace). Accionable ya descartado: "Cerrar" y la acción principal. Aviso sin descartar: "Entendido". Aviso descartado: "Cerrar".
- Los mensajes descartados se reabren en "modo de consulta" desde la bandeja: `dismissed` selecciona el pie con "Cerrar".

### 8.5 Bandeja (`PortalMessagesList`)

Aparece en el Panel general (slot `messages` de `app/portal/(protected)/dashboard/page.tsx`).
- Consulta con `usePortalMessages(isMember)`.
- Muestra los mensajes de `isInPortalMessageHistory`: los **sin leer siempre**; los leídos hasta `PORTAL_MESSAGE_HISTORY_DAYS` (30) días desde `createdAt`.
- Ordena: sin leer primero, y dentro de cada grupo los no respondidos antes que los respondidos.
- Indica "n sin leer", un punto por mensaje sin leer y, bajo el título, "Ya respondido" o el tipo, con la antigüedad relativa.
- Al abrir un mensaje: lo marca como mostrado (no vuelve a salir en la cola de esa sesión), lo abre en el diálogo y, si no estaba `seen`, envía un recibo `seen`. Sus acciones usan `usePortalMessageActions` con `onDone` que solo cierra el diálogo (no detiene la cola).
- Si la consulta falla: "No se pudieron cargar los mensajes."

### 8.6 Administración

`PortalMessagesAdminPage`: lista todos los mensajes con búsqueda por título y descripción, filtros multi-selección por tipo y por estado (Vigente, Vencido, Inactivo), y orden (más recientes, más antiguos, título A–Z, próximos a vencer). Cada fila muestra tipo, estado, audiencia (`audienceSummary`: "Global" o los nombres de hasta dos organizaciones, y rol, cantidad de personas o "Todas las personas"), vencimiento y un interruptor "Activo". `RowActions` ofrece vista previa, edición y reenvío. El reenvío solo está disponible con estado `active` y pide confirmación ("volverá a aparecer como nuevo para todos sus destinatarios, incluso para quienes ya lo leyeron o descartaron").

La vista previa reutiliza `PortalMessageDialog` con el registro guardado: el enlace de entidad es `allowed` si el registro trae `linked_entity_label` y `unavailable` si no; el de sección es siempre `allowed`.

`PortalMessageForm` (modal con tres pestañas, contenido, audiencia y enlace/vigencia):
- Plantillas (`templates.ts`): `portal_welcome`, `task_overdue`, `security_review`, `general_announcement`. Aplicar una rellena título, descripción y tipo (con confirmación si ya había texto propio) y guarda `template_key`.
- El formulario valida con `PortalMessageInputSchema`, mapea cada `issue` al campo y a la pestaña (`ISSUE_FIELDS`) y abre la primera pestaña con error. Los errores de servidor se muestran con `userFacingErrorMessage(error, 'No se pudo guardar el mensaje.')`.
- Organizaciones o personas de un mensaje guardado que ya no están disponibles (organización inactiva, persona que dejó la organización) se avisan y se **quitan al guardar** (`staleOrganizations`, `staleUsers`).
- `expires_at` se arma con `localDateEndToISOString`: el mensaje vale hasta el final de ese día local.
- El tipo de entidad se limita a los de la sección elegida; cambiar de sección o de organizaciones limpia la entidad. Si la entidad guardada queda fuera del tope de 200 opciones, se conserva con su etiqueta.
- `cta_label` solo se envía en accionables (`null` en avisos).

### 8.7 Consultas (TanStack Query)

| Hook | Clave | Notas |
|---|---|---|
| `useAdminPortalMessages(organizationIds)` | `['platform-admin', 'portal-messages', organizationIds]` | La página usa `[]`; el formulario usa las organizaciones elegidas (entrada de caché distinta). |
| `usePortalMessageEntityOptions(scope, organizationIds, type)` | `['platform-admin', 'portal-message-entities', scope, organizationIds, type]` | Habilitada si hay `type`. |
| `usePortalMessages(enabled)` | `['portal-messages', 'mine']` | `refetchInterval` 60 s. Aplican además `staleTime` 30 s y `retry: 1` de `makeQueryClient`. |

### 8.8 Mutaciones

| Hook | Efecto |
|---|---|
| `useSavePortalMessage` | Crea o edita. Invalida el prefijo `['platform-admin', 'portal-messages']`. Sin aviso propio: el formulario muestra el error en línea. |
| `useSetPortalMessageActive` | Misma llamada de edición. Invalida el mismo prefijo; aviso "Mensaje activado." o "Mensaje desactivado."; errores por `showApiError`. |
| `useReplayPortalMessage` | Invalida el mismo prefijo; aviso "Mensaje listo para volver a mostrarse"; errores por `showApiError`. |
| `usePortalMessageReceipt` | Invalida `['portal-messages', 'mine']` solo en éxito. |

El prefijo `['platform-admin', 'portal-messages']` cubre la lista y las opciones del formulario. Guardar un mensaje no invalida las opciones de entidad.

### 8.9 Contrato de tipos

`PortalMessageDTO`, `PortalMessageRecord` y `AdminPortalMessageOptions` se definen a mano en `service.ts`. `PortalMessageRecord` deriva de `PortalMessageInput` (que sale del schema Zod). Los schemas de entrada se importan directamente de `modules/portal-messages/schema.ts` (`SYSTEM_PROMPT.md` §5).

## 9. Cómo extender el feature

1. **Nuevo campo de mensaje**: campo en `collections/PortalMessages/index.ts`, campo en `PortalMessageInputSchema`, y mapeo en `payloadData` y `messageInputFromDoc`.
2. **Nuevo tipo de entidad enlazable**: agregarlo a `TASK_REFERENCE_COLLECTIONS` (afecta también a tareas), a `PORTAL_MESSAGE_ENTITY_SECTION`, a `linked_entity` de la colección y a `PORTAL_MESSAGE_ENTITY_TYPE_LABELS` e íconos.
3. **Nueva sección enlazable**: `PORTAL_MESSAGE_SECTIONS`, `PORTAL_MESSAGE_SECTION_LINKS` (mismo nombre e ícono que el menú) y las rutas que corresponda.
4. **Nuevo tipo de mensaje**: valor en `message_type` (colección y schema), etiquetas y tonos en `portal-message-labels.ts`, y ramas del pie en `PortalMessageDialog` y de `close` en `usePortalMessageActions`.
5. **Nueva audiencia**: `messageTargetsUser` y su prueba, `audience` del schema, `payloadData`, `messageInputFromDoc`, `validateAudience`, y el formulario.
6. **Nuevo recibo o estado**: campo en `portal-message-receipts`, rama en `messageReceiptEndpoint`, DTO y acciones del cliente.
7. Códigos de error nuevos en `lib/user-facing-error.ts`.
8. Pruebas (§12).

## 10. Catálogo de errores

Cuerpo de error: `{ error: <código o texto>, message?, issues? }`. El cliente muestra texto de `lib/user-facing-error.ts` indexado por `error` (el `HttpError.code`); ver `session-and-access.md` §8.4.

| Código | HTTP | Cuándo |
|---|---|---|
| `unauthenticated` | 401 | Sin sesión activa (`platformAdmin` y `orgUser`) |
| `forbidden` | 403 | Identidad de tipo equivocado: usuario en gestión, administrador de plataforma en entrega, administrador visitando una organización en cualquiera de los dos |
| `invalid_message` | 400 | Cuerpo de crear o editar inválido (`issues`), o `id` ausente en editar. Sin texto en `user-facing-error.ts` |
| `invalid_receipt` | 400 | `status` fuera de `seen` y `dismissed`, o `delivery_version` que no es un entero ≥ 1. Sin texto propio |
| `invalid_entity_scope` | 400 | `type` ausente o fuera de la lista en el endpoint de opciones de entidad. Texto: "El elemento relacionado no pertenece al alcance del mensaje." |
| `message_not_found` | 404 | Recibo o `resolve-link`: no existe, inactivo, vencido o fuera de la audiencia. Reenvío: no existe. Texto: "El mensaje ya no está disponible. Actualiza la lista." |
| `message_inactive_or_expired` | 409 | Reenvío de un mensaje inactivo o vencido |
| Texto de la excepción (ej. "Una organización no existe o está inactiva.") | 400 | `validateAudience` o cualquier fallo dentro del `try` de crear o editar. El campo `error` lleva la frase, no un código |

Los textos de `validateAudience` son: "Una organización no existe o está inactiva.", "Cada persona seleccionada debe pertenecer a una organización destinataria y estar activa.", "La tarea debe estar disponible para todas las organizaciones destinatarias." y "La entidad debe estar disponible para todas las organizaciones destinatarias.". Ninguno está en `MESSAGES_BY_CODE` ni coincide con los prefijos de `translateKnownMessage`, así que el cliente los reemplaza por el texto de contingencia ("No se pudo guardar el mensaje." en el formulario; el título correspondiente en el aviso del interruptor).

`messageReceiptEndpoint`, `resolve-link` y la bandeja no devuelven un código distinto para un mensaje fuera de la audiencia: es siempre `message_not_found`.

## 11. Comportamientos a tener presentes

Verificados en el código; no son necesariamente defectos, pero conviene conocerlos antes de tocar el feature.

1. **Los errores de audiencia pierden su texto en el cliente.** El servidor responde con la frase como `error`; `userFacingErrorMessage` no la reconoce y el formulario muestra "No se pudo guardar el mensaje.". Quien administra no ve el motivo concreto.
2. **Cualquier fallo del `try` se vuelve 400.** Un error de base de datos o un `id` inexistente en el `PATCH` también salen como 400 con el texto de la excepción, no como 500 ni 404.
3. **`POST` y `PATCH` devuelven el documento crudo.** No tiene la forma de `PortalMessageRecord` (incluye `created_by`, `scope`, `target_*`); el cliente lo tipa como si la tuviera.
4. **Editar no resurge el mensaje.** Solo el reenvío sube `delivery_version`. Una corrección de texto no llega de nuevo a quien ya descartó el mensaje.
5. **Entidad concreta implica una sola organización.** `validateAudience` exige exactamente una organización destinataria; un mensaje global con entidad solo es válido si existe una única organización activa.
6. **`remindLater` y cerrar un accionable no guardan nada.** El mensaje reaparece en la próxima sesión del navegador (nueva pestaña o ventana, o tras `resetPortalMessageSessionState`); `sessionStorage` evita repetirlo dentro de la misma pestaña, también tras recargar.
7. **La acción principal siempre descarta y detiene la cola.** Incluso sin enlace, o cuando el enlace falla. La marca de cola detenida persiste en `sessionStorage` de la pestaña: no se abren más mensajes por cola hasta que se reinicie el estado.
8. **`primaryAction` continúa si falla el recibo.** Un fallo al guardar el descarte solo muestra un aviso; la navegación o el cierre siguen.
9. **Costo de la bandeja.** `GET /v1/portal-messages` carga todos los mensajes activos sin paginar, filtra en memoria y resuelve el enlace de cada mensaje destinatario (consultas por mensaje, y para una tarea el chequeo completo de lectura de tareas). Se repite cada 60 s por sesión abierta.
10. **Sin feature flags.** Los mensajes se entregan aunque la función a la que enlazan esté apagada para la organización; el enlace lleva a un destino que responde `feature_disabled`.
11. **Un administrador visitante no ve nada.** Con `asOrganization`, `platformAdmin` y `orgUser` responden 403; la interfaz del portal no consulta para esa identidad.
12. **Las opciones de entidad tienen tope de 200 antes de filtrar.** Los documentos no disponibles se descartan después de aplicar el límite, así que una organización con muchos retirados puede mostrar menos de 200 opciones o ninguna.
13. **Un solo reenvío simultáneo puede perderse.** El reenvío es lectura y escritura sin lock (§5.4); dos reenvíos concurrentes pueden dejar la misma versión.
14. **Mensajes globales llegan a toda persona con contexto.** `messageTargetsUser` no consulta la organización ni el rol; la persona solo necesita pasar `orgUser` (membresía activa y rol).
15. **La audiencia por persona se valida contra el conjunto de organizaciones, no por pares.** Una persona de la organización A pasa la validación si A está entre las destinatarias, aunque el mensaje apunte también a B.
16. **`template_key` es informativo.** No se valida en el servidor ni se usa para entregar el mensaje.
17. **Un `seen` tardío no deshace un descarte** de la misma versión, pero sí limpia `dismissed_at` si el recibo viene de otra versión o no existe.
18. **El filtro de historial depende de `createdAt`, no de cuándo se leyó.** Un mensaje leído y creado hace más de 30 días sale de la bandeja aunque se haya leído hoy; uno sin leer se muestra siempre.
19. **Ejecutor de pruebas.** Los archivos `*.test.ts` e `*.integration.test.ts` de este feature corren con `node:test` (scripts `test` y `test:integration` de `package.json`); Vitest se reserva para los `*.audit.*`.

## 12. Cobertura de pruebas

Estado de cobertura automática; sin pruebas de extremo a extremo por ahora.

| Prueba | Cubre |
|---|---|
| `domain/portal-messages/targeting.test.ts` | Global; organización no destinataria; relaciones pobladas; roles; personas |
| `modules/portal-messages/portal-message-labels.test.ts` | `portalMessageStatus` (inactivo sobre vencido, vigente) y `isInPortalMessageHistory` (sin leer siempre; leídos hasta 30 días) |
| `endpoints/portalMessages.integration.test.ts` | Un caso: aviso con texto de acción rechazado (400); usuario no administrador en gestión (403); creación (201); entrega a la organización destinataria y no a otra; recibo `seen` y `dismissed`; recibo de otra organización (404); `resolve-link` de sección; reenvío (`delivery_version` 2, `dismissed` en `false`); recibo de la entrega anterior (`stale`); opciones de entidad acotadas a la organización; desactivar con audiencia obsoleta (200) y reactivar (400) |
| `endpoints/messages-scope.audit.integration.test.ts` | Por router y cookies: entrega por audiencia y rol, gestión solo desde StaffPortal, recibos y enlaces de quien no es destinatario (404), identidad del recibo tomada de la sesión, enlace a una entidad de otra oficina, rol revalidado en cada consulta, colecciones cerradas, organización desactivada |
| `endpoints/messages-receipts.audit.integration.test.ts` | Recibos simultáneos de una y varias personas; `seen` en curso frente a un descarte concurrente (primera lectura y tras reenvío); versiones anteriores, futuras e inválidas; reenvíos simultáneos; conservación del estado al editar, desactivar y reactivar; mensaje vencido (404/409 sin escrituras); vencimiento real; fecha elegida como día local |
| `modules/portal-messages/portal-message-expiry.audit.test.ts` | `localDateEndToISOString` en cinco husos, incluidos los días de cambio de horario; frontera exacta de `portalMessageStatus`; frontera de 30 días de `isInPortalMessageHistory` |

No tienen prueba automática propia: la validación de audiencia por persona y por entidad (salvo la organización obsoleta), el enlace a tareas y a entidades (`denied`, `unavailable`), el `PATCH` con identificador inexistente, los parámetros de las opciones de entidad (`invalid_entity_scope`, globales), la cola y las acciones del cliente (`PortalMessagesRuntime`, `usePortalMessageActions`, `PortalMessagesList`), y el formulario de administración.

La prueba de integración requiere una base PostgreSQL desechable; no se ejecuta como parte de este documento.
