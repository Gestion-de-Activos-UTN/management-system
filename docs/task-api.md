# API de tareas

Referencia técnica del feature `tasks`: contrato HTTP, reglas de dominio, permisos, concurrencia y la cadena que lo conecta con el frontend. Dirigida a quien mantiene o extiende el feature.

Verificado contra el código el 2026-10-31. Si algo de este documento contradice el código, gana el código: corregir el documento.

## 1. Capas y archivos

| Capa | Archivo | Responsabilidad |
|---|---|---|
| Contrato | `modules/tasks/schema.ts` | Schemas Zod de entrada. Los usa el cliente (formularios) y el servidor (endpoints). Fuente de verdad. |
| Endpoints | `endpoints/tasks.ts` | Autenticación, feature flag, parseo, serialización. Registrados en `payload.config.ts` vía `taskEndpoints`. |
| Dominio | `domain/tasks/task-actions.ts` | Todas las transiciones de estado, permisos de acción y alcance. |
| | `domain/tasks/task-state.ts` | Estado efectivo (`planned`) y vencimiento, funciones puras. |
| | `domain/tasks/task-eligibility.ts` | Quién puede ejecutar una tarea. |
| | `domain/tasks/task-reference.ts` | Resolución y permisos de la entidad relacionada (polimórfica). |
| | `domain/tasks/with-task-lock.ts` | Transacción y bloqueo por tarea. |
| | `domain/tasks/task-error.ts` | `TaskDomainError` y su respuesta HTTP. |
| | `domain/tasks/reconcile-asset-tasks.ts` | Hook `afterChange` de activos que ajusta tareas. |
| Persistencia | `collections/Tasks/index.ts` | Colección Payload, cerrada al acceso directo. |
| Cliente HTTP | `modules/tasks/service.ts` | Funciones sobre `lib/http-client.ts`; tipos `TaskDTO`, `TaskAction`. |
| Estado de servidor | `modules/tasks/hooks/use-tasks.ts`, `use-task-options.ts`, `use-task-actions.ts` | TanStack Query. |
| UI | `modules/tasks/components/*`, `app/portal/(protected)/tasks/` | Presentación. |

Cadena de una acción: componente → `useTaskCommand` → `service.ts` → `httpClient` → `endpoints/tasks.ts` → `domain/tasks/task-actions.ts` → `payload.update` sobre `tasks`.

## 2. Modelo

### 2.1 Colección `tasks`

Acceso: `create`, `read`, `update` y `delete` son `() => false`. La API REST de Payload no sirve esta colección; todo pasa por los endpoints propios, que escriben con `overrideAccess: true`. Motivo (comentario en la colección): además del tenant, hay que comprobar el permiso del actor sobre la entidad polimórfica relacionada.

Los campos de ciclo de vida (`status`, `claimed_*`, `completed_*`, `cancelled_*`, `archived_*`, `organization`, `office`, `created_by`, `requires_reassignment`, `claim_history`, `lifecycle_history`, `creation_batch_id`, `operation_id`, `operation_fingerprint`) tienen acceso `serverOnly` (`create` y `update` en `false`).

| Campo | Tipo | Notas |
|---|---|---|
| `title` | text, 3–160 | |
| `description` | textarea, ≤ 5000 | |
| `priority` | `low` \| `normal` \| `high` \| `urgent` | Indexado. |
| `status` | `pending` \| `in_progress` \| `completed` \| `cancelled` | Estado persistido. Indexado. |
| `start_at` | date, requerido | `beforeValidate` (`defaultTaskStartAt`) lo completa con `now` al crear. |
| `due_at` | date, opcional | |
| `initial_due_at` | date | Copia de `due_at` al crear. No se modifica después. |
| `assignment_kind` | `open_pool` \| `role` \| `user` | |
| `assigned_role` / `assigned_user` | relación a `roles` / `users` | Solo el que corresponde al `assignment_kind`. |
| `claimed_by`, `completed_by`, `cancelled_by`, `archived_by`, `created_by` | relación polimórfica `users` \| `admins` | Un PlatformAdmin no tiene documento en `users`. |
| `claimed_at`, `completed_at`, `cancelled_at`, `archived_at` | date | `archived_at` indexado. |
| `completion_reason`, `cancellation_reason` | textarea, ≤ 500 | `completion_reason` solo existe si la completó un administrador (§5.6). |
| `related_entity` | relación polimórfica a `TASK_REFERENCE_COLLECTIONS` | Ver §2.3. |
| `organization` | relación, requerido | Indexado. |
| `office` | relación, opcional | `null` = tarea de toda la organización. Indexado. |
| `requires_reassignment` | checkbox | Marca persistida; ver §3.4. |
| `claim_history` | json | Eventos `{ action, at, by, reason? }`. No sale en la API (§4.1). |
| `lifecycle_history` | json | Eventos del sistema sobre activos (§7.3). Sí sale en la API. |
| `creation_batch_id` | text | UUID compartido por las tareas creadas en una misma solicitud multi-oficina. |
| `operation_id` | text, indexado, `hidden` | Clave de operación de la creación (§4.3.1). Compartida por todas las tareas de esa solicitud. No sale en las respuestas. |
| `operation_fingerprint` | text, `hidden` | SHA-256 del cuerpo canónico de la creación, sin la clave. No sale en las respuestas. |
| `seed_key` | text, único | Solo seeds. |
| `effective_status`, `is_overdue` | virtuales (`afterRead`) | Calculados con `effectiveTaskStatus` e `isTaskOverdue`. |

### 2.2 Estados

`planned` **no se guarda**: es una tarea `pending` cuyo `start_at` está en el futuro (`effectiveTaskStatus`). El estado persistido tiene cuatro valores; el efectivo, cinco.

La tabla lista las acciones de usuario. Los cambios que dispara el sistema están en §7.3.

| Acción | Estado de origen | Estado de destino |
|---|---|---|
| crear | — | `pending` |
| `claim` | `pending` y efectivo distinto de `planned` | `in_progress` |
| `release` | `in_progress` | `pending` |
| `reassign` | `pending` o `in_progress` | `pending` |
| `PATCH` con `start_at` futuro | `in_progress` | `pending` (replanificación, §5.5) |
| `complete` | `in_progress` | `completed` |
| `force-complete` | `in_progress` reclamada por otra persona | `completed` |
| `cancel` | `in_progress` | `cancelled` |
| `archive` | `completed` o `cancelled` | no cambia `status`; fija `archived_at` |
| `DELETE` | `pending` sin `claimed_at` | se elimina el documento |

`completed` y `cancelled` son terminales. El vencimiento no cambia el estado: `is_overdue` es `due_at < now` mientras no sea terminal.

### 2.2.1 Flujos

**Una tarea planificada.** Si se crea con `start_at` futuro, queda `pending` y se muestra como `planned`. Nadie puede reclamarla (`claim` responde 400 `task_planned` y no aparece en `available_actions`), pero sí editarla, reasignarla y eliminarla. Al llegar `start_at` pasa a ser reclamable sin que nada se escriba: el estado efectivo se recalcula en cada lectura.

**Ciclo normal.** Se crea `pending`, alguien la reclama (`in_progress`, con `claimed_by` y `claimed_at`) y esa misma persona la completa (`completed`, con `completed_by` y `completed_at`). Solo quien reclamó puede completarla. Cada paso agrega su fila a la actividad de la tarea.

**Reclamo simultáneo.** Dos personas pueden pulsar "Tomar" a la vez. Los comandos se serializan con un lock por tarea (§7.1): el primero gana; el segundo relee la tarea ya `in_progress` y recibe 409 `task_not_pending`. El código `already_claimed` pertenece a la escritura condicional que protege el `UPDATE` y con el lock vigente no se alcanza. Ninguna prueba ejercita hoy dos reclamos simultáneos.

**Soltar una tarea.** `release` la devuelve a `pending` y vacía `claimed_by` y `claimed_at`. La asignación (`assigned_role` o `assigned_user`) no cambia, así que vuelve a estar disponible para quienes eran elegibles. Solo puede soltarla quien la reclamó; si ya no está en curso, el código dice qué pasó (§4.5).

**Reasignar.** Cambia la asignación (`open_pool`, rol o persona) y deja la tarea `pending` sin reclamo. Si estaba en curso, la persona que la tenía la pierde: la actividad muestra "liberada" y "reasignada" con el mismo momento y el mismo actor. Requiere que la nueva asignación tenga al menos una persona elegible en la oficina de la tarea. También limpia la marca `requires_reassignment`.

**Intervención sobre una tarea en curso.** Quien gestiona no puede completar por otro, pero sí actuar de dos formas, ambas terminales y con motivo obligatorio:
- `force-complete`: la tarea queda `completed` a nombre de quien la fuerza. Solo org_admin o PlatformAdmin, y solo si la reclamó otra persona. El `completion_reason` guardado hace que la persona que reclamó vea "completada por un administrador" si intenta completarla después.
- `cancel`: la tarea queda `cancelled`. Cualquier gestor con permiso `cancel`.

**Una tarea pendiente que ya no se necesita.** No hay acción de usuario que cancele una `pending`. Se elimina (`DELETE`, borrado real). La condición exige `claimed_at` vacío; como todas las transiciones actuales hacia `pending` (`release`, `reassign`, replanificación, liberaciones del sistema) lo limpian, hoy cualquier tarea pendiente cumple. Una tarea pendiente solo pasa a `cancelled` por una acción del sistema (§7.3).

**Replanificar una tarea en curso.** Editar `start_at` a una fecha futura devuelve la tarea a `pending`, sin reclamo, como si nunca hubiera empezado, y sin evento en la actividad (§5.5). Editar otros campos no cambia el estado.

**Cierre y archivo.** `completed` y `cancelled` son definitivos: no se editan ni se reasignan. `archive` solo marca `archived_at`; la tarea sigue terminal y desaparece del listado salvo con `include_archived`. Es idempotente.

**Tareas que cambian solas.** Cuando se desactiva una persona o se le quita una oficina, sus tareas en curso de esa oficina vuelven a `pending`. Cuando se desactiva una oficina u organización, o se retira o elimina un activo, las tareas abiertas se cancelan. Cuando un activo cambia de oficina, sus tareas lo siguen. Detalle en §7.3.

### 2.3 Entidad relacionada

`related_entity` admite: `offices`, `assets`, `non-network-assets`, `assessment-instances`, `compliance-results`, `inventory-snapshots`, `scan-reports`, `risk-evaluations`, `agents` (`TASK_REFERENCE_COLLECTIONS`, también whitelist del endpoint de opciones).

`resolveTaskReference` carga la entidad y devuelve `{ organizationId, officeId, label, unavailable? }`:
- Si no existe: `related_entity_not_found` (404).
- Si no se puede resolver la organización: `related_entity_without_organization` (400).
- Para `assets` y `non-network-assets`, `unavailable` es `true` si `status === 'retired'` o tiene `deleted_at`.
- `officeId` sale de la entidad (para `offices` es la propia oficina). `null` significa entidad de alcance organizacional.

## 3. Permisos y alcance

### 3.1 Matriz (`access/rbac/permissions.ts`, colección `tasks`)

| Rol | Acciones |
|---|---|
| `org_admin` | `create`, `read`, `edit`, `claim`, `release`, `assign`, `reassign`, `complete`, `cancel`, `archive`, `delete` |
| `office_manager` | las mismas que `org_admin` |
| `org_viewer` | `read`, `claim`, `release`, `complete` |
| `platform_admin` sin organización | solo `read`, y los endpoints responden 400 antes de llegar ahí |
| `platform_admin` con `?asOrganization=` | se evalúa como `org_admin` (`canDo`) |

`assign` no es una acción de endpoint: funciona como marca de "gestor". Decide `view=all` y si una persona puede leer tareas en las que no está involucrada ni es elegible (§3.3).

Lo que distingue a `office_manager` de `org_admin` es el **alcance** (§3.2) y el `force-complete`, que no está en la matriz sino en una verificación de rol en el dominio: `ctx.isPlatformAdmin || ctx.role === 'org_admin'` (`forceCompleteTaskLocked`, `availableTaskActions`).

### 3.2 Alcance de organización y oficina

Todo endpoint pasa por `taskContext`:
1. `getTenantContext` sin sesión activa → 401 `unauthenticated`.
2. Sin `organizationId` → 400 `organization_context_required`.
3. `organizationFeatures(req, org).tasks === false` → 403 `feature_disabled`.

`assertTaskScope` (dominio): una tarea de otra organización, o de una oficina fuera de `ctx.officeIds` para quien no tiene alcance organizacional (`hasOrgWideScope`), responde **404** `task_not_found`, nunca 403. No se revela su existencia. Una tarea con `office = null` pasa el filtro de oficina para toda la organización.

### 3.3 Lectura de una tarea (`assertCanReadTask`)

En orden:
1. Permiso `read`.
2. `assertTaskScope`.
3. Entidad relacionada legible por el actor (`assertReferenceReadable`). Si la entidad existe y el actor no puede leerla, la tarea responde 404 si está abierta. Si es terminal, se muestra la tarea sin la referencia.
4. Si el actor es gestor (`assign`), está involucrado (`claimed_by` es él o `assigned_user` es él) o es elegible (§3.4), puede leerla. En otro caso, 404.

Una entidad relacionada que fue eliminada (no resuelve) no bloquea: la referencia queda `undefined` y `related_entity_info.available` es `false`.

### 3.4 Elegibilidad

`listEligibleTaskMembers(req, org, officeId, reference?)` devuelve las personas que pueden ejecutar una tarea de esa oficina:
- Membresía activa con `status: 'active'` y usuario no `inactive`.
- Si la tarea tiene oficina: roles con alcance organizacional siempre; el resto, solo si tiene esa oficina asignada.
- Si la tarea no tiene oficina y tiene entidad relacionada: solo roles con alcance organizacional.
- Si hay entidad relacionada: el rol debe poder leerla (`roleCanReadTaskReference`: permiso `read` sobre la colección más alcance sobre su oficina).

`assignmentEligibleMembers` filtra esa lista por la asignación: `open_pool` = todas, `role` = las de ese `roleId`, `user` = esa persona.

`actorIsEligible` (para `claim` y lecturas): falso si `requires_reassignment`. Para un PlatformAdmin: verdadero en `open_pool`; en `role`, solo si el rol asignado es `org_admin`; falso en `user`. Para el resto, debe estar en la lista y cumplir la asignación.

`requires_reassignment` en la respuesta es `task.requires_reassignment` (marca persistida) **o** que, en este momento, la asignación no tenga ninguna persona elegible (cálculo en vivo). Siempre `false` en tareas terminales.

## 4. Contrato HTTP

Prefijo `/api`. Cuerpos JSON. Un cuerpo ausente o inválido se parsea como `{}`, así que se responde con el error de validación correspondiente. El cliente agrega `?asOrganization=` automáticamente a toda request cuando está en la URL del portal (`lib/organization-request-context.ts`); solo tiene efecto para PlatformAdmin.

| Método y ruta | Permiso | Entrada | Respuesta OK |
|---|---|---|---|
| `GET /v1/tasks` | `read` (+ `assign` si `view=all`) | query `TaskListQuerySchema` | 200 `{ docs, totalDocs }` |
| `GET /v1/tasks/:id` | `read` | — | 200 `TaskDTO` completo |
| `POST /v1/tasks` | `create` | `CreateTasksSchema` | 201 `{ docs, totalDocs }` |
| `PATCH /v1/tasks/:id` | `edit` | `EditTaskSchema` | 200 tarea |
| `POST /v1/tasks/:id/claim` | `claim` | — | 200 tarea |
| `POST /v1/tasks/:id/release` | `release` | — | 200 tarea |
| `POST /v1/tasks/:id/reassign` | `reassign` | `ReassignTaskSchema` | 200 tarea |
| `POST /v1/tasks/:id/complete` | `complete` | — | 200 tarea |
| `POST /v1/tasks/:id/force-complete` | `complete` + org_admin o PlatformAdmin | `{ reason }` | 200 tarea |
| `POST /v1/tasks/:id/cancel` | `cancel` | `{ reason }` | 200 tarea |
| `POST /v1/tasks/:id/archive` | `archive` | — | 200 tarea |
| `DELETE /v1/tasks/:id` | `delete` | — | 200 documento eliminado (§10.4) |
| `GET /v1/tasks/assignment-options` | `create`, o `reassign` con `task_id` | query | 200 `{ users, roles }` |
| `GET /v1/tasks/reference-options` | `create` | query | 200 `{ docs }` |

`assignment-options` y `reference-options` se registran antes de `/v1/tasks/:id` en `taskEndpoints`. Mantener ese orden al agregar rutas estáticas.

### 4.1 Forma de la tarea

`taskWithDerivedState` devuelve el documento **sin `claim_history`** y con `effective_status`. `claim_history` guarda ids de quienes reclamaron o liberaron; la API expone esa información resuelta a nombres en `actor_labels.claim_events` (solo en el detalle).

| Campo extra | Lista | Detalle | Create / comandos |
|---|---|---|---|
| `effective_status` | sí | sí | sí |
| `related_entity_info` | sí | sí | no |
| `available_actions` | sí | sí | no |
| `requires_reassignment` | sí | sí | solo el campo persistido |
| `assignment_info` | no | sí | no |
| `actor_labels` | no | sí | no |

`related_entity_info`: `{ relationTo, value, available, label, office_id }`, o `null` si la tarea no tiene entidad.
`assignment_info`: `{ office_name, role_name, user_name }`, solo con valores de lo que ya se autorizó leer.
`actor_labels`: nombre (o correo) por cada `*_by` y `claim_events`. Un administrador de plataforma sin nombre se muestra como "Administrador de plataforma". Un actor que ya no se encuentra queda en `null`.
`available_actions` (`availableTaskActions`), cada una según estado, permiso y rol:

| Acción | Condición |
|---|---|
| `edit` | no terminal y permiso `edit` |
| `claim` | `status = pending`, efectivo `pending` (no `planned`), permiso `claim` y elegible |
| `release` | `in_progress`, el actor es quien reclamó y permiso `release` |
| `reassign` | no terminal y permiso `reassign` |
| `complete` | `in_progress`, el actor es quien reclamó y permiso `complete` |
| `force_complete` | `in_progress`, reclamada por otra persona, actor org_admin o PlatformAdmin y permiso `complete` |
| `cancel` | `in_progress` y permiso `cancel` |
| `archive` | terminal, sin `archived_at` y permiso `archive` |
| `delete` | `pending`, sin `claimed_at` y permiso `delete` |

El servidor repite todas las verificaciones al ejecutar; `available_actions` es solo ayuda para la UI.

### 4.2 `GET /v1/tasks`

Query (`TaskListQuerySchema`):

| Parámetro | Valores | Notas |
|---|---|---|
| `view` | `mine` (por defecto) \| `pool` \| `all` | `all` exige `assign`, o 403. |
| `status` | lista separada por comas de `planned,pending,in_progress,completed,cancelled` | Ausente = todos. |
| `priority` | lista separada por comas de `low,normal,high,urgent` | |
| `office_id` | id | Fuera de alcance para quien no es org-wide: 403 `forbidden`. |
| `include_archived` | booleano | Ver §10.2. |

Semántica:
- Base: misma organización; si no tiene alcance organizacional, oficinas propias **o** `office` vacío. Con `office_id`: esa oficina **o** `office` vacío (las tareas organizacionales también corresponden a quien trabaja en esa oficina).
- `planned` se busca en la base como `pending` y se filtra después por estado efectivo.
- Cada resultado pasa por `assertCanReadTask`; un 404 se descarta sin error.
- `mine`: reclamadas por el actor o con `assigned_user` igual al actor.
- `pool`: `status = pending` y `assignment_kind` distinto de `user`.
- Orden `due_at` ascendente, luego `createdAt` descendente. **Sin paginación**; `totalDocs` es la cantidad devuelta.

### 4.3 `POST /v1/tasks`

`CreateTasksSchema`:
- Campos: `title`, `description?`, `priority`, `start_at?`, `due_at?` (ISO con offset), `global`, `office_ids`, `related_entity?`, `operation_id?` (16 a 64 caracteres `[A-Za-z0-9_-]`), más la asignación.
- Asignación (unión discriminada por `assignment_kind`): `open_pool` sin campos; `role` con `assigned_role`; `user` con `assigned_user`. Los campos que no corresponden se rechazan (`z.never()`).
- Reglas: `start_at` ≤ `due_at` (con `start_at` por defecto = ahora); sin oficinas repetidas; `global` excluye `office_ids`; sin `global`, al menos una oficina; hasta 500.

Dominio (`createTasksInTransaction`), en orden:
1. Permiso `create`.
2. Si hay `related_entity`: resolverla; `unavailable` → 409 `asset_unavailable`; de otra organización o ilegible para el actor → 404 `related_entity_not_found`.
3. Oficinas destino: con entidad, la de la entidad (ignora `global` y `office_ids` del cuerpo); sin entidad, `[]` si `global`, o `office_ids`. Quien no tiene alcance organizacional necesita al menos una oficina y todas dentro de su alcance, o 403 `forbidden`. Las oficinas deben existir, estar activas y ser de la organización, o 400 `invalid_offices`.
4. Por cada oficina destino, que la asignación tenga al menos una persona elegible, o 400 `no_eligible_assignees`. Se valida todo antes de escribir.
5. `start_at` por defecto `now`; `due_at` anterior a `start_at` → 400 `invalid_dates`.
6. Se crea **una tarea por oficina**, o una sola con `office = null` si es global. Con más de una oficina comparten `creation_batch_id`.

Es atómico: todas las tareas se crean en una transacción o ninguna. Si la entidad es un activo, se toma además un lock de fila del activo (`lockAssetRow`) para serializar con los cambios del activo.

#### 4.3.1 Reintentos: clave de operación

Contrato para una creación guardada cuya respuesta se pierde. El cliente genera una clave aleatoria por formulario abierto y la repite en cada reintento de ese formulario (`TaskForm`). Con `operation_id`, `createTasks` hace lo siguiente antes del paso 2:
1. Comprueba el permiso `create`.
2. Toma un lock transaccional `task-create:<organización>:<clave>`. Los intentos simultáneos con la misma clave esperan al que lo tiene.
3. Calcula la huella SHA-256 del cuerpo canónico sin la clave (`canonicalJson`, `lib/canonical-json.ts`).
4. Busca tareas de la organización con esa clave:
   - **Ninguna:** crea normalmente y guarda la clave y la huella en cada tarea.
   - **Existen, con la misma huella y el mismo autor (`actorMatches`):** responde 201 con esas tareas, sin crear ni modificar nada.
   - **Existen con otra huella o de otro autor:** 409 `task_operation_conflict`. No escribe y no revela las tareas.

Reglas del contrato:
- **No deduplica por contenido.** Sin clave, o con una clave nueva (otro formulario), dos tareas idénticas se crean las dos.
- **La clave vale dentro de la organización.** La misma clave en otra organización es otra operación.
- **Un fallo antes del `COMMIT` no deja la clave usada.** El reintento crea las tareas una vez.
- **La réplica no repite validaciones de alcance.** Devuelve lo que el mismo autor ya creó, aunque después haya cambiado su alcance.
- **Si las tareas de la operación se eliminaron**, la clave deja de existir y un reintento las vuelve a crear.

Los comandos (§4.5) no usan clave: el lock por tarea y los estados hacen que una repetición responda 409 sin repetir efectos.

### 4.4 `PATCH /v1/tasks/:id`

`EditTaskSchema` es parcial: `title`, `description`, `priority`, `start_at`, `due_at` (acepta `null` para quitarlo). Tarea terminal: 409 `task_terminal`. Si el `start_at` efectivo supera el `due_at` efectivo: 400 `invalid_dates`. Replanificación en §5.5.

### 4.5 Comandos de estado

- **`claim`**: ver §5.1.
- **`release`**: solo quien reclamó (403 `not_claimant`). La tarea vuelve a `pending` con `claimed_by` y `claimed_at` en `null`, y se agrega el evento `released`.
- **`reassign`**: ver §5.2.
- **`complete`**: solo quien reclamó (403 `not_claimant`).
- **`force-complete`**: la tarea debe estar en curso y reclamada por **otra** persona (409 `task_not_force_completable`). Guarda `completion_reason`.
- **`cancel`**: solo `in_progress` (409 `task_not_in_progress`). Guarda `cancellation_reason`.
- **`archive`**: solo terminales (409 `task_not_terminal`). Es idempotente: si ya tiene `archived_at`, devuelve la tarea sin escribir.
- **`DELETE`**: ver §5.7.

`reason` (cancel y force-complete): 3–500 caracteres, regla `TEXT_RULES.free`.

Las acciones `release`, `complete` y `reassign` sobre una tarea que ya no está en curso devuelven un código que distingue qué pasó (`assertTaskInProgress`): `task_completed_by_admin` si tiene `completion_reason`, `task_already_completed`, `task_cancelled` o `task_state_changed`. La UI los usa para explicar el estado actual en lugar de culpar a quien reclamó.

### 4.6 `GET /v1/tasks/assignment-options`

Parámetros: `office_id`, `office_ids` (lista separada por comas), `task_id`, `reference_type` + `reference_id`. Reglas (`TaskAssignmentOptionsQuerySchema` y endpoint):
- Un parámetro repetido en la URL → 400 `invalid_query`.
- `reference_type` y `reference_id` van juntos.
- `task_id` es excluyente con oficinas y referencia: el alcance lo define la tarea. Exige permiso `reassign`, y 409 `task_terminal` si ya es terminal.
- Sin `task_id`: exige `create`. Con referencia, las oficinas salen de la entidad; si además se envían oficinas que no coinciden, 400 `invalid_scope`. Sin referencia ni oficinas, quien no tiene alcance organizacional recibe 400 `scope_required`.

Respuesta `{ users: [{ id, name, email, role_id, role }], roles: [{ id, slug }] }`. Con varias oficinas se devuelve la **intersección**: una persona o un rol aparece solo si es elegible en todas. Un rol solo se ofrece si tiene al menos una persona elegible.

### 4.7 `GET /v1/tasks/reference-options`

Parámetros: `type` (whitelist, o 400 `invalid_reference_type`), `office_id?`, `id?` (para recuperar la opción ya elegida). Devuelve hasta 100 entidades por `updatedAt` descendente, **después** de filtrar las que el actor puede leer (`tenantCanReadTaskReference`). El alcance por colección: `scan-reports` por oficina, `offices` activas de la organización, el resto por organización y oficina.

## 5. Reglas por operación

### 5.1 Reclamar

Orden de verificaciones: permiso `claim`, alcance, referencia legible, `status = pending` (409 `task_not_pending`), no `planned` (400 `task_planned`), elegibilidad (403 `not_eligible`). La escritura es condicional (`where: id y status = pending`, `limit: 1`); si no actualiza ninguna fila, 409 `already_claimed`. Con el lock por tarea vigente (§7.1), quien llega segundo ya ve el estado `in_progress` y recibe `task_not_pending`, así que `already_claimed` funciona como defensa. Agrega el evento `claimed` a `claim_history`.

### 5.2 Reasignar

Tarea terminal: 409 `task_terminal`. Debe haber al menos una persona elegible para la nueva asignación en la oficina de la tarea (400 `no_eligible_assignees`). Efecto: nueva asignación, `status = pending`, `claimed_by` y `claimed_at` en `null`, `requires_reassignment = false`. Eventos: si estaba en curso, `released` con `reason: 'task_reassigned'`; siempre `reassigned`. Ambos con el mismo `at` y el mismo actor.

### 5.3 Completar y forzar

`complete` requiere ser quien reclamó. `force-complete` requiere lo contrario, más ser org_admin o PlatformAdmin. En ambos se fijan `completed_by` y `completed_at`; solo `force-complete` guarda `completion_reason`, y por eso ese campo distingue una finalización administrativa.

### 5.4 Cancelar

Solo tareas en curso. Una tarea pendiente no se cancela: se elimina (§5.7) si no fue reclamada. Fija `cancelled_by`, `cancelled_at` y `cancellation_reason`.

### 5.5 Editar y replanificar

Si la tarea está en curso y el nuevo `start_at` queda en el futuro, la tarea vuelve a `pending` con `claimed_by` y `claimed_at` en `null`. Esa replanificación **no** agrega evento a `claim_history`.

### 5.6 Archivar

Fija `archived_by` y `archived_at`. Por defecto el listado excluye las archivadas (`archived_at` vacío); `include_archived` las incluye.

### 5.7 Eliminar

Condición: `status === 'pending'` y `claimed_at` vacío (409 `task_cannot_be_deleted`). `release` y `reassign` limpian `claimed_at`, así que una tarea que fue reclamada y liberada vuelve a poder eliminarse. Es una eliminación real (`payload.delete`), no lógica.

## 6. Catálogo de errores

Cuerpo de error: `{ error: <código>, message: <texto en español> }`. Los códigos de validación agregan `issues` (de Zod) en lugar de `message`. El cliente muestra el texto de `lib/user-facing-error.ts`, indexado por `error`; el `message` del servidor es para diagnóstico.

`taskErrorResponse` solo convierte `TaskDomainError`. **Cualquier otra excepción se vuelve a lanzar** y llega a Payload como 500 sin código.

| Código | HTTP | Cuándo |
|---|---|---|
| `unauthenticated` | 401 | Sin sesión activa |
| `organization_context_required` | 400 | PlatformAdmin sin `asOrganization` |
| `feature_disabled` | 403 | Feature `tasks` apagado para la organización |
| `forbidden` | 403 | Sin permiso, `view=all` sin `assign`, oficina fuera de alcance, `force-complete` sin rol |
| `task_not_found` | 404 | No existe, otra organización, oficina fuera de alcance, o no legible por el actor |
| `task_operation_conflict` | 409 | `operation_id` ya usado con otro cuerpo o por otra persona (§4.3.1) |
| `related_entity_not_found` | 404 | Entidad inexistente o ilegible |
| `related_entity_without_organization` | 400 | La entidad no permite resolver su organización |
| `invalid_query` | 400 | Query inválida (`issues`) |
| `invalid_task` | 400 | Cuerpo de crear o editar inválido (`issues`) |
| `invalid_assignment` | 400 | Cuerpo de reasignar inválido (`issues`) |
| `invalid_reason` | 400 | Motivo inválido en cancelar o `force-complete` (`issues`) |
| `invalid_reference_type` | 400 | `type` fuera de la whitelist |
| `invalid_offices` | 400 | Oficinas inexistentes, inactivas o de otra organización |
| `invalid_scope` | 400 | Oficinas que no coinciden con las de la entidad |
| `scope_required` | 400 | Falta alcance para quien no es org-wide |
| `invalid_dates` | 400 | `due_at` anterior a `start_at` |
| `no_eligible_assignees` | 400 | La asignación no tiene personas elegibles |
| `asset_unavailable` | 409 | Activo retirado o eliminado |
| `task_terminal` | 409 | Editar, reasignar u ofrecer opciones sobre una tarea terminal |
| `task_not_pending` | 409 | Reclamar una tarea que no está pendiente, incluido perder un reclamo simultáneo |
| `task_planned` | 400 | Reclamar antes de `start_at` |
| `not_eligible` | 403 | Reclamar sin ser elegible |
| `already_claimed` | 409 | La escritura condicional del reclamo no encontró la tarea pendiente (defensa; ver §5.1) |
| `not_claimant` | 403 | Liberar o completar sin ser quien reclamó |
| `task_completed_by_admin` | 409 | Ya completada con `completion_reason` |
| `task_already_completed` | 409 | Ya completada |
| `task_cancelled` | 409 | Ya cancelada |
| `task_state_changed` | 409 | Ya no está en curso (otro motivo) |
| `task_not_force_completable` | 409 | Sin reclamo, o reclamada por quien ejecuta |
| `task_not_in_progress` | 409 | Cancelar una tarea que no está en curso |
| `task_not_terminal` | 409 | Archivar una tarea que no es terminal |
| `task_cannot_be_deleted` | 409 | No está pendiente o tiene `claimed_at` |

Los códigos `invalid_query`, `invalid_task`, `invalid_assignment`, `invalid_reason` e `invalid_reference_type` no tienen texto en `user-facing-error.ts`, porque el formulario valida antes con el mismo schema.

Un error del lado del cliente que no viene del servidor: `task_command_busy` (`TaskCommandBusyError`, `modules/tasks/task-command-gate.ts`). Se rechaza una segunda acción distinta sobre la misma tarea mientras otra está en curso; no genera aviso.

## 7. Concurrencia, atomicidad y efectos del sistema

### 7.1 Bloqueo por tarea

Todas las operaciones sobre una tarea existente pasan por `withTaskLock(req, id, fn)`:
1. Abre una transacción, o reutiliza la de `req.transactionID` (en ese caso el que llama es dueño del commit).
2. Toma `pg_advisory_xact_lock(hashtextextended('task:<id>', 0))` antes de leer nada. Quien espera relee el estado ya confirmado.
3. Ejecuta el comando, y confirma o revierte según corresponda.

Falla con error si no hay transacciones PostgreSQL disponibles. `claim` suma una escritura condicional sobre `status = pending` como segunda defensa.

### 7.2 Creación

`createTasks` usa `withTransaction`. Todas las tareas de una solicitud multi-oficina son atómicas. Con `operation_id`, primero toma el lock de la clave (§4.3.1). Para entidades `assets` o `non-network-assets`, toma después `lockAssetRow`, antes de validar.

### 7.3 Cambios iniciados por el sistema

No pasan por los endpoints. Cada tarea se modifica bajo `withTaskLock` y en **orden de id**, para tomar los locks siempre en el mismo orden.

| Origen | Función | Efecto |
|---|---|---|
| Persona desactivada o sin acceso a una oficina | `releaseClaimedTasks` (`task-actions.ts`), disparada desde `domain/organizations/member-responsibilities.ts` (`releaseMemberTasks`, `withDeferredTaskReleases`) | Tareas en curso reclamadas por esa persona vuelven a `pending` con evento `released` y `reason`: `member_deactivated` o `office_access_removed`. Si hay una operación de miembro en curso, se aplaza hasta que termine. |
| Oficina u organización desactivada | `cancelOpenTasks` | Cancela tareas `pending` y `in_progress`, con motivo "Oficina desactivada." u "Organización desactivada.". |
| Cambio de un activo | Hook `reconcileAssetTasks`, `afterChange` en `assets` y `non-network-assets` | Ver abajo. Se ejecuta en la misma transacción que el cambio del activo. |

`reconcileAssetTasks` actúa si el activo cambió de oficina, quedó no disponible (retirado o eliminado) o cambió algún campo que afecta su revisión de seguridad. Sobre tareas abiertas que lo referencian directamente o referencian sus revisiones:
- **Activo no disponible**: cancela la tarea.
- **Revisión sin reemplazo**: cancela la tarea ("La revisión de este activo ya no corresponde.").
- **Cambio de oficina o de revisión**: actualiza `office`, recalcula `requires_reassignment` con la elegibilidad de la oficina nueva y, en tareas de revisión, repunta `related_entity` a la revisión que reemplaza a la anterior. Si quien tenía la tarea ya no es elegible, la devuelve a `pending`. Una asignación a persona sin elegibles queda con `assigned_user = null`.
- Agrega un evento a `lifecycle_history` (`at`, `reason`, oficina anterior y nueva, quien la tenía y, en revisiones, la anterior y la nueva).

Las liberaciones del hook escriben `lifecycle_history`, no `claim_history`.

### 7.4 Puntos de enganche pendientes

Las operaciones sensibles llevan comentarios `// AUDIT:` y `// NOTIFY:` en cada punto de escritura. AuditLog y Notification Bell **no existen aún**: son marcas, no código. Ver `SYSTEM_PROMPT.md` §2.

## 8. Frontend

### 8.1 Cadena

- Páginas: `app/portal/(protected)/tasks/page.tsx` y `tasks/[id]/page.tsx`.
- Componentes (`modules/tasks/components/`): `RowActions`, `TaskDetail`, `TaskForm`, `TaskEditForm`, `TaskDeleteModal`, `TaskAssignmentFields`, `TaskReferenceSummary`, `CreateRelatedTaskButton`.
- Hooks (`modules/tasks/hooks/`): `use-tasks`, `use-task-options`, `use-task-actions`.
- Cliente: `modules/tasks/service.ts`, que usa `lib/http-client.ts` contra `/api/v1/tasks...`.

El Panel general también consume `useTasks({ view: 'mine', officeId, asOrganization })`; con el feature apagado el endpoint responde 403 y el Panel deja de mostrar la lista de tareas y su contador (`tasksAvailable = !tasks.isError`).

### 8.2 Consultas (TanStack Query)

| Hook | Clave | Notas |
|---|---|---|
| `useTasks(params)` | `['tasks', params]` | Refetch cada 30 s. |
| `useTask(id, asOrganization)` | `['tasks', id, asOrganization]` | Refetch cada 30 s mientras `pending` o `in_progress`. |
| `useTaskReferenceOptions` | `['task-reference-options', type, officeId, asOrganization, selectedId]` | Habilitada si hay `type`. |
| `useTaskAssignmentOptions` | `['task-assignment-options', officeIds, reference, asOrganization, taskId]` | |

### 8.3 Mutaciones

| Hook | Efecto |
|---|---|
| `useCreateTasks` | Invalida `['tasks']`; aviso "Tarea creada". `TaskForm` agrega su `operation_id` (32 hex de `crypto.getRandomValues`, que funciona también fuera de un contexto seguro), fijo mientras el formulario está montado. |
| `useEditTask(id)` | Invalida `['tasks']`; aviso "Tarea actualizada". |
| `useTaskCommand(id)` | Despacha `claim`, `release`, `complete`, `archive`, `reassign`, `cancel`, `force_complete`, `delete`. Invalida `['tasks']` en éxito **y también en error**, para que una pantalla desactualizada se refresque antes de volver a habilitar acciones. |

`['tasks']` es prefijo de la lista y del detalle, por lo que ambos se refrescan. Los errores pasan por `showApiError`; los de campo se muestran en línea, no como aviso.

`useTaskCommand` serializa con `createTaskCommandGate` (`modules/tasks/task-command-gate.ts`): repetir la misma acción comparte la promesa en curso; una acción distinta se rechaza con `TaskCommandBusyError`. Es un bloqueo visual del cliente: no reemplaza el bloqueo del servidor (§7.1). Las promesas que devuelve ya están manejadas, así que quien las ignore no genera `unhandledrejection`.

### 8.4 Contrato de tipos

`TaskDTO` (`service.ts`) extiende el tipo `Task` generado por Payload con los campos de §4.1. Los schemas de entrada se importan directamente de `modules/tasks/schema.ts`, sin redefinirlos (`SYSTEM_PROMPT.md` §5).

## 9. Cómo agregar una acción nueva

1. Permiso en la matriz (`access/rbac/permissions.ts`), y el tipo `Action` si es nueva.
2. Función `xxxTaskLocked(req, ctx, id, ...)` en `domain/tasks/task-actions.ts`: `assertAction`, `loadTask`, `assertTaskScope`, `assertReferenceReadable`, verificación de estado y escritura. Exportarla envuelta en `withTaskLock`. Agregar los comentarios `AUDIT` y `NOTIFY`.
3. Schema de entrada, si lleva cuerpo, en `modules/tasks/schema.ts`.
4. Endpoint: `commandEndpoint(path, fn)` si no lleva cuerpo; si lo lleva, un endpoint como `cancelTaskEndpoint`. Registrarlo en `taskEndpoints` antes de cualquier ruta con `:id` que pueda capturarlo.
5. Regla en `availableTaskActions`.
6. Cliente: función en `service.ts`, valor en `TaskAction`, rama en el `mutationFn` de `useTaskCommand`, texto en el mapa de `onSuccess` y de `onError`.
7. Códigos de error nuevos en `lib/user-facing-error.ts`.
8. Pruebas de dominio y de integración (§11).

## 10. Comportamientos a tener presentes

Verificados en el código; no son necesariamente defectos, pero conviene conocerlos antes de tocar el feature.

1. **Costo del listado.** `GET /v1/tasks` no pagina y, por cada tarea, `assertCanReadTask`, `availableTaskActions` y `taskRequiresReassignment` pueden llamar a `listEligibleTaskMembers`, que carga todas las membresías activas de la organización con `depth: 2`. El costo crece con tareas × miembros.
2. **`include_archived`.** Usa `z.coerce.boolean()`, que convierte cualquier cadena no vacía en `true`, incluida `"false"`. El cliente envía `'true'` o nada. Una llamada directa con `include_archived=false` incluiría las archivadas.
3. **Replanificación y liberaciones del hook.** Ni la replanificación por edición (§5.5) ni las liberaciones de `reconcileAssetTasks` agregan eventos a `claim_history`, así que no aparecen en `actor_labels.claim_events`. Las del hook quedan en `lifecycle_history`.
4. **`DELETE` devuelve el documento crudo.** La respuesta no pasa por `taskWithDerivedState`: incluye `claim_history` y no incluye `effective_status`. El cliente la tipa como `TaskDTO`.
5. **Mensaje de `task_cannot_be_deleted`.** Dice "pendientes que nunca fueron reclamadas", pero la condición evalúa `claimed_at`, que `release` y `reassign` limpian (§5.7).
6. **Cancelar y eliminar.** Una tarea pendiente no se puede cancelar (`cancel` exige `in_progress`); se elimina. Como todas las transiciones actuales hacia `pending` limpian `claimed_at`, la condición de `DELETE` sobre ese campo hoy no rechaza ninguna tarea pendiente.
7. **Un 404 puede significar "sin permiso".** Alcance, entidad ilegible y falta de elegibilidad responden `task_not_found` para no revelar su existencia.
8. **Reclamo simultáneo.** El perdedor recibe `task_not_pending` ("ya no está pendiente"), un mensaje menos específico que el de `already_claimed` ("otra persona ya reclamó"). Ninguna prueba ejercita dos reclamos a la vez.
9. **`force-complete` fuera de la matriz.** Su restricción a org_admin y PlatformAdmin vive en `forceCompleteTaskLocked` y `availableTaskActions`; si se agrega un rol con permiso `complete` y alcance organizacional, no la obtiene automáticamente.

## 11. Cobertura de pruebas

Estado de cobertura automática; sin pruebas de extremo a extremo por ahora.

| Prueba | Cubre |
|---|---|
| `domain/tasks/task-state.test.ts` | Estado efectivo, vencimiento, finalización tardía |
| `domain/tasks/task-eligibility.test.ts` | Filtrado por asignación |
| `domain/tasks/task-reference.test.ts` | Lectura de referencias por rol y alcance |
| `domain/tasks/task-actions.audit.test.ts` | Alcance de creación y reasignación, lock transaccional |
| `collections/Tasks/index.test.ts` | Hook `defaultTaskStartAt` |
| `modules/tasks/schema.test.ts`, `schema.audit.test.ts` | Schemas Zod |
| `modules/tasks/task-activity.test.ts`, `task-reference-link.audit.test.ts` | Actividad y enlaces |
| `modules/tasks/task-command-gate.audit.test.ts` | Bloqueo de acciones del cliente |
| `endpoints/tasks.integration.test.ts` | Creación multi-oficina, reclamo, replanificación, completado, borrado; asignación por rol sin permiso sobre la entidad |
| `endpoints/task-assignment-regressions.audit.integration.test.ts` | 17 casos: opciones de asignación, alcance entre oficinas y organizaciones, completado administrativo, conflictos, atomicidad de liberar y reasignar |
| `endpoints/task-operations.audit.integration.test.ts` | 9 casos de la clave de operación: reintento, intentos simultáneos, otro cuerpo, otra persona u organización, duplicados intencionales, rollback y reintento, privacidad de la clave, claves inválidas, comandos repetidos con 409 |
| `modules/tasks/components/TaskForm.component.test.tsx` | Incluye: el reintento tras un fallo de red repite la clave y cada formulario abierto genera la suya |

Las pruebas de integración requieren una base PostgreSQL desechable; `task-assignment-regressions` exige `postgresql://siam_test@127.0.0.1:55448/siam_task_checks`.

Los efectos del sistema (§7.3) no tienen una suite propia de tareas; se cubren desde el ciclo de vida de cada origen:

| Efecto | Prueba |
|---|---|
| `releaseClaimedTasks` (persona desactivada o sin oficina) | `endpoints/memberLifecycle.integration.test.ts` (2 casos), `domain/organizations/member-responsibilities.test.ts` (aplazamiento) |
| `cancelOpenTasks` por oficina | `endpoints/offices.integration.test.ts` |
| `cancelOpenTasks` por organización | `endpoints/platformOrganizations.integration.test.ts` |
| `reconcileAssetTasks` (traslado, retiro, eliminación, revisión reemplazada) | `endpoints/remaining-corroboration.audit.integration.test.ts` (SEC-52/53 y FOLLOWUP) |
