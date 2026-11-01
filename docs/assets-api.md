# API de activos

Referencia técnica del feature de inventario de activos: activos de red (`assets`, alimentados por el escáner), activos manuales (`non-network-assets`) y las excepciones de inventario (`inventory-incidents`). Cubre contrato HTTP, reglas de dominio, permisos, concurrencia, efectos del sistema y la cadena que lo conecta con el frontend. Dirigida a quien mantiene o extiende el feature.

Verificado contra el código el 2026-10-31. Si algo de este documento contradice el código, gana el código: corregir el documento.

Fuera de alcance, documentado en otros archivos: la ingesta de reportes del escáner y los snapshots de inventario (`scanner-api.md`), el cálculo de riesgo (`risk-api.md`), las revisiones de seguridad (`assessments-api.md`), las tareas (`task-api.md`), el alta/baja de miembros (`members-api.md`) y la desactivación de oficinas (`offices-api.md`). Aquí solo se describe cómo esos módulos tocan a los activos.

## 1. Capas y archivos

| Capa | Archivo | Responsabilidad |
|---|---|---|
| Contrato | `modules/assets/schema.ts` | Schemas Zod del activo de red: `AssetBusinessUpdateSchema` (lo usa el endpoint `business`), `AssetIdentificationSchema` (lo usa `identify`), `AssetIdentificationFormSchema` y `normalizeAssetIdentificationForm` (solo formulario), `createAssetBusinessFieldsSchema` (solo formulario). |
| | `modules/non-network-assets/schema.ts` | `NonNetworkAssetFieldsSchema` y `createNonNetworkAssetSchema`. **Solo lo usa el cliente** (§4.7). |
| | `domain/assessments/assessment-scope-schema.ts` | Campos y reglas de la exclusión de revisión (`AssessmentScopeFieldsSchema`, `validateAssessmentScope`), compartidos por ambos tipos de activo. |
| Endpoints propios | `endpoints/assetBusiness.ts` | `PATCH /v1/assets/:id/business`. |
| | `endpoints/assetIdentify.ts`, `endpoints/assetUnidentify.ts` | `PATCH /v1/assets/:id/identify` y `/unidentify`. |
| | `endpoints/nonNetworkAssetReview.ts` | `PATCH /v1/non-network-assets/:id/review`. |
| | `endpoints/softwareSuggestions.ts` | `GET /v1/software-suggestions`. |
| | `endpoints/inventoryIncidents.ts` | `POST /v1/inventory-incidents/:id/resolve`. |
| | `domain/assets/logical-delete.ts` | `DELETE /api/assets/:id` y `DELETE /api/non-network-assets/:id` (endpoint de colección `logicalDeleteEndpoint`), más los hooks `rejectPhysicalAssetDelete` y `preserveDeletedAsset`. |
| Registro | `payload.config.ts` | Registra los endpoints sueltos y los jobs `aging-sweep` y `reconcile-expired-asset-exclusions`. |
| Colecciones | `collections/Assets/index.ts` y `collections/Assets/hooks/*` | Activo de red. |
| | `collections/NonNetworkAssets/index.ts`, `invariants.ts`, `categoryGroups.ts`, `categoryGroupRules.ts`, `hooks/*` | Activo manual. |
| | `collections/InventoryIncidents/index.ts` | Excepciones de inventario. |
| Dominio | `domain/assets/asset-types.ts` | Tipos de activo de red (`SCANNED_ASSET_TYPE_VALUES`), categorías manuales (`MANUAL_ASSET_CATEGORY_VALUES`) y `CATEGORY_HAS_SOFTWARE`. |
| | `domain/inventories/asset-identity.ts` | Clasificación de MAC y clave de identidad (`assetIdentityKey`). La usa la ingesta. |
| | `domain/inventories/inventory-incidents.ts` | `recordInventoryIncident`, la única que crea incidentes. La invoca la ingesta. |
| | `domain/inventories/agingSweep.ts` | Paso `active` a `offline` por antigüedad de `last_seen`. |
| | `domain/assessments/validateAssetAssessmentScope.ts`, `reconcileAssessmentInstance.ts`, `reconcileExpiredAssetExclusions.ts`, `asset-assessment-scope.ts` | Exclusión de revisión y su reconciliación con las revisiones abiertas. |
| | `domain/tasks/reconcile-asset-tasks.ts` | Hook `afterChange` que ajusta tareas (ver `task-api.md` §7.3). |
| | `domain/organizations/member-responsibilities.ts`, `lib/system-context.ts` | Liberación y reasignación de responsables por ciclo de vida de personas. |
| | `domain/offices/office-lifecycle.ts` | Baja y traslado de activos por desactivación de oficina. |
| | `domain/with-transaction.ts` | `withTransaction`, `transactionLock`, `lockAssetRow`. |
| | `access/tenant/assertOwnerCoversOffice.ts`, `assertOrganizationMatches.ts` | Validación del responsable y de la organización de la fila. |
| Cliente HTTP | `modules/assets/service.ts`, `modules/non-network-assets/service.ts` | Funciones sobre `lib/http-client.ts` y `lib/list-resource.ts`. |
| Estado de servidor | `modules/assets/hooks/*`, `modules/non-network-assets/hooks/*` | TanStack Query. |
| UI | `modules/assets/components/*`, `modules/non-network-assets/components/*`, `app/portal/(protected)/inventory/page.tsx`, `app/portal/(protected)/inventory/[id]/page.tsx` | Presentación. |

Las subrutas `inventory/scan-reports` e `inventory/snapshots` pertenecen a `scanner-api.md`.

Hay dos familias de operaciones. Las **propias** (endpoints de la tabla) llevan su lógica en el handler o en hooks de colección y escriben con `overrideAccess: true`. Las **genéricas** son la API REST de Payload sobre las colecciones: lectura (`GET /api/assets`, `GET /api/non-network-assets`, `GET /api/inventory-incidents`) y, para activos manuales, alta y edición (`POST` y `PATCH /api/non-network-assets`). Las reglas de las genéricas viven en `access` de colección, `access` de campo y hooks.

## 2. Modelo

### 2.1 Colección `assets` (activo de red)

Acceso de colección: `create` y `delete` son `() => false` (un activo de red lo crea solo la ingesta con `overrideAccess`, y se da de baja con el endpoint lógico). `read` y `update` usan `orgScopedAccess('assets', ..., { kind: 'org_offices', field: 'office' })`: organización de la fila; los roles sin alcance organizacional además quedan limitados a `office in ctx.officeIds`.

Los campos se dividen por quién puede escribirlos:

**Bloque técnico.** Tiene `access.update: () => false` (`technicalFieldAccess`), de modo que ni la API REST ni un cliente pueden modificarlo. Lo escriben la ingesta del escáner y el `agingSweep`, con `overrideAccess`. Incluye: `location_pending`, `port_scan_coverage`, `scanner_asset_id`, `identity_key` (único), `asset_id` (único, requerido), `agent`, `office`, `organization`, `observed_agents`, `ip`, `last_observed_cidr`, `last_seen`, `gateway_ip`, `gateway_mac`, `mac`, `mac_metadata`, `vendor`, `hostname`, `names`, `is_scanner_host`, `scanner_host_match`, `asset_coverage`, `scan_issues`, `evidence_history`, `applied_report_ids`, `os`, `os_candidates`, `os_status`, `state_reason`, `host_scripts`, `services`, `inferred_type`, `inference_confidence`, `inference_signals`, `inference_version`. `host_scripts` y `services[].scripts` además tienen `read` restringido por `readTechnicalEvidence`.

`office` y `organization` se derivan del agente autenticado en la ingesta; nunca vienen del usuario.

**Estado de identificación, también bloqueado a la API REST.** `confirmed_type`, `authorization_status`, `type_confirmed_by` y `type_confirmed_at` tienen `technicalFieldAccess`: solo los escriben `identify` y `unidentify` (con `overrideAccess`) y `business` (solo `authorization_status`).

**Bloque de negocio.** `alias` (≤ 120), `criticality` (`low` | `medium` | `high` | `critical`), `owner` (relación a `users`), `location` (≤ 200), `status` (`active` | `retired` | `offline`, por defecto `active`) y los campos de exclusión de revisión (`assessment_scope`, `assessment_exclusion_reason`, `assessment_exclusion_note`, `assessment_excluded_until`; `assessment_excluded_at` y `assessment_excluded_by` son de servidor). Son editables por la API REST con permiso `update`, pero la vía prevista es el endpoint `business`.

**Estado de identificación, solo de servidor.** `identified` (checkbox) e `identification_status` (`pending` | `confirmed` | `needs_review`) declaran `access.update: false`. Un `PATCH /api/assets/:id` que los incluya los descarta sin error. Solo los escriben `identify`, `unidentify`, la ingesta (`needs_review`) y el seed, todos con `overrideAccess`.

**Marcas de interfaz.** `first_viewed_at` y `technical_changed_at` (§2.4.3). Tampoco declaran `access` de campo.

**Baja lógica.** `deleted_at`: `create` y `update` en `false` a nivel de campo; solo lo escribe `logicalDeleteEndpoint` con `overrideAccess`.

### 2.2 Colección `non-network-assets` (activo manual)

Acceso de colección: `create` usa `canDoAccess` (solo el permiso, sin fila), `read` y `update` usan `orgScopedAccess` con el mismo alcance `org_offices` por `office`, `delete` es `() => false`. La baja se hace con `logicalDeleteEndpoint`.

| Campo | Tipo | Notas |
|---|---|---|
| `alias` | text, requerido, ≤ 120 | |
| `asset_category` | select, requerido | 16 valores de `MANUAL_ASSET_CATEGORY_VALUES`. Enum fijo en código. |
| `product_details` | grupo: `software_vendor` (≤ 120), `software_product` (≤ 240), `software_version` (≤ 120) | Corresponde a las categorías con grupo `product_details` (§5.3). `software_vendor` y `software_product` están indexados. |
| `cloud_details` | grupo: `kind` (`productivity_identity` \| `infrastructure` \| `domain_dns`), `vendor` (≤ 120) | Categoría `cloud_asset`. |
| `repository_details` | grupo: `kind` (`source_code` \| `secrets_vault` \| `corporate_email` \| `database` \| `other_digital`) | Categoría `information_repository`. |
| `notes` | textarea, ≤ 1000 | |
| `software_part` | select `a` \| `o`, oculto | Por defecto `a`. |
| `cpe_candidate` | text, ≤ 500, indexado | Derivado en `beforeChange` (§5.3). `create` y `update` en `false`. |
| `criticality` | select, requerido | |
| `owner` | relación a `users` | Obligatorio al crear; solo el sistema lo deja en `null` (§2.5). |
| `location` | text, ≤ 200 | |
| exclusión de revisión | los mismos seis campos que `assets` | |
| `status` | `active` \| `retired` | No admite `offline`. |
| `review_interval` | select requerido, por defecto `never` | `never`, `1d`, `3d`, `1w`, `1m`, `6m`, `1y`. |
| `next_review_at` | date | Derivado del intervalo; `create` y `update` en `false`. |
| `last_reviewed_at` | date | Lo escribe solo el endpoint `review`; `create` y `update` en `false`. |
| `review_status` | virtual (`afterRead`) | `ok` \| `overdue` según `next_review_at < now`. |
| `can_review` | virtual (`afterRead`) | Ver §5.4. |
| `related_assets` | relación múltiple a `assets` | Marcador sin lógica de correlación hoy. |
| `office` | relación, requerida | |
| `organization` | relación, requerida | Derivada de la oficina; `create` y `update` en `false`. |
| `last_updated_at` | date | Lo fija el hook en cada escritura. |
| `deleted_at` | date, indexado | Igual que `assets`. |
| `seed_key` | text, único, oculto | Solo seeds. |

Una escritura que traiga un campo con `create`/`update` en `false` por la API REST lo descarta; los hooks y los endpoints propios sí los escriben porque usan `overrideAccess`.

### 2.3 Colección `inventory-incidents`

Acceso: `create`, `update` y `delete` en `() => false`; `read` con `orgScopedAccess('assets', 'read', { kind: 'org_offices', field: 'office' })`. El filtro de oficina se aplica al campo `office` (la oficina actual del activo), no a `proposed_office`.

| Campo | Notas |
|---|---|
| `incident_key` | text, único, requerido. SHA-256 de `organization`, `kind` y `asset` (o `office:ip` si no hay activo). |
| `organization`, `office` | `office` es la oficina en la que el sistema conserva el activo. |
| `proposed_office` | Oficina donde el escáner observó el activo (solo `kind = location`). |
| `asset`, `agent` | Relaciones opcionales. |
| `kind` | `location` \| `identity`. |
| `status` | `pending` \| `moved` \| `kept` \| `reviewed`, por defecto `pending`, indexado. |
| `reason` | text, ≤ 500. |
| `ip`, `report_id`, `observed_at` | Evidencia de la observación. |
| `resolved_at`, `resolved_by` | Los fija `resolve`. `resolved_by` es polimórfico (`users` \| `admins`). |

`recordInventoryIncident` crea o actualiza el incidente. Si el existente tiene `observed_at` posterior a la observación nueva, devuelve el existente sin escribir. Si el existente está en `kept` y su `proposed_office` coincide con el de la observación, también lo devuelve sin reabrirlo. En otro caso escribe con `status: 'pending'`. Quién la invoca y en qué condiciones se detalla en `scanner-api.md`.

### 2.4 Estados

#### 2.4.1 Activo de red

Tres ejes independientes:

| Eje | Campo | Valores | Quién lo cambia |
|---|---|---|---|
| Presencia | `status` | `active`, `offline`, `retired` | `active` a `offline`: solo la ingesta y `agingSweep` (marcador `context.systemJob`). `offline` a `active`: la ingesta cuando vuelve a observar el activo (`scanner-api.md`). `active`/`offline` a `retired` y `retired` a `active`: edición manual, retiro en cascada por oficina (`retireOfficeAssets`) o baja lógica. |
| Identificación | `identification_status` + `identified` | `pending` (por defecto), `confirmed`, `needs_review` | `identify` los pone en `confirmed` y `true`; `unidentify` en `pending` y `false`. `needs_review` existe en el enum; ningún endpoint de este alcance lo escribe. |
| Autorización | `authorization_status` | `pending` (por defecto), `authorized`, `unauthorized` | `identify`, `business` y la ingesta al crear. |

`identified` e `identification_status` se escriben siempre juntos en los endpoints, pero son dos columnas. La interfaz decide con `identification_status === 'confirmed'`; el filtro "Identificación" de la tabla usa `identified`.

Baja lógica: `deleted_at` presente implica `status = 'retired'` (lo escribe `logicalDeleteEndpoint`). `preserveDeletedAsset` impide, en una fila con `deleted_at`, poner un `status` distinto de `retired` o modificar `deleted_at` (409 con el mensaje "Un activo eliminado conserva su baja y su historial."). Un activo retirado sin `deleted_at` sí puede reactivarse.

#### 2.4.2 Activo manual

`status` (`active` | `retired`) y `deleted_at`, con las mismas reglas de baja lógica. Reactivar (`retired` a `active`) exige oficina activa (§5.5). El estado de revisión (`review_status`, `can_review`) es virtual y se calcula al leer; no hay job de vencimiento de revisiones.

#### 2.4.3 Marcas "NEW" y "CHANGED" del activo de red

`first_viewed_at`: `null` = nunca visto; la interfaz lo fija una vez al entrar al detalle y no se reinicia. `technical_changed_at`: lo fija la ingesta cuando un activo ya visto (`first_viewed_at` no nulo) cambia su bloque técnico, y la interfaz lo vuelve a `null` al entrar al detalle. Ambos se escriben por la API REST genérica (§4.8), no por endpoint propio.

#### 2.4.4 Flujos

**Activo detectado hasta identificado.** La ingesta crea el activo con `identification_status = 'pending'`, `authorization_status = 'pending'` y `identified = false`. Mientras no está confirmado, `rejectBusinessEditsBeforeIdentified` rechaza cualquier cambio a `alias`, `location`, `criticality`, `owner`, `confirmed_type` y `authorization_status` (400, mensaje que enumera los campos en conflicto), salvo el marcador de sistema `systemJob` y la liberación de responsable del sistema (§2.5). `identify` confirma tipo y autorización en una sola escritura: fija `confirmed_type`, `authorization_status`, `identified = true`, `identification_status = 'confirmed'`, `type_confirmed_by` (`actorRelation`, que distingue `users` de `admins`) y `type_confirmed_at`. Con `authorization_status = 'authorized'` aplica `owner` y `criticality` del cuerpo; con `unauthorized` fuerza ambos a `null`. Como el cambio de `confirmed_type` dispara `reconcileAssessmentApplicability`, un activo identificado como `workstation` recibe su revisión de seguridad (§7.3).

**Editar un activo identificado.** `business` acepta cualquier subconjunto de `authorization_status`, `alias`, `criticality`, `owner`, `location`, `status` y los cuatro campos de exclusión. Si queda `unauthorized`, `enforceAuthorizationInvariant` limpia `owner` y `criticality` aunque no vengan en el cuerpo.

**Activo sin identificar.** `business` responde 409 `asset_not_identified` si el cuerpo toca cualquier campo fuera de los cuatro de exclusión de revisión. Es decir, un activo sin identificar solo admite cambios de exclusión por este endpoint, incluido `status` (el endpoint lo rechaza aunque el hook de colección deja `status` fuera del gate; §10).

**Quitar la identificación.** `unidentify` fija `identified = false` e `identification_status = 'pending'` y **no** borra `alias`, `location`, `criticality`, `owner`, `confirmed_type` ni `authorization_status`: quedan guardados para precargar una nueva identificación y dejan de contar en lo que filtra por `identified` o `confirmed` (riesgo, snapshots). El endpoint no valida estado previo: sobre un activo ya `pending` es una escritura sin efecto. No emite recálculo de revisión (§7.3).

**Conflicto de ubicación.** Cuando la ingesta observa un activo ya conocido desde otra oficina, conserva la oficina actual, crea un incidente `location` con `status = 'pending'` y pone `location_pending = true` en el activo (`scanner-api.md`). `resolve` con `move` traslada el activo a `proposed_office` y toma `agent` del incidente; con `keep` deja el activo donde está y baja `location_pending`; en ambos casos el incidente queda `moved` o `kept` con `resolved_at` y `resolved_by`. Un incidente `kept` hace que las observaciones siguientes de esa misma oficina propuesta solo refresquen la presencia, sin reabrir el incidente.

**Datos contradictorios.** Si un reporte trae observaciones distintas para la misma IP, la ingesta rechaza esas observaciones y crea un incidente `identity` sin activo. `resolve` con `reviewed` lo cierra; no modifica ningún activo.

**Activo manual.** Se crea con `POST /api/non-network-assets` (oficina y responsable obligatorios), se edita con `PATCH /api/non-network-assets/:id` (el formulario manda todos los campos), y se confirma su revisión con `review`. Cambiar de categoría limpia los grupos de detalle que ya no corresponden. Cambiar de oficina exige un responsable que cubra la nueva oficina.

**Baja lógica.** `DELETE` cancela por el hook `reconcileAssetTasks` las tareas abiertas que referencian al activo, cierra sus revisiones (hook de aplicabilidad), encola el recálculo de riesgo y conserva el documento, sus resultados de cumplimiento y las contribuciones de riesgo históricas. El activo deja de aparecer en los listados del frontend (`where[deleted_at][exists]=false`) y en los nuevos snapshots (`createInventorySnapshot` filtra `deleted_at`).

### 2.5 Responsable (`owner`)

| Aspecto | Activo de red | Activo manual |
|---|---|---|
| Obligatoriedad | Opcional. Solo tiene sentido con `authorization_status = 'authorized'`. | Obligatorio al crear (`Selecciona un responsable.`). |
| Valor `null` | Lo pone `identify` (si `unauthorized`), `enforceAuthorizationInvariant`, `identify`/`business` cuando el usuario lo declara desconocido, o el sistema. | Solo el sistema (§2.5.1). Una persona puede conservar un `null` existente al editar otros campos, pero no elegirlo. |
| Pertenencia | `validateOwnerTenant` (beforeChange): si el cuerpo trae `owner`, `assertOwnerCoversOffice` con la organización y oficina **del documento original**. | `resolveTenantAndReview`: se valida si cambia el responsable o la oficina. |
| `assertOwnerCoversOffice` | Membership activa en la organización del activo (400, "no tiene una membership activa en esta organización"); si el rol no tiene alcance organizacional, la oficina del activo debe estar en sus oficinas (400, "no pertenece a la oficina del activo"). | Igual. |

`assertOwnerCoversOffice` es compartida. No exige que el usuario esté activo a nivel de `users`, solo la membership activa. Un responsable que quedó desactivado no bloquea editar otros campos del activo: se valida solo cuando el `owner` o la oficina cambian.

#### 2.5.1 Liberación por el sistema

Cuando una persona se desactiva o pierde una oficina, `releaseOwnedAssets` (en `member-responsibilities.ts`) deja `owner = null` en sus activos de esa oficina (o de todas), uno por uno para que corran los hooks, bajo `lockAssetRow`. Lo hace dentro de `withSystemContext(req, 'systemOwnerRelease', ...)`, que activa `req.context.systemOwnerRelease` solo mientras corre la escritura. Ese marcador:
- En activos manuales, permite `owner = null` (el hook de otro modo lo rechaza).
- En activos de red no identificados, es la única excepción de `rejectBusinessEditsBeforeIdentified` y solo cuando el único campo tocado es `owner` y pasa a `null`.

`reassignOwnedAssets` pasa los activos al reemplazo solo si no están retirados, están en oficina activa y son manuales o de red con `identification_status = 'confirmed'`. Los demás se liberan. Los hooks validan que el reemplazo cubra la oficina; si no, toda la operación revierte. `ownedAssets` ignora los activos con `deleted_at`.

El traslado de activos manuales por desactivación de oficina (`moveManualAssets`) escribe `office`, `owner = null` y `location = null` también bajo `systemOwnerRelease`; el hook no exige responsable nuevo en ese caso, pero el activo queda con tareas marcadas `requires_reassignment` (§7.3).

## 3. Permisos y alcance

### 3.1 Matriz (`access/rbac/permissions.ts`)

| Rol | `assets` | `non-network-assets` |
|---|---|---|
| `org_admin` | `read`, `update`, `delete` | `create`, `read`, `update`, `delete` |
| `office_manager` | `read`, `update` | `create`, `read`, `update` |
| `org_viewer` | `read` | `read` |
| `platform_admin` sin organización | `read` | `read` |
| `platform_admin` con `?asOrganization=` | se evalúa como `org_admin` | se evalúa como `org_admin` |

`canDo` devuelve `false` para `platform_admin` sin organización en cualquier acción distinta de `read`. `inventory-incidents` no tiene entrada propia: el endpoint `resolve` y la lectura usan el permiso `update` y `read` de `assets`.

`create` sobre `assets` no existe en la matriz a propósito. `delete` sobre ambos lo tiene solo `org_admin` (y `platform_admin` con organización).

### 3.2 Alcance de organización y oficina

Todos los endpoints propios resuelven `getTenantContext(req)`; sin contexto o con `isActive` falso responden 401 `unauthenticated`. Luego se comprueba el permiso (403 `forbidden`).

`ctx.officeIds` de un `org_admin` incluye todas las oficinas de su organización (el hook `enforceOrgAdminOffices` de `organization-memberships` se las asigna); para un `platform_admin` con `asOrganization`, son todas las oficinas de esa organización. Por eso `assertOfficeInScope` (que compara con `ctx.officeIds` sin distinguir rol) alcanza para ambos roles.

Los endpoints `business`, `identify`, `unidentify` y `review` aplican, en este orden: cargar la fila (404 `not_found` si no existe), `assertOfficeInScope` y `assertOrganizationMatches`. Estas dos funciones lanzan `APIError` (403, mensaje visible) en lugar de devolver un 404: **un activo de otra oficina o de otra organización responde 403, no 404**. En cambio `resolve` y la baja lógica responden **404** `not_found` para organización o oficina ajenas. Los parámetros `unrestricted` de esas funciones se calculan como `isPlatformAdmin && !organizationId`, caso que ya cortó `canDo`; en estos endpoints no se alcanza.

`software-suggestions` es el único que se acota solo por organización, nunca por oficina (dos sedes comparten proveedores; ver §4.6).

**Organización inactiva: solo lectura.** Toda escritura de un usuario sobre activos de una organización inactiva (en la práctica, un PlatformAdmin que la visita con `?asOrganization=`) responde 409 `organization_inactive`. Se aplica en dos capas: los endpoints propios (`business`, `identify`, `unidentify`, `review`, `resolve`, baja lógica) llaman a `organizationWriteError` y responden `{ error: 'organization_inactive' }`; el hook `rejectWritesInInactiveOrganization` (§5.1) cubre además el REST genérico y cualquier escritura futura, y responde `{ errors: [{ message, data: { code: 'organization_inactive' } }] }`. No aplica sin usuario (ingesta del escáner, jobs) ni sin organización visitada (cascadas del StaffPortal, que retiran activos al desactivar). Las lecturas siguen respondiendo.

### 3.3 Feature flags

El catálogo de features (`domain/subscriptions/features.ts`) incluye `asset_inventory`, pero **ningún endpoint ni pantalla del inventario lo verifica**. Los endpoints de este documento no devuelven `feature_disabled`. Otros features sí inciden en efectos sobre activos: `security_assessments` (si está apagado, `reconcileAssetAssessmentInstance` no crea ni modifica revisiones) y `tasks`.

### 3.4 Campos técnicos y de negocio por vía de escritura

| Vía | Campos que acepta |
|---|---|
| `PATCH /v1/assets/:id/business` | Solo `AssetBusinessUpdateSchema` (`.strict()`); un campo técnico responde 400 `invalid_business_data`. |
| `PATCH /v1/assets/:id/identify` | Solo `AssetIdentificationSchema` (`.strict()`). |
| `PATCH /api/assets/:id` (REST) | Los campos sin `access.update: false`: bloque de negocio, `first_viewed_at`, `technical_changed_at`. Pasa por los hooks de §5.1. |
| `POST` y `PATCH /api/non-network-assets` | Todos los campos salvo los que tienen `create`/`update` en `false`. |

## 4. Contrato HTTP

Prefijo `/api`. Cuerpos JSON. El cliente agrega `?asOrganization=` automáticamente a cada request cuando está en la URL del portal (`lib/organization-request-context.ts`); solo tiene efecto para PlatformAdmin.

| Método y ruta | Permiso | Entrada | Respuesta OK |
|---|---|---|---|
| `GET /assets`, `GET /assets/:id` | `read` sobre `assets` | query estándar de Payload | Respuesta de Payload |
| `PATCH /v1/assets/:id/business` | `update` sobre `assets` | `AssetBusinessUpdateSchema` | 200 documento `assets` |
| `PATCH /v1/assets/:id/identify` | `update` sobre `assets` | `AssetIdentificationSchema` | 200 documento `assets` |
| `PATCH /v1/assets/:id/unidentify` | `update` sobre `assets` | — | 200 documento `assets` |
| `PATCH /assets/:id` (REST) | `update` sobre `assets` | campos de §3.4 | Respuesta de Payload |
| `DELETE /assets/:id` | `delete` sobre `assets` | — | 200 `{ doc, message }` |
| `GET /non-network-assets` | `read` | query estándar | Respuesta de Payload |
| `POST /non-network-assets` | `create` | campos de §2.2 | Respuesta de Payload (`{ doc, message }`) |
| `PATCH /non-network-assets/:id` | `update` | campos de §2.2 | Respuesta de Payload |
| `PATCH /v1/non-network-assets/:id/review` | `update` sobre `non-network-assets` | — | 200 documento |
| `DELETE /non-network-assets/:id` | `delete` | — | 200 `{ doc, message }` |
| `GET /v1/software-suggestions` | `read` sobre `non-network-assets` | — | 200 `{ vendors, products }` |
| `GET /inventory-incidents` | `read` sobre `assets` | query estándar | Respuesta de Payload |
| `POST /v1/inventory-incidents/:id/resolve` | `update` sobre `assets` | `{ decision }` | 200 documento `inventory-incidents` |

Los endpoints `business`, `identify`, `unidentify` y `review` devuelven el resultado crudo de `payload.update` (el documento), sin envoltorio. `DELETE` devuelve `{ doc, message }`. Estas respuestas usan `depth: 0` (relaciones como ids). Si un agente llega expandido en cualquier otra lectura, solo trae `office`, `organization`, `lifecycle_status` y `last_heartbeat_at` (`defaultPopulate` de `agents`); `apiKeyHash` es un campo `hidden` y nunca sale en una respuesta. Las rutas genéricas devuelven lo que corresponde a la API REST de Payload.

Formato de error: los handlers propios responden `{ error: <código> }` (más `issues` o `message` según el caso). Los `APIError` lanzados por hooks, por `assertOfficeInScope`, `assertOrganizationMatches` y `assertOwnerCoversOffice` los serializa Payload como `{ errors: [{ message, ... }] }`. `lib/http-client.ts` toma `code` de `errors[0].name` o `error`, y `message` de `errors[0].message`, `message` o `error`.

### 4.1 `PATCH /v1/assets/:id/business`

Cuerpo (`AssetBusinessUpdateSchema`, `.strict()`, todos opcionales):

| Campo | Regla |
|---|---|
| `authorization_status` | `authorized` \| `unauthorized` |
| `alias` | string, `trim`, ≤ 120, `TEXT_RULES.label`; admite `null` |
| `criticality` | `low` \| `medium` \| `high` \| `critical`; admite `null` |
| `owner` | string; admite `null`. Sin validación de formato en el schema. |
| `location` | string, `trim`, ≤ 200, `TEXT_RULES.label`; admite `null` |
| `status` | `active` \| `retired` \| `offline` |
| `assessment_scope` | `included` \| `excluded` |
| `assessment_exclusion_reason` | uno de `ASSESSMENT_EXCLUSION_REASON_VALUES`; admite `null` |
| `assessment_exclusion_note` | string, `trim`, ≤ 1000, `TEXT_RULES.free`; admite `null` |
| `assessment_excluded_until` | datetime ISO con offset; admite `null` |

Orden de verificaciones: sesión, permiso `update`, carga del activo (404), alcance de oficina y organización (403), parseo del cuerpo. Cuerpo inválido, con campos no permitidos o vacío (`{}`): 400 `invalid_business_data` con `issues` (vacío si el cuerpo era `{}`). Luego, si `identification_status !== 'confirmed'` y el cuerpo toca algún campo fuera de los cuatro de exclusión: 409 `asset_not_identified`. Después se escribe con `payload.update` y corren los hooks (§5.1).

Los errores de exclusión de revisión los emite `validateAssetAssessmentScope` como `ValidationError` de Payload (400). El schema Zod del endpoint no aplica `validateAssessmentScope`; esa validación vive en el hook y en el formulario.

### 4.2 `PATCH /v1/assets/:id/identify`

`AssetIdentificationSchema` (`.strict()`):

| Campo | Regla |
|---|---|
| `confirmed_type` | requerido, uno de `SCANNED_ASSET_TYPE_VALUES`: `workstation`, `mobile`, `gateway`, `network_device`, `printer`, `server`, `iot`, `other` |
| `authorization_status` | requerido, `authorized` \| `unauthorized` |
| `owner` | string o `null`, opcional. El literal `__unknown__` se rechaza. |
| `criticality` | `low` \| `medium` \| `high` \| `critical` o `null`, opcional |
| `alias` | igual que en `business`; opcional |
| `location` | igual que en `business`; opcional |

Cuerpo inválido: 400 `invalid_identification` con `issues`. Efecto: ver §2.4.4 y §5.2. No verifica `status`, `deleted_at` ni estado de identificación previo: se puede identificar de nuevo un activo ya confirmado, o identificar uno retirado.

### 4.3 `PATCH /v1/assets/:id/unidentify`

Sin cuerpo (el cliente envía `{}`; el endpoint no lo lee). Escribe `identified = false` e `identification_status = 'pending'` y devuelve el documento.

### 4.4 `POST /v1/inventory-incidents/:id/resolve`

Cuerpo: `ResolveInventoryIncidentSchema` (`.strict()`): `{ decision: 'move' | 'keep' | 'reviewed' }`. Un cuerpo ausente, no JSON o con campos extra: ver más abajo.

Requiere `ctx.organizationId` (un PlatformAdmin sin `asOrganization` recibe 403 `forbidden`). Se ejecuta en `withTransaction` y toma `transactionLock('inventory:<organización>')` antes de leer el incidente: serializa con la ingesta de la misma organización.

En orden:
1. Incidente inexistente, de otra organización, o, para quien no tiene alcance organizacional, con `office` o `proposed_office` fuera de `ctx.officeIds`: 404 `not_found`.
2. `status` distinto de `pending`: 409 `already_resolved`.
3. Decisión incompatible con el tipo: `reviewed` sobre `location`, o `move`/`keep` sobre `identity`: 400 `invalid_decision`.
4. `move`: el incidente debe ser `location` y tener `asset`, `proposed_office` y `agent`, o 400 `invalid_decision`. Se bloquea la fila del activo (`lockAssetRow`) y se relee: si tiene `deleted_at`, está `retired` o su oficina ya no es la del incidente, 409 `asset_changed`. La oficina destino debe estar activa y ser de la organización, o 409 `invalid_office`. El responsable se conserva si `assertOwnerCoversOffice` confirma que cubre la oficina destino; si lanza `OwnerOutOfScopeError`, el activo pasa a `owner = null`. Se escribe `office`, `agent` (el del incidente), `owner` y `location_pending = false`.
5. `keep`: escribe `location_pending = false` en el activo del incidente.
6. `reviewed`: no toca activos.
7. Se actualiza el incidente: `status` = `moved`, `kept` o `reviewed`, `resolved_at` y `resolved_by`. Responde 200 con el incidente.

Todo ocurre en una transacción; un fallo revierte el activo y el incidente.

Para el cuerpo, el handler llama `req.json?.()` sin `.catch`; un cuerpo vacío o no JSON lanza antes de la validación (§10). Un cuerpo JSON válido pero con otro formato responde 400 `invalid_input`.

### 4.5 `PATCH /v1/non-network-assets/:id/review`

Sin cuerpo. Carga el activo (404 `not_found`), alcance (403), y verifica `canReviewNow(next_review_at, review_interval, now)`: si no corresponde, 400 `review_not_due_yet`. Escribe `last_reviewed_at = now` con `context: { reviewConfirmed: true }`; el hook recalcula `next_review_at` desde `now` (§5.4). Devuelve el documento actualizado.

### 4.6 `GET /v1/software-suggestions`

Sin parámetros propios. Respuesta `{ vendors: string[], products: string[] }`, deduplicados (`Set`) y ordenados. Sin organización resuelta (PlatformAdmin sin `asOrganization`) responde 200 con ambas listas vacías, antes de comprobar el permiso. Con organización exige `read` sobre `non-network-assets` (403 `forbidden`). Lee hasta 5000 activos manuales de la organización con `product_details.software_vendor` existente, con `select` acotado a `product_details`, y deduplica en memoria. No filtra por `deleted_at` ni por `status`: los proveedores de activos retirados o dados de baja también se sugieren.

### 4.7 API REST de `non-network-assets`

`modules/non-network-assets/schema.ts` lo usan solo los formularios. El servidor valida con las reglas de campo de Payload (`required`, `maxLength`, opciones de `select`) y con los hooks de §5.3, §5.5 y §5.6; **no ejecuta `NonNetworkAssetSchema` ni aplica `TEXT_RULES.label` a `alias` o `location`** (verificado: ningún archivo de `collections/NonNetworkAssets` ni de `domain/assets` importa `TEXT_RULES`). Los errores de los hooks son `APIError` o `ValidationError` (400); los de grupos de categoría llevan `errors` con `path` (`product_details.software_vendor`, `cloud_details.kind`, etc.).

### 4.8 API REST de `assets` usada por la interfaz

Además de los endpoints propios, `modules/assets/service.ts` escribe en `PATCH /api/assets/:id` dos marcas: `first_viewed_at` (valor `now`) y `technical_changed_at` (valor `null`). Pasan por el `access.update` de colección (permiso `update` sobre `assets`, filtro de oficina) y por los hooks de §5.1.

### 4.9 Baja lógica (`DELETE /api/assets/:id`, `DELETE /api/non-network-assets/:id`)

Endpoint de colección (`logicalDeleteEndpoint(collection)`, path `/:id`). Requiere organización resuelta y permiso `delete` (solo `org_admin`; 403 `forbidden`). En `withTransaction`: `lockAssetRow`, carga el activo; inexistente, de otra organización o, para quien no tiene alcance organizacional, de una oficina fuera de `ctx.officeIds`: 404 `not_found`. Organización inactiva: 409 `organization_inactive`, también para un activo ya eliminado. Si ya tiene `deleted_at`: 200 con el documento y el mismo mensaje, sin escribir (idempotente). En otro caso escribe `status = 'retired'` y `deleted_at = now`, y responde `{ doc, message: 'Activo eliminado del inventario; historial conservado.' }`. En las dos ramas `doc` sale con `depth: 0`.

Una eliminación física (`payload.delete` o `DELETE` por `where`) falla en `rejectPhysicalAssetDelete` con 409 ("Los activos se eliminan lógicamente para conservar su historial."), además de que `access.delete` es `() => false`.

## 5. Reglas por operación

### 5.1 Hooks de `assets`

`beforeChange`, en este orden: `rejectWritesInInactiveOrganization`, `preserveDeletedAsset`, `validateOwnerTenant`, `rejectManualOfflineStatus`, `rejectBusinessEditsBeforeIdentified`, `enforceAuthorizationInvariant`, `validateAssetAssessmentScope`, `rejectRevivalInInactiveOffice`. `afterChange`: `reconcileAssessmentApplicability`, `reconcileAssetTasks`. Corren en toda escritura (endpoint propio, REST, ingesta, jobs, cascadas); los que distinguen al sistema usan `req.context`.

| Hook | Regla | Error |
|---|---|---|
| `rejectWritesInInactiveOrganization` | Con usuario y organización en el contexto (`ctx.organizationId`), la organización debe estar activa. Compartido con `non-network-assets`; vive en `domain/organizations/admin-actions.ts`. | 409 "La organización está inactiva. ..." (`data.code = 'organization_inactive'`) |
| `preserveDeletedAsset` | Con `deleted_at` en el original: no se acepta `status` distinto de `retired` ni cambiar `deleted_at`. | 409 "Un activo eliminado conserva su baja y su historial." |
| `validateOwnerTenant` | Si `data.owner` viene: `assertOwnerCoversOffice` con la organización y oficina del documento original. | 400 (§2.5) |
| `rejectManualOfflineStatus` | `status` pasa a `offline` sin `context.systemJob`. | 400 "El estado «sin conexión» solo puede establecerlo un proceso automático, no una edición manual." |
| `rejectBusinessEditsBeforeIdentified` | Si el documento no será identificado (`identification_status !== 'confirmed'` y `identified` falso tras la escritura), rechaza cambios efectivos (valor distinto del guardado) en `alias`, `location`, `criticality`, `owner`, `confirmed_type`, `authorization_status`. Excepciones: `context.systemJob`, y `context.systemOwnerRelease` cuando el único campo tocado es `owner` y pasa a `null`. | 400 "Este activo todavía no fue identificado: alias, ubicación, criticidad y responsable no se pueden editar hasta confirmarlo. Campo(s) en conflicto: ..." |
| `enforceAuthorizationInvariant` | Si el `authorization_status` efectivo no es `authorized`, deja `owner` y `criticality` en `null`. No reescribe `data` si ya están vacíos. | — |
| `validateAssetAssessmentScope` | Ver §5.6. | `ValidationError` 400 |
| `rejectRevivalInInactiveOffice` | Un activo `retired` que pasa a otro `status` en una oficina con `is_active === false`. | 400 "La oficina de este activo está inactiva: reactívala antes de reactivar el activo." |

`rejectBusinessEditsBeforeIdentified` considera identificado el documento si `identification_status` efectivo es `confirmed` o si `identified` efectivo es verdadero, por lo que una escritura que traiga ambas marcas a la vez (como `identify`) pasa el gate.

### 5.2 Identificar

Orden: sesión, permiso, carga (404), alcance (403), parseo (400 `invalid_identification`), escritura. El cuerpo se extiende con `owner` y `criticality` forzados a `null` cuando `authorization_status !== 'authorized'`; con `authorized`, `owner` y `criticality` son los del cuerpo y, si no vienen (`undefined`), `payload.update` no los modifica. `type_confirmed_by` usa `actorRelation(req, ctx.userId)`. `AUDIT:` marcador en el punto de escritura.

### 5.3 Hooks de `non-network-assets`: categoría y software

`beforeChange`: `preserveDeletedAsset`, `resolveTenantAndReview`, `validateAssetAssessmentScope`, `validateCategoryGroups`. `afterChange`: `reconcileAssessmentApplicability` (manual) y `reconcileAssetTasks`.

Categoría y grupos. `categoryGroupOf` mapea categoría a grupo: `antivirus_edr` y `software_license` a `product_details`; `cloud_asset` a `cloud_details`; `information_repository` a `repository_details`; el resto a ninguno. `resolveCategoryGroups` calcula el estado efectivo de cada grupo (lo enviado gana clave a clave, `null` limpia el grupo; lo ausente cae al original):
- Grupo activo: obligatorios `software_vendor` y `software_product` (`product_details`), `kind` (`cloud_details` y `repository_details`). Si faltan, `validateCategoryGroups` lanza `ValidationError` con `path` por campo ("Escribe el proveedor.", "Escribe el producto.", "Selecciona un tipo.").
- Grupos inactivos con contenido: se ponen todos sus subcampos en `null` (`clean`). Así cambiar de categoría no deja detalles huérfanos.

Software y CPE (en `resolveTenantAndReview`). `categoryHasSoftware` (`CATEGORY_HAS_SOFTWARE`: solo `antivirus_edr` y `software_license`) activa la identidad de software. Si el par proveedor/producto está incompleto (uno sin el otro), `assertSoftwareIdentityComplete` lanza 400 ("Falta el proveedor..." / "Falta el producto..."). Con identidad completa, `cpe_candidate` = `buildCpeCandidate` (`cpe:2.3:<part>:<vendor>:<product>:<version|*>:*:*:*:*:*:*:*`, normalizado a minúsculas y `_`); sin software, `software_part` y `cpe_candidate` se ponen en `null`. Es un identificador sin verificar contra ningún diccionario.

### 5.4 Revisiones periódicas (activo manual)

`review_interval` determina `next_review_at`. `deriveNextReviewAt` recalcula desde `now` solo al crear, al cambiar el intervalo o al confirmar una revisión (`context.reviewConfirmed`, que solo pone el endpoint `review`); cualquier otra edición conserva el valor. `never` produce `null`. Las horas por intervalo: `1d` 24, `3d` 72, `1w` 168, `1m` 720 (30 días), `6m` 4368 (182 días), `1y` 8760 (365 días).

`can_review` (`canReviewNow`): `false` con `never` o sin `next_review_at`; `true` si ya venció; en otro caso `true` desde una ventana previa al vencimiento: 12 h (`1d`, `3d`), 24 h (`1w`), 5 días (`1m`), 10 días (`6m`, `1y`). `review_status` es `overdue` si `next_review_at < now`, `ok` en otro caso (incluido sin fecha).

El hook respeta `req.context.seedEffectiveNow` para reproducir un reloj histórico en los seeds; el input HTTP no llega a `req.context`.

Marcador `NOTIFY:` en la colección: un aviso por revisión vencida está marcado, no implementado. Una revisión vencida no crea tareas.

### 5.5 Oficina, responsable y baja (activo manual)

Antes corren `rejectWritesInInactiveOrganization` (organización inactiva, §5.1) y `preserveDeletedAsset`. `resolveTenantAndReview` se ejecuta en cada escritura, en este orden:
1. Sin contexto de tenant (`getTenantContext` nulo), devuelve `data` sin más (escrituras internas).
2. Oficina efectiva = la del cuerpo o la del original. `assertOfficeInScope` contra `ctx.officeIds` (400 `MissingOfficeError` si falta, 403 si está fuera de alcance).
3. Se carga la oficina; `organization` del activo = organización de la oficina (el usuario no la elige).
4. Oficina inactiva: si la oficina cambió (o es alta) o se reactiva un `retired` a `active`, 400 "La oficina elegida está inactiva.".
5. Responsable (§2.5): sin `owner` y sin `systemOwnerRelease`: alta, o había responsable previo, o cambió la oficina, 400 "Selecciona un responsable." / "Selecciona un responsable para la nueva oficina."; con `owner` nuevo o cambio de oficina, `assertOwnerCoversOffice`.
6. `next_review_at` y software (§5.3, §5.4), y `last_updated_at`.

El mensaje "La oficina elegida está inactiva." solo cubre oficina nueva, traslado y reactivación; editar otros campos de un activo que ya está en una oficina inactiva no se bloquea.

### 5.6 Exclusión de revisión (ambos tipos)

`validateAssetAssessmentScope` (`beforeChange`, el mismo para ambas colecciones) evalúa el estado efectivo (`{ ...originalDoc, ...data }`):
- Si `assessment_scope` efectivo es `included` (o ausente): devuelve el `data` con `assessment_exclusion_reason`, `_note`, `_excluded_until`, `_excluded_at` y `_excluded_by` en `null`.
- Si es `excluded`: valida con `AssessmentScopeFieldsSchema` y `validateAssessmentScope`: motivo obligatorio ("Selecciona un motivo de exclusión."); motivo `other` exige nota ("Escribe una breve explicación."); vencimiento obligatorio ("Selecciona una fecha de vencimiento."). El rango del vencimiento (debe ser posterior a ahora y no superar 90 días, `ASSESSMENT_EXCLUSION_MAX_DAYS`) solo se valida si la ventana cambió (`assessmentExclusionWindowChanged`: el original no estaba excluido o cambió `assessment_excluded_until`). Así una edición no relacionada de un activo con exclusión vigente no revalida fechas.
- Si `assessment_scope` cambió en este request, fija `assessment_excluded_at = now` y `assessment_excluded_by = ctx.userId`. Un PlatformAdmin no tiene documento en `users`; `ctx.userId` es su id de `admins`, y el campo es relación a `users` (§10).

`isAssetExcludedFromAssessments` considera excluido un activo con `assessment_scope = 'excluded'` y sin vencimiento, o con vencimiento futuro; un vencimiento inválido cuenta como excluido. El job `reconcile-expired-asset-exclusions` (cada hora) pone `assessment_scope = 'included'` en los activos de ambas colecciones con `assessment_excluded_until <= now`, bajo `lockAssetRow`, releyendo antes de escribir; su escritura dispara los hooks de aplicabilidad. Marcadores `AUDIT:` y `NOTIFY:` en ese job.

### 5.7 Reactivar un activo retirado

Activo de red: `rejectRevivalInInactiveOffice` (oficina inactiva). Activo manual: `resolveTenantAndReview` (oficina inactiva, mensaje distinto). En ambos, si `deleted_at` está presente, `preserveDeletedAsset` lo impide (409) antes que cualquier otro hook. Un activo retirado por la cascada de desactivación de oficina (sin `deleted_at`) puede reactivarse una vez reactivada la oficina.

## 6. Catálogo de errores

Los códigos `error` de endpoints propios:

| Código | HTTP | Cuándo |
|---|---|---|
| `unauthenticated` | 401 | Sin contexto de tenant o `isActive` falso (todos los endpoints y la baja lógica) |
| `forbidden` | 403 | Sin permiso; `resolve`, baja lógica y `software-suggestions` (con organización) sin organización o sin permiso |
| `not_found` | 404 | Activo o incidente inexistente. En `resolve` y baja lógica, también organización u oficina ajenas |
| `organization_inactive` | 409 | Escritura sobre una organización inactiva (§3.2). En el REST genérico llega como `errors[0].data.code` |
| `invalid_business_data` | 400 | Cuerpo de `business` inválido, con campos no permitidos o vacío (`issues`) |
| `invalid_identification` | 400 | Cuerpo de `identify` inválido (`issues`) |
| `asset_not_identified` | 409 | `business` con campos fuera de la exclusión sobre un activo no confirmado |
| `review_not_due_yet` | 400 | `review` fuera de la ventana de habilitación |
| `invalid_input` | 400 | `resolve` con cuerpo que no cumple `ResolveInventoryIncidentSchema` |
| `already_resolved` | 409 | `resolve` sobre un incidente que no está `pending` |
| `invalid_decision` | 400 | Decisión incompatible con el tipo, o `move` sin activo, oficina propuesta o agente |
| `asset_changed` | 409 | `resolve` `move`: el activo fue eliminado, retirado o ya no está en la oficina del incidente. Incluye `message` |
| `invalid_office` | 409 | `resolve` `move`: oficina destino inactiva o de otra organización |

Errores lanzados como `APIError` o `ValidationError` por alcance y hooks (los serializa Payload; el texto es el de la columna):

| Origen | HTTP | Mensaje |
|---|---|---|
| `assertOfficeInScope` (endpoints propios, hook manual) | 403 | La oficina indicada no pertenece a las oficinas asignadas al usuario |
| `assertOfficeInScope` sin oficina | 400 | NonNetworkAssets.office es obligatorio: identifica el tenant del activo |
| `assertOrganizationMatches` | 403 | Este recurso pertenece a otra organización |
| `assertOwnerCoversOffice` | 400 | El usuario asignado como owner no tiene una membership activa en esta organización / ... no pertenece a la oficina del activo |
| `rejectBusinessEditsBeforeIdentified` | 400 | Este activo todavía no fue identificado: ... |
| `rejectManualOfflineStatus` | 400 | El estado «sin conexión» solo puede establecerlo un proceso automático, no una edición manual. |
| `rejectRevivalInInactiveOffice` | 400 | La oficina de este activo está inactiva: reactívala antes de reactivar el activo. |
| `resolveTenantAndReview` | 400 | La oficina elegida está inactiva. / Selecciona un responsable. / Selecciona un responsable para la nueva oficina. |
| `assertSoftwareIdentityComplete` | 400 | Falta el proveedor: proveedor y producto se cargan juntos / Falta el producto: ... |
| `validateCategoryGroups` | 400 | `ValidationError` con `path` y mensaje por campo faltante |
| `validateAssetAssessmentScope` | 400 | `ValidationError` por motivo, nota, vencimiento o rango |
| `preserveDeletedAsset` | 409 | Un activo eliminado conserva su baja y su historial. |
| `rejectPhysicalAssetDelete` | 409 | Los activos se eliminan lógicamente para conservar su historial. |

El texto que ve el usuario sale de `lib/user-facing-error.ts`. Tiene entrada por código para `asset_not_identified`, `review_not_due_yet`, `asset_changed`, `forbidden`, `unauthenticated`, `feature_disabled`. **No** tiene entrada para `not_found`, `invalid_business_data`, `invalid_identification`, `invalid_input`, `already_resolved`, `invalid_decision` ni `invalid_office`. Por mensaje, deja pasar las `APIError` cuyo texto empieza con prefijos de una lista (entre ellos "Este activo todavía no fue identificado:", "La oficina elegida está inactiva.", "La oficina de este activo está inactiva:", "Selecciona un responsable.", "Un activo eliminado conserva su baja y su historial.", "Los activos se eliminan lógicamente..." y prefijos genéricos como "La oficina "); cualquier otro texto se sustituye por el mensaje de respaldo del hook (por ejemplo "No se pudo actualizar el activo"). Los mensajes de `assertOwnerCoversOffice`, de `rejectManualOfflineStatus` y de `assertOrganizationMatches` no están en esa lista.

## 7. Concurrencia, atomicidad y efectos del sistema

### 7.1 Bloqueos

| Operación | Mecanismo |
|---|---|
| `resolve` | `withTransaction` + `transactionLock('inventory:<org>')` + `lockAssetRow('assets', id)` (solo `move`). |
| Baja lógica | `withTransaction` + `lockAssetRow(collection, id)`. |
| `agingSweep` | Por activo: `withTransaction` + `lockAssetRow` y relectura (`status = active` y `shouldGoOffline` otra vez) antes de escribir. |
| `reconcileExpiredAssetExclusions` | Por activo: `withTransaction` + `lockAssetRow` y relectura. |
| Liberación y reasignación de responsables | `lockAssetRow` por activo dentro de la operación de miembro. |
| Retiro y traslado por oficina | `lockAssetRow` por activo. |
| `business`, `identify`, `unidentify`, `review`, `POST`/`PATCH` REST | Sin `lockAssetRow` ni transacción propia: la escritura la envuelve la transacción que Payload abre por request. |

`lockAssetRow` ejecuta `SELECT ... FOR UPDATE` sobre la tabla del activo y exige una transacción PostgreSQL activa. El orden de adquisición relevante es activo y luego tarea (`task-api.md` §7.1): `reconcileAssetTasks` toma `withTaskLock` dentro de la transacción del cambio del activo. `withDeferredTaskReleases` existe para mantener ese orden cuando una operación de miembro toca varios activos (§2.5.1).

### 7.2 Atomicidad

Los hooks `afterChange` corren en la misma transacción que la escritura del activo: si falla la reconciliación de revisiones, de tareas o el encolado de riesgo, la escritura del activo revierte. La excepción son los `AUDIT:`/`NOTIFY:`, que no existen.

`resolve` con `move` es atómico (activo e incidente). La baja lógica y la cascada de oficina también.

### 7.3 Efectos de un cambio de activo

Los hooks `afterChange` disparan estos efectos; ver los módulos citados para el detalle.

**`reconcileAssessmentApplicability` (revisión de seguridad).** Para activos de red se vuelve a evaluar la revisión abierta si: se crea con `confirmed_type = 'workstation'` y no retirado; cambia la oficina; cambia `confirmed_type`; entra o sale de `retired`; cambia `assessment_scope` o `assessment_excluded_until`. Para manuales: se crea de una categoría evaluable (`isManualCategoryAssessable`) y no retirado; cambia la oficina; cambia `asset_category`; entra o sale de `retired`; cambia el alcance o su vencimiento. El motivo registrado es `assessment_scope_changed`, `office_changed` o `asset_identified`. Un cambio de `owner` sincroniza el asignado de la revisión (`syncAssetAssessmentAssignee`, `syncManualAssetAssessmentAssignee`). Cambios solo de `status` entre `active` y `offline`, de `criticality`, `alias` o `location` no tocan la revisión. `reconcileAssetAssessmentInstance` solo crea revisión si hay `organization-settings`, suscripción y `security_assessments` activo, el activo tiene tipo confirmado, está identificado y confirmado, no retirado, en oficina activa y no excluido. Detalle en `assessments-api.md`.

**`reconcileAssetTasks`.** Se ejecuta en `update` si el activo cambió de oficina, quedó no disponible (`status = 'retired'` o `deleted_at`) o cambió alguno de `confirmed_type`, `asset_category`, `identified`, `identification_status`, `assessment_scope`, `assessment_excluded_until`. Sobre tareas `pending` e `in_progress` que referencian al activo directamente o a sus revisiones, cancela o reubica según `task-api.md` §7.3.

**Riesgo.** Ambos hooks de aplicabilidad llaman `enqueueRiskRecalculation` en cada escritura (organización más las oficinas afectadas, incluida la anterior si hubo traslado). En activos de red se omite cuando la escritura viene de un job de sistema (`context.systemJob`) salvo traslado, porque la ingesta y el `agingSweep` encolan por su cuenta. En activos manuales se encola siempre. Si `PAYLOAD_DISABLE_JOBS === '1'` o no hay cola, no se encola. Detalle en `risk-api.md`.

**`unidentify`.** La condición de `reconcileAssessmentApplicability` para activos de red no incluye `identified` ni `identification_status`: quitar la identificación no vuelve a evaluar la revisión abierta (la condición de `reconcileAssetTasks` sí incluye ambos campos). No hay prueba que cubra esta secuencia (§11). El recálculo de riesgo sí se encola.

### 7.4 Jobs

| Job (`payload.config.ts`) | Programación | Efecto sobre activos |
|---|---|---|
| `aging-sweep` | cada hora (`0 5 * * * *`, cola `maintenance`) | `agingSweep`: pasa a `offline` los activos de red `active` cuyo `last_seen` supera `offline_after_hours` de su organización (`organization-settings`; 72 por defecto). Registra la corrida en `job-runs`. Escribe con `context.systemJob` y encola el riesgo de la oficina. |
| `reconcile-expired-asset-exclusions` | cada hora (`0 0 * * * *`) | §5.6. |
| `expire-raw-scan-payloads` | diario | Retención de evidencia cruda del escáner; ver `scanner-api.md`. |

`agingSweep` itera con cursor por `id` en páginas de 200, filtra `status = active` en la consulta (un `retired` no entra), y por cada activo candidato relee bajo lock. El endpoint `POST /v1/internal/jobs/aging-sweep` (`endpoints/internalJobs.ts`, autorizado por token interno) dispara la misma función manualmente.

### 7.5 Cascadas desde otros módulos

| Origen | Efecto sobre activos |
|---|---|
| Desactivar una oficina u organización (`retireOfficeAssets`) | `status = 'retired'` (sin `deleted_at`) en los activos vigentes; los hooks cancelan tareas, cierran revisiones y encolan riesgo. Incluye manuales solo si se pidió (`includeManual`). Detalle en `offices-api.md`. |
| Traslado de activos manuales al desactivar una oficina (`moveManualAssets`) | `office` nueva, `owner = null`, `location = null`. |
| Desactivar a una persona o quitarle una oficina | `releaseOwnedAssets` / `reassignOwnedAssets` (§2.5.1). `ownedAssetsSummary` alimenta el cuadro de desactivación; excluye los retirados. |

### 7.6 Puntos de enganche pendientes

Las operaciones sensibles llevan comentarios `// AUDIT:` y `// NOTIFY:` en cada punto de escritura (los endpoints de este documento, la baja lógica, `recordInventoryIncident`, el hook de revisión vencida, `reconcileAssetTasks`, las liberaciones de responsable y el job de exclusiones). AuditLog y Notification Bell **no existen aún**: son marcas, no código. Ver `SYSTEM_PROMPT.md` §2.

## 8. Frontend

### 8.1 Cadena

- Página `app/portal/(protected)/inventory/page.tsx` (pestañas Red y Activos manuales, panel de incidentes). Usa `modules/assets/components/` (`RowActions`, `InventoryIncidentsPanel`, `IdentificationBadge`) y `modules/non-network-assets/components/` (`NonNetworkAssetForm`, `RowActions`), con los hooks y el `service.ts` de cada módulo sobre `lib/http-client.ts`, contra `/api/...`.
- Página `app/portal/(protected)/inventory/[id]/page.tsx` (detalle de un activo de red). Usa `modules/assets/components/` (`AssetDetailView`, `AssetIdentificationModal`, `InventoryIncidentsPanel`) y `modules/assets/hooks/*` sobre `modules/assets/service.ts`.

`inventory/page.tsx` lee `asOrganization`, `officeId`, `tab` y `nonNetworkAsset` de la URL. `?tab=non-network` abre la pestaña de activos manuales; `?officeId=` fija la oficina seleccionada; `?nonNetworkAsset=<id>` abre el formulario de edición de ese activo una vez cargada la lista. La oficina seleccionada vive en `useUiStore` (`selectedOfficeId`) y entra a las claves de consulta.

El detalle de un activo de red es `/portal/inventory/<id>`. La pestaña activa (`datos` o `red`) vive en `?tab=`. Los activos manuales no tienen página de detalle: se editan en un modal del listado.

### 8.2 Consultas (TanStack Query)

`staleTime` global 30 s (`lib/query-client.ts`). Las listas usan `listResource`, que pagina de a 100 con `sort: 'id'` hasta `hasNextPage`.

| Hook | Clave | Notas |
|---|---|---|
| `useAssetsList(asOrganization)` | `['assets', asOrganization, selectedOfficeId]` | `GET /api/assets?depth=1&where[deleted_at][exists]=false` y `where[office][equals]` si hay oficina. |
| `useAsset(id)` | `['assets', id]` | `GET /api/assets/:id?depth=1`. No filtra `deleted_at`: un activo dado de baja sigue abriendo por enlace directo. No incluye `asOrganization` en la clave. |
| `useNonNetworkAssetsList(asOrganization)` | `['non-network-assets', asOrganization, selectedOfficeId]` | Mismo filtro que `assets`. |
| `useSoftwareSuggestions({ asOrganization, enabled })` | `['software-suggestions', asOrganization]` | Habilitada solo si la categoría del formulario tiene software. Sin `officeId` en la clave. |
| `useInventoryIncidents(asOrganization, assetId)` | `['inventory-incidents', asOrganization, officeId, assetId]` | Incidentes `pending`; por oficina seleccionada en el listado y por activo en el detalle. |

Ninguna consulta de este feature tiene `refetchInterval`.

### 8.3 Mutaciones

| Hook | Endpoint | Invalida | Aviso |
|---|---|---|---|
| `useUpdateAsset(id)` | `PATCH /api/v1/assets/:id/business` | `['assets']` y revisión de seguridad | "Activo actualizado" |
| `useIdentifyAsset` | `PATCH /api/v1/assets/:id/identify` | `['assets']` y revisión de seguridad | "Activo identificado" |
| `useUnidentifyAsset` | `PATCH /api/v1/assets/:id/unidentify` | `['assets']` y revisión de seguridad | "Identificación eliminada" |
| `useMarkAssetViewed(id)` | `PATCH /api/assets/:id` (`first_viewed_at`) | `['assets']` | ninguno, silencioso |
| `useMarkAssetChangesViewed(id)` | `PATCH /api/assets/:id` (`technical_changed_at: null`) | `['assets']` | ninguno, silencioso |
| `useSaveNonNetworkAsset(id?)` | `POST /api/non-network-assets` o `PATCH .../:id` | `['non-network-assets']`, `['software-suggestions']` y revisión de seguridad | "Activo creado" / "Activo actualizado" |
| `useMarkReviewed` | `PATCH /api/v1/non-network-assets/:id/review` | `['non-network-assets']` (espera el refetch) | "Revisión confirmada" |
| `useInventoryIncidents(...).resolution` | `POST /api/v1/inventory-incidents/:id/resolve` | `['inventory-incidents']`, `['assets']`, `['tasks']` y revisión de seguridad | ninguno; el error se muestra en línea con `userFacingErrorMessage` |

"Revisión de seguridad" es `invalidateSecurityReview` (`modules/assessments/invalidate-security-review.ts`): invalida `['assessments']`, `['risk']` y `['tasks']` con `refetchType: 'all'`, porque cambiar un activo reconcilia revisiones, riesgo y tareas del lado del servidor. Los errores de las mutaciones con aviso pasan por `showApiError`.

`service.ts` no expone la baja lógica: **ninguna pantalla ni función de cliente llama `DELETE /api/assets/:id` ni `DELETE /api/non-network-assets/:id`**.

### 8.4 Pantallas

**Listado (`inventory/page.tsx`).**
- `InventoryIncidentsPanel` arriba, sin ocultarse por pestaña; no renderiza nada si no hay incidentes pendientes.
- Pestaña "Red": filtros locales por texto (alias confirmado, hostname, IP), criticidad (solo cuenta si el activo está confirmado), estado e identificación (`identified`). Dos tablas: vigentes y "Retirados y sin conexión". La partición usa `useFrozenBucket`: cada fila queda en el grupo que le tocó la primera vez que se vio hasta recargar la página, de modo que un activo retirado desde la edición no salta de tabla solo.
- Pestaña "Activos manuales": filtros locales por alias, categoría, criticidad y estado de revisión (`review_status`); misma partición congelada; botón "Nuevo activo" que abre `NonNetworkAssetForm` en un modal.
- Los datos de oficina e inventario ya vienen acotados por la API; el filtro por oficina del selector se aplica en la consulta.

**`NonNetworkAssetForm`.** `react-hook-form` con `createNonNetworkAssetSchema(asset)` como resolver (el original sirve de línea base para el rango de la exclusión). Muestra solo el grupo de detalle de la categoría elegida (`categoryGroupOf`) y habilita las sugerencias solo si `categoryHasSoftware`. Las opciones de responsable son los miembros que cubren la oficina elegida (`memberCoversOffice`); al cambiar de oficina, si el responsable ya no la cubre o no había responsable, se vacía el campo. La opción "Sin responsable" aparece deshabilitada. En edición envía **todos** los campos del formulario.

**`AssetDetailView`.** Datos de negocio con formulario propio (`createAssetBusinessFieldsSchema(asset)`) y envío de **solo los campos modificados** (`dirtyFields`), para no reenviar un `status` desactualizado. Campos de negocio deshabilitados si el activo no está confirmado; criticidad y responsable deshabilitados además si la autorización no es `authorized`. El selector de estado no ofrece `offline`; si el activo ya está offline lo muestra deshabilitado. Botón "Identificar activo" (abre `AssetIdentificationModal`, que sugiere `confirmed_type` desde `inferred_type` y normaliza `__unknown__` a `null` antes de enviar) o "Quitar identificación" con confirmación. Al montar, dispara `markViewed` si `first_viewed_at` es `null` y `markChangesViewed` cuando `technical_changed_at` cambia.

**Control de acceso en la UI.** `AssetDetailView`, el listado y los formularios no condicionan botones por permiso; el servidor responde 403 si el rol no tiene `update` o `create`. Solo `InventoryIncidentsPanel` consulta `useTenantContext` (`permissions.assets` incluye `update` y cobertura de las oficinas del incidente) para mostrar las acciones de resolución.

### 8.5 Contrato de tipos

`Asset`, `NonNetworkAsset` e `InventoryIncident` son los tipos generados por Payload (`app/types/payload-types`). Los schemas de entrada se importan de `modules/*/schema.ts` sin redefinirlos (`SYSTEM_PROMPT.md` §5). `service.ts` tipa como `NonNetworkAsset` el resultado de `POST` y `PATCH /api/non-network-assets`, que en realidad devuelve la respuesta de Payload (`{ doc, message }`); los hooks no leen ese resultado.

## 9. Cómo extender

**Agregar una categoría manual.**
1. Valor en `MANUAL_ASSET_CATEGORY_VALUES` y entrada en `MANUAL_ASSET_CATEGORY_OPTIONS` y en `MANUAL_ASSET_CATEGORY_GROUPS` (`domain/assets/asset-types.ts`).
2. Decidir si tiene software en `CATEGORY_HAS_SOFTWARE` y su grupo en `CATEGORY_GROUP` (`categoryGroups.ts`). Ambos son `Record` exhaustivos: no compila hasta decidirlo.
3. Decidir su aplicabilidad de revisión en `isManualCategoryAssessable` (`domain/risk/risk-asset-type.ts`) y su tipo de riesgo; es una decisión distinta de las dos anteriores.
4. Regenerar `app/types/payload-types.ts`.

**Agregar un campo de negocio al activo de red.**
1. Campo en `collections/Assets/index.ts` (sin `technicalFieldAccess`).
2. Agregarlo a `GATED_FIELDS` de `rejectBusinessEditsBeforeIdentified` si no debe editarse antes de identificar.
3. Agregarlo a `AssetBusinessUpdateSchema` y a `AssetBusinessBaseSchema`; el endpoint `business` es `.strict()` y lo rechaza si no está.
4. Decidir si cambia la aplicabilidad de revisión o de tareas (`assetAssessmentApplicabilityChanged`, lista de `reconcileAssetTasks`).

**Agregar un endpoint sobre activos.**
1. Resolver `getTenantContext`, `canDo`, carga de la fila, `assertOfficeInScope` y `assertOrganizationMatches` en ese orden (como `assetBusiness.ts`).
2. Escribir con `payload.update` para que corran los hooks; si hay varios pasos, `withTransaction` y `lockAssetRow` como `resolve`.
3. Marcadores `AUDIT:` y `NOTIFY:`.
4. Registrar el endpoint en `payload.config.ts`.
5. Función en `service.ts`, hook de mutación que invalide `['assets']` (o `['non-network-assets']`) y `invalidateSecurityReview`.
6. Códigos nuevos en `lib/user-facing-error.ts`.
7. Pruebas (§11).

## 10. Comportamientos a tener presentes

Verificados en el código; no son necesariamente defectos, pero conviene conocerlos antes de tocar el feature.

1. **`asset_inventory` no se aplica.** Existe en el catálogo de features, pero ningún endpoint ni pantalla del inventario lo verifica (§3.3).
2. **Alcance: 403 en unos endpoints y 404 en otros.** `business`, `identify`, `unidentify`, `review` y los hooks de `non-network-assets` responden 403 con mensaje cuando el activo es de otra oficina u organización (revelan que existe); `resolve` y la baja lógica responden 404.
3. **`status` en un activo de red sin identificar.** `rejectBusinessEditsBeforeIdentified` deja `status` fuera del gate (el comentario del hook lo describe como escritura legítima), pero el endpoint `business` lo cuenta como campo fuera de la exclusión y responde 409 `asset_not_identified`. Por la API REST genérica el cambio de `status` sí pasaría el hook. La baja lógica y el retiro por oficina también escriben `status` sobre activos sin identificar.
4. **`identified` e `identification_status` por la API REST.** No tienen `access` de campo y no están en `GATED_FIELDS`; quien tenga permiso `update` sobre `assets` podría, según estas definiciones, escribirlos por `PATCH /api/assets/:id` sin pasar por `identify`. Los comentarios del código describen `identify` como el único camino previsto. No hay prueba que lo ejercite.
5. **`unidentify` y la revisión de seguridad.** No reconcilia la revisión abierta (§7.3). `identify` sobre un activo ya confirmado con el mismo `confirmed_type` tampoco cambia la condición.
6. **`unidentify` no valida estado previo y no revisa `deleted_at`, `status` ni oficina activa.** `identify` tampoco.
7. **`identify` con `owner` omitido.** Con `authorized` y sin `owner` en el cuerpo, `owner` queda como estaba (la clave es `undefined` y Payload no la escribe), a diferencia de `null`, que sí lo borra. Lo mismo con `criticality`.
8. **`business` no valida el responsable en el schema.** `owner` es cualquier string; la pertenencia a la organización y a la oficina la comprueba `validateOwnerTenant`, que usa la oficina y organización del documento original.
9. **Cuerpo de `resolve`.** `req.json?.()` no tiene `.catch`: un cuerpo vacío o no JSON no llega a responder 400 `invalid_input`. Los demás endpoints con cuerpo sí capturan el error de parseo y lo tratan como `{}`.
10. **`resolve` `move` y responsable.** Si el responsable no cubre la oficina destino, el activo pasa a `owner = null`. Si el activo no está identificado, `rejectBusinessEditsBeforeIdentified` ve ese cambio de `owner` sin `systemOwnerRelease` y rechaza la escritura con 400; el incidente no se resuelve.
11. **`recordInventoryIncident` y `observed_at`.** Un incidente existente con `observed_at` posterior no se actualiza con observaciones más antiguas; el panel muestra "Última observación" con ese valor.
12. **Validación de texto solo en cliente (manuales).** `TEXT_RULES.label` en `alias` y `location` y el tope de `notes` en el formulario se aplican en Zod; el servidor solo aplica `maxLength` de Payload (§4.7).
13. **`assessment_excluded_by` en activos manuales y de red.** El hook guarda `ctx.userId`; el campo es relación a `users`. Para un PlatformAdmin con `asOrganization`, `ctx.userId` es el id de su documento en `admins`.
14. **Listados sin `deleted_at` en el detalle.** Las listas filtran `deleted_at`, `useAsset` no: el detalle de un activo eliminado sigue abriendo por URL y muestra sus acciones. `software-suggestions` tampoco filtra `deleted_at` ni `status`.
15. **Costo de `software-suggestions`.** Carga hasta 5000 activos por apertura del formulario (comentario `COSTE:` en el endpoint); el límite también acota el resultado: una organización con más de 5000 activos con software puede recibir sugerencias incompletas.
16. **Marcas de visto para roles de solo lectura.** `useMarkAssetViewed` y `useMarkAssetChangesViewed` se disparan al abrir el detalle sin comprobar permisos; para `org_viewer`, el `PATCH /api/assets/:id` responde error de acceso y la mutación no tiene `onError`, por lo que falla en silencio. La marca `first_viewed_at` no se fija para ese rol.
17. **Baja lógica sin interfaz.** El endpoint existe y está probado, pero no hay llamada desde el cliente (§8.3).
18. **Comentario desactualizado del endpoint interno.** `endpoints/internalJobs.ts` dice que no hay scheduler cableado al `aging-sweep`; `payload.config.ts` sí lo programa cada hora.
19. **Retención de los incidentes.** No hay job que archive ni elimine `inventory-incidents`; los resueltos permanecen.
20. **Comentario desactualizado en `collections/Assets/index.ts`.** Un comentario dice que el PATCH manual de negocio "nunca pasa por el Zod"; la edición de negocio de un activo de red hoy pasa por `AssetBusinessUpdateSchema` en el endpoint `business`. Lo que no pasa por Zod es la API REST genérica.

## 11. Cobertura de pruebas

Estado de cobertura automática; sin pruebas de extremo a extremo por ahora.

| Prueba | Cubre |
|---|---|
| `collections/NonNetworkAssets/invariants.test.ts` | `assertOfficeInScope` (403 vs 400), derivación de `next_review_at`, ventanas de `can_review`, `review_status`, CPE e identidad de software, reinicio de cuenta al confirmar revisión |
| `collections/NonNetworkAssets/categoryGroupRules.test.ts` | Sin casos: el archivo contiene solo `// TODO: escribir los tests`. `resolveCategoryGroups` no tiene prueba directa |
| `collections/NonNetworkAssets/hooks/reconcileAssessmentApplicability.test.ts` | Cambios que alteran la aplicabilidad de revisión de un activo manual |
| `collections/Assets/hooks/enforceAuthorizationInvariant.test.ts` | Limpieza de `owner`/`criticality` con `unauthorized` o `pending` |
| `collections/Assets/hooks/rejectBusinessEditsBeforeIdentified.test.ts` | Gate de identificación, excepción `systemJob`, `status`/`identified` fuera del gate, cambios sin valor distinto |
| `collections/Assets/hooks/reconcileAssessmentApplicability.test.ts` | Cambios que alteran la aplicabilidad de un activo de red |
| `modules/assets/schema.test.ts`, `modules/assets/business-form-validation.audit.test.ts` | Schemas de `business` e identificación, normalización de valores desconocidos, validación del formulario de negocio |
| `modules/non-network-assets/schema.test.ts` | Responsable obligatorio al alta, activo sin responsable guardable, mensajes de categoría |
| `modules/assets/inferDeviceCategory.test.ts` | Inferencia del tipo sugerido (`domain/assets/inferDeviceCategory.ts`) |
| `domain/inventories/agingSweep.test.ts` | `shouldGoOffline` (umbral, borde, sin `last_seen`, umbrales por organización) |
| `domain/inventories/asset-identity.audit.test.ts` | Clasificación de MAC y claves de identidad por alcance |
| `domain/assessments/asset-assessment-scope.test.ts`, `assessment-scope-schema.audit.test.ts`, `reconcileExpiredAssetExclusions.test.ts` | Exclusión de revisión: vigencia, validación y reinclusión por vencimiento |
| `endpoints/assetIdentify.integration.test.ts` | 401, 403 sin permiso, 403 fuera de oficina, identificación con owner y criticidad, `unauthorized` sin ellos |
| `endpoints/review-findings.audit.integration.test.ts` | Un `PATCH /api/assets/:id` de OrgAdmin o Responsable no cambia `identified` ni `identification_status`; `identify` y `unidentify` siguen funcionando |
| `endpoints/assetUnidentify.integration.test.ts` | 401; vuelve a `pending` sin borrar `owner`, `criticality` ni `alias` |
| `endpoints/nonNetworkAssetReview.integration.test.ts` | Una revisión vencida queda al día (reinicio de `next_review_at`) |
| `endpoints/softwareSuggestions.integration.test.ts` | Deduplicación y orden, aislamiento entre organizaciones, 401 |
| `endpoints/audit-fixes.audit.integration.test.ts` | VAL-01: exclusión de revisión por `business` y por la API REST de activos manuales (400 con `null` o inválida, edición no relacionada, job repetible) |
| `endpoints/remaining-corroboration.audit.integration.test.ts` | Baja lógica de un activo manual (rechazo físico, tareas canceladas, historial y contribuciones de riesgo conservados, riesgo encolado); traslado y retiro de activos con sus tareas; conflicto de MAC global y ubicación con incidentes; ubicación conservada tras `keep`; reasignación de revisiones; `agingSweep` frente a una observación fresca (SEC-50) |
| `endpoints/memberLifecycle.integration.test.ts` | Desactivar con reemplazo reasigna activos; sin reemplazo quedan sin responsable (incluidos los de red no identificados); quitar oficina libera solo sus activos; activos manuales no pueden quedar sin responsable ni ir a oficina inactiva |
| `endpoints/member-manager-status.audit.integration.test.ts`, `endpoints/orgMembers.integration.test.ts` | Efectos de miembros sobre responsabilidades |
| `endpoints/offices.integration.test.ts`, `endpoints/platformOrganizations.integration.test.ts` | Retiro, traslado y cancelación al desactivar oficina u organización |
| `access/rbac/officeScoping.integration.test.ts` | Lectura por oficina, rechazo de `PATCH` REST sobre activo de otra oficina, responsables que cubren la oficina |
| `access/rbac/permissions.test.ts` | Matriz de permisos |
| `endpoints/manual-assessment-categories.audit.integration.test.ts` | Revisiones de categorías manuales (nube) |

Sin cobertura directa encontrada en el repositorio para: `PATCH /v1/assets/:id/business` salvo los casos de exclusión de arriba (alias, `owner`, `status`, `asset_not_identified`), `POST /v1/inventory-incidents/:id/resolve` (ninguna prueba invoca `resolveInventoryIncidentEndpoint`), `review_not_due_yet`, el filtrado de `rejectManualOfflineStatus` y de `rejectRevivalInInactiveOffice`, la rama `owner = null` de `resolve` `move`, y el efecto de `unidentify` sobre la revisión abierta.

Las pruebas de integración requieren una base PostgreSQL desechable; ver `SYSTEM_PROMPT.md` y la configuración de cada archivo.
