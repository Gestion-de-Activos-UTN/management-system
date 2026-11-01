# API de organizaciones y plataforma

Referencia técnica del feature de administración de organizaciones desde el portal de plataforma (StaffPortal): alta, edición, desactivación y reactivación de organizaciones, alta de personas OrgAdmin adicionales, listado con resumen operativo, panel de plataforma y perfil del administrador de plataforma. Incluye el modelo de suscripción (planes, cupos, features) del que dependen. Dirigida a quien mantiene o extiende el feature.

Verificado contra el código el 2026-10-31. Si algo de este documento contradice el código, gana el código: corregir el documento.

Documentos relacionados: `task-api.md` (cancelación de tareas y liberación de tareas por persona), `members-api.md` (alta y baja de personas de una organización), `offices-api.md` (ciclo de vida de oficinas), `organization-settings-api.md` (ajustes y política de assessment), `session-and-access.md` (contexto de tenant y `?asOrganization=`), `portal-messages-api.md` (mensajes de plataforma), `scanner-api.md` (agentes), `assets-api.md`, `assessments-api.md` y `risk-api.md` (efectos de la desactivación sobre activos, revisiones y riesgo).

## 1. Capas y archivos

| Capa | Archivo | Responsabilidad |
|---|---|---|
| Contrato | `modules/organizations/schema.ts` | Schemas Zod: `OrganizationDetailsSchema`, `OrganizationCreateSchema`, `PlatformOrgAdminCreateSchema`, `OrganizationStatusSchema`. Los usan los formularios y los endpoints. Fuente de verdad. |
| | `modules/auth/schema.ts` | `PlatformAdminProfileSchema`. |
| Endpoints | `endpoints/platformOrganizations.ts` | Siete endpoints de organizaciones (exportados como `platformOrganizationEndpoints`). |
| | `endpoints/platformDashboard.ts` | `platformDashboardEndpoint`. |
| | `endpoints/platformAdminProfile.ts` | `platformAdminProfileEndpoint`, `updatePlatformAdminProfileEndpoint`. |
| | `payload.config.ts` | Registra los tres grupos. |
| Dominio | `domain/organizations/createOrgWithAdmin.ts` | Alta atómica de organización, ajustes, suscripción, primera oficina y primer OrgAdmin. |
| | `domain/organizations/organization-lifecycle.ts` | `organizationStatusImpact`, `deactivateOrganization`, `reactivateOrganization`. |
| | `domain/organizations/update-organization-details.ts` | Edición de nombre y rubro. |
| | `domain/organizations/admin-actions.ts` | `AdminDomainError`, `adminErrorResponse`, `assertOrganizationActive`, `organizationAdminLock`, `subscriptionLimits`. |
| | `domain/organizations/member-admin.ts` | `createMember` y `assertUserLimit`, reutilizados para el OrgAdmin adicional. |
| | `domain/organizations/industry-options.ts` | Catálogo de rubros (`INDUSTRY_OPTIONS`, `INDUSTRY_VALUES`). |
| | `domain/subscriptions/limits.ts` | `SUBSCRIPTION_LIMITS`, `getSubscriptionLimits`, tipos `SubscriptionLevel`. |
| | `domain/subscriptions/plan-limits.ts` | `planLimits`: lectura de topes desde el documento `subscriptions`. |
| | `domain/subscriptions/features.ts` | `FEATURE_CATALOG`, `defaultFeatures`, `normalizeFeatures`, `organizationFeatures`. |
| | `domain/subscriptions/agent-quota.ts` | Cupo de agentes por plan (`getAgentQuota`, `calculateAgentLimit`). |
| | `domain/with-transaction.ts` | `withTransaction` con `lockKey`. |
| Persistencia | `collections/Organizations/index.ts`, `collections/Subscriptions/index.ts`, `collections/Admins/index.ts` | Colecciones Payload `organizations`, `subscriptions`, `admins`. |
| Contexto | `access/tenant/resolveTenantContext.ts` | `getTenantContext` y resolución de `?asOrganization=`. |
| | `lib/organization-request-context.ts` | Reenvío de `asOrganization` en todo request del cliente. |
| Cliente HTTP | `modules/organizations/service.ts`, `modules/platform-admin/service.ts`, `modules/auth/service.ts` (perfil), `modules/users/service.ts` (`createPlatformOrgAdmin`) | Funciones sobre `lib/http-client.ts`. |
| Estado de servidor | `modules/organizations/hooks/use-organizations.ts`, `modules/platform-admin/hooks/use-platform-dashboard.ts`, `modules/auth/hooks/use-platform-admin-profile.ts`, `modules/users/hooks/use-org-members.ts` (`useCreatePlatformOrgAdmin`) | TanStack Query. |
| UI | `modules/organizations/components/*`, `modules/organizations/organizations.columns.tsx`, `modules/platform-admin/components/PlatformDashboard.tsx` | Presentación. |
| Páginas | `app/(dashboard)/(protected)/` : `layout.tsx`, `page.tsx` (panel), `organizations/page.tsx`, `account/page.tsx`, `portal-messages/page.tsx`; login en `app/(dashboard)/login/page.tsx` | Portal de plataforma. |

Cadena de una acción de ciclo de vida: `OrganizationStatusModal` → `useSetOrganizationStatus` → `setOrganizationStatus` (`service.ts`) → `httpClient` → `organizationStatusEndpoint` → `withTransaction` (con `organizationAdminLock`) → `deactivateOrganization` o `reactivateOrganization`.

Los endpoints de organizaciones no tienen una colección propia de acceso REST: `organizations`, `subscriptions` y `admins` tienen `create`, `update` y `delete` en `() => false`, y todo lo que escribe el feature pasa con `overrideAccess: true` desde dominio.

## 2. Modelo

### 2.1 Colección `organizations`

Acceso: `create`, `update` y `delete` en `() => false`. `read` usa `orgScopedAccess('organizations', 'read', { kind: 'self' })`: un PlatformAdmin sin organización lee todas; con `?asOrganization=` o como miembro, solo la propia.

| Campo | Tipo | Notas |
|---|---|---|
| `name` | text, requerido | Sin unicidad. |
| `is_active` | checkbox, por defecto `true` | |
| `deactivated_at` | date | Instante de la última desactivación. Lo escribe solo `deactivateOrganization`; no se limpia al reactivar. Acota qué OrgAdmin vuelve al reactivar (§5.3). |
| `settings` | relación a `organization-settings` | Escritura directa bloqueada (`access.update` en `false`). |
| `subscription` | relación a `subscriptions` | Ídem. |

### 2.2 Colección `subscriptions`

Sin lectura ni escritura externa (los cuatro accesos en `() => false`). Una suscripción por organización (`organization` es `unique`).

| Campo | Tipo | Notas |
|---|---|---|
| `organization` | relación, requerido, único, indexado | |
| `level` | select `basic` \| `premium` | Opciones tomadas de `Object.keys(SUBSCRIPTION_LIMITS)`. |
| `user_limits` | json, requerido | Topes por rol (`org_admin`, `office_manager`, `org_viewer`). |
| `max_offices` | number | |
| `features` | json | Mapa plano `feature_key -> boolean`. |

`createOrgWithAdmin` es el único camino de código del feature que crea una suscripción. No hay endpoint que cambie `level`, `user_limits`, `max_offices` ni `features` de una organización existente (verificado: ningún endpoint ni dominio escribe `subscriptions` salvo la creación; el resto de las escrituras están en seeds y tests). Los topes se **copian** del plan al documento al crear: los endpoints que los hacen cumplir (`subscriptionLimits`, `planLimits`) leen el documento, no `SUBSCRIPTION_LIMITS`.

### 2.3 Colección `admins`

Cuentas de PlatformAdmin. Autenticación propia (`auth` con `useSessions: true`, `maxLoginAttempts: 5`, `lockTime` 10 min, token de 1 h). `create`, `read`, `update` y `delete` en `() => false`; el endpoint `/first-register` responde 403 (solo hay alta por la CLI de seed). `unlock` también en `false`.

| Campo | Tipo | Notas |
|---|---|---|
| `name` | text, ≤ 120 | Editable desde la cuenta (§4.8). |
| `role` | relación a `roles`, requerido | `filterOptions`: solo roles con `is_platform_role`. |
| `status` | select `active` \| `inactive`, por defecto `active` | Un admin `inactive` no resuelve contexto de tenant (`isActive: false`). |

Un PlatformAdmin no tiene organización ni membership. Es el "actor sin documento en `users`" que mencionan otros documentos (`task-api.md`).

### 2.4 Planes y cupos (`domain/subscriptions/limits.ts`)

| Concepto | Basic | Premium |
|---|---|---|
| `max_offices` (oficinas activas) | 3 | 10 |
| `agents_per_office` | 1 | 2 |
| `user_limits.org_admin` | 1 | 3 |
| `user_limits.office_manager` | 2 | 10 |
| `user_limits.org_viewer` | 4 | 20 |

Dónde se hace cumplir cada tope:

- **Oficinas**: `assertOfficeQuota` (`domain/offices/office-lifecycle.ts`) compara las oficinas **activas** con `max_offices` del documento al crear o reactivar una oficina (`office_limit_reached`, 409). La primera oficina que crea `createOrgWithAdmin` no pasa por ese chequeo.
- **Personas por rol**: `assertUserLimit` (`member-admin.ts`) cuenta las membresías con `is_active: true` del rol (`user_limit_reached`, 409). Se aplica en `createMember`, en reactivar personas y en reactivar la organización. La membership del primer OrgAdmin que crea `createOrgWithAdmin` no pasa por el chequeo.
- **Agentes**: `getAgentQuota` calcula `límite = cantidad de oficinas de la organización × agents_per_office` usando `SUBSCRIPTION_LIMITS` por `level` (no el documento) y cuenta los agentes que `countsTowardAgentLimit`. La cantidad de oficinas sale de `totalDocs` de una consulta sin filtro de `is_active`: **cuenta también las oficinas inactivas**. Si no hay suscripción lanza `SubscriptionNotFoundError`. El detalle de agentes está en `scanner-api.md`.

`planLimits(subscription)` devuelve `null` para un tope ausente o no numérico; `null` significa "sin tope cargado" y los chequeos de oficinas y personas no limitan en ese caso. La sesión expone `limits` con esta misma lectura (`endpoints/session.ts`).

Consecuencia del cupo `org_admin` de Basic (1): el alta de una persona OrgAdmin adicional (§4.5) en una organización Basic con su primer administrador activo responde 409 `user_limit_reached`.

### 2.5 Features (`domain/subscriptions/features.ts`)

`FEATURE_CATALOG`: `asset_inventory`, `security_assessments`, `risk_score`, `tasks`. `defaultFeatures()` pone todas en `true`. `createOrgWithAdmin` guarda `defaultFeatures()` para **cualquier** plan: Basic y Premium difieren hoy en topes, no en features.

`normalizeFeatures(raw)` completa las claves ausentes con el valor por defecto (`true`) sin pisar un `false` explícito; un valor que no sea objeto (o sea arreglo) se trata como `{}`. `organizationFeatures(req, organizationId)` lee la suscripción y aplica `normalizeFeatures`; la sesión y los endpoints usan la misma lectura. Si la organización no tiene suscripción, el resultado es todo `true`.

Consumidores verificados: `security_assessments` (`GET /v1/security-review/summary` responde 403 `feature_disabled`; `reconcileAssessmentInstance` no abre assessments sin ella; la navegación del portal oculta la sección), `risk_score` (rama de riesgo de oficinas asignadas del mismo endpoint), `tasks` (`task-api.md`; navegación). No se encontró consumidor de `asset_inventory` fuera del catálogo.

### 2.6 Rubros (`industry-options.ts`)

16 valores estables: `technology`, `healthcare`, `education`, `retail`, `manufacturing`, `professional_services`, `finance_insurance`, `construction_real_estate`, `transport_logistics`, `energy_utilities`, `agriculture`, `hospitality_tourism`, `media_telecommunications`, `public_sector`, `nonprofit`, `other`. Se guardan en `organization-settings.industry`; el texto libre `industry_details` solo se admite con `other` (§4.4). El comentario del archivo indica que sirve para segmentar y para futuras funciones de IA.

## 3. Permisos y alcance

### 3.1 Quién puede qué

Todos los endpoints de este documento exigen un PlatformAdmin. Los de organizaciones y el panel exigen además **no estar en contexto de visita**:

| Quién | Endpoints de organizaciones y panel (§4.1 a §4.7) | Perfil (§4.8) |
|---|---|---|
| Sin sesión, o admin con `status` distinto de `active` | 401 `unauthenticated` | 401 `unauthenticated` |
| Cuenta de `users` (OrgAdmin, Manager, Viewer) | 403 `forbidden` | 403 `forbidden` |
| PlatformAdmin sin `?asOrganization=` | permitido | permitido |
| PlatformAdmin con `?asOrganization=` | 403 `forbidden` | permitido |

La verificación es `ctx.isPlatformAdmin && !ctx.organizationId` (helper local `platformAdmin` en `platformOrganizations.ts`, equivalente en `platformDashboard.ts`). El id de la organización destino siempre sale de la ruta, nunca del contexto visitado. El perfil solo exige `isPlatformAdmin` y `req.user.collection === 'admins'`, así que funciona también con `?asOrganization=`.

OrgAdmin, Manager y Viewer no tienen ningún endpoint de este feature. `organizations` es de solo lectura para todos los roles en la matriz (`access/rbac/permissions.ts`: `organizations: ['read']`), y la lectura de un miembro se limita a su propia organización.

### 3.2 Visita a una organización (`?asOrganization=`)

`getTenantContext` toma `asOrganization` de la URL del request. Para una cuenta de `admins`:

- Si el parámetro está presente y la organización existe: `organizationId` = ese id, `role = 'org_admin'`, `officeIds` = todas las oficinas de la organización (activas e inactivas) y `selectedOfficeId` = la primera. `isPlatformAdmin` sigue en `true`. Es lo que hace que el resto del sistema trate al admin como un OrgAdmin de esa organización (`task-api.md` §3.1).
- Si la organización no existe: `resolveTenantContext` **lanza** `TenantResolutionError`. No hay captura en los endpoints de este documento, de modo que el request termina como error 500 de Payload y no como 4xx. La prueba `access/tenant/resolveTenantContext.test.ts` fija el `throw`.
- Una cuenta de `users` que manda el parámetro lo ve ignorado (no escala).

Del lado del cliente, `lib/http-client.ts` pasa cada path por `organizationRequestPath`, que agrega `?asOrganization=<valor de window.location.search>` a todo request a `/api/...` si la URL del navegador lo tiene y el path no lo trae. Aplica también a mutaciones. Consecuencias verificadas:

- Entrar a una organización es navegar a `/portal/dashboard?asOrganization=<id>` (acción "Abrir portal de la organización" en `RowActions`). El layout del portal admite a un admin solo con ese parámetro y, sin él, lo redirige a `/`.
- Si el admin está en una página del portal de plataforma con `?asOrganization=` en la URL (el layout de `(dashboard)/(protected)` conserva el parámetro en los enlaces del menú y muestra un indicador "Visualizando"), los requests de esa página también llevan el parámetro: los endpoints de §4.1 a §4.7 responderían 403 `forbidden`, y el listado de organizaciones (REST de Payload) devolvería solo la organización visitada (`kind: 'self'`).

### 3.3 Restricciones de edición

- **Activa**: editar nombre o rubro exige organización activa (409 `organization_inactive`, `assertOrganizationActive`). La UI oculta el lápiz y el menú "Añadir administrador" cuando la organización está inactiva (`RowActions`).
- **Fuera de contexto de visita**: ver §3.1. La prueba `organization-details.audit.integration.test.ts` fija el rechazo de un PlatformAdmin en contexto de visita y de cuentas de organización.
- **Alta de OrgAdmin adicional** también exige organización activa (`createMember` llama a `assertOrganizationActive`).
- Solo un PlatformAdmin reactiva una organización; el mensaje de `organization_inactive` lo dice.

## 4. Contrato HTTP

Prefijo `/api`. Cuerpos JSON. Un cuerpo ausente o no parseable se interpreta como `{}` y produce el error de validación correspondiente. Los endpoints se registran en `payload.config.ts`.

| Método y ruta | Entrada | Respuesta OK |
|---|---|---|
| `GET /v1/platform-admin/organizations/operational-summary` | — | 200 `{ counts: { offices, agents } }` |
| `POST /v1/platform-admin/organizations` | `OrganizationCreateSchema` | 201 organización creada |
| `GET /v1/platform-admin/organizations/:id` | — | 200 `{ name, industry, industry_details }` |
| `PATCH /v1/platform-admin/organizations/:id` | `OrganizationDetailsSchema` | 200 `{ ok: true }` |
| `POST /v1/platform-admin/organizations/:id/org-admins` | `PlatformOrgAdminCreateSchema` | 201 `{ id, name, email, role }` |
| `GET /v1/platform-admin/organizations/:id/status-impact` | — | 200 `OrganizationStatusImpact` |
| `POST /v1/platform-admin/organizations/:id/status` | `OrganizationStatusSchema` | 200 `{ ok: true }` |
| `GET /v1/platform-admin/dashboard` | — | 200 métricas de plataforma |
| `GET /v1/platform-admin-profile` | — | 200 `{ name, email }` |
| `PATCH /v1/platform-admin-profile` | `PlatformAdminProfileSchema` | 200 `{ name, email }` |
| `GET /api/organizations` (REST de Payload) | query estándar | 200 página de documentos |

`operational-summary` se registra antes que `GET .../organizations/:id`; mantener ese orden al agregar rutas estáticas bajo `/organizations/`. No hay endpoint de listado propio: el listado usa la API REST de Payload (§4.9).

### 4.1 `GET /v1/platform-admin/organizations/operational-summary`

Recorre por páginas de 1000 las oficinas con `is_active: true` y los agentes con `is_active: true` (`depth: 0`, `overrideAccess: true`). Respuesta:

```
{ counts: {
    offices: { [organizationId]: number },
    agents:  { [organizationId]: { active: number, online: number } }
} }
```

`offices[org]` es la cantidad de oficinas activas. `agents[org].active` es la cantidad de agentes con `is_active: true` (incluye agentes aprovisionados que aún no enviaron heartbeat). `online` cuenta los activos con `isAgentOnline`: heartbeat no futuro y a lo sumo `OFFLINE_THRESHOLD_SECONDS` (600 s) atrás. Una organización sin oficinas o sin agentes activos **no aparece** en el mapa; el cliente la interpreta como 0.

La organización de cada fila se extrae con `relationId`; si no se puede resolver, la fila se omite.

### 4.2 `POST /v1/platform-admin/organizations`

`OrganizationCreateSchema`:

| Campo | Regla |
|---|---|
| `name` | trim, 1–200, `TEXT_RULES.label` |
| `industry` | uno de `INDUSTRY_VALUES` |
| `industry_details` | opcional, trim, ≤ 300, `TEXT_RULES.free`; solo si `industry === 'other'` |
| `plan` | `basic` \| `premium` |
| `first_office` | `OfficeInputSchema`: `name` trim 1–120 (`TEXT_RULES.label`), `province_id` obligatorio y válido, `department_id` opcional (`null` admitido) y perteneciente a la provincia |
| `first_admin` | `UserCredentialsSchema`: `name` trim 1–120 (`TEXT_RULES.personName`), `email` trim, válido, ≤ 254, pasado a minúsculas, `password` 8–128 |

El schema de alta no es `strict`: claves desconocidas se descartan. Si `industry_details` viene con un `industry` distinto de `other` y no está vacío, el error es 400 `invalid_organization` con `issues` (path `industry_details`).

Respuesta 201:

```
{ id, name, is_active: true, plan,
  office:      { id, name },
  first_admin: { id, name, email, role: 'org_admin' } }
```

Los ids se serializan como `String`. `is_active` es el literal `true` y `plan` es el valor del cuerpo (no se relee de la suscripción). El orden y la atomicidad están en §5.1.

### 4.3 `GET /v1/platform-admin/organizations/:id`

Devuelve `{ name, industry, industry_details }` con datos de `organizations` y `organization-settings` (`industry_details` como `''` si no hay). 404 `not_found` si la organización no existe; 409 `organization_settings_missing` si no hay ajustes. No exige organización activa. Alimenta el formulario de edición.

### 4.4 `PATCH /v1/platform-admin/organizations/:id`

`OrganizationDetailsSchema` es `strict`: `name` (trim, 1–200, `TEXT_RULES.label`), `industry` (catálogo), `industry_details` opcional (trim, ≤ 300, `TEXT_RULES.free`, solo con `other`). Cualquier otra clave produce 400 `invalid_organization`. Es una edición total: el cliente siempre envía nombre y rubro.

Dentro de `withTransaction` con `organizationAdminLock(id)` ejecuta `updateOrganizationDetails`:
1. Revalida el cuerpo con el mismo schema.
2. `assertOrganizationActive` (409 `organization_inactive`).
3. Busca los ajustes (409 `organization_settings_missing` si faltan), antes de cualquier escritura.
4. Actualiza `organizations.name`.
5. Actualiza `organization-settings`: `industry` y `industry_details` (`data.industry_details || null`, de modo que cambiar a un rubro distinto de `other` borra el detalle).

Ambas escrituras comparten la transacción: si la segunda falla, el nombre vuelve atrás (cubierto por `organization-details.audit.integration.test.ts`). Respuesta `{ ok: true }`.

### 4.5 `POST /v1/platform-admin/organizations/:id/org-admins`

Cuerpo: `PlatformOrgAdminCreateSchema` (= `UserCredentialsSchema`: `name`, `email`, `password`). Cuerpo inválido: 400 `invalid_member`.

Se arma un contexto sintético (`role: 'org_admin'`, `organizationId` de la ruta, `officeIds: []`) y se llama a `createMember` dentro de `withTransaction` con `organizationAdminLock(id)`, con `role: 'org_admin'` y `office_ids: []`. `createMember`:
1. `assertOrganizationActive`.
2. Resuelve el rol `org_admin` y aplica `assertUserLimit` (`user_limit_reached`).
3. Rechaza un correo ya usado en `users` (409 `email_unavailable`).
4. Crea el usuario (`status: 'active'`) y su membership (`status: 'active'`, `is_active: true`, sin oficinas explícitas).
5. El hook `enforceOrgAdminOffices` de `organization-memberships` le asigna **todas** las oficinas de la organización; `linkMembershipToUser` enlaza el usuario con su membership.

Respuesta 201 `{ id, name, email, role: 'org_admin' }`. Si la ruta no trae id responde 404 `organization_not_found`; si el id no corresponde a una organización existente ver §10.

### 4.6 `GET .../:id/status-impact` y `POST .../:id/status`

`status-impact` devuelve `OrganizationStatusImpact` según el estado actual:

```
{ is_active: true,  deactivation: { offices, members, agents,
                                     network_assets, manual_assets, open_tasks } }
{ is_active: false, reactivation: { admin: { name, email } | null,
                                     office: { name } | null } }
```

Cálculo de `deactivation` (`deactivationImpact`):

| Campo | Cálculo |
|---|---|
| `offices` | oficinas con `is_active: true` |
| `members` | membresías con `is_active: true` |
| `agents` | agentes de la organización cuyo `getAgentLifecycleStatus` no es `revoked` (se cuentan en memoria sobre todos los agentes) |
| `network_assets` | `assets` de la organización con `status` distinto de `retired` y sin `deleted_at` |
| `manual_assets` | `non-network-assets` con el mismo filtro |
| `open_tasks` | `tasks` con `status` `pending` o `in_progress` |

`reactivation.admin` es el OrgAdmin que volvería (§5.3) o `null`; `reactivation.office` es la oficina más antigua o `null`. 404 `organization_not_found` si no existe.

`POST .../status` con `OrganizationStatusSchema` (unión discriminada por `is_active`):
- `{ is_active: true }`: reactiva.
- `{ is_active: false, confirm_name }`: desactiva; `confirm_name` trim, 1–200, `TEXT_RULES.free`.

Cuerpo inválido: 400 `invalid_status`. Ejecuta `deactivateOrganization` o `reactivateOrganization` dentro de `withTransaction` con `organizationAdminLock(id)`. Respuesta `{ ok: true }`. Si la organización ya está en el estado pedido, el dominio retorna sin escribir y el endpoint responde igualmente `{ ok: true }` (en la desactivación, **antes** de comparar `confirm_name`).

### 4.7 `GET /v1/platform-admin/dashboard`

Seis conteos en paralelo con `overrideAccess: true`:

```
{ organizations: { total, active },
  active_offices,
  agents: { active, online },
  pending_incidents }
```

| Campo | Cálculo |
|---|---|
| `organizations.total` | todas las organizaciones |
| `organizations.active` | `is_active: true` |
| `active_offices` | oficinas `is_active: true`, de todas las organizaciones (incluye las de organizaciones inactivas que conserven oficinas activas; no ocurre tras `deactivateOrganization`, que las desactiva) |
| `agents.active` | agentes `is_active: true` |
| `agents.online` | agentes `is_active: true` con `last_heartbeat_at` entre `now - 600 s` y `now` |
| `pending_incidents` | `inventory-incidents` con `status: 'pending'` |

Sin errores propios más allá de 401 y 403. Las organizaciones inactivas cuentan en `total` y no en `active`; la UI muestra "inactivas" como `max(0, total - active)`.

### 4.8 Perfil del administrador de plataforma

`GET` lee el documento de `admins` por `ctx.userId` y devuelve `{ name: admin.name ?? '', email }`. `PATCH` valida `PlatformAdminProfileSchema` (`name`: trim, 2–120, `TEXT_RULES.personName`; otro cuerpo, 400 `invalid_profile` con `issues`), actualiza solo `admins.name` con `overrideAccess: true` y devuelve `{ name, email }`. La escritura no abre transacción propia. El correo no es editable. El comentario `AUDIT:` del endpoint marca el punto de enganche (§7.4).

### 4.9 Listado de organizaciones

`listOrganizations` llama `listResource<Organization>('/api/organizations', { depth: '1', asOrganization })` y `listResource` recorre todas las páginas (`sort: 'id'`, `limit: 100`, hasta que `hasNextPage` sea falso; si una página vacía anuncia más páginas, lanza error). El resultado depende de `orgScopedAccess` (§2.1). No hay paginación en la UI: el filtro por nombre y estado es local.

## 5. Reglas por operación

### 5.1 Alta de organización (`createOrgWithAdmin`)

Si se la invoca sin una transacción activa en el request, abre una (`payload.db.beginTransaction`) y la confirma o revierte; con un `req` que ya tiene `transactionID` la reutiliza y no confirma (es dueña del commit quien la abrió; así la compone `scripts/seed-navigation.ts`). Todo el alta es atómico. Orden de escritura, todo con `overrideAccess: true`:

1. `organizations`: `name`, `is_active: true`.
2. `organization-settings` y `subscriptions`, lanzados con `Promise.all` sobre la misma transacción. Ajustes: `industry`, `industry_details` (solo si hay), `assessment_policy_key: 'essential'`, `assessment_policy_version: 2`, `assessment_policy_selected_at: ahora`. Suscripción: `level`, `max_offices` y `user_limits` copiados de `getSubscriptionLimits(plan)` y `features: defaultFeatures()`. El `plan` por omisión del dominio es `basic` (para los seeds); el endpoint siempre envía el plan.
3. `organizations` se actualiza con los ids de `settings` y `subscription`.
4. `offices`: primera oficina `is_active: true`, nombre `first_office.name` (por defecto del dominio, "Casa central"), `province_id` y `department_id` si vienen.
5. `reconcileAssessmentInstance` con `'initial'` para el sujeto organización y luego para el sujeto oficina (abre los assessments iniciales si la suscripción tiene `security_assessments`).
6. Busca el rol `org_admin`; si no está sembrado, lanza un `Error` plano ("Role org_admin no sembrado").
7. Normaliza el correo (trim y minúsculas) y verifica que no exista en `users`: si existe, `AdminDomainError('email_unavailable', 409)`.
8. `users`: cuenta con `status: 'active'`.
9. `organization-memberships`: `role` org_admin, `offices: [primera oficina]`, `status: 'active'`, `is_active: true`. El hook `linkMembershipToUser` enlaza el usuario.

Cualquier fallo revierte todo (por ejemplo, un correo duplicado detectado en el paso 7 deshace la organización creada en el paso 1). Ver las pruebas en §11.

No hay verificación previa de nombre duplicado de organización.

### 5.2 Desactivación en cascada (`deactivateOrganization`)

Ejecuta en una sola transacción, con el lock `org-admin:<id>`. Orden:

1. Carga la organización (404 `organization_not_found`). Si ya está inactiva, retorna sin hacer nada.
2. Compara `confirm_name` con `name`, ambos con `trim`, sensible a mayúsculas (400 `confirmation_mismatch`).
3. Fija `deactivatedAt` (un único instante para la organización y todas las membresías que se den de baja).
4. Actualiza `organizations`: `is_active: false`, `deactivated_at`. Va primero porque el guard del último org_admin (`blockLastActiveOrgAdminOnUpdate`) no protege organizaciones inactivas.
5. Para **cada oficina de la organización, también las ya inactivas**: `revokeOfficeAgents(..., 'organization_deactivated')` (revoca los agentes no revocados) y `retireOfficeAssets(..., { includeManual: true })` (pasa a `status: 'retired'` los activos de red y manuales vigentes, uno por uno bajo `lockAssetRow`, para que corran los hooks de cada activo: según el comentario del dominio, cancelan sus tareas, cierran sus assessments y encolan el riesgo).
6. Dentro de `withDeferredTaskReleases`: cada membership activa pasa a `is_active: false` con `deactivated_at`. Los hooks de `organization-memberships` hacen el resto: `cascadeDeactivationToUser` pone el usuario en `status: 'inactive'`; el `beforeChange` de `users` (`revokeInactiveSessions`) vacía `sessions`, así que las sesiones se cierran y el login posterior falla (`rejectInactiveLogin`, 403); `releaseMemberResponsibilities` deja sin responsable los activos de la persona y encola la liberación de sus tareas en curso, que se ejecuta al terminar el bloque (`task-api.md` §7.3).
7. `cancelOpenTasks(req, { organizationId }, 'Organización desactivada.')`: cancela las tareas `pending` e `in_progress` restantes de la organización, con lock por tarea, en orden de id.
8. Para cada oficina: si estaba activa, `is_active: false`; y `reconcileAssessmentInstance` con `is_active: false` y razón `manual_review` (cierra el assessment abierto de la oficina). Al final, lo mismo para el sujeto organización.

Qué **no** cambia: las `features`, `level` y topes de la suscripción (decisión explícita del comentario: así reactivar puede abrir assessments sin pasar por el plan); los documentos de `users` y `organization-memberships` (no se borran, se desactivan); los ajustes de la organización; el historial de assessments y evaluaciones de riesgo ya guardadas.

La prueba de integración fija: 403 para un OrgAdmin, conteos del impacto, 400 ante nombre distinto, todas las oficinas y membresías inactivas, usuarios `inactive`, activos de red y manuales (incluso de una oficina ya inactiva) `retired`, agentes con `revocation_reason: 'organization_deactivated'`, tarea cancelada con `Organización desactivada.`, cero assessments abiertos y `features` intactas.

### 5.3 Reactivación (`reactivateOrganization`)

Reabre lo mínimo para operar:

1. Carga la organización; si ya está activa, retorna sin hacer nada.
2. Calcula en paralelo el OrgAdmin a reactivar y la lista de oficinas (orden `createdAt` ascendente).
3. Sin administrador: 409 `no_admin_available`. Sin oficinas: 409 `no_office_available`.
4. `organizations.is_active: true` (no limpia `deactivated_at`).
5. `reactivateOffice` sobre `offices[0]` (la oficina más antigua): valida `assertOrganizationActive` y `assertOfficeQuota` (409 `office_limit_reached`), la activa, abre su assessment (`office_reactivated`) y encola el recálculo de riesgo.
6. Si la membership del administrador sigue inactiva: `assertUserLimit` (409 `user_limit_reached`) y `is_active: true`. `enforceOrgAdminOffices` le asigna todas las oficinas de la organización (activas o no).
7. `users.status: 'active'` para ese administrador: la cascada de desactivación lo pasó a `inactive` y a propósito no se revierte sola.
8. `reconcileAssessmentInstance` del sujeto organización con `organization_reactivated`.
9. `enqueueRiskRecalculation` para la organización y la oficina reactivada.

**Quién es el OrgAdmin a reactivar** (`oldestAvailableAdmin`): solo si la organización tiene `deactivated_at`. Busca las membresías con rol `org_admin` de esa organización cuyo `deactivated_at` sea mayor o igual al de la organización (es decir, las que se dieron de baja **con** ella), ordenadas por `createdAt`, y elige la primera cuyo usuario todavía exista. Un administrador desactivado a mano antes no tiene `deactivated_at` o lo tiene anterior, y queda afuera.

**Qué no se restaura**: las demás personas (de cualquier rol), las demás oficinas, los agentes revocados, los activos dados de baja (`retired`), las tareas canceladas, y la membership de personas con otros roles. Cada cosa se reactiva por separado (`members-api.md`, `offices-api.md`, `scanner-api.md`, `assets-api.md`). La sesión del administrador reactivado no se recupera: las sesiones se cerraron en la desactivación y debe iniciar sesión de nuevo.

La prueba de integración cubre: solo vuelve el OrgAdmin más antiguo y la oficina más antigua, assessments `office_reactivated` y `organization_reactivated` abiertos, los activos `retired` siguen así, 409 `no_admin_available` sin administradores y que no revive a un OrgAdmin dado de baja antes de la organización.

### 5.4 Edición y alta de OrgAdmin

Ver §4.4 y §4.5. La edición no cambia plan, topes ni features: no hay operación para eso.

## 6. Catálogo de errores

Cuerpo de error de dominio: `{ error: <código>, message: <texto>, details }` (`adminErrorResponse`). Los errores de validación de los endpoints y los de autenticación usan `{ error: <código> }` y, para validación, `issues` de Zod (sin `message`). El cliente muestra el texto de `lib/user-facing-error.ts`, indexado por `error`.

| Código | HTTP | Cuándo |
|---|---|---|
| `unauthenticated` | 401 | Sin sesión, o admin inactivo |
| `forbidden` | 403 | No es PlatformAdmin, o está en contexto de visita (§3.1); perfil: no es PlatformAdmin |
| `invalid_organization` | 400 | Cuerpo inválido en alta o edición (`issues`) |
| `invalid_member` | 400 | Cuerpo inválido en alta de OrgAdmin (`issues`) |
| `invalid_status` | 400 | Cuerpo inválido al cambiar estado (`issues`) |
| `invalid_profile` | 400 | Cuerpo inválido en perfil (`issues`) |
| `organization_not_found` | 404 | Organización inexistente en `status-impact` o `status`; ruta de alta de OrgAdmin sin id |
| `not_found` | 404 | `GET .../:id` de una organización inexistente |
| `organization_settings_missing` | 409 | La organización no tiene ajustes (detalle y edición) |
| `organization_inactive` | 409 | Editar o sumar un OrgAdmin a una organización inactiva |
| `confirmation_mismatch` | 400 | `confirm_name` distinto del nombre al desactivar |
| `no_admin_available` | 409 | Reactivar sin OrgAdmin elegible |
| `no_office_available` | 409 | Reactivar sin oficinas |
| `office_limit_reached` | 409 | La oficina a reactivar excede `max_offices` |
| `user_limit_reached` | 409 | Tope de personas del rol (alta de OrgAdmin adicional, reactivación) |
| `email_unavailable` | 409 | El correo ya existe en `users` (alta de organización y de OrgAdmin) |
| `rank_escalation` | 403 | Invariante de `organization-memberships` |
| `last_active_org_admin` | 409 | Invariante de `organization-memberships` |
| `invalid_request` | según el error | `APIError` público de un hook en cascada (por ejemplo, de activos) |

`adminErrorResponse` solo convierte `AdminDomainError`, `RankEscalationError`, `LastActiveOrgAdminError` y `APIError` con `isPublic`. **Cualquier otra excepción se vuelve a lanzar** y llega a Payload (ver §10). Un `AdminDomainError` sin mensaje usa el código como mensaje.

`lib/user-facing-error.ts` tiene texto para `organization_inactive`, `organization_not_found`, `organization_settings_missing`, `confirmation_mismatch`, `no_admin_available`, `no_office_available`, `office_limit_reached`, `user_limit_reached`, `email_unavailable` y `organization_context_required`. El alta de organización y de OrgAdmin no muestran aviso para `email_unavailable`: el formulario lo presenta junto al campo (§8.3).

## 7. Concurrencia, atomicidad y efectos del sistema

### 7.1 Lock por organización

`status`, `PATCH` y `org-admins` usan `withTransaction(payload, req, fn, { lockKey: organizationAdminLock(id) })`, con clave `org-admin:<organizationId>`. El mismo lock lo usan las acciones de Administración de personas y oficinas (`admin-actions.ts` lo documenta como lo que serializa altas, bajas y cambios de rol que de otro modo podrían saltear el tope del plan o dejar la organización sin org_admin). Detalle de `withTransaction`:

- Si el request no tiene transacción, abre una y es dueña del commit; si falla, hace rollback. Al final restaura `req.transactionID`.
- Con `lockKey` toma `pg_advisory_xact_lock(hashtextextended(<clave>, 0))`. Cuando es dueña de la transacción usa `pg_try_advisory_xact_lock`; si está ocupado, hace rollback, espera el lock en una transacción descartable y reinicia con un snapshot nuevo.
- Reintenta el comando completo (hasta tres intentos) ante conflictos `40001` o `40P01`.
- Falla con error si no hay transacciones PostgreSQL.

Un `POST .../status` es entonces atómico: o se aplica toda la cascada de §5.2 o ninguna. `POST /v1/platform-admin/organizations` (alta) no toma lock por organización: `createOrgWithAdmin` abre su propia transacción.

### 7.2 Dentro de la cascada

Los activos se retiran uno por uno con `lockAssetRow`; las tareas se cancelan con `withTaskLock` en orden de id; las liberaciones de tareas por desactivación de personas se aplazan hasta después de todas las escrituras de activos (orden activo → tarea, para evitar deadlocks). Ver `task-api.md` §7.1 y §7.3.

### 7.3 Escrituras fuera de transacción

El `PATCH` del perfil de plataforma y el `GET` del detalle no usan transacción; las lecturas de `operational-summary` y del panel son conteos independientes sin snapshot común.

### 7.4 Puntos de enganche pendientes

`organization.deactivate` es un trigger de `AUDIT` confirmado (comentario en `deactivateOrganization`, junto con `NOTIFY` para plataforma y OrgAdmin de la organización). También llevan `AUDIT:` la creación de la organización, ajustes y suscripción, oficina, usuario y membership en `createOrgWithAdmin`; la reactivación de la organización, la membership y el usuario; la edición de nombre y rubro (con `NOTIFY` a los administradores de la organización); y la edición del nombre del perfil de plataforma. AuditLog y Notification Bell **no existen aún**: son marcas, no código. Ver `SYSTEM_PROMPT.md`.

## 8. Frontend

### 8.1 Cadena

- Layout del StaffPortal: `app/(dashboard)/(protected)/layout.tsx` (guarda, menú e indicador de visita).
- Resumen: `app/(dashboard)/(protected)/page.tsx` muestra `PlatformDashboard`, que usa `usePlatformDashboard`.
- Organizaciones: `app/(dashboard)/(protected)/organizations/page.tsx`, con `OrganizationCreateModal`, `OrganizationEditModal`, `OrganizationStatusModal` y `RowActions` de `modules/organizations/components/`, y `modules/users/components/MemberCreateModal` para el alta de OrgAdmin adicional. Hooks: `modules/organizations/hooks/use-organizations.ts` y `modules/users/hooks/use-org-members.ts`; clientes: `modules/organizations/service.ts` y `modules/users/service.ts`, sobre `lib/http-client.ts` contra `/api/v1/platform-admin/...`.
- Cuenta: `app/(dashboard)/(protected)/account/page.tsx`, que usa `use-platform-admin-profile` y `modules/auth/service.ts`.

La guarda del layout es solo de cliente: mientras `useSession` y `useTenantContext` resuelven muestra un loader; si la sesión no es de `admins`, redirige a `/login`. El menú tiene tres entradas: "Resumen", "Organizaciones" y "Mensajes" (`portal-messages-api.md`). La cuenta (`/account`) usa `AccountProfileCard` y `AccountAccessCard` con el rol fijo `platform_admin`.

### 8.2 Consultas (TanStack Query)

| Hook | Clave | Notas |
|---|---|---|
| `useOrganizationsList(asOrganization)` | `['organizations', asOrganization]` | Vía `useListQuery`; recorre todas las páginas. |
| `useOrganizationOperationalSummary` | `['platform-admin', 'organizations', 'operational-summary']` | Refetch cada 60 s. |
| `useOrganizationDetails(id)` | `['organizations', 'details', id]` | Habilitada si hay `id`. |
| `useOrganizationStatusImpact(id)` | `['organizations', 'status-impact', id]` | `staleTime: 0`. Habilitada si hay `id`. |
| `usePlatformDashboard` | `['platform-admin', 'dashboard']` | Refetch cada 60 s. |
| `usePlatformAdminProfile` | `['platform-admin-profile']` | Habilitada solo si `session.collection === 'admins'`. |

### 8.3 Mutaciones

| Hook | Efecto |
|---|---|
| `useCreateOrganization` | Invalida `['organizations']` y `['platform-admin']`; aviso "Organización creada." El error `email_unavailable` no genera aviso: `OrganizationCreateModal` lo muestra en el campo del correo y vuelve a esa pestaña. |
| `useUpdateOrganizationDetails` | Invalida `['organizations']`, `['platform-admin']` y `['organization-settings']`; aviso "Organización actualizada." |
| `useSetOrganizationStatus` | Invalida `['organizations']` y `['platform-admin']`; aviso "Organización reactivada." o "desactivada." |
| `useCreatePlatformOrgAdmin(id)` | Invalida `['organizations']` y `['platform-admin']`; aviso "Administrador añadido." Sin aviso para `email_unavailable`. |
| `useUpdatePlatformAdminProfile` | Invalida `['platform-admin-profile']` y `['tasks']` (el nombre aparece en la actividad de tareas); aviso "Nombre actualizado". |

Los errores pasan por `showApiError`. Al desactivar, `OrganizationStatusModal` vuelve a pedir el impacto (`impact.refetch()`) si la mutación falla, y se cierra al tener éxito.

### 8.4 Comportamiento de las pantallas

- **Listado**: columnas "Nombre", "Oficinas activas", "Escáneres" (en línea / activos), estado y acciones. Las cifras salen de `operational-summary`: si la consulta falla, la celda muestra "—" y se ve un `Alert` rojo "No se pudo cargar el resumen operativo"; si tiene éxito y la organización no figura, muestra 0. La búsqueda por nombre y el filtro de estado son locales.
- **Acciones por fila**: abrir el portal de la organización (`/portal/dashboard?asOrganization=<id>`), editar (solo activas), desactivar o reactivar, y en un menú, añadir OrgAdmin (solo activas).
- **Crear**: modal de cuatro pestañas (organización, oficina, administrador, revisión). Valida con `OrganizationCreateSchema`; el plan por defecto del formulario es `basic`.
- **Desactivar**: carga `status-impact`; muestra los seis conteos, un aviso de qué se restaura al reactivar y exige escribir el nombre (comparación local con `trim`, igual que el servidor). **Reactivar**: muestra el administrador y la oficina que volverán; el botón queda deshabilitado si falta alguno.
- **Panel**: `MetricsStrip` con organizaciones (activas e inactivas), oficinas activas, agentes conectados de activos e incidentes pendientes; botón "Actualizar"; `Alert` si la consulta falla.

### 8.5 Contrato de tipos

`OrganizationStatusImpact` se importa del dominio (`domain/organizations/organization-lifecycle.ts`) en `service.ts`. `PlatformDashboardMetrics` y `OrganizationOperationalCounts` están definidos a mano en los services del cliente, sin derivarse de los endpoints. Los schemas de entrada se importan directamente de `modules/organizations/schema.ts`.

## 9. Cómo agregar una operación de plataforma

1. Schema de entrada en `modules/organizations/schema.ts`.
2. Función de dominio en `domain/organizations/`; lanzar `AdminDomainError` con código y estado.
3. Endpoint en `platformOrganizations.ts` con el guard `platformAdmin`, `handle(...)` y, si escribe, `withTransaction` con `organizationAdminLock`. Registrarlo en `platformOrganizationEndpoints` antes de cualquier ruta con `:id` que pueda capturarlo.
4. Comentarios `AUDIT` y `NOTIFY` en cada punto de escritura.
5. Cliente: función en `service.ts`, hook, invalidación de `['organizations']` y `['platform-admin']`.
6. Texto de los códigos nuevos en `lib/user-facing-error.ts`.
7. Prueba de integración sobre los endpoints (§11).

## 10. Comportamientos a tener presentes

Verificados en el código; no son necesariamente defectos.

1. **Organización inexistente en `PATCH` y en `org-admins`.** `assertOrganizationActive` hace `findByID` sin capturar el error de "no encontrado" de Payload, que no es un `AdminDomainError`; `adminErrorResponse` lo re-lanza. A diferencia de `GET .../:id` (404 `not_found`) y de `status-impact`/`status` (404 `organization_not_found`), el código de estas dos rutas depende de cómo Payload serialice el error y no se verificó con una prueba.
2. **`asOrganization` inexistente.** `getTenantContext` lanza `TenantResolutionError` sin captura en los endpoints: error 500 de Payload, no 4xx.
3. **Contexto de visita en la URL del portal de plataforma.** Como el cliente reenvía `asOrganization` desde `window.location.search` a todo request, estar en `/organizations?asOrganization=...` hace que los endpoints de plataforma respondan 403 y que el listado muestre una sola organización (§3.2).
4. **`deactivateOrganization` ya inactiva.** Retorna antes de validar `confirm_name`; el endpoint responde `{ ok: true }`. Igual con `reactivateOrganization` sobre una activa.
5. **Reactivar elige por antigüedad de oficina, no por actividad.** Toma `offices[0]` en orden `createdAt`, la oficina "más antigua", sin considerar si estaba activa antes de la desactivación. `deactivated_at` de la organización no se limpia al reactivar; un segundo ciclo lo sobrescribe y deja afuera a quienes quedaron inactivos del primero.
6. **Primer OrgAdmin sin chequeo de cupo.** Ni su membership ni la primera oficina pasan por `assertUserLimit` o `assertOfficeQuota` en `createOrgWithAdmin`; con los topes actuales (1 OrgAdmin, 3 o 10 oficinas) no hay conflicto.
7. **Planes sin cambio posterior.** `level`, topes y features solo se escriben al crear; el cupo de agentes lee `SUBSCRIPTION_LIMITS` por `level`, el de oficinas y personas lee el documento. Si alguien edita el documento, ambos pueden divergir.
8. **Cupo de agentes cuenta oficinas inactivas.** `getAgentQuota` usa `totalDocs` de oficinas sin filtrar por estado; el tope de oficinas de §2.4 cuenta solo activas.
9. **Errores no tipados.** Un rol `org_admin` no sembrado en el alta lanza un `Error` plano; `adminErrorResponse` lo re-lanza y llega como 500. Un conflicto de unicidad de Payload distinto de `email_unavailable` también.
10. **Estado del request tras el alta.** `createOrgWithAdmin` asigna `transactionID` sobre el `req` recibido (`Object.assign`) y no lo restaura al confirmar; `withTransaction`, en cambio, restaura `req.transactionID`. El endpoint de alta responde enseguida, de modo que no tiene efecto observable hoy.
11. **`asset_inventory` sin consumidor.** Está en `FEATURE_CATALOG` y en `defaultFeatures` pero no se encontró código que lo evalúe.
12. **Edición total.** `PATCH` exige `name` e `industry` siempre; no hay edición parcial.
13. **Sin listado propio.** El listado depende de la REST de Payload y del acceso `self`; cualquier cambio en `orgScopedAccess` o en la matriz de `organizations` lo afecta sin tocar estos endpoints.
14. **Tipos del cliente manuales.** `PlatformDashboardMetrics` y `OrganizationOperationalCounts` repiten a mano el contrato de los endpoints.

## 11. Cobertura de pruebas

Estado de cobertura automática; sin pruebas de extremo a extremo por ahora. Las pruebas de integración requieren una base PostgreSQL desechable; `organization-details.audit.integration.test.ts` valida que `DATABASE_URL` coincida con un patrón de base de pruebas.

| Prueba | Cubre |
|---|---|
| `endpoints/platformOrganizations.integration.test.ts` | Tres casos: desactivación completa (403 de OrgAdmin, `status-impact`, 400 por nombre, cascada sobre oficinas, personas, usuarios, activos, agentes, tareas, assessments, `features` intactas, reactivación mínima); 409 `no_admin_available`; no revive a un OrgAdmin dado de baja antes. |
| `endpoints/organization-details.audit.integration.test.ts` | `GET` y `PATCH` de detalle: rechazo anónimo y de cuentas de organización, rechazo en contexto de visita, actualización conjunta y limpieza de `industry_details`, campos inválidos o ajenos sin cambios, rollback del nombre si falla el ajuste, rechazo en organización inactiva. |
| `domain/organizations/update-organization-details.audit.test.ts` | Validaciones previas a la escritura y escritura solo de nombre y rubro en el mismo request. |
| `domain/organizations/createOrgWithAdmin.test.ts` | Orden de creación (con ajustes, suscripción y features por defecto), rollback total ante falla a mitad de secuencia, reutilización de la transacción de un `externalReq`. |
| `domain/subscriptions/features.audit.test.ts` | `normalizeFeatures`: clave ausente = incluida; `false` explícito se conserva; valores mal formados. |
| `domain/subscriptions/agent-quota.test.ts` | Límite de agentes: uno por oficina en Basic, dos en Premium. |
| `access/tenant/resolveTenantContext.test.ts` | Admin sin y con `asOrganization`, `officeIds` de la organización visitada, `throw` por organización inexistente, `asOrganization` ignorado en cuentas de `users`. |
| `lib/organization-request-context.audit.test.ts` | Reenvío de `asOrganization` en los requests del cliente. |
| `lib/list-resource.audit.test.ts` | Recorrido completo de páginas en `listResource`. |
| `collections/OrganizationMemberships/hooks/enforceOrgAdminOffices.test.ts`, `invariants.test.ts` | Asignación de todas las oficinas a un org_admin e invariantes de membership. |
| `domain/organizations/member-responsibilities.test.ts` | Aplazamiento de liberaciones de tareas (usado por la cascada). |

Sin cobertura automática encontrada para: `POST /v1/platform-admin/organizations` (alta por endpoint), `POST .../org-admins`, `GET .../operational-summary`, `GET /v1/platform-admin/dashboard`, el perfil de plataforma, `organizationStatusImpact` en estado inactivo con `admin: null`, los cupos de oficinas y personas aplicados a estos flujos, ni componentes del frontend.
