# API del escáner y evidencia técnica

Referencia técnica de la comunicación escáner ↔ plataforma y de la evidencia que genera: aprovisionamiento y revocación de agentes, canal del agente (reportes, heartbeat, vendor), ingesta de reportes, instantáneas de inventario, aging de activos, retención de evidencia cruda y trabajos internos. Dirigida a quien mantiene o extiende el feature.

Verificado contra el código el 2026-10-31. Si algo de este documento contradice el código, gana el código: corregir el documento.

Fuera de alcance, documentado en otros archivos de `docs/`: CRUD y reglas de activos (`assets-api.md`), cálculo de riesgo (`risk-api.md`), revisiones de seguridad (`assessments-api.md`), configuración de organización (`organization-settings-api.md`), alta y baja de oficinas (`offices-api.md`), sesión y permisos del portal (`session-and-access.md`), tareas (`task-api.md`).

## 1. Capas y archivos

| Capa | Archivo | Responsabilidad |
|---|---|---|
| Contrato | `contracts/scan-report.schema.ts` | `ScanReportPayloadSchema`: forma del reporte y reglas cruzadas (tiempos, red, cobertura). |
| | `contracts/asset.schema.ts` | `AssetPayloadSchema` y sub-schemas (servicios, SO, nombres, cobertura, MAC). |
| | `contracts/network.ts` | CIDR privados válidos, `networkContains`. |
| | `contracts/heartbeat.schema.ts` | `HeartbeatPayloadSchema`. |
| | `modules/scan-reports/schema.ts` | `EvidenceNameSchema` (renombrado de evidencia; lo usan cliente y endpoint). |
| Autenticación del agente | `access/middleware/resolveAgentAuth.ts` | Token por agente, lockout escalonado, revocación automática. |
| Endpoints del agente | `endpoints/reports.ts`, `endpoints/heartbeat.ts`, `endpoints/vendor.ts` | Canal escáner → plataforma. |
| Endpoints de personas | `endpoints/agentProvisioning.ts`, `endpoints/agentRevoke.ts`, `endpoints/officeAgentSummary.ts` | Alta, baja y estado de escáneres por oficina. |
| | `endpoints/inventorySnapshots.ts` | Generación manual de instantánea. |
| | `endpoints/evidenceNames.ts` | Renombrado de informes e instantáneas (`scanReportNameEndpoint`, `inventorySnapshotNameEndpoint`). |
| Endpoints de infraestructura | `endpoints/internalJobs.ts` | `expireRawScanPayloadsEndpoint`, `agingSweepEndpoint`. |
| Dominio | `domain/inventories/processScanReport.ts` | Punto único de procesamiento de un reporte: transacción, idempotencia, orden de efectos. |
| | `domain/inventories/ingestScanReport.ts` | Upsert de activos, fusión de evidencia, incidentes. |
| | `domain/inventories/asset-identity.ts` | Clasificación de MAC y clave de identidad. |
| | `domain/inventories/autoSnapshot.ts`, `createInventorySnapshot.ts` | Instantáneas automáticas y manuales. |
| | `domain/inventories/agingSweep.ts` | Paso de activos a `offline`. |
| | `domain/inventories/expireRawScanPayloads.ts`, `technical-evidence.ts` | Retención de evidencia cruda a 30 días. |
| | `domain/inventories/inventory-incidents.ts` | Alta de incidentes de identidad y ubicación. |
| | `domain/agents/agent-state.ts` | Estados del agente, umbrales de conectividad y lockout. |
| | `domain/agents/buildAgentPackage.ts` | Paquete `.zip` descargable. |
| | `domain/subscriptions/agent-quota.ts`, `limits.ts` | Cupos de escáner. |
| | `domain/with-transaction.ts` | Transacciones y advisory locks. |
| | `domain/risk/recover-jobs.ts` | Recuperación de jobs al arrancar. |
| Persistencia | `collections/Agents/index.ts` (`agents`) | Agente, credencial hasheada, estado. |
| | `collections/ScanReports/index.ts` (`scan-reports`) | Reporte recibido, estado, payload crudo. |
| | `collections/InventorySnapshots/index.ts` (`inventory-snapshots`) | Instantánea inmutable. |
| | `collections/JobRun/index.ts` (`job-runs`) | Historial de corridas de `aging_sweep`. |
| | `collections/InventoryIncidents/index.ts` (`inventory-incidents`) | Excepciones de identidad y ubicación generadas por la ingesta. |
| Cliente HTTP | `modules/scan-reports/service.ts`, `modules/inventory-snapshots/service.ts`, `modules/offices/service.ts` | Funciones sobre `lib/http-client.ts` (`listResource`, `httpClient`). |
| Estado de servidor | `modules/scan-reports/hooks/*`, `modules/inventory-snapshots/hooks/*`, `modules/offices/hooks/use-offices.ts` | TanStack Query. |
| UI | `modules/scan-reports/*`, `modules/inventory-snapshots/*`, `modules/offices/components/AgentProvisionModal.tsx`, `app/portal/(protected)/inventory/scan-reports/`, `.../inventory/snapshots/`, `.../administration/offices/page.tsx` | Presentación. |

Los endpoints se registran en `payload.config.ts` (arreglo `endpoints`); los jobs programados, en `jobs.tasks` del mismo archivo. El listado y el detalle de informes e instantáneas **no** son endpoints propios: se leen por la API REST estándar de Payload (`/api/scan-reports`, `/api/inventory-snapshots`), filtrada por las funciones `access` de cada colección (§3.3).

Cadena de un reporte: agente (`sender.py`) → `POST /api/v1/reports` → `endpoints/reports.ts` → `processScanReport` → `ingestScanReport` → `payload.create/update` sobre `assets` y `scan-reports`.

## 2. Modelo

### 2.1 Colección `agents`

Acceso: `create`, `read`, `update` y `delete` son `() => false`. Todo acceso pasa por la Local API con `overrideAccess: true` desde los endpoints y desde `resolveAgentAuth`. El agente no se borra nunca: se revoca (comentario de `buildRevocationData`: ScanReports y activos mantienen `agent` como relación requerida).

| Campo | Tipo | Notas |
|---|---|---|
| `id` | text, único | `agent-<uuid>`, generado por el endpoint de aprovisionamiento. |
| `office` | relación a `offices`, requerido | Inmutable tras la creación (`beforeValidate` lanza error si cambia). |
| `organization` | relación a `organizations` | Denormalizado desde la oficina en cada `beforeValidate`; nunca editable. |
| `provisioned_at` | date | Por defecto, ahora. |
| `first_heartbeat_at`, `last_heartbeat_at`, `last_agent_timestamp` | date | Los dos primeros con reloj del servidor; el tercero es el `timestamp` que declara el agente, solo diagnóstico. |
| `runtime_status` | `idle` \| `scanning` \| `unknown` | Último estado declarado en el heartbeat. |
| `lifecycle_status` | `provisioned` \| `active` \| `revoked` | Indexado. Ver §2.4. |
| `status` | virtual (`afterRead`) | `online` u `offline`; `offline` si está revocado. No se persiste. |
| `is_active` | checkbox | Compatibilidad: `false` = revocado. El `beforeChange` lo recalcula siempre desde el ciclo de vida. |
| `revoked_at`, `revocation_reason` | date, select | Motivos: `manual`, `auto_lockout_abuse`, `office_deactivated`, `organization_deactivated`. |
| `failedAttempts`, `lockedUntil`, `lockoutCount` | number, date, number | Estado del lockout (§3.2). |
| `apiKeyPrefix` | text, único, indexado | Primeros 8 caracteres del token. Se usa para ubicar al agente. |
| `apiKeyHash` | text, `hidden` | `bcrypt` (costo 10) del token completo. `hidden` lo quita de toda respuesta (REST, Local, GraphQL), también cuando el agente llega expandido; solo `resolveAgentAuth` lo lee, con `showHiddenFields: true`. |
| `apiKey` | virtual | Se rellena en el `afterChange` de la creación a partir de `req.context.plainApiKey`; ningún endpoint lo devuelve. |

Cuando un agente se expande desde otra colección (`assets`, `scan-reports`, `inventory-incidents`), `defaultPopulate` limita sus campos a `office`, `organization`, `lifecycle_status` y `last_heartbeat_at`. El estado de bloqueo y `apiKeyPrefix` solo aparecen en las lecturas directas del agente (panel de administración y endpoints propios).

Hooks relevantes:
- `beforeChange` (1): calcula el siguiente estado con `getAgentLifecycleStatus`, aplica `assertAgentTransition` en updates y fuerza `lifecycle_status` e `is_active` coherentes.
- `beforeChange` (2), solo `create`: toma el token de `req.context.provisionApiKey` (aprovisionamiento) o `req.context.seedApiKey` (seed de desarrollo), o genera uno aleatorio; guarda prefijo y hash. El endpoint de aprovisionamiento inyecta el token por contexto: el token en claro no pasa por el cuerpo de ninguna API.
- `afterChange`: si cambia el estado "en línea" del agente (según `isAgentOnline` y no revocado), encola recálculo de riesgo de la organización y de la oficina (`enqueueRiskRecalculation`).

### 2.2 Colección `scan-reports`

Acceso: `create`, `update` y `delete` en `false`; `read` por `orgScopedAccess('scan-reports', 'read', { kind: 'offices', field: 'office' })`. Se escribe solo desde `processScanReport` y desde `expireRawScanPayloads` con `overrideAccess`, y `display_name` desde `evidenceNames.ts`.

| Campo | Notas |
|---|---|
| `id` (text, único) | Es el `report_id` que manda el agente. |
| `content_fingerprint` | SHA-256 del contenido canónico del reporte (§6.1). |
| `received_at` | Indexado. |
| `agent` | Relación a `agents`, requerido. |
| `office` | Derivado del agente autenticado, nunca del cuerpo. |
| `network`, `scan_start`, `scan_end`, `hosts_up`, `execution_status`, `report_coverage`, `scanner_interfaces`, `gateway_ip`, `gateway_mac` | Copia de los datos del reporte. |
| `raw_payload` | JSON completo del reporte validado. Lectura restringida a quien tiene `read_technical` (§3.3). |
| `raw_payload_expires_at` | `received_at` + 30 días al crear; `null` tras la expiración. Indexado. |
| `status` | `received` (por defecto) \| `processed` \| `failed`. |
| `processed_at` | Fecha de fin del procesamiento. |
| `error` | Texto. Lectura restringida a `read_technical`. Contiene el JSON de `rejectedAssets` o `null`; nunca un mensaje libre. |
| `display_name` | Único campo editable (≤ 80), solo por `evidenceNames.ts`. |

### 2.3 Colección `inventory-snapshots`

Acceso: `create`, `update` y `delete` en `false`; `read` por `orgScopedAccess(..., { kind: 'org_offices', field: 'office' })`. Se crea solo desde `createInventorySnapshot`. La inmutabilidad tiene dos excepciones de mantenimiento, ambas con `overrideAccess`: `display_name` (renombrado) y la redacción de salidas crudas de scripts a los 30 días (§8.3).

| Campo | Notas |
|---|---|
| `organization`, `office` | Requeridos, indexados. |
| `taken_at` | Momento de la toma. |
| `generated_by` | `manual` \| `scheduled` \| `pre_audit`. |
| `triggered_by_user` | Relación polimórfica `users` \| `admins`; solo en las manuales. |
| `risk_score` | Relación a `risk-evaluations`, requerida. Evaluación calculada en el momento de la toma. |
| `assessment_results_snapshot` | JSON: `{ evaluation_id, score, coverage, unknown_percentage, evaluated_at }`. `score` es `null` si `scoreVisible(confidence)` es falso. |
| `assets_dump` | JSON `{ network: Asset[], non_network: NonNetworkAsset[] }`: copia por valor (`structuredClone`) de los documentos con `deleted_at` vacío, incluidos retirados y `offline`. Su `afterRead` (`redactSnapshotForViewer`) elimina `host_scripts` y `scripts` para quien no tiene `read_technical`. |
| `display_name` | Único campo editable (≤ 80). |

`generated_by`: `manual` lo escribe el endpoint de generación; `scheduled` lo escribe `maybeCreateAutoSnapshot` durante la ingesta; `pre_audit` solo lo usa `domain/demo/seedDemoData.ts`.

### 2.4 Estados del agente

`getAgentLifecycleStatus`: `revoked` si `lifecycle_status === 'revoked'` o `is_active === false`; `active` si `lifecycle_status === 'active'` o hay `last_heartbeat_at`; en otro caso `provisioned`. Transiciones válidas (`assertAgentTransition`): `provisioned → active`, `provisioned → revoked`, `active → revoked`. `revoked` es terminal.

Conectividad derivada (`getAgentConnectivity`), no persistida:
- `revoked`: ciclo de vida revocado.
- `pending`: sin `last_heartbeat_at`.
- `online`: último heartbeat hace como máximo `OFFLINE_THRESHOLD_SECONDS` = 600 s (el doble de `HEARTBEAT_INTERVAL_SECONDS` = 300) y no en el futuro.
- `offline`: el resto.

Cuenta para el cupo (`countsTowardAgentLimit`) todo agente no revocado, incluido el que nunca se conectó.

### 2.5 Estados del reporte

| Estado | Significado |
|---|---|
| `received` | Estado inicial dentro de la transacción. Con el flujo actual no se confirma nunca en ese estado (§6.4). |
| `processed` | Reporte `completed` o `partial` aplicado al inventario. Se conserva aunque haya activos rechazados. |
| `failed` | El agente informó `execution_status: failed`: se guarda como diagnóstico y no toca el inventario. |

`execution_status` (`completed` \| `partial` \| `failed`) es el declarado por el agente, salvo un caso: si declaró `completed` y la ingesta rechazó al menos un activo, se guarda `partial`.

## 3. Autenticación, permisos y alcance

Hay dos tipos de cliente, con mecanismos separados.

### 3.1 Rutas de agente: token por agente

Aplica a `POST /v1/reports`, `POST /v1/heartbeat` y `GET /v1/vendor`. No usan sesión ni `getTenantContext`.

El agente envía `Authorization: Bearer <token>`. `resolveAgentAuth`, en orden:
1. Sin token tras quitar `Bearer ` y espacios: 401 `missing bearer token`.
2. Busca el agente por `apiKeyPrefix` (primeros 8 caracteres del token). Sin coincidencia: 401 `unknown token`. No suma intentos fallidos a nadie.
3. Si `lockedUntil` es futuro: 429 `agent temporarily locked out`, sin comparar el hash.
4. `bcrypt.compare(token, apiKeyHash)`. Si falla: registra el intento fallido (§3.2) y responde 401 `invalid token`.
5. Con el hash correcto y `is_active` falso: 401 `agent revoked`. Solo se llega acá con una credencial válida, y por eso el agente lo interpreta como revocación real (§5.2).
6. Si viene `X-Agent-ID` y difiere del id del agente: 401 `agent_id mismatch`. Si el encabezado no viene, no se compara.

Devuelve `{ agentId, officeId, organizationId }`. Esa identidad define la oficina y la organización de todo lo que se escribe; **nunca** se toman del cuerpo.

`reports.ts` envía `Authorization` y `X-Agent-ID`. `heartbeat.ts` y `vendor.ts` no leen `X-Agent-ID`; el agente tampoco lo manda en esas dos rutas.

Los errores de autenticación del agente tienen forma `{ error: <mensaje> }`. Los textos son parte del contrato con el agente (§5.2): `heartbeat.ts` lo declara en un comentario y remite a `SYSTEM_PROMPT.md` §6 (no cambiarlos sin versionar el canal).

### 3.2 Lockout escalonado

Constantes de `agent-state.ts`: `AGENT_LOCKOUT_THRESHOLD` = 10, `AGENT_LOCKOUT_MINUTES` = 15, `AGENT_LOCKOUT_ESCALATION_THRESHOLD` = 3. `recordFailedAttempt` (en `createPayloadAgentAuthDeps`):
- Con menos de 10 fallos acumulados: incrementa `failedAttempts`.
- Al llegar a 10: `failedAttempts` vuelve a 0, `lockoutCount` suma 1 y, si `lockoutCount` es menor que 3, `lockedUntil` queda 15 minutos adelante.
- Si `lockoutCount` llega a 3: revoca al agente con motivo `auto_lockout_abuse` (`buildRevocationData`) y limpia el lockout.

Razón declarada en el código: un tercero que conozca solo el prefijo (visible en la UI o en logs) no puede dar de baja a un agente legítimo con una sola ráfaga.

`resetAttempts` pone `failedAttempts`, `lockoutCount` y `lockedUntil` en cero. Lo llaman `reports.ts` (inmediatamente después de autenticar, antes de validar el cuerpo) y `heartbeat.ts` (tras actualizar el agente). `vendor.ts` no lo llama.

El incremento es una lectura-modificación-escritura sin bloqueo: dos fallos concurrentes pueden contarse como uno.

### 3.3 Rutas de personas: sesión y matriz RBAC

Las rutas de personas llaman a `getTenantContext`: sin contexto o con `isActive` falso, 401 `unauthenticated`. Matriz (`access/rbac/permissions.ts`):

| Colección y acción | `org_admin` | `office_manager` | `org_viewer` | `platform_admin` |
|---|---|---|---|---|
| `agents`: `create`, `read`, `update` | sí | no | no | solo con `?asOrganization=` (se evalúa como `org_admin`, `canDo`) |
| `scan-reports`: `read` | sí | sí | sí | sí |
| `scan-reports`: `read_technical` | sí | sí | no | sí (con organización seleccionada, para el endpoint de sesión) |
| `scan-reports`: `update` (solo renombrar) | sí | sí | no | solo con organización |
| `inventory-snapshots`: `create` | sí | **no** | no | solo con organización |
| `inventory-snapshots`: `read` | sí | sí | sí | sí |
| `inventory-snapshots`: `update` (solo renombrar) | sí | sí | no | solo con organización |
| `job-runs`: `read` | no | no | no | sí |

`canDo` devuelve falso para un `platform_admin` sin organización en cualquier acción distinta de `read`. Por eso, en aprovisionamiento, revocación y generación de instantáneas, la rama `unrestricted` (`isPlatformAdmin && !organizationId`) no se alcanza en la práctica: `canDo` ya respondió 403.

Alcance de fila:
- `scan-reports.read`: `{ office in ctx.officeIds }` (`kind: 'offices'`). `inventory-snapshots.read`: organización del actor y, para roles sin alcance organizacional, oficina en `ctx.officeIds` (`kind: 'org_offices'`). Un `platform_admin` sin organización ve todo.
- Campos técnicos: `scan-reports.raw_payload` y `scan-reports.error` leen con `readTechnicalEvidence` (permiso `read_technical`). `inventory-snapshots.assets_dump` pasa por `redactSnapshotForViewer`. El `org_viewer` conserva el resumen y el inventario normalizado, y no ve el payload crudo ni las salidas de scripts.
- Los endpoints de escritura repiten el alcance a nivel de fila: `assertOfficeInScope` (oficina del actor, 403) y `assertOrganizationMatches` (organización de la fila, 403 `Este recurso pertenece a otra organización`). Ambos lanzan `APIError`, así que el cuerpo de error es el de Payload (`{ errors: [...] }`), no `{ error }`.

### 3.4 Rutas de infraestructura: token de servicio

`endpoints/internalJobs.ts`. `isAuthorized` compara el `Authorization` (sin `Bearer`) contra `process.env.INTERNAL_JOBS_TOKEN` por igualdad de cadena. Sin la variable configurada, rechaza todo (falla cerrado). Respuesta de rechazo: 401 `unauthorized`. No usa sesión ni token de agente.

## 4. Contrato HTTP

Prefijo `/api`. Todas las respuestas de error propias son JSON `{ error: <código o mensaje> }`; los errores `APIError` (alcance, conflicto de `report_id`, validación de `processScanReport`) usan la forma de Payload.

| Método y ruta | Cliente y autenticación | Permiso | Entrada | Respuesta OK |
|---|---|---|---|---|
| `POST /v1/reports` | agente (token + `X-Agent-ID`) | — | `ScanReportPayloadSchema`, ≤ 5 MiB | 200 `{ report_id, status, processed, rejected }` |
| `POST /v1/heartbeat` | agente (token) | — | `HeartbeatPayloadSchema`, ≤ 16 KiB | 200 `{ status: 'ok' }` |
| `GET /v1/vendor?mac=` | agente (token) | — | query `mac` | 200 `{ vendor }` |
| `POST /v1/agents/provision` | sesión | `agents.create` | `{ office_id, platform? }` | 201 `application/zip` |
| `POST /v1/agents/:id/revoke` | sesión | `agents.update` | — | 200 documento del agente (§4.5) |
| `GET /v1/offices/agent-summary` | sesión | `offices.read` (detalle con `agents.read`) | — | 200 `{ docs, quota }` |
| `POST /v1/inventory-snapshots/generate` | sesión | `inventory-snapshots.create` | `{ office_id }` | 201 instantánea |
| `PATCH /v1/scan-reports/:id/name` | sesión | `scan-reports.update` | `EvidenceNameSchema` | 200 `{ id, display_name }` |
| `PATCH /v1/inventory-snapshots/:id/name` | sesión | `inventory-snapshots.update` | `EvidenceNameSchema` | 200 `{ id, display_name }` |
| `POST /v1/internal/jobs/aging-sweep` | token de servicio | — | — | 200 `{ status: 'ok', summary }` |
| `POST /v1/internal/jobs/expire-scan-payloads` | token de servicio | — | — | 200 `{ status: 'ok', summary }` |
| `GET /api/scan-reports`, `/api/scan-reports/:id` | sesión (REST de Payload) | `scan-reports.read` | query de Payload | documentos |
| `GET /api/inventory-snapshots`, `/api/inventory-snapshots/:id` | sesión (REST de Payload) | `inventory-snapshots.read` | query de Payload | documentos |

### 4.1 `POST /v1/reports`

Orden de verificaciones del endpoint:
1. Lectura acotada del cuerpo (`readBoundedJSON`, 5 MiB): se cuentan los bytes antes de decodificar, también sin `Content-Length`. Errores: 400 `invalid content-length`, 413 `payload too large`, 400 `missing payload`, 400 `invalid JSON`. Ocurre **antes** de autenticar.
2. `resolveAgentAuth` (§3.1) con `Authorization` y `X-Agent-ID`.
3. `resetAttempts` del agente.
4. `ScanReportPayloadSchema.safeParse`. Falla: 400 `{ error: 'invalid payload', issues }`.
5. `body.agent_id !== auth.agentId`: 401 `agent_id mismatch`.
6. Algún `asset.agent_id` distinto de `body.agent_id`: 400 `asset agent_id mismatch`.
7. `processScanReport` (§6).

Respuesta: `{ report_id, status: 'processed' | 'failed', processed: <cantidad de activos aplicados>, rejected: [{ asset_id, error }] }`. En un reintento de un reporte ya procesado, `processed` es 0 y `rejected` vacío: no se reconstruye la respuesta original (§6.1).

Errores de dominio que salen de `processScanReport` como `APIError`: 400 `invalid scan report` (revalida el schema), 400 `agent_id mismatch`, 409 `report_id already belongs to a different agent or payload`. Cualquier otra excepción se propaga como 500.

### 4.2 Contenido del reporte (`ScanReportPayloadSchema`)

Todos los objetos son `.strict()`: un campo desconocido es 400. Los schemas reflejan `scanner-prototype/src/siam_agent/models.py` (comentarios `Mapeo 1:1` en el código).

Cabecera:
- `report_id`, `agent_id`: texto 1–120.
- `network`: CIDR IPv4 privado canónico con prefijo /16 a /32 (`ScanNetworkSchema`; rangos 10/8, 172.16/12, 192.168/16).
- `scan_start`, `scan_end`: ISO con offset.
- `hosts_up`: entero 0–65534; debe igualar `assets.length`.
- `assets`: hasta 65534.
- `scan_mode` (`full` \| `degraded`) y `scan_mode_reason` (≤ 500, `null` en `full`, obligatorio en `degraded`).
- `execution_status`: `completed` \| `partial` \| `failed`.
- `scanner_interfaces`: hasta 16 `{ name, ip, mac, network, is_route_to_target }`.
- `report_coverage`: `schema_version` 1, `profile` `siam_standard_v1`, `discovery`, `ports` (hasta 8), `service_detection`, `os_detection`, `name_resolution`, `limitations` (hasta 30). Estados de cobertura: `complete`, `partial`, `not_attempted`, `unknown`.
- `gateway_ip`, `gateway_mac`: nulos si el agente no pudo resolverlos. Es el gateway de la ruta efectiva al objetivo.

Reglas cruzadas (`superRefine`):
- `scan_start` no posterior a `scan_end`; `scan_end` no más de 5 minutos en el futuro (`SCANNER_CLOCK_TOLERANCE_MS`).
- `scan_mode: degraded` no puede declarar `os_detection: complete`.
- Cada activo: `scan_time` dentro de `[scan_start, scan_end]` con tolerancia de 5 minutos y no en el futuro; `ip` dentro de `network`; ninguna cobertura de activo puede superar la del reporte (un `host_timeout` en `limitations` permite que el reporte esté `partial` y el activo `complete`; `name_resolution` no tiene esa excepción).

Activo (`AssetPayloadSchema`): `asset_id`, `agent_id`, `ip` (IPv4), `mac` (vacía o `AA:BB:CC:DD:EE:FF` en mayúsculas), `vendor`, `hostname`, `os` y `os_candidates` (hasta 3), `services` (hasta 4096; cada uno con puerto, protocolo, estado, producto, versión, `cpe`, método de detección, confianza 0–10, `scripts`), `scan_time`, `state_reason`, `host_scripts`, `names` (hasta 20, fuentes `nmap`, `ptr`, `mdns`, `netbios`, `ssdp`), `mac_metadata`, `asset_coverage`, `scan_issues` (hasta 20). Una clase de MAC con dirección (`globally_administered`, `locally_administered`, `multicast`, `broadcast`) exige MAC no vacía; `vendor_resolution: resolved` exige `vendor`.

El contrato debe cambiar solo de forma aditiva mientras haya agentes viejos desplegados; un cambio incompatible exige versionar la ruta (`SYSTEM_PROMPT.md` §6). Los comentarios del schema muestran ese criterio en dos campos: `HeartbeatPayloadSchema.status` usa `.catch('unknown')` para tolerar valores desconocidos de agentes viejos, y `AssetPayload.os.device_type` se menciona como campo con compatibilidad hacia agentes anteriores.

### 4.3 `POST /v1/heartbeat`

Orden: lectura acotada (16 KiB, mismos errores que §4.1) → `resolveAgentAuth` (solo `Authorization`) → `HeartbeatPayloadSchema` (400 `{ error: 'invalid payload', issues }`) → `body.agent_id !== auth.agentId` (401 `agent_id mismatch`).

`HeartbeatPayloadSchema` (`.strict()`): `agent_id` (1–120), `status` (`idle` \| `scanning` \| `unknown`; cualquier otro valor se convierte en `unknown`), `timestamp` (ISO con offset).

Efecto: lee el agente y lo actualiza con `last_heartbeat_at` = reloj del servidor, `last_agent_timestamp` = timestamp del cuerpo, `runtime_status`, `lifecycle_status: 'active'` y, si no había, `first_heartbeat_at`. Después llama a `resetAttempts`. Respuesta 200 `{ status: 'ok' }`.

El `update` no tiene `catch`: cualquier fallo responde 500 y el agente reintenta en el siguiente ciclo. Si el agente se revoca durante el request, el `update` no falla: el hook `beforeChange` calcula el estado con `{ ...originalDoc, ...data }`, y como `is_active` ya es `false`, el agente sigue `revoked`. La respuesta es 200, y el siguiente heartbeat recibe 401 `agent revoked` desde `resolveAgentAuth`.

### 4.4 `GET /v1/vendor`

Autentica como el heartbeat (solo `Authorization`). Parámetro `mac`: se quitan `:` y `-`, se pasa a mayúsculas y se toman los 6 primeros caracteres (OUI). Búsqueda en `MOCK_VENDORS`, un catálogo fijo de dos entradas (`44D454`, `C07982`); el comentario `ponytail` del archivo lo declara catálogo de demo, equivalente a `_MOCK_VENDORS` de `scanner-prototype/src/siam_agent/mock_server.py`. Resultado: 200 `{ vendor }` o 404 `{ error: 'unknown vendor' }`, incluido el caso sin `mac`. El 404 es parte del contrato: el cliente lo trata como "plataforma disponible, MAC desconocida".

### 4.5 `POST /v1/agents/provision`

Cuerpo: `{ office_id: string, platform?: 'posix' | 'windows' }`. `platform` es opcional a propósito: un cliente anterior al soporte Windows no lo manda y recibe el paquete `posix`.

Orden en el endpoint:
1. Sesión (401 `unauthenticated`) y permiso `agents.create` (403 `forbidden`).
2. `office_id` ausente o no texto: 400 con `error: 'office_id es requerido'` (el campo `error` lleva el mensaje, no un código).
3. `platform` fuera de la lista: 400 `platform_invalid`.
4. Carga la oficina. Inexistente o con `is_active` falso: 404 `office_not_available`.
5. `assertOrganizationMatches`: oficina de otra organización, 403 (`APIError`).
6. Genera `agentId` (`agent-<uuid>`) y el token (32 bytes aleatorios en base64url). Construye el paquete `.zip` **antes** de reservar cupo.
7. Dentro de `withAgentQuotaLock(organizationId)`: `getAgentQuota`; sin suscripción, 422 `subscription_not_found`; `quota.available === 0`, 409 `agent_limit_reached` con `{ error, limit, used, available, per_office }`; si hay cupo, crea el agente (`lifecycle_status: 'provisioned'`, `is_active: true`) pasando el token por `context.provisionApiKey`.
8. Respuesta 201 con el `.zip` (`Content-Type: application/zip`, `Content-Disposition: attachment; filename="<agentId>-<platform>.zip"`, `Cache-Control: no-store`).

Este endpoint **no** llama a `assertOfficeInScope`: solo verifica la organización de la oficina, no que la oficina esté entre las del actor. Con la matriz actual solo `org_admin` (y `platform_admin` con organización) tienen `agents.create`, y ambos tienen alcance organizacional, así que hoy no hay diferencia observable.

Contenido del paquete (`buildAgentPackage`): `src/siam_agent/` (copia del directorio del agente, sin `__pycache__` ni `.pyc`; un symlink aborta con error), `requirements.txt`, el launcher del SO elegido (`start-agent.sh` para `posix`; `start-agent.ps1` y `start-agent.cmd` para `windows`), `.env` (permisos `600`) y `README.md`. Las variables del `.env` son `AGENT_ID`, `PLATFORM_TOKEN`, `PLATFORM_URL` (`<origen>/api/v1/reports`) y `HEARTBEAT_URL` (`<origen>/api/v1/heartbeat`). El archivo se escribe con CRLF en el paquete Windows. El origen sale de `platformOrigin()` (`lib/platform-origin.ts`) a partir de `NEXT_PUBLIC_SITE_URL`: en producción la variable es obligatoria y debe ser un origen HTTPS canónico; en desarrollo se acepta HTTP solo en loopback y, sin variable, se usa `http://localhost:3001`. Nunca se deriva del encabezado `Host`. La raíz del fuente del agente es `SCANNER_SOURCE_ROOT` o, por defecto, `../scanner-prototype` respecto del directorio de trabajo del proceso.

El `.env` no incluye `VENDOR_URL`; el agente lo deriva de `PLATFORM_URL` (`config.py`: reemplaza el último segmento por `vendor`).

### 4.6 `POST /v1/agents/:id/revoke`

Sin cuerpo. Orden: sesión, permiso `agents.update`, carga del agente (404 `not_found`), `assertOrganizationMatches` y `assertOfficeInScope` (403). Si el agente ya está revocado, devuelve el documento sin escribir (idempotente). Si no, `update` con `buildRevocationData('manual')`: `lifecycle_status: 'revoked'`, `is_active: false`, `revoked_at`, `revocation_reason: 'manual'`.

La respuesta es el documento del agente, tanto si se revoca ahora como si ya estaba revocado. No incluye `apiKeyHash` (campo `hidden`); conserva `apiKeyPrefix` y los contadores de bloqueo.

### 4.7 `GET /v1/offices/agent-summary`

Sin parámetros. Orden: sesión; permiso `offices.read` (403); si no hay organización en el contexto (PlatformAdmin sin `asOrganization`), 200 `{ docs: [], quota: null }`. Toma las oficinas de la organización que estén en `ctx.officeIds`, los agentes de esas oficinas y arma una fila por oficina.

Forma de la respuesta según el permiso:
- Con `agents.read` (`org_admin`, `platform_admin` con organización): `docs` son `DetailedOfficeAgentSummary` — `{ office_id, total, active, online, offline, never_connected, agents: [{ id, lifecycle_status, connectivity, revocation_reason, last_heartbeat_at }] }`. `active` cuenta los no revocados; `never_connected` los `pending`. `quota` es `{ limit, used, available, per_office }` (`getAgentQuota` sin oficina), o `null` si la organización no tiene suscripción (con 200 y las filas igual).
- Sin `agents.read` (`office_manager`, `org_viewer`): `docs` son `{ office_id, scanner_status }` y `quota: null`.

`getOfficeScannerStatus` resume una fila: `not_installed` (sin agentes), `inactive` (todos revocados), `online` (al menos uno en línea), `pending` (todos los activos sin primer heartbeat), `offline` (resto).

### 4.8 `POST /v1/inventory-snapshots/generate`

Cuerpo `{ office_id }`. Orden: sesión; permiso `inventory-snapshots.create` (403); `office_id` ausente, 400 `office_id es requerido` (mensaje en `error`); `assertOfficeInScope` (403); carga de la oficina (si no existe, `findByID` lanza y la respuesta es el error de Payload); `assertOrganizationMatches` (403); oficina con `is_active === false`, 409 `office_inactive`. Crea la instantánea con `createInventorySnapshot(..., { type: 'manual', userId })` y la vuelve a leer con `overrideAccess: false`, para que la respuesta pase por el control de acceso y la redacción del actor. 201 con el documento (profundidad 0).

### 4.9 Renombrado: `PATCH /v1/scan-reports/:id/name` y `/v1/inventory-snapshots/:id/name`

Ambos salen de `renameEndpoint(collection, path)`. Cuerpo `EvidenceNameSchema`: `{ display_name: string | null }`; el texto se recorta, admite hasta `EVIDENCE_NAME_MAX` = 80, debe cumplir `TEXT_RULES.label` y un valor vacío se guarda como `null` (vuelve al título por defecto). La clave `display_name` es obligatoria (es `nullable`, no opcional).

Orden: sesión; exige `ctx.organizationId` y permiso `update` sobre la colección (403 `forbidden`; un PlatformAdmin sin organización queda fuera); cuerpo inválido, 400 `invalid_body` (sin `issues`); documento inexistente, 404 `not_found`; `assertOfficeInScope` con la oficina del documento y `assertOrganizationMatches` con la organización de esa oficina (403). Actualiza solo `display_name` con `overrideAccess: true`. Respuesta 200 `{ id, display_name }` (`null` si quedó vacío).

El permiso del cliente (`renameEvidence` en `endpoints/session.ts`) se calcula con `canDo(..., 'scan-reports', 'update')` y se usa para ambas colecciones. La matriz da el mismo resultado para las dos.

### 4.10 Trabajos internos

`POST /v1/internal/jobs/aging-sweep` ejecuta `agingSweep`; `POST /v1/internal/jobs/expire-scan-payloads` ejecuta `expireRawScanPayloads`. Éxito: 200 `{ status: 'ok', summary }`. Cualquier excepción: 500 `{ status: 'error', message }`. Resúmenes en §8.

## 5. Reglas por operación del canal del agente

### 5.1 Aprovisionamiento y credencial

- El token en claro existe solo en el `.env` del paquete y durante la solicitud. En base queda el hash `bcrypt` y el prefijo. No hay endpoint para volver a descargar una credencial ni para rotarla: reemplazar un escáner es aprovisionar otro y revocar el anterior.
- Cada aprovisionamiento crea un agente nuevo `provisioned`. Mientras no esté revocado consume cupo (§9), aunque nunca se haya conectado.
- La construcción del paquete ocurre antes del cupo y de la creación: un fallo de E/S (por ejemplo, fuente del agente ausente) responde con error y no deja agente ni credencial.

### 5.2 Heartbeat y revocación vistos desde el agente

Lo que se verifica leyendo `scanner-prototype/src/siam_agent`:
- `config.py` define `HEARTBEAT_URL`, `PLATFORM_URL`, `VENDOR_URL`, `PLATFORM_TOKEN`, `AGENT_ID` a partir del entorno; el intervalo del heartbeat es 300 s por defecto, con un máximo de 540 s (comentario: la plataforma marca `offline` a los 600 s).
- `agent.py::_send_heartbeat` envía `{ agent_id, status, timestamp }` con solo `Authorization`. Se envía al iniciar y luego cada intervalo.
- `agent.py::_is_revocation` considera revocación únicamente 401 con `{ "error": "agent revoked" }`. Al detectarla, detiene el agente, descarta la cola local y sale con código 3. Un 429 (lockout), un 401 con otro texto o un fallo de red mantienen el comportamiento de reintento.
- `agent.py::_send_heartbeat`, cuando el estado es `idle`, intenta además vaciar la cola de reportes pendientes.
- Un 401 `agent revoked` en `POST /v1/reports` **no** detiene al agente: `sender.py` lo trata como rechazo permanente de ese reporte (§6.5). La detención ocurre solo por el heartbeat.

El texto `agent revoked` se emite desde un solo lugar: `resolveAgentAuth`, con una credencial válida y el agente inactivo.

### 5.3 Vendor

El agente consulta `GET /v1/vendor` desde `oui_lookup.py::_lookup_vendor_remote` con timeout de 2 s. Ante fallo de conexión o timeout desactiva la consulta remota por el resto de la ejecución. Cualquier estado distinto de 200 devuelve `None` sin desactivarla y cae a la caché local OUI.

## 6. Ingesta de reportes

### 6.1 Idempotencia y conflicto de `report_id`

`processScanReport` calcula `content_fingerprint` = SHA-256 de una serialización canónica del reporte ya validado (`canonicalJson`, `lib/canonical-json.ts`: claves ordenadas por unidad de código UTF-16, recursiva; no depende del locale ni del ICU del runtime). `scripts/check-canonical-fingerprints.ts` (solo lectura) recalcula la huella de los reportes que aún conservan `raw_payload` para confirmar que un cambio en la serialización no invalida reintentos. Busca un `scan-reports` con ese `id`:
- Existe con otro agente **o** con otra huella: `APIError` 409 `report_id already belongs to a different agent or payload`. No se escribe nada.
- Existe con `status` distinto de `received`: devuelve el resultado como ya procesado (`alreadyProcessed: true`, `processedAssetIds: []`, `rejectedAssets: []`, `status` `failed` o `processed` según el guardado). No toca inventario, instantáneas ni cumplimiento.
- Existe en `received`: retoma el procesamiento sin recrear el registro (rama defensiva; §6.4).
- No existe: lo crea.

La identidad de un reporte es el par `report_id` + contenido: reintentar el mismo reporte es seguro; reutilizar el id con otro contenido o desde otro agente se rechaza.

### 6.2 Orden de efectos (`processScanReport`)

Todo ocurre dentro de una única transacción (§6.3):
1. Revalida el reporte con `ScanReportPayloadSchema` y la coincidencia de `agent_id` (400 si falla). Este mismo código lo usa también el seed de demo, por lo que el endpoint y el seed no se desvían en semántica.
2. Toma el lock `scan-report:<report_id>` y resuelve la idempotencia (§6.1).
3. Crea `scan-reports` con `status: 'received'`, la oficina del agente, `raw_payload` = reporte completo y `raw_payload_expires_at` = ahora + `RAW_TECHNICAL_RETENTION_DAYS` (30) días.
4. Si `execution_status !== 'failed'`: `maybeCreateAutoSnapshot`. La instantánea representa el estado **anterior** a aplicar este reporte (comentario del código).
5. Si es `failed`: resultado vacío. Si no: `ingestScanReport` (§6.6).
6. Si no es `failed`: `reevaluateComplianceAfterScan` (organización, oficina, ids de documentos procesados, fecha `scan_end`). El detalle pertenece a `assessments-api.md`.
7. Actualiza el reporte: `status` `failed` o `processed`; `execution_status` degradado a `partial` si era `completed` y hubo rechazos; `processed_at`; `error` = JSON de `rejectedAssets` o `null`.

Un reporte `failed` guarda cabecera, cobertura y payload como diagnóstico, no crea instantánea ni modifica activos y queda en `status: failed`.

### 6.3 Transacción, aislamiento y bloqueos

`processScanReport` envuelve todo en `withTransaction(payload, request, command, { isolationLevel: 'repeatable read', lockKey: 'inventory:<organizationId>' })` (`domain/with-transaction.ts`):
- **Lock por organización.** Serializa todas las observaciones de inventario de una organización (advisory lock transaccional sobre `inventory:<organizationId>`) antes de buscar identidades y hacer upserts. Dos reportes distintos de la misma organización se procesan uno tras otro; el segundo ve lo que confirmó el primero.
- **Cómo se adquiere con `repeatable read`.** El snapshot de lectura se fija en la primera sentencia, así que bloquear dentro de la transacción leería datos anteriores al titular del lock. Si la transacción es propia, intenta `pg_try_advisory_xact_lock`; si está ocupado, hace rollback, espera el lock en una transacción descartable y reinicia con un snapshot nuevo. El comentario `ponytail` declara que la espera no tiene tope; termina porque cada titular confirma o revierte.
- **Lock por reporte.** `scan-report:<report_id>` se toma dentro de la transacción.
- **Reintento por conflicto.** Si el comando falla con `40001` (serialización), `40P01` (deadlock) o `23505` (unicidad, con `repeatable read`), o con un `ValidationError` de Payload originado en una violación de unicidad, se reejecuta **todo** el comando, hasta 3 intentos en total. Si la transacción viene heredada (`request` con `transactionID`), no reintenta y el dueño decide.
- Requiere transacciones PostgreSQL: sin ellas, error `This operation requires PostgreSQL transactions`.

### 6.4 Rollback ante fallo parcial

Cualquier excepción dentro del comando revierte la transacción completa: el registro `scan-reports`, los activos tocados, la instantánea automática y los encolados de riesgo (`enqueueRiskRecalculation` reutiliza la transacción). No queda un reporte `received` a medias ni un inventario parcial. El endpoint responde 500 (excepción no controlada) o el estado del `APIError`, y el agente reintenta con el mismo `report_id`, que se procesa desde cero. Esto está cubierto por la prueba "second asset failure rolls back the whole report; retry creates exactly one snapshot" (§11).

Por eso un reporte persistido en `received` no debería existir tras un commit; la rama de `status === 'received'` de §6.1 es defensiva (la ejercita una prueba que crea el registro a mano).

### 6.5 Reintentos del agente y respuesta de la plataforma

Verificado en `scanner-prototype/src/siam_agent/sender.py`:
- El agente persiste cada reporte en una cola SQLite antes de enviarlo (`enqueue_report`) y entrega en orden (`flush_queue`), con un lock que evita vaciados simultáneos. Las rutas `_post_once` devuelven si el fallo es reintentable.
- Son reintentables: errores de conexión, timeouts, 408, 429 y 5xx. Quedan en la cola.
- Son rechazos permanentes (el reporte se descarta de la cola, y el siguiente continúa): cualquier otro 4xx, es decir 400 (contrato), 401 (token), 403, 409 (`report_id` en conflicto) y 413 (tamaño).
- Consecuencia para la plataforma: un 5xx o una excepción no controlada durante el procesamiento provoca un reintento seguro (la transacción se revirtió y la idempotencia protege). Un 4xx descarta el reporte para siempre en el agente.

`send()` hace hasta 3 intentos con 5 s de espera; `flush_queue` usa un intento por reporte por pasada.

### 6.6 Upsert de activos (`ingestScanReport`)

Este documento describe la ingesta como parte del canal; las reglas de negocio de los activos viven en `assets-api.md`.

Por reporte:
1. **Agrupación por IP.** Los activos con la misma IP y contenido idéntico se colapsan en uno. Si difieren, se registra un incidente de `identity` (`recordInventoryIncident`) y **todas** las filas de esa IP se rechazan con "Equipo por revisar: observaciones contradictorias para la misma dirección."
2. **Normalización de identidad** (`normalizeAssetIdentity`): la plataforma clasifica la MAC por sus bits (`classifyMac`: global, local, multicast, broadcast, inválida, desconocida) e ignora la clasificación del agente. Solo conserva `mac` si es global o local, y `vendor` solo si es global.
3. **Campos obligatorios** (`asset_id`, `ip`, `scan_time`): si faltan, el activo se rechaza con `campos técnicos faltantes: ...`. `mac`, `vendor` y `hostname` son opcionales a propósito: un host sin ellos no se descarta.
4. **Búsqueda del activo existente** (`findExistingAsset`):
   - MAC global o local: busca por MAC dentro de la organización (la local, solo en la misma oficina). Un registro retirado o eliminado de **otra** oficina es historial (`pickMacMatch`): suelta su `identity_key` para que la tome el equipo observado ahora, y no coincide.
   - Si no hay coincidencia por MAC: busca por IP en la misma oficina (el más reciente por `last_seen`). Un candidato sin MAC es el mismo equipo. Un candidato con otra MAC, frente a un reporte con MAC usable, es otro dispositivo (IP reasignada). Frente a un reporte sin MAC usable, el candidato solo coincide si no superó `offline_after_hours` de la organización.
5. **Ubicación.** Si el activo existente está en otra oficina y la observación es la más reciente, se registra un incidente de `location` y se marca `location_pending`; el activo se rechaza con "Ubicación por confirmar..." hasta que un responsable decida. Si la decisión previa fue `kept`, solo se refresca la presencia (`last_seen`, y `status: active` si no está retirado) sin tocar oficina, agente ni identidad. La resolución del incidente (`POST /v1/inventory-incidents/:id/resolve`) pertenece a `assets-api.md`.
6. **Bloque técnico** (`sanitizeTechnicalBlock`): solo se persisten campos conocidos del contrato, nunca el cuerpo por spread. Política de fusión:
   - *Identidad* (`mac`, `vendor`, `hostname`, `os`, `os_candidates`, `gateway_*`): "not-null-wins". Un valor vacío del reporte no borra el último conocido, porque un escaneo degradado no puede ver esos datos.
   - *Dinámico* (`ip`, `services`, `state_reason`, `host_scripts`, `names`, `mac_metadata`, `asset_coverage`, `scan_issues`, `last_seen` y derivados): refleja la última observación y solo reemplaza al existente si `scan_time` no es anterior a `last_seen`. Un reporte demorado no pisa evidencia más reciente.
   - Siempre: `observed_agents` (una fila por agente con su última observación), `evidence_history` (hasta 100 filas), `applied_report_ids` (últimos 50). Reintentar el mismo `report_id` no incrementa dos veces `evidence_history` (`alreadyApplied`).
   - `os_status` lo decide la plataforma: `identified` si el mejor candidato tiene al menos 85 de precisión y supera estrictamente al segundo; si no, `indeterminate`.
   - La plataforma deriva `is_scanner_host` y `scanner_host_match` comparando IP y MAC con `scanner_interfaces`, y recalcula la inferencia de tipo de dispositivo (`inferDeviceCategory`, `inference_version: 2`).
7. **Escritura.** Con activo existente: `update` con `context.systemJob = true`. Marca `technical_changed_at` solo si el activo ya fue visto por una persona (`first_viewed_at`) y cambió algún campo técnico (`hasTechnicalChanged`). Pasa a `status: active` salvo que esté `retired` (un escaneo no revive un activo dado de baja) o que la observación no sea la más reciente. Si estaba `confirmed` con tipo confirmado y la inferencia `likely` diverge, pasa a `identification_status: needs_review`. Sin activo: `create` con `status: active`. Los campos de negocio (alias, criticidad, ubicación, responsable) nunca se tocan.
8. **Riesgo.** Al final, `enqueueRiskRecalculation` para la organización, la oficina del agente y las oficinas cuya presencia se refrescó por una decisión `kept`.

El resultado reporta `processedAssetIds` (id técnico `asset_id`), `processedDocumentIds` y `rejectedAssets`. El caso `kept` no se cuenta como procesado.

### 6.7 Aging y presencia

La ingesta fija `last_seen` con el `scan_time` del activo y lo pasa a `active` (salvo `retired`). La plataforma no detecta ausencias por reporte: un activo que no aparece en un escaneo, incluso `partial`, no cambia de estado por eso. El paso a `offline` es solo por tiempo (§8.1).

## 7. Instantáneas de inventario

### 7.1 Creación (`createInventorySnapshot`)

`createInventorySnapshot(payload, officeId, trigger, request?)` abre una transacción `repeatable read` (o hereda la del llamador) y, en ella:
1. Carga la oficina y su organización.
2. Recorre por páginas de 100 todos los `assets` y `non-network-assets` de la oficina con `deleted_at` vacío.
3. Calcula el riesgo **en ese instante** con `recalculateRisk` (nunca reutiliza el último resultado almacenado: puede haber un recálculo encolado sin correr). Esto persiste una `risk-evaluations`.
4. Crea la instantánea: `generated_by` según el disparador, `triggered_by_user` solo en `manual` (`actorRelation`: `users` o `admins`), `risk_score` = la evaluación, `assessment_results_snapshot` y `assets_dump` por valor.

Si cualquier paso falla, no queda instantánea ni evaluación. No toma el lock por organización de la ingesta: una instantánea manual concurrente con una ingesta ve un estado consistente (`repeatable read`), anterior o posterior a ella, pero no serializado con ella.

### 7.2 Instantánea automática (`maybeCreateAutoSnapshot`)

Se invoca desde `processScanReport` (§6.2, paso 4), dentro de la transacción de la ingesta, solo para reportes no `failed` y no repetidos. Lee `organization-settings` de la organización:
- Con `snapshot_before_each_scan` verdadero: crea una instantánea `scheduled` en cada reporte aplicado, sin mirar el intervalo.
- Si no: `snapshot_interval_days` (valores válidos `1, 3, 7, 14, 30`; por defecto `DEFAULT_SNAPSHOT_INTERVAL_DAYS` = 7). Busca la última instantánea de la oficina, de cualquier origen, y crea una nueva si no hay ninguna o si pasó el intervalo (`shouldTakeSnapshot`). Una instantánea manual reciente pospone la automática.

Las propiedades de organización se documentan en `organization-settings-api.md`.

### 7.3 Lectura

Detalle y listado por REST de Payload. El `afterRead` de `assets_dump` redacta `host_scripts` y `scripts` para quien no tiene `read_technical` (§3.3).

## 8. Trabajos y efectos del sistema

### 8.1 `aging-sweep` (`agingSweep`)

Pasa a `offline` los activos `active` que superan el umbral de su organización.
- Umbral: `offline_after_hours` de `organization-settings` (valores `24, 48, 72, 96, 168`), por defecto `DEFAULT_OFFLINE_AFTER_HOURS` = 72. Es por organización: dos organizaciones pueden tener resultados distintos en la misma corrida.
- `shouldGoOffline(lastSeen, hours, now)`: vencido si `now - last_seen >= hours`. Un `last_seen` nulo cuenta como vencido.
- Recorre `status: active` ordenado por `id` con cursor (`id > último`) en lotes de 200. El cursor evita saltarse filas: al pasar a `offline`, la propia consulta se encoge, y una paginación por offset perdería elementos.
- Cada transición ocurre en su propia transacción: toma `lockAssetRow` (`FOR UPDATE`), relee el activo y vuelve a evaluar estado y vencimiento (si un escaneo lo refrescó entre tanto, no se toca), escribe `status: 'offline'` con `context.systemJob` y encola recálculo de riesgo de la oficina.
- Un activo `retired` nunca entra: el filtro `status: active` de la consulta lo garantiza.
- Cada corrida crea un `job-runs` (`job_type: 'aging_sweep'`, `status: running`) y lo cierra en `success` con `summary` `{ assets_transitioned, organizations_processed }` o en `failed` con `error`, y relanza la excepción. `job-runs` solo lo lee `platform_admin`.
- Programación: tarea `aging-sweep` en `payload.config.ts`, cron `0 5 * * * *` (cada hora, minuto 5), cola `maintenance`, `retries: 5`.

### 8.2 Cola y arranque

`jobs.autoRun` ejecuta la cola `maintenance` cada minuto (hasta 5 jobs) y la cola `risk` cada 15 segundos (hasta 10). Requiere un proceso encendido de forma continua (comentario del config: no funciona en serverless).

Tareas programadas relacionadas con este feature:

| Tarea | Cron | Cola | Qué hace |
|---|---|---|---|
| `aging-sweep` | `0 5 * * * *` | `maintenance` | §8.1. |
| `expire-raw-scan-payloads` | `0 15 3 * * *` | `maintenance` | §8.3. Sin `retries` declarado. |
| `refresh-risk` | `0 45 3 * * *` | `maintenance` | Reencola el riesgo de las organizaciones activas: cubre el vencimiento de respuestas y los heartbeats obsoletos, que cambian el riesgo sin evento. El comentario del config acepta un desfase de hasta un día. |
| `recalculate-risk` | por evento | `risk` | Encolada por la ingesta, los cambios de conectividad del agente y el aging. Clave de concurrencia por organización y oficina, con `supersedes`. |

Los agentes que pasan a `offline` por falta de heartbeat no generan evento: `Agents.afterChange` solo corre cuando se escribe el agente. El estado "en línea" cambiado por el simple paso del tiempo lo recoge `refresh-risk`.

**Recuperación de jobs.** `onInit: recoverJobsOnStartup` (`domain/risk/recover-jobs.ts`): al arrancar, pone `processing: false` en todos los jobs de las colas `risk` y `maintenance` que quedaron en `processing: true`. Supone que este proceso es el único worker: con workers compartidos se desactiva con `SIAM_JOB_RECOVERY_ON_START=0`.

### 8.3 Retención de evidencia cruda (`expireRawScanPayloads`)

`RAW_TECHNICAL_RETENTION_DAYS` = 30. Tres pasos, en orden:
1. **Reportes.** Mientras existan `scan-reports` con `raw_payload_expires_at <= now`, en lotes de 100: `raw_payload: null` y `raw_payload_expires_at: null` (`context.systemJob`). El documento, su cobertura, estado y `error` permanecen. El plazo corre desde la recepción del reporte.
2. **Activos.** Candidatos: `last_seen` anterior o igual a `now - 30 días` (o ausente) y `host_scripts` o `services.scripts` presentes. Por cada uno, en su transacción con `lockAssetRow`, relee y, si sigue vencido, pone `host_scripts: null` y `scripts: null` en cada servicio. Si una ingesta actualizó el activo mientras esperaba el lock, la evidencia nueva se conserva.
3. **Instantáneas.** Candidatos por consulta SQL `assets_dump::text LIKE '%scripts"%'`. En cada una, bajo lock de fila, `expireSnapshotTechnicalEvidence` elimina `host_scripts` y `scripts` de los activos de red cuyo `last_seen` venció (`observationExpired`: un `last_seen` desconocido cuenta como vencido). El inventario normalizado y el puntaje histórico se mantienen.

Resumen: `{ expired, asset_evidence_expired, snapshot_evidence_expired }`. Es repetible: lo ya redactado no vuelve a ser candidato. No escribe en `job-runs`. Programación en §8.2.

En el portal, un informe sin `raw_payload` se muestra como "Detalle archivado" (§10.3).

### 8.4 Revocación automática por ciclo de vida de la oficina

Fuera de los endpoints de este documento, `revokeOfficeAgents` (`domain/offices/office-lifecycle.ts`) revoca los agentes no revocados de una oficina con motivo `office_deactivated` o `organization_deactivated` al desactivarla (la desactivación de la organización la invoca por cada oficina, `domain/organizations/organization-lifecycle.ts`). El agente lo detecta en su siguiente heartbeat (§5.2). Ver `offices-api.md`.

### 8.5 Puntos de enganche pendientes

Las escrituras sensibles de este feature llevan comentarios `// AUDIT:`; algunas, también `// NOTIFY:` (revocación manual, lockout, incidentes). AuditLog y Notification Bell **no existen aún**: son marcas, no código (`SYSTEM_PROMPT.md` §2).

## 9. Cupos de escáner

`domain/subscriptions/limits.ts`: `basic` permite 1 agente por oficina; `premium`, 2. `getAgentQuota(payload, organizationId, req?, officeId?)`:
- `limit` = cantidad de oficinas de la organización × `agents_per_office`.
- `used` = agentes de la organización no revocados (`countsTowardAgentLimit`).
- `available` = mínimo entre `limit - used` y `agents_per_office - (no revocados de la oficina)`. Sin `officeId` el segundo término es `agents_per_office`.
- `per_office` = `agents_per_office`.
- Sin documento de suscripción: `SubscriptionNotFoundError`.

El conteo de oficinas es `totalDocs` de una búsqueda por organización, sin filtro de `is_active`: las oficinas inactivas cuentan para `limit`.

`withAgentQuotaLock(organizationId, work)` serializa la verificación de cupo y la creación por organización con una cola de promesas en memoria (`Map`). El comentario del código indica que sirve mientras la aplicación corra como un único proceso: con varias réplicas debe reemplazarse por un lock transaccional de PostgreSQL. Solo el aprovisionamiento usa este lock; el cupo se verifica y se crea dentro, y el paquete se construyó afuera para no bloquear otros aprovisionamientos detrás de un trabajo de E/S.

## 10. Frontend

### 10.1 Cadena

- **Informes de escaneo:** `app/portal/(protected)/inventory/scan-reports/page.tsx` (listado) y `[id]/page.tsx` (detalle) → `modules/scan-reports/hooks/use-scan-reports.ts`, `use-scan-report.ts` → `modules/scan-reports/service.ts` → `lib/list-resource.ts` / `lib/http-client.ts` → `/api/scan-reports` y `/api/v1/scan-reports/:id/name`.
- **Instantáneas:** `.../inventory/snapshots/page.tsx` y `[id]/page.tsx` → `modules/inventory-snapshots/hooks/use-snapshots.ts`, `use-snapshot.ts`, `use-generate-snapshot.ts`, `use-latest-snapshot.ts` → `modules/inventory-snapshots/service.ts` → `/api/inventory-snapshots`, `/api/v1/inventory-snapshots/generate` y `/api/v1/inventory-snapshots/:id/name`.
- **Escáneres por oficina:** `app/portal/(protected)/administration/offices/page.tsx` → `modules/offices/components/AgentProvisionModal.tsx` → `modules/offices/hooks/use-offices.ts` (`useProvisionAgent`, `useOfficeAgentSummary`, `useRevokeAgent`) → `modules/offices/service.ts` (`provisionAgent`, `listOfficeAgentSummary`, `revokeAgent`) → `httpClient`. La descarga usa `httpClient.download`, que hace el POST y devuelve un `Blob`; los errores se parsean del JSON (`error`, `message`).
- **Aviso global de escaneo nuevo:** `app/portal/(protected)/layout.tsx` monta `ScanResultMonitor` → `use-new-scan-result.ts` → `getLatestProcessedScanReport`.

Los tipos `ScanReport` e `InventorySnapshot` salen de `app/types/payload-types.ts` (generado). `AgentQuotaSummary`, `OfficeAgentSummary` y `AgentPlatform` se importan de los archivos del servidor (`endpoints/officeAgentSummary.ts`, `domain/agents/buildAgentPackage.ts`).

### 10.2 Consultas (TanStack Query)

| Hook | Clave | Notas |
|---|---|---|
| `useScanReportsList(asOrganization)` | `['scan-reports', asOrganization, selectedOfficeId]` | `listResource` pagina de a 100; orden `-scan_start`; filtra por `where[office][equals]` si hay oficina seleccionada. |
| `useScanReport(id)` | `['scan-reports', id]` | `depth=1` para poblar `agent` y `office`. |
| `useNewScanResult(scopeKey, asOrganization)` | `['scan-reports', 'latest-processed', scopeKey]` | `limit=1`, `status=processed`, orden `-processed_at`; refetch cada 30 s, no en segundo plano. |
| `useSnapshotsList(asOrganization)` | `['inventory-snapshots', asOrganization, selectedOfficeId]` | `depth=0`, orden `-taken_at`. |
| `useLatestSnapshot(asOrganization)` | misma clave que el listado | Toma el primero; comparte caché con `useSnapshotsList`. Lo usa la página de riesgo. |
| `useSnapshot(id)` | `['inventory-snapshots', id]` | `depth=0`. |
| `useOfficeAgentSummary(asOrganization)` | `['office-agent-summary', asOrganization]` | |

Un platform admin con `?asOrganization=` lo propaga el cliente a toda request (`lib/organization-request-context.ts`).

### 10.3 Mutaciones y comportamiento de pantalla

| Hook | Efecto |
|---|---|
| `useRenameScanReport(id)` | Invalida `['scan-reports']`; aviso "Nombre del escaneo guardado". |
| `useRenameSnapshot(id)` | Invalida `['inventory-snapshots']`; aviso "Nombre de la instantánea guardado". |
| `useGenerateSnapshot` | Invalida solo `['inventory-snapshots']` (generar es una lectura de los activos, no los modifica); aviso "Instantánea generada". |
| `useProvisionAgent` | Éxito: invalida `['office-agent-summary']`; el modal descarga el `.zip` y se cierra. Error: `showApiError`. |
| `useRevokeAgent` | Invalida `['office-agent-summary']`; aviso "Acceso del escáner revocado". |

**Renombrado.** El mismo `EvidenceNameSchema` valida en cliente (`evidenceNameError`) y en servidor. Hay dos puntos de entrada: `RenameAction` (`components/ui/RenameAction.tsx`), un botón de lápiz en la columna Acciones de cada listado que abre un modal, y `EditableTitle` en el título del detalle. Ambos reciben `canEdit`/`canRename` de `tenant.data.permissions.renameEvidence`; sin el permiso no se muestran. `RenameAction` bloquea el reenvío con un `ref` antes de llamar a `onSave`, porque `saving` llega un render tarde y Enter puede repetirse. Texto vacío = nombre por defecto ("Informe de escaneo" / "Instantánea").

**Listado de informes.** Estado como filtro local (`received`, `processed`, `failed`). La columna Activos calcula aceptados y rechazados a partir de `raw_payload` y `error` (`totalAssetsInReport`, `parseRejectedAssets`). Para quien no puede leer esos campos (sin `read_technical`) o si el payload expiró, `raw_payload` llega vacío y la columna muestra "Detalle archivado". El detalle usa `!report.raw_payload` para mostrar el aviso de retención.

**Instantáneas.** El botón "Generar instantánea" exige oficina seleccionada en la barra superior y `canDo(role, 'inventory-snapshots', 'create')`. El detalle lee `assessment_results_snapshot` (`score`, `coverage`, `excluded_assets`) y `assets_dump`.

**Escáneres.** El modal de la oficina permite elegir SO (`posix` o `windows`), muestra los agentes con su conectividad (`AgentConnectivityBadge`) y el cupo, y desactiva (revoca) agentes no revocados con confirmación. El botón "Generar y descargar" se deshabilita cuando `quota.available === 0`. El nombre del archivo descargado lo arma el cliente (`siam-agent-<oficina>-<plataforma>.zip`), distinto del `Content-Disposition` del servidor.

**Aviso de escaneo nuevo.** `ScanResultMonitor` guarda un id de línea de base por organización y, cuando el último reporte procesado cambia, invalida `assets`, `non-network-assets`, la revisión de seguridad y `scan-reports` (excepto `latest-processed`) y muestra una notificación persistente.

## 11. Cobertura de pruebas

Estado de cobertura automática; sin pruebas de extremo a extremo por ahora. Las pruebas de integración requieren PostgreSQL desechable.

| Prueba | Cubre |
|---|---|
| `contracts/scan-report.schema.test.ts` | Forma del reporte, campos extra, cobertura obligatoria, `degraded`, gateway, `hosts_up`, cobertura por activo y `host_timeout`. |
| `contracts/scan-scope.audit.test.ts` | Alcance de red, ventana de tiempo, reportes futuros o invertidos, límites del heartbeat. |
| `contracts/network.audit.test.ts` | Subredes de interfaz legítimas sin ampliar el alcance de escaneo. |
| `access/middleware/resolveAgentAuth.test.ts` | Token válido, prefijo desconocido, hash inválido, 429 por lockout, umbral, escalada y revocación automática, agente revocado, `X-Agent-ID`. |
| `lib/canonical-json.test.ts` | Orden por unidad de código; equivalencia con el orden anterior (`localeCompare`) para todas las claves fijas del contrato y para los ids de scripts NSE, de modo que los `content_fingerprint` guardados siguen valiendo. |
| `endpoints/agent-exposure.audit.integration.test.ts` | Un agente expandido solo trae campos públicos; la lectura directa conserva el bloqueo y oculta el hash salvo con `showHiddenFields`; baja lógica y tareas sin datos privados del agente. |
| `domain/agents/agent-state.test.ts` | Estados, transiciones, cupo y timestamps inválidos o futuros. |
| `domain/agents/buildAgentPackage.test.ts` | Contenido del paquete por plataforma, `.env`, CRLF/LF, launchers. |
| `domain/subscriptions/agent-quota.test.ts` | `calculateAgentLimit` por plan. |
| `endpoints/agentProvisioning.integration.test.ts` | 401, 403 por rol, otra organización, 201 con `.zip`, Windows, `platform` inválido, 409 por cupo. |
| `endpoints/agentRevoke.integration.test.ts` | Revocación manual idempotente. |
| `endpoints/review-findings.audit.integration.test.ts` | Heartbeat: fallo transitorio de base → 500, sin revocar, y el siguiente responde 200; revocación durante el request → 200 y el siguiente 401 `agent revoked`. Revocar dos veces nunca devuelve `apiKeyHash` |
| `endpoints/officeAgentSummary.test.ts`, `.integration.test.ts` | `getOfficeScannerStatus`; 401 y resumen limitado a oficinas en alcance. |
| `endpoints/reports.test.ts`, `endpoints/remaining-corroboration.audit.test.ts` | Rechazo 413 antes de autenticar, con y sin `Content-Length`; límites del heartbeat. |
| `endpoints/reports.integration.test.ts` | Alta de activos e idempotencia por `report_id`, reconciliación degradado→full, host sin MAC/vendor/hostname, token inválido. |
| `endpoints/remaining-corroboration.audit.integration.test.ts` | Reintentos idénticos concurrentes (una sola aplicación y una sola instantánea), reportes distintos concurrentes, 409 por contenido distinto o por otro agente, tiempos futuros, evidencia antigua, MAC local por oficina, redes inválidas, normalización de SO, IP repetida con MAC contradictoria, reporte `failed`, rollback completo ante fallo del segundo activo, un reintento. |
| `domain/inventories/ingestScanReport.test.ts` | Reconciliación por IP y MAC, not-null-wins, campos dinámicos, `technical_changed_at`, `os_status`, `retired` sticky, `needs_review`, campos faltantes, reintento sin duplicar historia, reporte demorado, `scanner_host`, activos de otra oficina (`pickMacMatch`). |
| `domain/inventories/asset-identity.audit.test.ts`, `port-coverage.audit.test.ts` | Clasificación de MAC y claves de identidad; cobertura de puertos. |
| `domain/inventories/createInventorySnapshot.integration.test.ts` | Congelado de inventario y riesgo, activo no identificado, copia por valor, riesgo calculado al momento. |
| `domain/inventories/autoSnapshot.test.ts` | `shouldTakeSnapshot`. |
| `collections/InventorySnapshots/index.test.ts` | `update`, `delete` y `create` cerrados a nivel de colección. |
| `endpoints/evidenceNames.integration.test.ts` | Renombrado de instantáneas sin tocar la evidencia y respetando alcance. No hay prueba equivalente para `PATCH /v1/scan-reports/:id/name`. |
| `domain/inventories/agingSweep.test.ts` | `shouldGoOffline` (umbrales, borde, `last_seen` nulo). La corrida completa y el recorrido por cursor no tienen prueba propia en este archivo. |
| `domain/inventories/expireRawScanPayloads.test.ts`, `technical-evidence.audit.test.ts` | Expiración de payload sin borrar el documento; límites de expiración y repetibilidad. |
| `endpoints/security-policy.audit.integration.test.ts` | Permiso técnico por rol, retención a 30 días con job repetible, limpieza que espera una actualización del activo y conserva evidencia nueva. |
| `domain/risk/delivery.audit.test.ts` | `recoverJobsOnStartup` y la opción de desactivarlo. |

Sin prueba directa en este repositorio: `endpoints/heartbeat.ts` (solo se cubre el schema), `endpoints/vendor.ts`, `endpoints/internalJobs.ts` (autenticación por token de servicio) y `POST /v1/inventory-snapshots/generate`.

## 12. Comportamientos a tener presentes

Verificados en el código; no son necesariamente defectos, pero conviene conocerlos antes de tocar el feature.

1. **Respuesta del `revoke`.** No incluye `apiKeyHash` (campo `hidden`), pero conserva `apiKeyPrefix`, `failedAttempts`, `lockedUntil` y `lockoutCount`: es una lectura directa del agente.
2. **Heartbeat de un agente revocado durante el request.** Responde 200 y guarda `last_heartbeat_at`, aunque el agente queda `revoked`. Se detiene en el siguiente heartbeat.
3. **Reporte repetido.** La respuesta de un reintento ya procesado es `processed: 0` y `rejected: []`; no reproduce el resultado original. El agente no usa el cuerpo de la respuesta.
4. **Rechazos 4xx son definitivos para el agente.** 400, 401, 403, 409 y 413 sobre `/v1/reports` descartan el reporte de la cola local (`sender.py`). Un 401 `agent revoked` en reportes no detiene al agente; solo lo hace el heartbeat.
5. **Cupo por oficina en el modal.** El comentario de `AgentProvisionModal` afirma que `quota.available` es el mínimo entre el cupo de la organización y el de la oficina. `GET /v1/offices/agent-summary` llama a `getAgentQuota` sin `officeId`, así que `available` usa `agents_per_office` completo para la oficina. El botón solo se deshabilita por agotamiento de la organización; el agotamiento por oficina lo hace cumplir el servidor con 409 `agent_limit_reached` al aprovisionar.
6. **Oficinas inactivas y cupo.** `getAgentQuota` cuenta todas las oficinas de la organización, también las inactivas, para calcular `limit`.
7. **Credencial no recuperable.** El token solo viaja en el `.zip`. Si la descarga falla después de crear el agente, queda un agente `provisioned` que consume cupo hasta revocarlo.
8. **Lock de cupo en memoria.** `withAgentQuotaLock` no protege entre procesos.
9. **Comentarios desactualizados sobre la programación.** `endpoints/internalJobs.ts` dice que no hay scheduler cableado y que el job se dispara a mano; `payload.config.ts` ya agenda `aging-sweep` (cada hora) y `expire-raw-scan-payloads` (diario) con `jobs.autoRun`. El endpoint HTTP es un disparador manual adicional. Igualmente `endpoints/inventorySnapshots.ts`, `modules/inventory-snapshots/service.ts` y `collections/InventorySnapshots` dicen que `scheduled` está reservado, pero `maybeCreateAutoSnapshot` ya lo usa en cada ingesta.
10. **Conectividad y riesgo.** El paso de `online` a `offline` por tiempo no dispara recálculo de riesgo; lo cubre `refresh-risk` una vez al día. El paso a `online` (primer heartbeat o reanudación) sí lo encola vía `Agents.afterChange`.
11. **Viewers y "Detalle archivado".** Para un `org_viewer`, `raw_payload` y `error` no se devuelven (control de campo), así que el listado y el detalle de informes muestran "Detalle archivado" y cero rechazados aunque el payload exista.
12. **Listado con `raw_payload`.** El listado de informes pide todas las páginas de la colección con el payload crudo (hasta 5 MiB por informe, para quien puede leerlo) porque calcula aceptados desde él.
13. **Instantánea: `excluded_assets`.** La página de detalle lee `assessment_results_snapshot.excluded_assets`, pero `createInventorySnapshot` no escribe ese campo; el aviso correspondiente no aparece con el código actual.
14. **Instantánea manual y lock de ingesta.** `createInventorySnapshot` no toma el lock `inventory:<organizationId>`; se serializa con otras transacciones solo por aislamiento, no por bloqueo.
15. **`vendor`.** Solo resuelve dos OUI de demostración; el resto devuelve 404 y el agente cae a su caché local.
16. **Reporte en `received`.** El estado existe en el modelo y en la UI (filtro "Recibido"), pero el procesamiento atómico no confirma reportes en ese estado (§6.4).
17. **Mensajes de validación mezclados.** `office_id es requerido` se devuelve en `error` como texto; otros fallos usan códigos (`platform_invalid`). Los errores de alcance usan la forma de Payload (`errors`).
18. **Renombrado y organización.** Un PlatformAdmin necesita `?asOrganization=` para renombrar; sin organización recibe 403.
19. **`expire-raw-scan-payloads` no deja traza en `job-runs`**, a diferencia de `aging_sweep` (`job_type` solo admite `aging_sweep`).
20. **Lectura de `error`.** `scan-reports.error` guarda JSON de `rejectedAssets`, no un mensaje; el cliente lo parsea con `parseRejectedAssets` y trata un JSON inválido como lista vacía.
