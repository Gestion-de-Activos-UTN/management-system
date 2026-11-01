# API de miembros

Referencia técnica del feature `members`: las personas de una organización (alta, cambio de rol y oficinas, desactivación y reactivación), su contrato HTTP, las reglas de dominio, la delegación al Responsable de oficina, la concurrencia y la cadena que lo conecta con el frontend. Dirigida a quien mantiene o extiende el feature.

Verificado contra el código el 2026-10-31. Si algo de este documento contradice el código, gana el código: corregir el documento.

Documentos relacionados: `offices-api.md` (la desactivación de una oficina desactiva o recorta miembros por la misma cascada), `task-api.md` (liberación de tareas), `assets-api.md` (responsable de los activos), `organizations-platform-api.md` (alta de organizaciones y de administradores desde la plataforma) y `session-and-access.md` (sesión, `TenantContext`, perfil propio).

## 1. Capas y archivos

| Capa | Archivo | Responsabilidad |
|---|---|---|
| Contrato | `modules/users/schema.ts` | Schemas Zod: `MemberCreateSchema`, `MemberUpdateSchema`, `UserCredentialsSchema`, `ProfileUpdateSchema`, `ORGANIZATION_ROLES`. Los usan formularios y endpoints. Fuente de verdad. |
| Endpoints | `endpoints/orgMembers.ts` | Cuatro endpoints (listado, alta, actualización, impacto de desactivación). Registrados en `payload.config.ts`. |
| Dominio | `domain/organizations/member-admin.ts` | `createMember`, `updateMember`, `assertUserLimit`. Toda la regla de negocio de alta, estado, rol y oficinas. |
| | `domain/organizations/member-responsibilities.ts` | Qué cobertura pierde una persona (`lostCoverage`), liberación y reasignación de activos, liberación diferida de tareas, resumen de activos a cargo. |
| | `domain/organizations/admin-actions.ts` | `AdminDomainError`, `adminErrorResponse`, `assertOrganizationActive`, `organizationAdminLock`, `subscriptionLimits`. Compartido con oficinas y organizaciones. |
| | `domain/subscriptions/plan-limits.ts`, `limits.ts` | Lectura de topes del plan y constantes por nivel. |
| | `domain/with-transaction.ts` | Transacción con lock por clave. |
| Autorización | `access/rbac/permissions.ts` | Matriz estática de la colección `organization-memberships`. |
| | `access/rbac/member-status.ts` | Delegación por rango: `canChangeMemberStatus`, `canEditMemberOffices`. |
| | `access/tenant/resolveTenantContext.ts` | `TenantContext` (rol, rango, oficinas, `isActive`). |
| Persistencia | `collections/OrganizationMemberships/index.ts` y `hooks/*`, `invariants.ts` | Tabla puente usuario-organización-rol-oficinas, invariantes y cascadas. Cerrada al acceso directo. |
| | `collections/Users/index.ts`, `access/auth/account-sessions.ts` | Cuenta de acceso, estado, sesiones. |
| | `collections/Roles/index.ts` | Catálogo global de roles con `rank`. |
| | `collections/Subscriptions/index.ts` | Topes por rol (`user_limits`) y de oficinas (`max_offices`). |
| Cliente HTTP | `modules/users/service.ts` | Funciones sobre `lib/http-client.ts`; tipos `OrgMember`, `MemberDeactivationImpact`. |
| Estado de servidor | `modules/users/hooks/use-org-members.ts` | TanStack Query. |
| UI | `modules/users/components/*`, `modules/users/member-labels.ts`, `app/portal/(protected)/administration/users/page.tsx`, `app/portal/(protected)/team/page.tsx` | Presentación. |

Cadena de una acción: componente (`MemberStatusModal`, `MemberAccessModal`, `MemberCreateModal`) → `useUpdateOrgMember` / `useCreateOrgMember` → `service.ts` → `httpClient` → `endpoints/orgMembers.ts` → `withTransaction` (con lock de organización) → `updateMember` / `createMember` → `payload.create` / `payload.update` sobre `users` y `organization-memberships` → hooks de la colección.

Fuera de este documento: `/v1/me/profile` (perfil propio, `endpoints/myProfile.ts`, usado por `useMyProfile` y `useUpdateMyProfile` del mismo hook) y el alta de administradores desde la plataforma (`createPlatformOrgAdmin`, `/v1/platform-admin/organizations/:id/org-admins`), que comparten módulo y schema de credenciales pero no esta lógica.

## 2. Modelo

### 2.1 Colecciones

**`organization-memberships`** es la tabla puente (`SYSTEM_PROMPT.md`): la pertenencia de una persona a una organización y todo lo que determina su alcance. Acceso: `create`, `read`, `update` y `delete` son `() => false`. Todo pasa por los endpoints propios, que escriben con `overrideAccess: true`, y por `resolveTenantContext`, que la lee internamente.

| Campo | Tipo | Notas |
|---|---|---|
| `user` | relación a `users`, requerido, **único**, indexado | Una persona tiene como máximo una membresía, activa o no. |
| `organization` | relación a `organizations`, requerido, indexado | |
| `offices` | relación múltiple a `offices` | Oficinas asignadas. Para `org_admin` el hook las recalcula (§2.4). |
| `role` | relación a `roles`, requerido | `filterOptions` excluye roles de plataforma. |
| `status` | `onboarding` \| `active` | Valor por defecto de la colección: `onboarding`. |
| `is_active` | checkbox, por defecto `true` | Es lo que decide si la persona tiene acceso. |
| `deactivated_at` | date | Lo escribe la desactivación de la organización, no este feature. |

`user` y `organization` son inmutables tras la creación (`enforceImmutableOrgAndUser`, lanza `Error` genérico). Una persona no se mueve entre organizaciones.

**`users`** es la cuenta de acceso. Acceso directo cerrado en las cuatro acciones; la colección sigue sirviendo `/api/users/login` y `/api/users/me`. Campos propios: `name` (requerido), `status` (`active` \| `inactive`), `organization_membership` (solo lo escribe `linkMembershipToUser`). Autenticación con `useSessions: true`, bloqueo tras 5 intentos fallidos por 10 minutos, `unlock` cerrado, token de una hora.

**`roles`** es un catálogo global de solo lectura (`globalReadAccess('roles', 'read')`). Campos `slug` (único), `name`, `rank`, `scope`, `is_platform_role`. `rank`: 1 es la máxima autoridad. Los rangos sembrados (`scripts/seed-navigation.ts`) son `org_admin` = 1, `office_manager` = 5 y `org_viewer` = 10.

**`subscriptions`** guarda por organización `user_limits` (json con un tope por rol) y `max_offices`. Detalle en §3.5.

### 2.2 Estados de una persona

Una persona tiene tres estados de cara a la UI (`memberStatus` en `member-labels.ts`): `inactive` si `is_active` es `false`; si no, `onboarding` o `active` según `status` de la membresía. Solo `is_active` y el `status` de `users` tienen efecto sobre el acceso:

- `is_active` de la membresía: `resolveTenantContext` busca la membresía **con `is_active = true`** en cada request. Sin ella, no hay contexto y los endpoints responden 401 `unauthenticated`.
- `status` de `users`: `rejectInactiveLogin` rechaza el login con 403 si no es `active`, y `refresh` falla (`guardSessionOperation`).
- `status` de la membresía (`onboarding` / `active`): ningún endpoint ni regla de este feature lo lee ni lo escribe. `createMember` crea con `active`. El único código que produce `onboarding` es el seed (`scripts/seed-navigation.ts`) y el valor por defecto de la colección. El listado de selectores (§4.2) sí filtra por `status = active`, así que una membresía en `onboarding` no aparece allí.

| Operación | Membresía `is_active` | `users.status` |
|---|---|---|
| Alta (`createMember`) | `true`, `status = active` | `active` |
| Desactivar | `true` → `false` | Cascada: `inactive`, y se vacía `sessions` |
| Preparar (editar rol u oficinas de una persona inactiva) | sigue `false` | no cambia |
| Reactivar | `false` → `true` | `updateMember` lo pasa a `active` explícitamente |

La cascada de desactivación **no se revierte sola**: reactivar la membresía no reactiva la cuenta; `updateMember` hace ese segundo `payload.update` sobre `users` cuando `reactivating` es verdadero (comentario en `userLifecycleCascade.ts`).

### 2.2.1 Flujos

**Alta.** Un OrgAdmin (o un Responsable de oficina, solo de Observadores) envía nombre, correo, contraseña, rol y oficinas. Bajo el lock de la organización, el dominio comprueba que la organización esté activa, que el rol exista, que haya cupo para ese rol y que el correo no esté usado en ninguna organización. Si el rol no es `org_admin`, exige al menos una oficina activa de la organización, y si el actor es Responsable, que todas estén entre las suyas. Crea el usuario (`status = active`) y luego la membresía (`status = active`, `is_active = true`); el hook `linkMembershipToUser` escribe el vínculo inverso. Es atómico: si algo falla, no queda ni el usuario ni la membresía.

**Desactivación.** El cuadro de desactivación de la UI primero consulta el impacto (§4.5): activos a cargo de la persona, tareas en curso que reclamó y tareas abiertas asignadas a su nombre. La confirmación exige escribir el correo de la persona. Si tiene activos, la UI permite elegir un reemplazo. El endpoint toma el lock de la organización, valida la confirmación, que no sea uno mismo y que el reemplazo sea una persona activa distinta. Si hay reemplazo, **antes** de tocar la membresía pasa los activos al reemplazo (`reassignOwnedAssets`). Después actualiza la membresía a `is_active = false`; los hooks de la colección hacen el resto: impiden dejar la organización sin OrgAdmin activo, pasan `users.status` a `inactive` (lo que vacía las sesiones), dejan sin responsable los activos que sigan a su nombre y devuelven a `pending` las tareas en curso que reclamó. El acceso se corta de inmediato: el JWT sigue siendo válido pero deja de resolver contexto.

**Reactivación.** El endpoint exige organización activa y cupo para el rol. Si la persona no es `org_admin`, necesita al menos una oficina activa: usa las que tenía guardadas (descartando las inactivas) o las que se envíen en la misma solicitud. Si no queda ninguna, `offices_required`. No restaura nada más: los activos que quedaron sin responsable y las tareas que volvieron a `pending` no se reasignan ni se reclaman. La UI avisa de esto en el cuadro de reactivación.

**Preparar una persona inactiva.** Un OrgAdmin puede cambiar el rol y las oficinas de una persona inactiva sin reactivarla (`MemberAccessModal` avisa "La cuenta seguirá inactiva"). No consume cupo: el tope por rol se comprueba solo cuando el resultado es una persona activa y hay reactivación o cambio de rol (`active && (reactivating || roleChanged)`). Sí exige organización activa. El Responsable de oficina no puede hacerlo (§3.3).

**Bajar el propio rol.** Un OrgAdmin puede pasar a un rol de menor autoridad si queda otro OrgAdmin activo; no puede volver a subirse (`rank_escalation`): el rango se lee de la membresía vigente del actor. La UI avisa antes ("Vas a bajar tu propio rol").

**Quitar oficinas a una persona activa.** Cambiar `office_ids` o el rol de una persona activa recalcula qué oficinas activas dejó de cubrir (`lostCoverage`). Sus activos en esas oficinas quedan sin responsable y sus tareas en curso de esas oficinas vuelven a `pending` con motivo `office_access_removed`. Lo que conserva no se toca.

## 3. Permisos y alcance

### 3.1 Matriz (`access/rbac/permissions.ts`, colección `organization-memberships`)

| Rol | Acciones |
|---|---|
| `org_admin` | `create`, `read`, `update`, `change_status`, `edit_offices` |
| `office_manager` | `create`, `change_status`, `edit_offices` |
| `org_viewer` | ninguna |
| `platform_admin` sin organización | ninguna (`canDo` devuelve `false` salvo `read`, y la colección no figura en su matriz) |
| `platform_admin` con `?asOrganization=` | se evalúa como `org_admin` (`canDo`); `resolveTenantContext` le asigna `role = 'org_admin'` |

`update` es la acción "administración completa" (rol, estado, oficinas de cualquier persona, incluida una inactiva). `change_status` y `edit_offices` son las acciones delegables. El Responsable de oficina las tiene, pero acotadas por el dominio (§3.3). El comentario de la matriz lo resume: las colecciones siguen cerradas al CRUD directo y el Responsable solo recibe el flujo delegado de alta y estado de Observadores.

### 3.2 OrgAdmin

Sin límite de rango. `canManageMember` devuelve `true` para cualquier rol con alcance organizacional (`hasOrgWideScope`: `org_admin` y `platform_admin`), así que un OrgAdmin gestiona a otros OrgAdmin. Los límites del OrgAdmin los imponen el dominio y los hooks: no se desactiva a sí mismo, siempre queda un OrgAdmin activo, respeta cupos y no asigna más autoridad que la propia.

### 3.3 Responsable de oficina (delegación)

`updateMember` decide el camino según `canDo(ctx.role, 'organization-memberships', 'update')`. Quien no lo tiene (el Responsable) entra por el **camino delegado**:

1. **Relectura del actor dentro de la transacción.** El lock de organización pudo esperar mientras otro administrador cambiaba el alcance del actor, así que el rol, el rango, las oficinas y `isActive` del actor se releen con `loadMembership(ctx.userId)` y no se confía en el contexto de la request.
2. **Alcance sobre el objetivo** (`canManageMember`, con el actor releído): el actor debe estar activo, ser de la misma organización, tener la acción (`change_status` o `edit_offices`), y el objetivo debe tener **rango numérico mayor** (menos autoridad; `hasLessAuthority`), al menos una oficina asignada y **todas** sus oficinas dentro de las del actor. Un rango desconocido (no finito) niega. En la práctica, con los roles actuales, el objetivo solo puede ser un Observador (rango 10 frente a 5 del Responsable).
3. **Qué puede pedir:**
   - Cambiar estado (`is_active` booleano), solo si `canChangeMemberStatus` da `true`.
   - Cambiar oficinas (sin `is_active`), solo si `canEditMemberOffices` da `true`: el objetivo debe estar **activo** (para una persona inactiva se exige además `update`, que el Responsable no tiene).
   - Reactivar enviando `office_ids` está permitido, pero cada oficina enviada debe estar entre las del actor.
   - Nunca puede enviar `role`. Enviar `role`, o `office_ids` junto con una desactivación, o cualquier combinación que no sea una de las anteriores, responde 403 `forbidden`.
4. Después de autorizar, exige organización activa (`assertOrganizationActive`).

La evaluación del alcance usa las oficinas **almacenadas** del objetivo, sin filtrar las inactivas. Si el objetivo conserva una oficina inactiva que el Responsable no tiene, queda fuera de su alcance (esto es consecuencia del código; no hay una regla explícita sobre oficinas inactivas).

Alta: el endpoint `POST` permite a `office_manager` crear solo `org_viewer` (403 `forbidden` para otro rol), y `createMember` exige que todas las oficinas estén entre las suyas (403 `office_out_of_scope`). Para el alta no se usa rango, sino esa comprobación de rol.

### 3.4 Visibilidad en el listado

`GET /v1/org-members` no exige ninguna acción de la matriz: solo un contexto activo con organización. Quien tiene alcance organizacional ve a todas las personas; el resto, solo a quienes comparten al menos una oficina o tienen alcance organizacional (§4.2). Un Observador, que no tiene ningún permiso sobre la colección, también recibe este listado acotado a sus oficinas: es el origen de datos de los selectores de responsable. El correo solo se incluye para quien tiene `read`, `create` o `change_status` sobre `organization-memberships`; el Observador recibe nombre, rol y oficinas. La página `team` no se bloquea para él en el servidor ni en el cliente (§8.1).

### 3.5 Cuotas por rol del plan

`assertUserLimit(req, organizationId, role, excludeMembershipId?)`: lee el tope con `subscriptionLimits(...).userLimit(slug)` desde el documento `subscriptions` de la organización (campo `user_limits`). `null` (clave ausente) significa sin tope. Cuenta las membresías **con `is_active = true`** y ese rol, excluyendo la propia al reactivar o cambiar de rol; si `count >= limit`, 409 `user_limit_reached` con el texto "Tu plan permite hasta N persona(s) con el rol X".

Se aplica: en el alta, al reactivar, y al cambiar de rol una persona que queda activa. No se aplica al editar una persona inactiva sin reactivar. Las membresías en `onboarding` con `is_active = true` cuentan.

Los topes que aplica el sistema salen del documento de suscripción, no de `SUBSCRIPTION_LIMITS` (`domain/subscriptions/limits.ts`). Esa constante solo se usa al **crear** la organización (`createOrgWithAdmin` copia `user_limits` y `max_offices` al documento) y para la cuota de escáneres. Valores por nivel: `basic` = 1 / 2 / 4 (administradores / responsables / observadores) y `premium` = 3 / 10 / 20. En el código revisado, ningún endpoint modifica `subscriptions` después de la creación.

### 3.6 Invariantes en los hooks de `OrganizationMemberships`

Corren en cualquier vía que escriba la membresía (este feature, la desactivación de oficinas y la de organizaciones).

| Hook | Momento | Regla |
|---|---|---|
| `enforceImmutableOrgAndUser` | `beforeValidate` | `organization` y `user` inmutables en `update`. |
| `blockRankEscalation` | `beforeChange` | Si `data.role` viene, el rol destino no puede tener `rank` menor (más autoridad) que el rango del actor. El rango del actor sale de su membresía activa; sin usuario en la request o si es un `admins`, no hay restricción. Lanza `RankEscalationError`. |
| `enforceOrgAdminOffices` | `beforeChange` | Si el rol resultante es `org_admin`, reemplaza `offices` por **todas** las oficinas de la organización (incluidas las inactivas; `limit: 1000`). |
| `blockLastActiveOrgAdminOnUpdate` | `beforeChange` | Si la membresía estaba activa y se desactiva o cambia de rol, y su rol es protegido (`org_admin`), debe quedar al menos otro `org_admin` activo. No aplica si la organización está inactiva. Lanza `LastActiveOrgAdminError`. |
| `blockLastActiveOrgAdminOnDelete` | `beforeDelete` | Mismo invariante para el borrado. |
| `linkMembershipToUser` | `afterChange` (create) | Escribe `users.organization_membership`. |
| `cascadeDeactivationToUser` | `afterChange` (update) | `is_active` `true` → `false` deja `users.status = inactive`. |
| `releaseMemberResponsibilities` | `afterChange` (update) | Libera activos y tareas de lo que la persona dejó de cubrir (§7.2). |

Además, `Offices.afterChange` (`syncOrgAdminMemberships`) agrega cada oficina nueva a todas las membresías `org_admin` de la organización.

La regla "una membresía por usuario" la impone la restricción `unique` del campo `user`, sin hook adicional. No se distingue entre activa e inactiva: una persona nunca tiene una segunda membresía, de modo que no hay forma de mover una cuenta a otra organización.

## 4. Contrato HTTP

Prefijo `/api`. Cuerpos JSON. Un cuerpo ausente o inválido se parsea como `{}` y responde el error de validación correspondiente. El cliente agrega `?asOrganization=` a las requests del portal; solo tiene efecto para PlatformAdmin.

| Método y ruta | Permiso | Entrada | Respuesta OK |
|---|---|---|---|
| `GET /v1/org-members` | contexto activo | query `include_inactive=1` | 200 `{ docs }` |
| `POST /v1/org-members` | `create` (+ solo `org_viewer` si es Responsable) | `MemberCreateSchema` | 201 `{ id, name, email, role }` |
| `PATCH /v1/org-members/:id` | `change_status` o `edit_offices` | `MemberUpdateSchema` | 200 `{ ok: true }` |
| `GET /v1/org-members/:id/deactivation-impact` | `change_status` + alcance sobre el objetivo | — | 200 `{ owned_assets, in_progress_tasks, assigned_tasks }` |

`:id` es el **id del usuario**, no el de la membresía. Los endpoints no comprueban el feature flag de suscripción.

### 4.1 Autenticación y contexto

Los cuatro endpoints llaman a `getTenantContext`: sin contexto o con `isActive = false`, 401 `unauthenticated`. `POST` y `PATCH` además exigen `organizationId` y el permiso, o 403 `forbidden`. El `GET` de listado con un PlatformAdmin sin `asOrganization` devuelve `{ docs: [] }` con 200.

### 4.2 `GET /v1/org-members`

Query: `include_inactive=1` (solo el valor exacto `1`). Se respeta únicamente si el actor tiene `read` o `change_status` sobre la colección; si no, se ignora en silencio.

Semántica:
- Lee `organization-memberships` con `depth: 1`, `limit: 500` y `overrideAccess: true`. **Sin paginación**: más de 500 membresías se truncan.
- Sin `include_inactive`: solo `is_active = true` **y** `status = active`. Es el modo de los selectores.
- Con `include_inactive`: toda la organización, incluidas inactivas y `onboarding`.
- Alcance: con alcance organizacional, todas. Sin él, las que tienen alcance organizacional o comparten alguna oficina con el actor.
- Una persona inactiva solo se devuelve a quien no tiene alcance organizacional si `canChangeMemberStatus` da `true` para ella. Es decir, un Responsable ve inactivos solo si son Observadores completamente dentro de sus oficinas.
- Un rol no poblado (solo id) da `slug` y `rank` `null`, y todas las comprobaciones por rango niegan.

Cada elemento de `docs`: `{ id, name, email?, role, office_ids, office_names, status, is_active, can_change_status, can_edit_offices }`. `email` solo está presente para quien gestiona personas (`seesMemberEmails`, `access/rbac/permissions.ts`; la misma regla aplica `GET /v1/tasks/assignment-options`). `office_names` lista las oficinas de la persona que quien consulta puede ver. `orgMemberOptionLabel` muestra «nombre · rol · email» o, sin email, «nombre · rol · oficina» (la primera, con «+N» si hay más), y `MemberStatusModal` no permite confirmar una baja sin él. `id` es el id del **usuario**. `can_change_status` y `can_edit_offices` los calcula el servidor con las mismas funciones que usa `updateMember`; la UI las usa solo para mostrar u ocultar acciones.

### 4.3 `POST /v1/org-members`

`MemberCreateSchema`: `name` (trim, 1–120, regla `personName`), `email` (trim, formato correo, ≤ 254, se pasa a minúsculas), `password` (8–128), `role` (`org_admin` \| `office_manager` \| `org_viewer`), `office_ids` (lista de uuid, ≤ 500, por defecto `[]`).

Orden en el endpoint: contexto, permiso `create`, schema (400 `invalid_member` con `issues`), restricción de Responsable (403 `forbidden` si el rol no es `org_viewer`). Luego `withTransaction` con lock de organización y `createMember`:

1. `assertOrganizationActive` → 409 `organization_inactive`.
2. `roleBySlug` (rol no de plataforma) → 400 `invalid_role`.
3. `assertUserLimit` → 409 `user_limit_reached`.
4. Correo ya existente en `users` (en cualquier organización) → 409 `email_unavailable`.
5. Si el rol no es `org_admin`: las oficinas deben existir, ser de la organización y estar activas, todas (400 `invalid_offices`); al menos una (400 `offices_required`); si el actor es Responsable, todas entre las suyas (403 `office_out_of_scope`). Si el rol es `org_admin` y se envían oficinas: 400 `invalid_offices`.
6. Crea el usuario con `status = active` y luego la membresía con `status = active`, `is_active = true`. Para `org_admin`, `offices` se envía vacío y `enforceOrgAdminOffices` lo completa.

Respuesta 201: `{ id, name, email, role }` con el id del usuario.

### 4.4 `PATCH /v1/org-members/:id`

`MemberUpdateSchema` (todos opcionales, pero al menos uno): `is_active`, `role`, `office_ids` (≤ 500 uuid), `replacement_owner_id` (uuid), `confirm_email` (correo, minúsculas). Refinamientos:
- Sin ningún campo definido: "No hay cambios para guardar."
- `replacement_owner_id` solo con `is_active = false`.
- `is_active = false` exige `confirm_email`.
- `confirm_email` solo con `is_active = false`.

Cualquier incumplimiento responde 400 `invalid_member` con `issues`. Por eso `confirmation_required` (el dominio lo lanza si falta `confirm_email` al desactivar) no es alcanzable por HTTP: el schema responde antes. Solo se alcanza llamando a `updateMember` directamente.

Orden de verificaciones en `updateMember` (el primer fallo gana):

1. `loadMembership` del objetivo: 404 `member_not_found` si no hay membresía en la organización del actor (o si el objetivo es de otra organización).
2. Camino delegado, si el actor no tiene `update` (§3.3): 403 `forbidden`; luego `organization_inactive`.
3. Si el objetivo está inactivo, no se reactiva y la solicitud toca rol u oficinas: `organization_inactive` si la organización está inactiva.
4. Desactivación: `confirmation_mismatch` (400) si el correo no coincide con el de la persona, comparado sin distinguir mayúsculas ni espacios laterales.
5. `cannot_deactivate_self` (409) si el objetivo es el propio actor.
6. Reemplazo: si es el mismo usuario, o no está activo, 400 `invalid_replacement`. Si el id no tiene membresía en la organización, `loadMembership` responde 404 `member_not_found` (no `invalid_replacement`).
7. Rol: si cambia, `roleBySlug` (400 `invalid_role`).
8. Reactivación: `organization_inactive`; y si queda activa por reactivación o cambio de rol, `assertUserLimit` (409 `user_limit_reached`).
9. Oficinas: si el rol resultante no es `org_admin` y (la persona queda activa **o** se envían `office_ids`): se resuelven las oficinas activas de `office_ids ?? oficinas guardadas`. Si se enviaron y alguna no existe o está inactiva: 400 `invalid_offices`. Si no queda ninguna: 400 `offices_required`. Cuando no se envían `office_ids`, las oficinas guardadas se **filtran a las activas** y se reescriben; las inactivas se descartan en silencio.
10. Si hay reemplazo y la persona estaba activa y queda inactiva: `reassignOwnedAssets` (antes de escribir la membresía).
11. `payload.update` de la membresía con `is_active`, `role` (si cambió) y `offices` (si se calcularon). Aquí corren los hooks (§3.6): `rank_escalation` (403), `last_active_org_admin` (409).
12. Si fue una reactivación, `payload.update` de `users` con `status = active`.

El endpoint responde 200 `{ ok: true }`. Un `role` igual al actual no cambia nada. Un `PATCH` que no cambia cobertura (mismo rol, estado y oficinas) no libera responsabilidades (`sameCoverageInputs`).

### 4.5 `GET /v1/org-members/:id/deactivation-impact`

Exige `change_status`, que exista la membresía (404 `member_not_found`; también si el rol no se pudo poblar) y que `canChangeMemberStatus` dé `true` (403 `forbidden`). No comprueba la organización activa. No pasa por `adminErrorResponse`: una excepción inesperada llega a Payload como 500 sin código.

Respuesta:
- `owned_assets`: activos de red y manuales a cargo de la persona (`owner` igual a la persona, sin `deleted_at`), **sin los retirados**. Cada uno: `{ id, collection, name, office_id, office_name, office_active }`. El nombre de un activo de red es `alias`, `hostname`, `ip` o "Activo de red".
- `in_progress_tasks`: tareas `in_progress` reclamadas por la persona (`claimed_by` en `users`).
- `assigned_tasks`: tareas `pending` o `in_progress` con `assigned_user` igual a la persona, en toda la organización, sin filtrar por oficina.

El resumen de activos excluye los retirados, pero la liberación al desactivar usa `ownedAssets` sin ese filtro: un activo retirado que aún tenga a la persona como responsable también queda sin responsable (§7.2). Por eso el contador de la UI puede ser menor que lo realmente liberado.

## 5. Reglas por operación

### 5.1 Desactivar

Condiciones (§4.4, pasos 4–6, 10–11) y efectos:

| Efecto | Dónde ocurre |
|---|---|
| Membresía `is_active = false` | `updateMember` |
| `users.status = inactive` y `sessions = []` | `cascadeDeactivationToUser` y `revokeInactiveSessions` |
| Activos con reemplazo: pasan al reemplazo si son vigentes (no retirados), de oficina activa e identificados; el resto queda sin responsable | `reassignOwnedAssets` |
| Activos restantes: `owner = null` | `releaseMemberResponsibilities` → `releaseOwnedAssets` (`offices = 'all'`) |
| Tareas `in_progress` reclamadas: vuelven a `pending`, motivo `member_deactivated` | `releaseMemberResponsibilities` → `releaseMemberTasks` → `releaseClaimedTasks` |
| Tareas asignadas (`assigned_user`) | No se modifican. Con la persona inactiva, la elegibilidad calculada en vivo marca `requires_reassignment` (ver `task-api.md` §3.4). |

Un activo de red es "identificado" si `identification_status === 'confirmed'`; los activos manuales siempre se consideran identificados. Los hooks de los activos validan que el reemplazo cubra la oficina de cada activo; si no, el error del hook (público) se convierte en 400 `invalid_request` con el mensaje del hook y se revierte toda la transacción. La UI filtra los candidatos para que cubran las oficinas de los activos reasignables (`memberCoversOffice`), así que ese error solo aparece ante datos que cambiaron entre el cálculo y el envío.

### 5.2 Reactivar

Efectos y exclusiones en §2.2.1. Resumen de lo que escribe: `is_active = true`, `offices` (para no administradores, las activas), opcionalmente `role`, y `users.status = active`. No toca activos ni tareas. Las sesiones se vaciaron al desactivar, por lo que la persona debe iniciar sesión de nuevo.

### 5.3 Cambiar rol u oficinas de una persona activa

Solo OrgAdmin puede cambiar el rol (el camino delegado lo prohíbe). Reglas: cupo del rol destino (si cambió), `rank_escalation`, último OrgAdmin, y oficinas activas obligatorias para los roles que no son `org_admin`. Pasar a `org_admin` deja `offices` con todas las oficinas de la organización. Bajar de `org_admin` a otro rol sin enviar `office_ids` conserva las oficinas activas (el `org_admin` las tenía todas); con `office_ids` usa esa lista.

La cobertura perdida se calcula con `lostCoverage(previous, next, activeOfficeIds)`:
- Si la membresía anterior no estaba activa: nada se pierde.
- Si pasa a inactiva: `'all'`.
- En otro caso, las oficinas **activas** que cubría antes y ya no cubre. Un rol con alcance organizacional cubre todas las oficinas activas. Las oficinas inactivas se ignoran.

### 5.4 Editar oficinas como Responsable

Solo `office_ids`, solo de un Observador activo completamente dentro del alcance del Responsable, con cada oficina enviada entre las del Responsable y al menos una. No se puede enviar `role` ni `is_active` junto con `office_ids` (salvo la reactivación, §3.3).

## 6. Catálogo de errores

Cuerpo de error del dominio: `{ error: <código>, message: <texto>, details? }` (`adminErrorResponse`). Los de validación son `{ error, issues }`. El cliente muestra el texto de `lib/user-facing-error.ts` indexado por `error`.

`adminErrorResponse` convierte `AdminDomainError`, `RankEscalationError`, `LastActiveOrgAdminError` y `APIError` públicos de hooks (como `invalid_request`). **Cualquier otra excepción se relanza** y llega a Payload como 500 sin código. Los endpoints `GET` no usan `adminErrorResponse`.

| Código | HTTP | Cuándo |
|---|---|---|
| `unauthenticated` | 401 | Sin contexto activo (incluye membresía desactivada) |
| `forbidden` | 403 | Sin permiso en el endpoint; Responsable que crea un rol distinto de `org_viewer`; camino delegado fuera de alcance o con `role`; impacto fuera de alcance |
| `invalid_member` | 400 | Cuerpo de alta o de actualización inválido (`issues`). No tiene texto en `user-facing-error.ts`: el formulario valida antes |
| `member_not_found` | 404 | El usuario no tiene membresía en la organización del actor; también un reemplazo inexistente |
| `invalid_role` | 400 | El rol no existe como rol de organización |
| `email_unavailable` | 409 | Ya existe una cuenta con ese correo |
| `user_limit_reached` | 409 | Tope del plan para el rol (alta, reactivación, cambio de rol) |
| `invalid_offices` | 400 | Oficinas inexistentes, inactivas o de otra organización; oficinas enviadas para un `org_admin` |
| `offices_required` | 400 | Rol no administrador sin oficinas activas |
| `office_out_of_scope` | 403 | Alta por un Responsable con oficinas ajenas |
| `organization_inactive` | 409 | Ver §4.4 para los casos exactos |
| `confirmation_required` | 400 | Solo desde el dominio (el schema lo cubre por HTTP) |
| `confirmation_mismatch` | 400 | Correo de confirmación distinto |
| `cannot_deactivate_self` | 409 | El actor intenta desactivarse |
| `invalid_replacement` | 400 | Reemplazo igual a la persona o inactivo |
| `rank_escalation` | 403 | Asignar un rol de mayor autoridad que el propio |
| `last_active_org_admin` | 409 | Desactivar o degradar al último OrgAdmin activo |
| `invalid_request` | según el `APIError` | Regla pública de un hook de activos en cascada (reemplazo que no cubre la oficina del activo, activo sin responsable, etc.). El `message` es el del hook. Sin texto propio en `user-facing-error.ts` |

## 7. Concurrencia, atomicidad y efectos del sistema

### 7.1 Transacción y lock de organización

`POST` y `PATCH` corren dentro de `withTransaction(payload, req, fn, { lockKey: organizationAdminLock(organizationId) })`. La clave es `org-admin:<organizationId>`: un lock de asesoría de PostgreSQL por transacción (`pg_advisory_xact_lock(hashtextextended(key, 0))`).

Mecánica (`with-transaction.ts`): si la request no trae transacción, la abre y es dueña del commit. Intenta `pg_try_advisory_xact_lock`; si está ocupado, revierte, espera la liberación en una transacción desechable y vuelve a empezar con una instantánea nueva. Si ya había una transacción heredada, toma el lock bloqueante. Confirma si el comando termina; revierte si lanza. No hay reintento automático: solo se reintenta con aislamiento `repeatable read`, que estos endpoints no usan.

El lock serializa, por organización, altas, desactivaciones, cambios de rol y de oficinas, y también las acciones de oficinas (alta, estado) y las de plataforma sobre esa organización, que usan la misma clave. Sin él, la comprobación de cupo (lee y después escribe) o la del último OrgAdmin podrían saltearse con solicitudes concurrentes. Las actualizaciones de `users` toman además un lock de fila (`guardSessionOperation`) y exigen transacción.

El `GET` de impacto no usa lock ni transacción: es una lectura informativa y puede quedar desactualizada respecto de lo que ocurra al confirmar. Ningún código compara el impacto mostrado con el estado al ejecutar (a diferencia de `impact_changed` en oficinas).

La unicidad del correo se comprueba antes de crear (`email_unavailable`), pero el lock es por organización: dos altas simultáneas del mismo correo en organizaciones distintas no se serializan entre sí. Quedaría la restricción de unicidad de la base, cuyo error no pasa por `adminErrorResponse` (se relanza). No hay prueba que lo ejercite.

### 7.2 Liberación de responsabilidades

El hook `releaseMemberResponsibilities` corre en toda vía que cambie la membresía, no solo en `updateMember`, porque `deactivateOffice` y la desactivación de la organización escriben la membresía directamente. Condiciones: es un `update`, la membresía anterior estaba activa y cambió algo que define la cobertura (estado, rol u oficinas).

Con la cobertura perdida (`'all'` o una lista no vacía):
1. `releaseOwnedAssets`: para cada activo de red y manual de la persona en esas oficinas (sin `deleted_at`), uno por uno, toma el lock de fila del activo y escribe solo `owner = null` bajo el marcador de sistema `systemOwnerRelease` (una persona nunca puede elegir "sin responsable"). Los hooks del activo sincronizan el responsable de sus revisiones y encolan el recálculo de riesgo.
2. `releaseMemberTasks`: libera las tareas `in_progress` reclamadas por la persona en esas oficinas. Con `'all'`, todas las de la organización. Con una lista, solo las tareas cuya `office` está en la lista: una tarea de organización completa (`office = null`) reclamada por esa persona no se libera por quitarle una oficina. Motivo: `member_deactivated` si fue `'all'`, `office_access_removed` si fue una lista.

Orden y bloqueos: activos antes que tareas, igual que la ingesta de escaneos y el `PATCH` de un activo (lock de activo, luego lock de tarea). En `updateMember` la liberación de tareas ocurre inmediatamente dentro del hook. En `deactivateOffice` se aplaza con `withDeferredTaskReleases` hasta que terminaron todas las escrituras de activos, para no cruzar el orden de locks entre varias membresías. Ese aplazamiento se activa por `req.context`; si no hay uno en curso, `releaseMemberTasks` libera de inmediato.

`reassignOwnedAssets` (reemplazo al desactivar) corre en `updateMember` antes de actualizar la membresía. Para cada activo de la persona: si es asignable lo pasa al reemplazo (`writeOwner`, con lock de fila); si no, lo deja sin responsable (`releaseOwner`).

### 7.3 Sesiones

Desactivar una persona deja `users.status = inactive` y, en el mismo cambio, `sessions = []` (`revokeInactiveSessions`, `beforeChange` de `users`). Efectos: el JWT existente deja de resolver contexto porque ya no hay membresía activa (401 en los endpoints); `refresh` falla con 403; el login se rechaza con 403 mientras la cuenta no sea `active`. Al reactivar, `users.status` vuelve a `active` pero las sesiones no se restauran.

### 7.4 Puntos de enganche pendientes

Las operaciones sensibles llevan comentarios `// AUDIT:` y `// NOTIFY:` en cada punto de escritura (alta de usuario y de membresía, cambio de membresía, reactivación, cascada a `users`, revocación de sesiones, cambios de responsable de activos). AuditLog y Notification Bell **no existen aún**: son marcas, no código. Ver `SYSTEM_PROMPT.md`.

## 8. Frontend

### 8.1 Cadena

- Páginas: `app/portal/(protected)/administration/users/page.tsx` (`MembersView` con `mode="administration"`) y `app/portal/(protected)/team/page.tsx` (`MembersView` con `mode="team"`).
- Componentes de `modules/users/components/`: `MembersView`, `RowActions`, `MemberCreateModal`, `MemberAccessModal`, `MemberStatusModal`, `MemberSelect`.
- Hooks: `modules/users/hooks/use-org-members.ts`.
- Cliente: `modules/users/service.ts`, sobre `lib/http-client.ts`, hacia `/api/v1/org-members...`.

Ambas páginas montan el mismo componente `MembersView`; solo cambia `mode`. Diferencias por modo:

| Aspecto | `administration` | `team` |
|---|---|---|
| Título | "Usuarios" | "Equipo" |
| `canManage` (rol, estado de inactivos) | `permissions.organizationMembers.update` | siempre `false` |
| Roles ofrecidos al crear | los tres | solo `org_viewer`, rol bloqueado |
| Tope de plan en los contadores | muestra `usado de tope` | no lo muestra (`limit = null`) |
| Cambio de rol en el modal de acceso | solo con `canManage` | no (rol de solo lectura) |

Quién llega a cada una: `administration` cuelga de `administration/layout.tsx`, que muestra 404 si el contexto no es de OrgAdmin efectivo (`isEffectiveOrgAdmin`: OrgAdmin, o PlatformAdmin visitando una organización). Ese control es solo del cliente; el servidor aplica el suyo en cada endpoint. `team` no tiene layout propio: el menú lateral (`app/portal/(protected)/layout.tsx`) muestra "Equipo" solo si el usuario **no** es OrgAdmin efectivo y tiene `permissions.organizationMembers.create`, pero la ruta no se bloquea por URL directa, y el listado que consume está abierto a cualquier contexto activo (§3.4).

Las acciones por fila dependen de los permisos del contexto (`/v1/session`: `organizationMembers.create`, `changeStatus`, `editOffices`, `update`) y de lo que devuelve cada elemento (`can_change_status`, `can_edit_offices`). La edición de acceso de una persona inactiva solo está habilitada con `allowRoleChange` (es decir, para OrgAdmin en modo administración). Un usuario no puede pulsar "Desactivar" sobre sí mismo (`blockSelf`), aunque el servidor lo rechaza igual (`cannot_deactivate_self`).

`MembersView` consulta con `includeInactive: true`, y calcula en el cliente los contadores por rol (personas con `is_active` y ese rol, incluidas las `onboarding`) y los filtros por texto, rol y estado.

### 8.2 Consultas (TanStack Query)

| Hook | Clave | Notas |
|---|---|---|
| `useOrgMembers(asOrganization, { includeInactive })` | `['org-members', asOrganization, { includeInactive }]` | También lo usan selectores de responsable (activos y manuales) sin `includeInactive`. |
| `useMemberDeactivationImpact(userId, asOrganization)` | `['org-members', 'deactivation-impact', userId, asOrganization]` | Habilitada con `userId`; `staleTime: 0`. |
| `useMyProfile()` | `['my-profile']` | Perfil propio (fuera de este documento). |
| `useTenantContext` | `['tenant-context', asOrganization]` | Fuente de `permissions.organizationMembers` y `limits`. `staleTime` 60 s. |

La clave del impacto está bajo el prefijo `['org-members']`, así que se invalida junto con la lista.

### 8.3 Mutaciones

| Hook | Efecto |
|---|---|
| `useCreateOrgMember(asOrganization)` | Invalida `org-members`, `tenant-context`, `platform-admin`. Aviso "Persona creada." En error, muestra el aviso salvo `email_unavailable`, que el formulario pone como error del campo. |
| `useUpdateOrgMember(asOrganization)` | Aviso según `is_active`: "Persona reactivada", "Persona desactivada" o "Acceso actualizado". Invalida `org-members`, `tenant-context`, `my-profile`, `assets`, `non-network-assets`, `tasks`, `assessments`. En error, `showApiError`. |

`MemberStatusModal` bloquea el reenvío con una referencia (`submissionLock`) que se libera solo en error, porque el estado `pending` de la mutación deja una ventana ante un doble clic. El botón "Desactivar" queda deshabilitado mientras el impacto carga o falla y hasta que el correo escrito coincida. Si el impacto no se pudo cargar, no se permite desactivar.

`MemberAccessModal` envía `role` solo con `allowRoleChange` y `office_ids` solo para roles que no son `org_admin`. Avisa cuando se quitan oficinas (los activos y tareas de esas oficinas se liberan) y cuando una persona se baja el propio rol.

### 8.4 Contrato de tipos

`OrgMember`, `MemberDeactivationImpact` en `service.ts`. Los schemas de entrada se importan de `modules/users/schema.ts` sin redefinirlos. El tipo `RoleSlug` sale de `access/rbac/permissions.ts`.

## 9. Comportamientos a tener presentes

Verificados en el código; no son necesariamente defectos.

1. **`:id` es el usuario.** Todas las rutas `/v1/org-members/:id` y el `id` de cada elemento del listado son ids de `users`, no de la membresía.
2. **Una sola membresía por usuario.** `user` es `unique` y `user`/`organization` son inmutables: no existe el traslado de una persona a otra organización, ni "una membresía activa y otras inactivas".
3. **`status` de la membresía sin efecto.** `onboarding` no restringe nada, no se escribe desde ningún endpoint y excluye a la persona de los selectores (`status = active`), aunque sí aparece y cuenta en el listado de administración.
4. **Listado sin paginación.** Hasta 500 membresías; las restantes no se devuelven.
5. **Listado abierto a cualquier contexto activo.** No exige permiso sobre la colección. Un Observador recibe nombre y correo de las personas que comparten sus oficinas.
6. **`confirmation_required` inalcanzable por HTTP.** El schema ya exige `confirm_email` al desactivar.
7. **Reemplazo inexistente.** Un `replacement_owner_id` sin membresía en la organización responde 404 `member_not_found`, no `invalid_replacement`.
8. **Impacto no comparado.** El impacto se calcula aparte y no se vuelve a verificar al confirmar. Lo que cambie entre medio se libera igual.
9. **Activos retirados.** No figuran en `owned_assets` pero también se liberan.
10. **Tareas asignadas no se reasignan.** Solo se liberan las tareas `in_progress` reclamadas; las asignadas a nombre de la persona quedan, y el cálculo en vivo de `requires_reassignment` las marca.
11. **Oficinas inactivas y alcance delegado.** Se evalúa el alcance del Responsable sobre las oficinas almacenadas, también las inactivas, sin filtrarlas.
12. **Oficinas de OrgAdmin.** `enforceOrgAdminOffices` guarda todas las oficinas, incluidas las inactivas; `lostCoverage` y la UI las ignoran.
13. **Correo duplicado entre organizaciones.** La comprobación previa es global, pero el lock es por organización (§7.1).
14. **Comentarios desactualizados.** Comentarios de `endpoints/orgMembers.ts` y `modules/users/service.ts` mencionan `app/portal/(protected)/admin/users/page.tsx`; esa ruta no existe, la vigente es `administration/users`.

## 10. Cobertura de pruebas

Estado de cobertura automática; sin pruebas de extremo a extremo por ahora.

| Prueba | Cubre |
|---|---|
| `access/rbac/member-status.audit.test.ts` | `canChangeMemberStatus` y `canEditMemberOffices`: delegación sin edición general, cobertura completa, rango, organización ajena, actor inactivo, OrgAdmin sobre OrgAdmin, preparación de inactivos |
| `collections/OrganizationMemberships/invariants.test.ts` | Escalada de rango y último OrgAdmin (funciones puras) |
| `collections/OrganizationMemberships/hooks/enforceOrgAdminOffices.test.ts` | `org_admin` recibe todas las oficinas; los demás conservan las suyas |
| `collections/Offices/hooks/syncOrgAdminMemberships.test.ts` | Una oficina nueva se propaga a los `org_admin` |
| `domain/organizations/member-responsibilities.test.ts` | `lostCoverage`, `sameCoverageInputs`, `withDeferredTaskReleases` (aplazamiento, restauración del contexto, fallo) |
| `modules/users/service.test.ts` | `memberCoversOffice` |
| `collections/Users/unlock.audit.test.ts` | Desbloqueo manual denegado con bloqueo nativo |
| `endpoints/orgMembers.integration.test.ts` | Autodesactivación (409 `cannot_deactivate_self`), último OrgAdmin, `offices_required`, listado con y sin inactivos, tope por rol al reactivar, reactivación de `users`, cambios de rol y `rank_escalation`, perfil propio |
| `endpoints/review-findings.audit.integration.test.ts` | Listado de personas: el Observador recibe nombres sin correo; Responsable, OrgAdmin y plataforma visitante reciben el correo |
| `endpoints/memberLifecycle.integration.test.ts` | Desactivar con reemplazo (activos y liberación de tareas), sin reemplazo (incluye activos de red no identificados), quitar una oficina libera solo lo de esa oficina, activos manuales sin responsable ni en oficinas inactivas |
| `endpoints/member-manager-status.audit.integration.test.ts` | Delegación del Responsable: relectura del alcance dentro de la transacción, permisos en sesión y listado, edición de oficinas de Observadores, rechazo ante administradores, mixtos y ajenos, alta solo de Observadores, rechazo de `role`, confirmación por correo, reactivación sin restaurar, topes y override de oficinas, preparación de inactivos por OrgAdmin sin consumir cupo, organización inactiva |
| `access/rbac/officeScoping.integration.test.ts` | Alcance por oficina y selección de responsables |

Las pruebas de integración requieren una base PostgreSQL desechable. Ninguna prueba ejercita dos altas simultáneas con el mismo correo en organizaciones distintas ni la concurrencia del lock de organización con solicitudes paralelas.
