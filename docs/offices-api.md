# API de oficinas

Referencia técnica del feature `offices`: alta, edición, desactivación con destino de activos y reactivación de oficinas, su contrato HTTP, los efectos en tareas, riesgo, escáneres, personas y activos, y el selector global de oficina del frontend. Dirigida a quien mantiene o extiende el feature.

Verificado contra el código el 2026-10-31. Si algo de este documento contradice el código, gana el código: corregir el documento.

Documentos relacionados: `members-api.md` (cascada sobre personas), `task-api.md` (cancelación y movimiento de tareas), `assets-api.md` (activos de red y manuales), `scanner-api.md` (escáneres y su revocación; aprovisionamiento y resumen por oficina), `assessments-api.md` (revisión de seguridad por oficina), `risk-api.md` (recálculo) y `organizations-platform-api.md` (desactivación de una organización, que reutiliza parte de esta lógica).

## 1. Capas y archivos

| Capa | Archivo | Responsabilidad |
|---|---|---|
| Contrato | `modules/offices/schema.ts` | `OfficeInputSchema` (alta y edición), `OfficeStatusSchema` (activar y desactivar), `RETIRE_MANUAL_ASSET`. Fuente de verdad, compartida por formularios y endpoints. |
| Endpoints | `endpoints/offices.ts` | Cuatro endpoints de administración, exportados como `officeEndpoints`. |
| Dominio | `domain/offices/office-lifecycle.ts` | `createOffice`, `updateOfficeDetails`, `officeDeactivationImpact`, `deactivateOffice`, `reactivateOffice`, `loadOrganizationOffice`, `revokeOfficeAgents`, `retireOfficeAssets`. |
| | `domain/offices/active-offices.ts` | `findActiveOffices`: las oficinas que cuentan para riesgo, cobertura de personas y destinos de activos. |
| | `domain/organizations/admin-actions.ts` | `AdminDomainError`, `adminErrorResponse`, `assertOrganizationActive`, `organizationAdminLock`, `subscriptionLimits`. |
| | `domain/organizations/member-responsibilities.ts` | `withDeferredTaskReleases`. |
| | `domain/tasks/task-actions.ts` | `cancelOpenTasks`. |
| | `domain/assessments/reconcileAssessmentInstance.ts`, `domain/risk/enqueueRiskRecalculation.ts` | Revisión de la oficina y recálculo de riesgo. |
| Persistencia | `collections/Offices/index.ts`, `hooks/syncOrgAdminMemberships.ts` | Colección `offices`. Escritura cerrada. |
| Cliente HTTP | `modules/offices/service.ts` | Funciones sobre `lib/http-client.ts`. |
| Estado de servidor | `modules/offices/hooks/use-offices.ts` | TanStack Query. |
| UI | `modules/offices/components/*`, `modules/offices/offices.columns.tsx`, `office-deactivation.columns.tsx`, `app/portal/(protected)/administration/offices/page.tsx` | Presentación. |
| Alcance global | `modules/offices/components/OfficeSelector.tsx`, `modules/offices/office-risk-scope.ts`, `modules/offices/hooks/use-concrete-office-id.ts`, `lib/ui-store.ts` | Selector de oficina de la barra superior y su resolución para riesgo. |

Cadena de una acción de estado: `OfficeStatusModal` → `useSetOfficeStatus` → `service.ts` (`setOfficeStatus`) → `httpClient` → `endpoints/offices.ts` (`officeStatusEndpoint`) → `withTransaction` con lock de organización → `deactivateOffice` o `reactivateOffice`.

`modules/offices/service.ts` y `use-offices.ts` incluyen también el aprovisionamiento y la revocación de escáneres y el resumen de escáneres por oficina (`/v1/agents/provision`, `/v1/offices/agent-summary`, `/v1/agents/:id/revoke`). Esos endpoints pertenecen a `scanner-api.md` y no se describen aquí.

## 2. Modelo

### 2.1 Colección `offices`

Acceso: `create`, `update` y `delete` son `() => false`; `read` usa `orgScopedAccess('offices', 'read', { kind: 'org_offices', field: 'id' })`. Las escrituras pasan solo por los endpoints propios, con `overrideAccess: true`. La lectura (por la API REST de Payload, `/api/offices`) es de la organización del actor; los roles sin alcance organizacional ven solo las oficinas de su lista (`ctx.officeIds`).

| Campo | Tipo | Notas |
|---|---|---|
| `organization` | relación, requerido | Indexado. |
| `name` | text, requerido | |
| `province_id` | text, indexado | Código INDEC. Validación de colección: debe existir en `lib/argentina-geo`. |
| `department_id` | text | Debe pertenecer a `province_id`. |
| `is_active` | checkbox, por defecto `true` | Una oficina desactivada se conserva (historial); no se borra. |

La ubicación sale de `lib/argentina-geo.json` mediante `lib/argentina-geo.ts` (snapshot estático de Georef AR, sin servicio externo en ejecución): `PROVINCES`, `DEPARTMENTS`, `provinceName`, `departmentsOf`, `isDepartmentOf`, `locationLabel`. En la UI, el segundo selector se rotula "Comuna" para la provincia `02`, "Partido" para la `06` y "Departamento" en el resto.

Hook `afterChange` (`syncOrgAdminMemberships`): al **crear** una oficina, agrega su id a las `offices` de todas las membresías de rol `org_admin` de la organización (activas o no; `limit: 1000`).

### 2.2 Estados

| Estado | Significado |
|---|---|
| `is_active = true` | Cuenta para riesgo, para la cobertura de personas y como destino de activos. Admite escáneres. |
| `is_active = false` | Se conserva para historial. Sus activos de red están retirados, sus escáneres revocados, sus tareas canceladas y su revisión cerrada. No cuenta para el riesgo. |

`findActiveOffices` es la única definición de "oficina activa" que usan riesgo (`recalculateRisk`, `enqueueRiskRecalculation`), la cobertura de personas (`releaseMemberResponsibilities`), el reemplazo de responsable de activos y este feature.

### 2.2.1 Flujos

**Alta.** Un OrgAdmin envía nombre y provincia (y opcionalmente departamento). Bajo el lock de la organización, el dominio exige organización activa y cupo de oficinas activas del plan. Crea la oficina activa; el hook `syncOrgAdminMemberships` la agrega a todos los OrgAdmin; y se abre la revisión de seguridad de la oficina (`reconcileAssessmentInstance`, motivo `initial`) si la suscripción tiene el feature de revisiones y la política tiene preguntas para ese alcance. El alta no encola recálculo de riesgo.

**Edición.** Cambia nombre y ubicación. No toma el lock de organización, no abre transacción propia, no comprueba que la organización esté activa y también funciona sobre una oficina inactiva.

**Desactivación.** El cuadro de la UI primero consulta el impacto (§4.4), pide un destino para cada activo manual vigente (mover a otra oficina activa o dar de baja) y se confirma escribiendo el nombre de la oficina. El servidor toma el lock de la organización, relee la oficina dentro de la transacción y ejecuta todo en un solo paso: mueve o da de baja los activos manuales según lo decidido, da de baja los activos de red, revoca los escáneres, saca la oficina a las personas (y desactiva a quienes se quedan sin ninguna oficina activa), cancela las tareas que quedan, marca la oficina inactiva, cierra su revisión y encola el recálculo de riesgo de la organización. Si algo falla, no se aplica nada.

**Reactivación.** Marca la oficina activa y abre una nueva revisión de seguridad de la oficina. **No restaura nada de lo que hizo la desactivación**: ni escáneres (hay que instalar uno nuevo), ni personas (se reactivan desde Usuarios), ni activos movidos o dados de baja. Encola el recálculo de riesgo incluyendo la oficina.

**Impacto obsoleto.** Entre que la UI calculó el impacto y el usuario confirmó, los activos manuales pueden haber cambiado. El servidor exige que las decisiones recibidas cubran **exactamente** los activos manuales vigentes en ese momento; si no coinciden, responde 409 `impact_changed` y la UI recarga el impacto. Solo los activos manuales entran en esa comparación: los cambios en personas, escáneres, activos de red o tareas no se detectan y se aplican con el estado que haya al ejecutar.

## 3. Permisos y alcance

### 3.1 Matriz (`access/rbac/permissions.ts`, colección `offices`)

| Rol | Acciones |
|---|---|
| `org_admin` | `create`, `read`, `update` |
| `office_manager` | `read` |
| `org_viewer` | `read` |
| `platform_admin` sin organización | `read`; los endpoints de administración responden 403 (`canDo` niega acciones distintas de `read` sin organización) |
| `platform_admin` con `?asOrganization=` | se evalúa como `org_admin` |

`officeAdmin(req, action)` (`endpoints/offices.ts`) exige contexto activo y `canDo(ctx.role, 'offices', action, ctx.organizationId)`. Alta usa `create`; edición, impacto y estado usan `update`. Solo OrgAdmin (o PlatformAdmin visitando) administra oficinas; los Responsables y Observadores solo las leen.

Todas las operaciones se resuelven dentro de la organización del actor: `loadOrganizationOffice` responde 404 `office_not_found` si la oficina no existe **o es de otra organización**, sin distinguir.

### 3.2 Cuota de oficinas del plan

`assertOfficeQuota`: lee `max_offices` del documento `subscriptions` de la organización (`subscriptionLimits().maxOffices`; `null` = sin tope) y cuenta las oficinas **activas**. Si `activas >= tope`, 409 `office_limit_reached`. Se aplica en el alta y en la reactivación. `SUBSCRIPTION_LIMITS` (`basic` = 3, `premium` = 10) solo se usa al crear la organización, que copia el valor al documento de suscripción.

La UI muestra "N de M oficinas activas en tu plan" y deshabilita "Nueva oficina" cuando `activas >= max_offices` (`limits.max_offices` del contexto de sesión). No bloquea el botón de reactivar; el servidor responde 409 si no hay cupo.

## 4. Contrato HTTP

Prefijo `/api`. Cuerpos JSON. Un cuerpo ausente o inválido se parsea como `{}`. El cliente agrega `?asOrganization=` a las requests del portal; solo tiene efecto para PlatformAdmin.

| Método y ruta | Permiso | Entrada | Respuesta OK |
|---|---|---|---|
| `POST /v1/offices` | `offices.create` | `OfficeInputSchema` | 201 documento de la oficina |
| `PATCH /v1/offices/:id` | `offices.update` | `OfficeInputSchema` | 200 documento de la oficina |
| `GET /v1/offices/:id/deactivation-impact` | `offices.update` | — | 200 `OfficeDeactivationImpact` |
| `POST /v1/offices/:id/status` | `offices.update` | `OfficeStatusSchema` | 200 `{ ok: true }` |

El listado y la lectura de oficinas no tienen endpoint propio: el cliente usa la API REST de Payload (`GET /api/offices?depth=1`, `listOffices`), sujeta al acceso de §2.1. Esa respuesta incluye las oficinas inactivas; el filtrado es del cliente (§8.2).

Los endpoints no comprueban feature flags de suscripción. Los errores pasan por `adminErrorResponse`.

### 4.1 `POST /v1/offices` y `PATCH /v1/offices/:id`

`OfficeInputSchema`:
- `name`: trim, 1–120, regla `label` (letras, números, espacios y `. , - _ ' ( ) / #`).
- `province_id`: string no vacío; debe existir en el snapshot, o `province_id` inválida con "Provincia inválida.".
- `department_id`: string no vacío, `null` u omitido; si viene, debe pertenecer a la provincia.

El esquema es completo: la edición también exige nombre y provincia. Validación fallida: 400 `invalid_office` con `issues`.

Alta: `createOffice` en `withTransaction` con lock de organización. Orden: `assertOrganizationActive` (409 `organization_inactive`), `assertOfficeQuota` (409 `office_limit_reached`), creación con `is_active = true`, `reconcileAssessmentInstance`. Respuesta: la oficina creada.

Edición: `loadOrganizationOffice` (404 `office_not_found`) y `updateOfficeDetails` (`payload.update` con `name`, `province_id`, `department_id`). Sin transacción ni lock explícitos desde el endpoint. La UI envía siempre `department_id` (`null` para limpiarlo); una llamada directa que omita el campo no lo envía a la actualización.

### 4.2 `GET /v1/offices/:id/deactivation-impact`

Calcula lo que pasaría al desactivar (sin escribir nada). No toma lock ni transacción. Respuesta (`OfficeDeactivationImpact`):

| Campo | Contenido |
|---|---|
| `agents` | Escáneres no revocados de la oficina. Se revocarán. |
| `members_without_office` | Personas activas cuya **única** oficina activa es esta. Se desactivan. `{ user_id, name, email, role }`. |
| `members_losing_office` | Personas activas que conservan otra oficina activa. Solo pierden esta. |
| `network_assets` | Cantidad de activos de red vigentes (ni `retired` ni con `deleted_at`). Se dan de baja. |
| `manual_assets` | Activos manuales vigentes: `{ id, name, category, owner_name, open_tasks }`. Cada uno necesita una decisión. |
| `open_tasks` | Tareas abiertas (`pending` o `in_progress`) de la oficina **sin contar** las de sus activos manuales ni las de sus revisiones. Se cancelan. |
| `open_assessment` | Hay una revisión de la oficina abierta (`pending` o `in_progress`). Se cierra. |
| `destination_offices` | Oficinas activas distintas de esta: los destinos posibles. |

Los OrgAdmin no figuran en `members_*`: cubren todas las oficinas, activas o no. `open_tasks` de cada activo manual cuenta las tareas cuya entidad relacionada es el activo o una de sus revisiones; esas tareas siguen la decisión sobre el activo (se mueven con él, o se cancelan si se da de baja).

### 4.3 `POST /v1/offices/:id/status`

`OfficeStatusSchema` es una unión discriminada por `is_active`:
- `{ is_active: true }`: sin más campos.
- `{ is_active: false, confirm_name, manual_asset_decisions }`: `confirm_name` (trim, 1–120, regla `free`), `manual_asset_decisions` (por defecto `[]`, hasta 5000) con `{ asset_id: uuid, destination: uuid | 'retire' }`. `RETIRE_MANUAL_ASSET = 'retire'` indica dar de baja.

El esquema usa la regla `free` para `confirm_name` y no `label` porque el nombre guardado puede venir de un administrador o del seed con caracteres que `label` rechaza; si no, esa oficina no podría desactivarse.

Validación fallida: 400 `invalid_status` con `issues` (sin texto en `user-facing-error.ts`). El endpoint corre en `withTransaction` con lock de organización y delega en `reactivateOffice` o `deactivateOffice`, que releen la oficina dentro de la transacción. Respuesta: 200 `{ ok: true }`.

Idempotencia: desactivar una oficina que ya está inactiva, o reactivar una activa, retorna sin error y sin cambios (no valida el resto del cuerpo en ese caso).

## 5. Reglas por operación

### 5.1 Desactivar (`deactivateOffice`)

Orden de verificaciones (el primer fallo gana):

1. `loadOrganizationOffice` → 404 `office_not_found`. Si ya está inactiva: retorna.
2. Última oficina activa: si hay una sola oficina activa y es esta, 409 `last_active_office`.
3. `confirm_name` (comparado con `trim` contra el nombre guardado, sensible a mayúsculas) → 400 `confirmation_mismatch`.
4. Decisiones: deben cubrir exactamente los activos manuales vigentes, sin repetidos ni ajenos → 409 `impact_changed`.
5. Destinos: cada `destination` distinto de `retire` debe estar entre las oficinas activas **distintas de esta** → 400 `invalid_destination`.

No se comprueba organización activa en la desactivación.

Efectos, en este orden (todo en la misma transacción):

| Paso | Efecto | Quién lo hace |
|---|---|---|
| 1 | Activos manuales con destino: `office = destino`, `owner = null`, `location = null`, bajo `systemOwnerRelease`. Lock de fila por activo. Los hooks del activo cierran su revisión, abren una en el destino y mueven sus tareas marcándolas `requires_reassignment`. | `moveManualAssets` |
| 2 | Activos manuales con `retire`: `status = retired`. | `retireAssets` |
| 3 | Activos de red vigentes: `status = retired` (sin `deleted_at`: pueden reactivarse). Solo se escribe `status`. Los hooks cancelan sus tareas, cierran sus revisiones y encolan riesgo. | `retireOfficeAssets` con `includeManual: false` |
| 4 | Escáneres no revocados: `buildRevocationData('office_deactivated')`. | `revokeOfficeAgents` |
| 5 | Membresías activas con esta oficina, excepto `org_admin`: si no les queda otra oficina activa, `is_active = false` (cascada: cuenta inactiva, sesiones cerradas, activos y tareas liberados); si les queda, se les quita esta oficina de `offices` (los activos y tareas de esta oficina quedan liberados). | `deactivateOffice` dentro de `withDeferredTaskReleases` |
| 6 | Tareas `pending` e `in_progress` que quedan en la oficina: `cancelled`, motivo "Oficina desactivada.". | `cancelOpenTasks` |
| 7 | `offices.is_active = false`. | `deactivateOffice` |
| 8 | Revisión abierta de la oficina: `superseded`. | `reconcileAssessmentInstance` (`is_active: false`, motivo `manual_review`) |
| 9 | Recálculo de riesgo de la organización (sin oficinas puntuales). | `enqueueRiskRecalculation` |

Orden: todas las escrituras de activos van antes que las de tareas (lock de fila del activo, luego lock de tarea), igual que la ingesta de escaneos y el `PATCH` de un activo, para no cruzar locks. Por eso las liberaciones de tareas de las personas se aplazan al final del bloque de membresías (`withDeferredTaskReleases`), y `cancelOpenTasks` corre después de mover los activos manuales: las tareas de esos activos ya cambiaron de oficina y no se cancelan.

Los `org_admin` no se modifican: conservan el id de la oficina inactiva en su lista (`enforceOrgAdminOffices` les asigna todas las oficinas de la organización, incluidas las inactivas).

### 5.2 Reactivar (`reactivateOffice`)

Orden: relee la oficina (404 `office_not_found`); si ya está activa, retorna; `assertOrganizationActive` (409 `organization_inactive`); `assertOfficeQuota` (409 `office_limit_reached`). Escribe `is_active = true`, abre la revisión de la oficina (`reconcileAssessmentInstance`, motivo `office_reactivated`) y encola el recálculo de riesgo con `[officeId]`.

No restaura: escáneres revocados, membresías desactivadas o con la oficina quitada, activos movidos o dados de baja, ni tareas canceladas. Los activos de red retirados quedan `retired` (su reactivación individual es una decisión aparte). La oficina vuelve a ser visible de inmediato a los OrgAdmin, que nunca la perdieron.

### 5.3 Qué hace cada efecto sobre otras áreas

- **Tareas**: `cancelOpenTasks(req, { organizationId, officeId }, 'Oficina desactivada.')` busca las tareas abiertas de esa oficina, las ordena por id y las cancela una por una bajo `withTaskLock` (`cancelled_by` = actor del sistema). Las tareas con `office = null` (organización completa) no se tocan.
- **Riesgo**: `recalculateRisk` usa solo `findActiveOffices`. Desactivar saca los activos de la oficina de la exposición de la organización; reactivar la vuelve a contar.
- **Escáneres**: se revocan con razón `office_deactivated`. En la UI, el aviso dice que los escáneres se detienen solos en menos de 5 minutos y que, para quitarlos del equipo, hay que desinstalarlos a mano.
- **Revisión de seguridad**: la revisión abierta de la oficina pasa a `superseded` al desactivar; al reactivar se abre una nueva si la suscripción y la política la admiten. Las revisiones de los activos las gestionan los hooks de cada activo.

## 6. Catálogo de errores

Cuerpo de error: `{ error: <código>, message: <texto>, details? }`. Los de validación: `{ error, issues }`. `adminErrorResponse` solo convierte `AdminDomainError` (más las excepciones de invariantes de membresía y los `APIError` públicos de hooks). **Cualquier otra excepción se relanza** y llega a Payload como 500 sin código.

| Código | HTTP | Cuándo |
|---|---|---|
| `unauthenticated` | 401 | Sin contexto activo |
| `forbidden` | 403 | Sin la acción `offices.*` requerida, o sin organización |
| `invalid_office` | 400 | Cuerpo de alta o edición inválido (`issues`) |
| `invalid_status` | 400 | Cuerpo de estado inválido (`issues`). Sin texto en `user-facing-error.ts` |
| `office_not_found` | 404 | La oficina no existe o es de otra organización |
| `organization_inactive` | 409 | Alta o reactivación en una organización inactiva |
| `office_limit_reached` | 409 | Tope de oficinas activas del plan (alta o reactivación) |
| `last_active_office` | 409 | Desactivar la única oficina activa |
| `confirmation_mismatch` | 400 | El nombre escrito no coincide |
| `impact_changed` | 409 | Las decisiones sobre activos manuales no coinciden con los activos vigentes. La UI recarga el impacto |
| `invalid_destination` | 400 | Destino que no es una oficina activa distinta de la desactivada |
| `invalid_request` | según el `APIError` | Regla pública de un hook de activos o membresías en cascada. Sin texto propio |
| `last_active_org_admin`, `rank_escalation` | 409, 403 | Provenientes de hooks de membresía; no deberían alcanzarse en este flujo, porque los OrgAdmin no se modifican |

## 7. Concurrencia, atomicidad y efectos del sistema

### 7.1 Lock de organización y transacción

Alta y cambio de estado corren en `withTransaction(payload, req, fn, { lockKey: organizationAdminLock(organizationId) })`. La clave `org-admin:<organizationId>` es la misma que usan altas, bajas y cambios de rol de personas, y las acciones de plataforma sobre esa organización. Es un lock de asesoría por transacción de PostgreSQL: si está ocupado, el comando se revierte, espera fuera de la transacción y reinicia con una instantánea nueva (detalle en `members-api.md` §7.1).

Consecuencias:
- Dos altas simultáneas no pueden pasar el tope de oficinas (el conteo y la creación quedan serializados).
- Una desactivación no se cruza con altas o bajas de personas de la misma organización.
- La **edición de datos** (`PATCH`) no toma el lock ni abre transacción propia.
- El endpoint de impacto no toma lock: puede quedar desactualizado, y por eso la comparación de `impact_changed` (§2.2.1).

La desactivación es atómica en todo lo que escribe: movimiento y baja de activos, escáneres, membresías, tareas, oficina, revisión y encolado de riesgo. Si algo lanza, se revierte toda la transacción (por ejemplo, un hook de un activo que rechaza el movimiento).

### 7.2 Cascadas

La desactivación recorta o desactiva personas escribiendo la membresía directamente (`organization-memberships`), lo que dispara los hooks de §3.6 de `members-api.md`: `users.status = inactive` con sesiones cerradas, y `releaseMemberResponsibilities`, que libera activos y tareas de la oficina perdida. Esa liberación se aplaza con `withDeferredTaskReleases` hasta terminar las escrituras de activos (ver `members-api.md` §7.2).

La desactivación de una organización reutiliza `revokeOfficeAgents` y `retireOfficeAssets` (con `includeManual: true`) de este archivo; su flujo propio está en `organizations-platform-api.md`.

### 7.3 Puntos de enganche pendientes

Las operaciones llevan comentarios `// AUDIT:` y `// NOTIFY:` en cada punto de escritura (alta, edición, desactivación, reactivación, revocación de escáneres, baja y movimiento de activos, cascada de membresías). AuditLog y Notification Bell **no existen aún**: son marcas, no código. Ver `SYSTEM_PROMPT.md`.

## 8. Frontend

### 8.1 Cadena de la página de administración

- Página: `app/portal/(protected)/administration/offices/page.tsx`. Cuelga de `administration/layout.tsx`: 404 si el contexto no es de OrgAdmin efectivo (control del cliente; el servidor aplica el suyo).
- Componentes: `OfficeFormModal` (alta y edición, con validación `OfficeInputSchema` en el cliente), `OfficeStatusModal` (`DeactivateOffice` y `ReactivateOffice`), `RowActions`, `AgentProvisionModal`, `office-deactivation.columns.tsx` (tabla de decisiones por activo manual).
- Hooks: `use-offices.ts`. Cliente: `service.ts`.

La página consulta con `includeInactive: true` y filtra en el cliente por texto (nombre y ubicación) y por estado (el control de estado solo aparece si hay alguna inactiva). Las oficinas se muestran en una tabla con ubicación (`locationLabel`) y estado del escáner por oficina.

`OfficeStatusModal` al desactivar: carga el impacto (`useOfficeDeactivationImpact`); muestra totales (escáneres, activos de red, activos manuales con cuántos se mueven o se dan de baja o están sin decidir, tareas canceladas y personas desactivadas); para cada activo manual exige una decisión (por fila o en bloque; mover o dar de baja); lista las personas que se desactivan y las que pierden la oficina; y habilita "Desactivar oficina" solo con el nombre escrito coincidente y todas las decisiones tomadas. Las tareas canceladas que muestra suman las de la oficina y las de los activos manuales dados de baja. Si el servidor rechaza (por ejemplo, `impact_changed`), recarga el impacto. Al reactivar, muestra el aviso de que no se restaura nada más.

### 8.2 Consultas (TanStack Query)

| Hook | Clave | Notas |
|---|---|---|
| `useOfficesList(asOrganization, { includeInactive })` | `['offices', asOrganization]` | Misma clave con y sin `includeInactive`: el filtrado de inactivas se hace en `select` (`activeOnly`), no en la consulta. Solo la administración pide las inactivas. |
| `useOfficeDeactivationImpact(officeId, asOrganization)` | `['office-deactivation-impact', officeId, asOrganization]` | Habilitada con `officeId`; `staleTime: 0`. |
| `useOfficeAgentSummary(asOrganization)` | `['office-agent-summary', ...]` | Fuera de este documento. |
| `useTenantContext(asOrganization)` | `['tenant-context', asOrganization]` | Fuente de `officeIds`, `orgWide`, `limits.max_offices`. |

### 8.3 Mutaciones

| Hook | Efecto |
|---|---|
| `useSaveOffice(asOrganization)` | Alta o edición (según `id`). Aviso "Oficina creada." u "Oficina actualizada.". No define `onError`: el formulario captura el error y lo muestra con `userFacingErrorMessage`. |
| `useSetOfficeStatus(asOrganization)` | Aviso "Oficina reactivada." u "Oficina desactivada."; en error, `showApiError`. |

Ambas invalidan el mismo conjunto (`invalidateOfficeScope`): `offices`, `office-agent-summary`, `tenant-context`, `org-members`, `assets`, `non-network-assets`, `tasks`, `assessments`, `risk`, `dashboard-metrics`.

### 8.4 Selector global de oficina (`OfficeSelector`)

Vive en la barra superior (`app/portal/(protected)/layout.tsx`). La selección es un filtro transversal, no un destino de navegación.

- **Almacenamiento**: `useUiStore` (`lib/ui-store.ts`, Zustand con `persist`, clave `siam.ui-store` en `localStorage`) guarda `selectedOfficeId` (`null` = todas las oficinas) y `sidebarCollapsed`. La selección persiste entre sesiones y organizaciones. Los hooks de listados (`use-assets`, `use-non-network-assets`, `use-scan-reports`, `use-snapshots`, `use-inventory-incidents`, `use-dashboard-metrics`, y las páginas de tareas e inventario) la leen para armar sus claves y parámetros; el store nunca se escribe desde el resultado de una consulta.
- **Opciones**: `officeIds` del contexto de sesión intersecado con las oficinas activas del listado. "Todas las oficinas" aparece solo si el usuario tiene más de una oficina en `officeIds`.
- **Normalización** (efecto con el contexto cargado): si `selectedOfficeId` no pertenece a `officeIds` (por ejemplo, otra organización tras cambiar `?asOrganization=`), se reemplaza por la única oficina o por `null`; si es `null` y hay exactamente una oficina, se selecciona esa.
- **Roles**: `officeIds` de un OrgAdmin (o de un PlatformAdmin visitando) incluye todas las oficinas de la organización, también las inactivas (`resolveTenantContext` las lista sin filtrar y `enforceOrgAdminOffices` las asigna). El selector normaliza contra `officeIds`, no contra las oficinas activas: una selección que pasó a ser una oficina inactiva sigue siendo válida para esa normalización, aunque ya no aparece entre las opciones.

### 8.5 Alcance de riesgo (`office-risk-scope` y `useConcreteOfficeId`)

`officeRiskScope(tenant, selectedOfficeId)` (puro) separa el filtro de listados del alcance de una evaluación de riesgo, que necesita una oficina concreta salvo que el rol sea de alcance organizacional o tenga el permiso `assignedOfficeRisk`:
- `officeId`: la oficina seleccionada si está en `officeIds`; o la única oficina del usuario si la selección es `null` y solo tiene una; si no, `null`.
- `requiresOfficeSelection`: el usuario no tiene alcance organizacional ni consolidación asignada, no hay `officeId` y tiene más de una oficina.
- `ready`: hay contexto, no se requiere selección, y la selección es `null` o resolvió a una oficina propia.

`useConcreteOfficeId(asOrganization)` lee el parámetro `officeId` de la URL (admite `all` solo para alcance organizacional), lo copia al store si el usuario puede usarlo, y devuelve `officeRiskScope`. Lo usan `dashboard`, `risk-score` y `security-review`. `OfficeRiskSelectionNotice` es el aviso "Selecciona una oficina para ver el riesgo", que reemplaza el contenido cuando `requiresOfficeSelection` es verdadero. El filtro global "Todas las oficinas" no se sustituye por una oficina concreta: los listados siguen mostrando todas las oficinas asignadas.

## 9. Comportamientos a tener presentes

Verificados en el código; no son necesariamente defectos.

1. **La edición no está serializada.** `PATCH /v1/offices/:id` no usa el lock de organización ni comprueba la organización activa y funciona sobre oficinas inactivas.
2. **`impact_changed` solo vigila activos manuales.** Personas, escáneres, activos de red y tareas se leen al ejecutar; el cuadro de impacto puede mostrar cifras distintas de las aplicadas.
3. **Estado repetido sin error.** Desactivar una oficina ya inactiva o reactivar una activa devuelve 200 sin validar el cuerpo.
4. **Alta sin recálculo de riesgo.** `createOffice` no encola recálculo; `reactivateOffice` y `deactivateOffice` sí.
5. **Los OrgAdmin conservan oficinas inactivas.** Sus listas de `offices` (y el `officeIds` de su contexto) incluyen oficinas desactivadas. `findActiveOffices` y la UI de administración de usuarios las ignoran, pero el selector global normaliza contra `officeIds`.
6. **Tareas de organización completa.** `cancelOpenTasks` por oficina solo toca tareas con esa oficina; las de `office = null` quedan. Lo mismo ocurre con la liberación de tareas reclamadas al quitar una oficina a una persona.
7. **Personas desactivadas por oficina.** Quien se queda sin oficinas activas se desactiva aunque su membresía conserve el id de la oficina desactivada en `offices`.
8. **Activos manuales movidos.** Llegan sin responsable ni ubicación, sus tareas se marcan para reasignación y la comprobación de destino exige una oficina activa distinta (mover a la misma oficina da `invalid_destination`).
9. **Lectura por REST.** El listado usa la API de Payload; para roles sin alcance organizacional devuelve solo las oficinas de `officeIds`; a las personas sin alcance organizacional la desactivación les quita la oficina de esa lista (paso 5 de §5.1).
10. **Aprovisionar escáneres en oficinas inactivas.** La UI deshabilita "Instalar escáner" sobre una oficina inactiva sin escáneres (`RowActions`); la regla del servidor pertenece a `scanner-api.md`.

## 10. Cobertura de pruebas

Estado de cobertura automática; sin pruebas de extremo a extremo por ahora.

| Prueba | Cubre |
|---|---|
| `modules/offices/schema.test.ts` | `OfficeStatusSchema`: reactivar sin campos, desactivar con nombre y decisiones (mover o `retire`), lista vacía por defecto, destinos que no son ids, nombres con símbolos aceptados y caracteres de control rechazados |
| `modules/offices/office-risk-scope.audit.test.ts` | `officeRiskScope`: Responsable con varias oficinas, OrgAdmin organizacional, oficina seleccionada, única oficina, oficina ajena, contexto aún sin cargar, consolidación asignada |
| `collections/Offices/hooks/syncOrgAdminMemberships.test.ts` | Una oficina nueva se propaga a las membresías `org_admin` |
| `endpoints/offices.integration.test.ts` | Alta con ubicación válida e inválida y rechazo a quien no es OrgAdmin, tope del plan, impacto, `confirmation_mismatch`, `impact_changed`, `invalid_destination`, desactivación en un paso (activos de red retirados, activo manual dado de baja y otro movido con su tarea, tareas canceladas, escáneres revocados, persona sin oficinas inactiva), reactivación sin cascada |
| `endpoints/member-manager-status.audit.integration.test.ts`, `endpoints/memberLifecycle.integration.test.ts` | Efectos de la cascada sobre personas, activos y tareas (ver `members-api.md`) |
| `endpoints/officeAgentSummary.integration.test.ts`, `officeAgentSummary.test.ts` | Resumen de escáneres por oficina (ver `scanner-api.md`) |

Las pruebas de integración requieren una base PostgreSQL desechable. No hay prueba de la edición sobre una oficina inactiva, ni de la normalización del selector de oficina cuando la oficina elegida se desactiva, ni de concurrencia entre dos desactivaciones.
