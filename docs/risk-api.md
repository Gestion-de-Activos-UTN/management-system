# API de riesgo

Referencia técnica del feature `risk`: motor de cálculo, evaluaciones persistidas, consolidado en vivo del OfficeManager, cola de recálculo, contrato HTTP y la cadena que lo conecta con el frontend. Dirigida a quien mantiene o extiende el feature. Las revisiones de seguridad que alimentan el motor se documentan en `docs/assessments-api.md`; el ciclo de vida de tareas que referencian evaluaciones, en `docs/task-api.md`.

Verificado contra el código el 2026-10-31. Si algo de este documento contradice el código, gana el código: corregir el documento.

## 1. Capas y archivos

| Capa | Archivo | Responsabilidad |
|---|---|---|
| Contrato (tipos) | `modules/risk/service.ts` | Tipos `RiskEvaluationDTO`, `RiskContributionDTO`, `LatestRiskResponse`, `RiskScope` y la función `getLatestRisk`. No hay schema Zod compartido: la query se valida en el endpoint. |
| Contrato (constantes) | `domain/risk/constants.ts` | Pesos, umbrales, versiones de motor y catálogo, tamaños de página, claves de orden, y las reglas `scoreVisible` / `bandVisible`. |
| Endpoint de detalle | `endpoints/risk.ts` | `GET /v1/risk/latest`. Autenticación, permisos, feature flag, query, selección de vista, paginación, enmascarado y serialización. Registrado en `payload.config.ts` como `latestRiskEvaluationEndpoint`. |
| Endpoint de resumen | `endpoints/assessments.ts` (`securityReviewSummaryEndpoint`) | `GET /v1/security-review/summary`. Vive junto a las revisiones pero lee riesgo (§4.6). |
| Alcance | `access/rbac/risk-scope.ts` | `canReadAssignedOfficeRisk`: quién puede pedir el consolidado en vivo. |
| | `access/tenant/officeQueryError.ts` | Valida `office_id` contra el alcance del rol. |
| Motor | `domain/risk/engine.ts` | `calculateRisk`: función pura sobre pares (activo, control). |
| | `domain/risk/build-pairs.ts` | `buildRiskPairs`: arma los pares aplicables, la población y las alertas de exposición indeterminada. |
| | `domain/risk/automatic-evidence.ts` | Eficacia de los controles automáticos (A.5.9, A.5.12, A.8.16, A.8.20, A.8.21), exposición y multiplicador de alcance. |
| | `domain/risk/control-efficacy.ts` | `evaluateControlEfficacy`: eficacia de un control basado en preguntas. Lo usa el cierre de revisiones, no el recálculo. |
| | `domain/risk/risk-asset-type.ts` | Mapeo explícito de categoría de activo a tipo de riesgo, y categorías que reciben revisión. |
| | `domain/risk/catalog-v2/` | Catálogo de preguntas, controles y reglas condicionales (`catalog.ts`), tipos (`types.ts`), validación al importar (`validate-catalog.ts`, `index.ts`). |
| Cálculo y persistencia | `domain/risk/recalculateRisk.ts` | `calculateRiskForScope` (lectura pura, compartida) y `recalculateRisk` (calcula y persiste). |
| | `domain/risk/evaluation-from-result.ts` | Campos comunes entre la evaluación persistida y la en vivo. |
| | `domain/risk/persistRiskEvaluation.ts` | Escribe una evaluación y todas sus comprobaciones en una transacción. |
| Consolidado en vivo | `domain/risk/assigned-office-risk.ts` | `assignedOfficeRisk`: calcula y cachea el consolidado de las oficinas asignadas. |
| | `domain/risk/assigned-risk-cache.ts` | Caché por proceso con señal de evidencia, TTL y tope. |
| Estado de recálculo | `domain/risk/recalculation-status.ts` | `openRiskJob`, `riskJobStatus`, `riskRecalculationStatus`. |
| Cola | `domain/risk/enqueueRiskRecalculation.ts` | `enqueueRiskRecalculation`, `enqueueOrganizationRiskRecalculation`. |
| | `domain/risk/recover-jobs.ts` | Recuperación de jobs al arrancar el proceso. |
| | `payload.config.ts` | Tareas `recalculate-risk` y `refresh-risk`, cola `risk`, `autoRun`, `onInit`. |
| Orden | `domain/risk/sort-contributions.ts` | Orden total de comprobaciones antes de paginar. |
| Persistencia | `collections/RiskEvaluations/index.ts`, `collections/RiskEvaluations/scoreFieldAccess.ts` | Colección `risk-evaluations` y acceso por campo. |
| | `collections/RiskContributions/index.ts` | Colección `risk-contributions`. |
| Estado de servidor | `modules/risk/hooks/use-latest-risk.ts` | `useLatestRisk` (TanStack Query). |
| | `modules/assessments/hooks/use-risk-summary.ts` | `useRiskSummary` (resumen del Panel y de Revisión de seguridad). |
| UI | `app/portal/(protected)/risk-score/page.tsx`, `modules/risk/components/*`, `modules/risk/risk.columns.tsx`, `modules/risk/risk-labels.ts`, `modules/risk/risk-calculation-message.ts` | Presentación. |
| Alcance en cliente | `modules/offices/office-risk-scope.ts`, `modules/offices/hooks/use-concrete-office-id.ts` | Resuelve qué `office_id` pedir. |

Cadena de lectura: página → `useLatestRisk` → `getLatestRisk` → `httpClient` → `endpoints/risk.ts` → `assignedOfficeRisk` (consolidado en vivo) o `payload.find` sobre `risk-evaluations` y `risk-contributions` (vista persistida).

Cadena de escritura: evento del sistema → `enqueueRiskRecalculation` → `payload.jobs.queue` (tarea `recalculate-risk`, cola `risk`) → worker de `autoRun` → `recalculateRisk` → `persistRiskEvaluation`. El otro escritor es `domain/inventories/createInventorySnapshot.ts`, que llama a `recalculateRisk` de forma síncrona para congelar una evaluación junto a cada snapshot de inventario (§7.6).

## 2. Modelo

### 2.1 Colecciones

Ambas son de solo lectura para la API REST de Payload y de solo anexado: `create`, `update` y `delete` son `() => false`. Solo `persistRiskEvaluation` escribe (con `overrideAccess: true`). `read` usa `orgScopedAccess(..., { kind: 'org_offices', field: 'office' })`: los roles con alcance organizacional leen toda la organización; el resto, solo filas cuya `office` esté en sus oficinas, lo que excluye también las evaluaciones de organización (`office` vacío). El endpoint propio no usa ese acceso: lee con `overrideAccess: true` y aplica sus propias reglas (§3).

#### `risk-evaluations`

| Campo | Tipo | Notas |
|---|---|---|
| `organization` | relación, requerido | Indexado. |
| `office` | relación, opcional | Vacío = evaluación de toda la organización. Indexado. |
| `catalog_version`, `engine_version` | number | Hoy ambos valen 2 (`RISK_CATALOG_VERSION`, `RISK_ENGINE_VERSION`). |
| `policy_key` | `essential` \| `reinforced` | Política de revisión vigente al calcular. |
| `evaluated_at` | date | Momento en que se **leyó** la evidencia, no en que se guardó (§5.3). Indexado. |
| `rro_raw`, `rro_adjusted`, `riem` | number | Visibles por REST solo si `scoreVisible`. |
| `score` | number, opcional | Nulo si `riem` es 0. Visible por REST solo si `scoreVisible`. |
| `base_band`, `final_band` | `low` \| `medium` \| `high` \| `critical`, opcionales | Visibles por REST solo si `bandVisible`. |
| `coverage`, `unknown_percentage` | number | Porcentajes 0 a 100. |
| `confidence`, `effective_confidence` | `hidden` \| `preliminary` \| `warning` \| `usable` \| `reliable` | |
| `counts` | json | `compliant`, `partially_effective`, `non_compliant`, `not_evaluable`, `excluded`, `excluded_assets`, `unconfirmed_assets`. |
| `alerts` | json | `critical_assets`, `systemic_failures`, `severe_concentration`, `severe_concentration_percentage`, `undetermined_exposure` (§4.4). |
| `control_summary` | json | Un `ControlAggregate` por control aplicable. Visible por REST solo si `scoreVisible`. |
| `asset_summary` | json | Un `AssetRiskScore` por activo con riesgo evaluable. Visible por REST solo si `scoreVisible`. |

#### `risk-contributions`

Una fila por par (activo, control) de la evaluación.

| Campo | Tipo | Notas |
|---|---|---|
| `organization`, `office`, `evaluation` | relación | `evaluation` requerido e indexado. |
| `asset_key` | text | `asset:<id>` o `manual:<id>`. Indexado. |
| `asset`, `manual_asset` | relación | Solo la que corresponde al prefijo de `asset_key`. |
| `control_key` | text | Indexado. |
| `criticality`, `severity` | `low` \| `medium` \| `high` \| `critical` \| `unknown` | |
| `exposure` | `low` \| `medium` \| `high` | |
| `exposure_source` | `scan` \| `default_unknown`, opcional | |
| `scope_multiplier` | number | 1 o 1,5. |
| `efficacy` | number, opcional | Nulo = no evaluable. |
| `status` | `compliant` \| `partially_effective` \| `non_compliant` \| `not_evaluable` | |
| `inherent_risk`, `residual_risk` | number, opcionales | Visibles por REST solo si la evaluación madre cumple `scoreVisible` (`whenEvaluationScoreVisible`, con caché por request). |
| `coverage_weight` | number | Peso por criticidad. |
| `effect_snapshot` | json | `reason_code`, `unit_kind`, `unit_id`. |
| `excluded` | checkbox | |
| `reason_code` | text | |

### 2.2 Catálogo v2 y motor

`domain/risk/catalog-v2/catalog.ts` define 20 preguntas (4 de alcance organización, 3 de oficina, 13 de activo), 18 controles (13 basados en preguntas y los 5 automáticos de abajo), y 3 reglas condicionales (`force_zero` o `multiply`). Dos preguntas son exclusivas de la política `reinforced`; las demás aplican a ambas. Toda pregunta ofrece además las opciones `unknown` y `not_applicable` (esta última exige justificación) con eficacia nula. `validateRiskCatalogV2` corre al importar `catalog-v2/index.ts`: un catálogo inválido hace fallar el arranque.

Controles automáticos (no tienen preguntas):

| Control | Unidad | Origen |
|---|---|---|
| `A.5.9` Inventario | activo | `inventoryEfficacy`: identificado, con responsable y autorizado = 1; si no, nulo. Solo cobertura. |
| `A.5.12` Clasificación | activo | `classificationEfficacy`: criticidad distinta de `unknown` = 1; si no, nulo. Solo cobertura. |
| `A.8.16` Monitoreo | oficina | `evaluateOfficeMonitoring` sobre los agentes de la oficina: compliant = 1, non_compliant = 0, sin agentes = nulo. Solo activos de red. |
| `A.8.20` Shadow IT | activo | `shadowItEfficacy`: autorizado = 1, no autorizado = 0, pendiente o no identificado = nulo. Solo activos de red. Severidad `high`. |
| `A.8.21` Servicios de red | activo | `evaluateNetworkServices` sobre la clasificación de servicios (`evaluateNetworkBaseline`). Severidad según la regla de red; exposición fija `low`. Solo activos de red. |

Fórmulas (`engine.ts`, `constants.ts`):

- Pesos de criticidad y severidad: `low` 1, `medium` 2, `high` 4, `critical` 8, `unknown` 2. Exposición: `low` 1, `medium` 2, `high` 4. Multiplicador de alcance: 1, o 1,5 si el activo comparte CIDR con un activo no identificado.
- Para un par evaluable que no es solo de cobertura: riesgo inherente = peso criticidad × multiplicador × peso severidad × peso exposición; residual = inherente × (1 − eficacia). Un par con `excluded` se trata como no evaluable.
- `riem` = suma de inherentes; `rro_raw` = suma de residuales. Por control, el residual se limita a `CONTROL_RISK_CAP` (0,3) × `riem`; `rro_adjusted` es la suma de los residuales limitados. `score` = `rro_adjusted` / `riem` × 100, o nulo si `riem` es 0.
- Banda base: `score` ≥ 75 `critical`, ≥ 50 `high`, ≥ 25 `medium`, si no `low`. Concentración severa: más de 30 % del `rro_raw` proviene de pares con severidad `high` o `critical`; en ese caso la banda final sube un escalón.
- Cobertura: peso (por criticidad) de los pares no excluidos con eficacia no nula, sobre el peso de todos los no excluidos, × 100. Los pares de solo cobertura (A.5.9, A.5.12) entran en la cobertura y en `counts`, pero no suman riesgo.
- Confianza por cobertura: < 20 `hidden`, ≥ 20 `preliminary`, ≥ 40 `warning`, ≥ 60 `usable`, ≥ 80 `reliable`. `unknown_percentage` es el peso de los activos de la población no identificados o no autorizados. Si es ≥ 15, `effective_confidence` baja un escalón (`preliminary` y `hidden` no bajan).
- Falla sistémica de un control: algún par con severidad `high` o `critical` y, si la unidad es la organización, al menos una unidad no conforme; si no, más de 20 % de las unidades aplicables no conformes. Las unidades no evaluables cuentan en el denominador.
- Alerta de activo crítico: criticidad `high` o `critical`, severidad `critical` y estado `non_compliant`.
- `counts` se calcula sobre los pares no excluidos (incluidos los de solo cobertura); `excluded` cuenta pares y `excluded_assets` activos distintos; `unconfirmed_assets` cuenta activos de la población no identificados o no autorizados.

Armado de pares (`buildRiskPairs`): por cada activo se crean primero todos los pares aplicables y recién después se decide la evaluabilidad, de modo que la evidencia faltante o vencida queda en el denominador de cobertura como `not_evaluable`. Un activo de red no identificado o con autorización `pending` convierte todos sus pares en no evaluables con `reason_code: asset_unconfirmed`. Para controles basados en preguntas, la respuesta más específica gana: la propia del activo, luego la de su oficina, luego la de la organización; los controles de alcance `asset` nunca heredan. Un activo sin tipo de riesgo (impresoras, IoT, etc.) recibe solo los controles automáticos. Un activo excluido de las revisiones (`excluded`) pierde solo los pares de preguntas (marcados `excluded`); los automáticos se mantienen y el activo sigue en la población. Una respuesta `not_applicable` justificada produce eficacia nula, es decir, un par `not_evaluable` (con `reason_code: not_applicable`); no hay tratamiento especial en el motor.

### 2.3 Estados de recálculo

`RecalculationStatus` (`recalculation-status.ts`): `current`, `pending`, `processing`, `failed`, `outdated`. Se deriva del trabajo abierto más reciente (`payload-jobs`, cola `risk`, `concurrencyKey = risk:<organizationId>:<officeId | 'org'>`, sin `completedAt`):

| Condición | Estado |
|---|---|
| Hay trabajo abierto con `hasError` | `failed` |
| Hay trabajo abierto con `processing` | `processing` |
| Hay trabajo abierto sin lo anterior | `pending` |
| No hay trabajo abierto y existe evaluación | `current` |
| No hay trabajo abierto y no existe evaluación | `outdated` |

`outdated` solo significa "este alcance nunca se evaluó y no hay nada en cola". El estado nunca expone la entrada ni el error del trabajo. En Payload, `hasError` pasa a verdadero solo cuando se agotan los reintentos (verificado en `node_modules/payload/dist/queues/errors/handleTaskError.js`); entre reintentos el trabajo figura como `pending`. Un trabajo agotado conserva `completedAt` vacío, por lo que `openRiskJob` lo sigue encontrando; cuándo lo reemplaza un nuevo encolado depende de la opción `supersedes` de Payload y no se verificó aquí.

### 2.4 Flujos

**Una evaluación persistida.** Un evento (escaneo, cambio de un activo, respuesta de revisión, cambio de política, agente que cambia de en línea a fuera de línea) llama a `enqueueRiskRecalculation`, que encola un trabajo `recalculate-risk` para la organización y otro por cada oficina afectada. El worker toma el trabajo, descarta organizaciones u oficinas inactivas (sin escribir nada) y llama a `recalculateRisk`: `calculateRiskForScope` carga evidencia, `buildRiskPairs` arma pares, `calculateRisk` los evalúa y `persistRiskEvaluation` crea la evaluación y sus comprobaciones en una sola transacción. La vista persistida siempre muestra la última evaluación completada; mientras hay un trabajo abierto, `recalculation` lo indica y la evaluación mostrada puede estar desactualizada.

**Ráfaga de eventos.** Un escaneo que actualiza muchos activos genera muchos encolados. La clave de concurrencia de la tarea (`risk:<org>:<oficina|org>`, `exclusive: true`, `supersedes: true`) hace que un trabajo nuevo reemplace al pendiente del mismo alcance y que solo corra uno a la vez por alcance. Solo importa el último estado. Una prueba de integración verifica que una ráfaga deja como máximo un trabajo pendiente por alcance.

**Vista de OfficeManager sin oficina.** Un OfficeManager que no indica `office_id` no lee una evaluación persistida (no existe una para "mis oficinas"): `assignedOfficeRisk` calcula en el momento, con el motor, el conjunto exacto de sus oficinas asignadas y no escribe nada. La respuesta lleva `scope: 'assigned_offices'` y `evaluation.id: null`. El resultado no es el promedio de los puntajes por oficina: es una evaluación conjunta.

**Evaluación histórica.** Con `evaluation_id`, el endpoint devuelve esa evaluación concreta (ya que las evaluaciones son inmutables) sin estado de recálculo. Las tareas y los snapshots de inventario guardan el id de la evaluación como evidencia.

## 3. Permisos y alcance

### 3.1 Matriz (`access/rbac/permissions.ts`)

| Rol | `risk-evaluations` | `risk-contributions` |
|---|---|---|
| `org_admin` | `read` | `read` |
| `org_viewer` | `read` | `read` |
| `office_manager` | `read`, `read_assigned` | `read` |
| `platform_admin` sin organización | `read` | `read` |
| `platform_admin` con `?asOrganization=` | se evalúa como `org_admin` | |

`read_assigned` habilita el consolidado en vivo. `hasOrgWideScope` es verdadero solo para `platform_admin` y `org_admin`.

### 3.2 Filtros de acceso de `GET /v1/risk/latest`

En orden:
1. `getTenantContext` sin sesión activa: 401 `unauthenticated`.
2. Sin `organizationId` (PlatformAdmin sin `asOrganization`): 400 `organization_context_required`.
3. `canDo(role, 'risk-evaluations', 'read', organizationId)` falso: 403 `forbidden`.
4. `organizationFeatures(req, org).risk_score === false`: 403 `feature_disabled`.
5. Parseo de la query: inválida, 400 `invalid_query` (sin `issues`).
6. Selección de vista (§4.3), con las validaciones de oficina.

### 3.3 Selección de vista

`assignedScope` es verdadero cuando no hay `office_id`, no hay `evaluation_id` y `canReadAssignedOfficeRisk(ctx)` (sesión activa, organización, rol sin alcance organizacional y permiso `read_assigned`; hoy solo `office_manager`). El conjunto de oficinas **nunca viene del cliente**: sale de `ctx.officeIds` (la membresía resuelta en cada request), ordenado.

Si no es consolidado en vivo, `officeQueryError`:
- Con `office_id`: debe estar en `ctx.officeIds`, o 403 `office_forbidden`. Un `org_admin` tiene siempre todas las oficinas de su organización (`enforceOrgAdminOffices`).
- Sin `office_id`: solo roles con alcance organizacional; el resto, 403 `office_required`. Es el caso del `org_viewer`, que debe nombrar una de sus oficinas, y del `office_manager` cuando envía `evaluation_id` sin `office_id`.

Consecuencias: una oficina concreta consultada por un OfficeManager es la evaluación **persistida** de esa oficina; la historia de organización (`office` vacío) no es legible por roles sin alcance organizacional.

## 4. Contrato HTTP

Prefijo `/api`. El cliente agrega `?asOrganization=` automáticamente en el portal; solo tiene efecto para PlatformAdmin.

| Método y ruta | Permiso | Entrada | Respuesta OK |
|---|---|---|---|
| `GET /v1/risk/latest` | `read` en `risk-evaluations`, feature `risk_score` | query (§4.2) | 200 `LatestRiskResponse` |
| `GET /v1/security-review/summary` | sesión, feature `security_assessments` | `office_id?` | 200 `SecurityReviewSummary` (§4.6) |

### 4.2 Query de `GET /v1/risk/latest`

| Parámetro | Valores | Notas |
|---|---|---|
| `office_id` | texto no vacío | Ver §3.3. |
| `evaluation_id` | UUID | Evaluación concreta de la organización (sin `office_id`) o de la oficina indicada. |
| `page` | entero ≥ 1 | Por defecto 1. |
| `limit` | 10, 25 o 50 | Por defecto 25 (`RISK_PAGE_SIZES`, `RISK_DEFAULT_PAGE_SIZE`). Otro valor: `invalid_query`. |
| `sort` | `control` \| `asset` \| `status` | Por defecto `control` (`RISK_SORT_KEYS`). |
| `direction` | `asc` \| `desc` | Por defecto `asc`. |

La query se valida **antes** de calcular el consolidado en vivo. Un valor inválido responde `400 { error: 'invalid_query' }` sin detalle.

### 4.3 Vistas y forma de la respuesta

`LatestRiskResponse`: `{ scope?, recalculation?, evaluation, contributions, pagination }`.

| Vista | Condición | `scope` | `evaluation.id` | `recalculation` |
|---|---|---|---|---|
| Consolidado en vivo | Sin `office_id` ni `evaluation_id`, y `read_assigned` | `assigned_offices` | `null` | Estado del trabajo de **organización** (§5.4) |
| Organización persistida | Sin `office_id`, rol con alcance organizacional | `organization` | uuid | Estado del alcance organización |
| Oficina persistida | Con `office_id` permitido | `office` | uuid | Estado del alcance oficina |
| Histórica | Con `evaluation_id` | `organization` u `office` | uuid | **Ausente** (`undefined`, no se serializa) |

Sin evaluación en la vista persistida (alcance nunca evaluado) responde 200 con `evaluation: null`, `contributions: []` y `pagination: { page, totalPages: 0, totalDocs: 0, hasNextPage: false }`. Con `evaluation_id` que no existe en ese alcance: 404 `evaluation_not_found`.

`pagination`: `{ page, totalPages, totalDocs, hasNextPage }`. En la vista persistida `hasNextPage = page < totalPages`; en el consolidado, `page * limit < totalDocs`. Pedir una página más allá del final devuelve `contributions: []` con el `totalDocs` real.

### 4.4 Forma exacta de los DTO

`RiskEvaluationDTO` (`modules/risk/service.ts`, armado en `evaluationDTO` de `endpoints/risk.ts`):

| Campo | Tipo | Notas |
|---|---|---|
| `id` | `string \| null` | `null` en el consolidado en vivo. |
| `evaluated_at` | string ISO | |
| `engine_version`, `catalog_version` | number | |
| `policy_key` | `essential` \| `reinforced` | |
| `score` | `number \| null` | Enmascarado, §4.5. |
| `base_band`, `final_band` | `RiskBand \| null` | Enmascarados. |
| `coverage`, `unknown_percentage` | number | Siempre visibles. |
| `confidence`, `effective_confidence` | `ConfidenceBand` | Siempre visibles. |
| `counts` | `Record<compliant \| partially_effective \| non_compliant \| not_evaluable \| excluded \| excluded_assets \| unconfirmed_assets, number>` | Siempre visible. |
| `alerts` | ver abajo | Siempre visible. |
| `controls` | `ControlAggregate[]` (`control_key`, `residual_raw`, `residual_capped`, `capped`, `systemic_failure`) | `[]` si el puntaje está oculto. |
| `top_assets` | `Array<AssetRiskScore & { asset_label }>` | Hasta 10; `[]` si el puntaje está oculto. |

`alerts`: `critical_assets: Array<{ asset_id, asset_label, control_key }>`, `systemic_failures: string[]` (claves de control), `severe_concentration: boolean`, `severe_concentration_percentage: number`, `undetermined_exposure: Array<{ asset_id, asset_label, cidr }>`. `asset_label` se resuelve en el endpoint; un activo que ya no se encuentra se rotula `Activo no disponible`.

`top_assets` (`AssetRiskScore`): `{ asset_id, score, band, inherent_risk, residual_risk, asset_label }`. Se ordena por `score` descendente (sin puntaje al final) y desempata por `residual_risk`; se toman 10. Con banda oculta, `band` es `null`.

`RiskContributionDTO`: `id`, `asset_key`, `asset_label`, `control_key`, `status`, `criticality`, `severity`, `exposure`, `exposure_source` (`scan` \| `default_unknown` \| `null`), `scope_multiplier`, `efficacy`, `inherent_risk`, `residual_risk`, `excluded`, `reason_code`. En la vista persistida `id` es el uuid de la fila; en el consolidado, `"<asset_key>:<control_key>"`. `inherent_risk` y `residual_risk` son `null` si el puntaje está oculto.

### 4.5 Enmascarado por confianza

Una sola regla, en `constants.ts`, sobre `confidence` (la de cobertura, **no** `effective_confidence`):

| `confidence` | `scoreVisible` | `bandVisible` | Efecto |
|---|---|---|---|
| `hidden` | no | no | `score`, bandas, `controls`, `top_assets`, y `inherent_risk`/`residual_risk` de cada comprobación salen vacíos. |
| `preliminary` | sí | no | Hay `score`; bandas `null` y `band` de `top_assets` `null`. |
| `warning`, `usable`, `reliable` | sí | sí | Sin enmascarado. |

`coverage`, `unknown_percentage`, `counts`, `alerts` (incluidos los activos críticos) y los estados de las comprobaciones se devuelven siempre. El mismo enmascarado se aplica en el consolidado en vivo y en el resumen (§4.6). La API REST nativa de Payload lo replica a nivel de campo (`scoreFieldAccess.ts`) para que lecturas directas o relaciones pobladas (por ejemplo `inventory-snapshots.risk_score`) no filtren números que el endpoint oculta; el código de servidor, que lee con `overrideAccess`, no se ve afectado.

### 4.6 `GET /v1/security-review/summary`

Definido en `endpoints/assessments.ts`; se documenta aquí porque lee riesgo. Respuesta `SecurityReviewSummary`:

`{ scope?, recalculation?, risk_score, evaluated_percentage, applicable_checks, not_evaluable, requires_attention, excluded_assets, risk_band, unconfirmed_assets }`

Derivación (`riskSummaryDTO`): `risk_score` y `risk_band` con las mismas reglas de enmascarado; `evaluated_percentage` = `coverage`; `applicable_checks` = suma de `compliant`, `partially_effective`, `non_compliant` y `not_evaluable`; `requires_attention` = `non_compliant` + `partially_effective`; `excluded_assets` y `unconfirmed_assets` salen de `counts`.

Orden de verificaciones: sesión (401); organización (400 `organization_context_required`); feature `security_assessments` apagado (403 `feature_disabled`). Luego, con `read_assigned` y sin `office_id`: feature `risk_score` apagado (403 `feature_disabled`) y consolidado en vivo (`risk_unavailable` 503 si falla). En otro caso, `officeQueryError` y la última evaluación persistida de la organización o la oficina. Sin evaluación, 200 con ceros y `risk_score` y `risk_band` en `null`. No acepta `evaluation_id` ni paginación.

## 5. Reglas por operación

### 5.1 Lectura persistida

Se busca la evaluación (`sort: -evaluated_at`, `limit: 1`) filtrada por organización, oficina (o `office` vacío) y, si se pidió, `id`. Sin `evaluation_id`, la evaluación mostrada es siempre la más reciente por `evaluated_at`. Luego se cargan **todas** las comprobaciones de la evaluación (`pagination: false`), se resuelven los rótulos de los activos con dos consultas `in` (`assets` y `non-network-assets`, siempre filtradas por organización), se ordenan y se pagina en memoria (§5.5).

### 5.2 Carga de evidencia (`calculateRiskForScope`)

Lectura pura, compartida por el job y el consolidado en vivo:
- Oficinas activas de la organización, filtradas por `officeId` u `officeIds`. Las oficinas inactivas no cuentan: sus activos salen de la exposición.
- `organization-settings` (política `assessment_policy_key`; si no es una clave válida, `essential`).
- Activos de red y activos manuales no retirados de esas oficinas, paginados de a 200 hasta agotar el resultado (una truncación silenciosa quitaría pares de la cobertura). Un activo manual cuya categoría no tiene tipo de riesgo se omite.
- `compliance-results` **de toda la organización** con `valid_until` posterior a ahora: una evaluación de oficina hereda las respuestas de organización. Solo se usan las filas con `check_key` que empieza por `manual:` y `policy_key` igual a la política vigente; las respuestas dadas bajo otra política se ignoran. Los resultados técnicos automáticos no alimentan el motor: los controles automáticos se derivan en el momento de la evidencia actual.
- Agentes por oficina (para `A.8.16`), solo de oficinas que tienen activos de red.

### 5.3 Persistencia (`persistRiskEvaluation`)

Crea la evaluación y luego una fila de `risk-contributions` por par, **una inserción por fila**, en una transacción: propia, o la del request si la trae. Una falla revierte todo, de modo que nunca queda publicada una evaluación incompleta. Hereda `evaluated_at` del momento de lectura de la evidencia: una corrida lenta sobre evidencia más vieja no pasa a ser la "última" frente a una más reciente. Tras confirmar, hay una marca `NOTIFY` (Notification Bell no existe aún).

### 5.4 Consolidado en vivo (`assignedOfficeRisk`)

1. `canReadAssignedOfficeRisk` debe ser verdadero y haber organización, o lanza `forbidden`.
2. Se calcula la señal de evidencia (`evidenceSignal`): la última evaluación de **organización** (id) y el trabajo de organización abierto (id), unidos como `token`. Se lee **antes** de calcular: un cambio durante el cálculo obliga a recalcular en la próxima petición en lugar de ocultarse. De la misma lectura sale el estado de recálculo, que es el del trabajo de organización (`current` si no hay trabajo abierto).
3. La clave de caché es `<organizationId>|<officeIds ordenados>`. `createAssignedRiskCache` reutiliza la entrada si el `token` no cambió y tiene menos de 60 s (`ttlMs`). Hasta 100 entradas (`maxEntries`); al exceder se expulsa la inserción más antigua, y reinsertar una clave la mueve al final. Los llamadores concurrentes comparten una promesa; una promesa rechazada nunca se conserva, y un fallo viejo no borra una entrada más nueva de la misma clave.
4. Si el request ya tiene `transactionID`, se calcula sin caché, porque una promesa compartida no debe depender de la transacción de otro request.
5. `calculateAssignedRisk` llama a `calculateRiskForScope` con `officeIds`, arma la evaluación con `evaluationFromResult` (mismos campos que una persistida, `id: null`) y las comprobaciones con id `"<asset_id>:<control_key>"`.

Un fallo de cálculo se registra (`req.payload.logger.error`), no se cachea y responde 503 `risk_unavailable` sin detalle. La caché es por proceso: varias instancias guardan cada una la suya y siguen siendo correctas porque el `token` se revisa en cada petición.

### 5.5 Orden y paginación

`sortContributions` ordena **todas** las comprobaciones antes de paginar, con comparación de texto `es` (`Intl.Collator`, sin distinguir mayúsculas y con números naturales):
- `control`: por control, desempata por activo.
- `asset`: por rótulo visible del activo, desempata por control.
- `status`: de mejor a peor (`compliant`, `partially_effective`, `non_compliant`, `not_evaluable`) y al final lo excluido; desempata por control y activo.
- Todo orden termina en el id, para que ninguna fila se repita ni se pierda entre páginas. `direction: desc` invierte solo el criterio principal; los desempates conservan su sentido.

Orden y paginación son en memoria porque el rótulo del activo (alias, hostname, IP, MAC o id de activo) no está en la tabla. Es un límite declarado en el código (comentario `ponytail` en `endpoints/risk.ts`).

## 6. Catálogo de errores

Cuerpo: `{ error: <código> }`. `GET /v1/risk/latest` no devuelve `message` ni `issues`. El cliente muestra el texto de `lib/user-facing-error.ts`, indexado por código.

| Código | HTTP | Cuándo |
|---|---|---|
| `unauthenticated` | 401 | Sin sesión activa |
| `organization_context_required` | 400 | PlatformAdmin sin `asOrganization` |
| `forbidden` | 403 | Rol sin permiso `read` sobre `risk-evaluations` |
| `feature_disabled` | 403 | Feature `risk_score` apagado (o `security_assessments` en el resumen) |
| `invalid_query` | 400 | Query inválida (`limit` fuera de 10/25/50, `page` < 1, `sort` o `direction` inválidos, `evaluation_id` no UUID) |
| `office_forbidden` | 403 | `office_id` fuera de las oficinas del rol |
| `office_required` | 403 | Sin `office_id` para un rol sin alcance organizacional ni consolidado (incluye `evaluation_id` sin oficina del OfficeManager) |
| `evaluation_not_found` | 404 | `evaluation_id` inexistente en ese alcance |
| `risk_unavailable` | 503 | Falló el cálculo del consolidado en vivo |

`office_forbidden`, `office_required`, `evaluation_not_found` y los de validación no tienen texto propio en `user-facing-error.ts`; sí lo tienen `risk_unavailable`, `feature_disabled`, `forbidden`, `unauthenticated` y `organization_context_required`. Las excepciones no controladas (por ejemplo un fallo de lectura en la vista persistida) llegan a Payload como 500 sin código; solo el consolidado en vivo captura sus errores.

## 7. Concurrencia, atomicidad y efectos del sistema

### 7.1 Encolado

`enqueueRiskRecalculation(payload, organizationId, officeIds, req?)`:
- No hace nada si `PAYLOAD_DISABLE_JOBS === '1'` o no hay cola. Lanza si `jobs.runHooks` está activo: la cola transaccional exige `runHooks: false`, configurado en `payload.config.ts`.
- Encola siempre un trabajo de organización (`office_id` indefinido) más uno por cada oficina distinta y no vacía recibida. Quien llama pasa **toda** oficina que el cambio tocó (por ejemplo, la oficina previa de un activo que se movió).
- Usa la transacción del request si existe (el encolado se confirma o revierte junto con el cambio que lo originó) y, si no, abre una y la confirma al final. Sin transacciones PostgreSQL, lanza.
- No filtra organizaciones ni oficinas inactivas: lo hace el handler al correr.
- Lleva marcas `AUDIT` (AuditLog no existe aún).

`enqueueOrganizationRiskRecalculation` carga las oficinas activas y encola organización más todas ellas: para eventos de nivel organización (política, respuestas de la organización).

### 7.2 Tarea `recalculate-risk` (`payload.config.ts`)

- Cola `risk`; `retries: { attempts: 5, backoff: exponencial, delay: 1000 }`.
- `concurrency`: clave `risk:<organization_id>:<office_id | 'org'>`, `exclusive: true`, `supersedes: true`.
- Handler: carga organización y oficina; si alguna está inactiva (`is_active === false`) devuelve salida vacía (sin `evaluation_id`) y no persiste nada; si no, `recalculateRisk` y devuelve `evaluation_id`.
- `jobs.deleteJobOnComplete: true`: el trabajo completado desaparece, y por eso "sin trabajo abierto" equivale a "al día".
- El handler no consulta el feature `risk_score`: las evaluaciones se calculan aunque el feature esté apagado para la organización.

### 7.3 `autoRun`, recuperación y tarea diaria

- `autoRun` agenda `risk` cada 15 s (`limit: 10`) y `maintenance` cada minuto (`limit: 5`). Corre dentro del proceso de la aplicación: exige un proceso siempre encendido (el comentario de `payload.config.ts` aclara que no funciona en serverless).
- `onInit: recoverJobsOnStartup`: al arrancar, pone `processing: false` en los trabajos de las colas `risk` y `maintenance`. Asume que el proceso es el único worker; `SIAM_JOB_RECOVERY_ON_START=0` lo desactiva para workers compartidos.
- `refresh-risk` (cola `maintenance`, cron `0 45 3 * * *`): encola organización más oficinas activas para cada organización activa. Es la red de seguridad para lo que cambia sin evento: el vencimiento de respuestas (`valid_until`) y los latidos de agentes que dejan de llegar. Esos dos pueden demorar hasta un día en reflejarse en la vista persistida. Acumula fallos por organización y lanza un `AggregateError` al final si hubo alguno.

### 7.4 Quién encola

| Origen | Archivo |
|---|---|
| Ingesta de un reporte de escaneo | `domain/inventories/ingestScanReport.ts` (una vez por corrida, con las oficinas de presencia) |
| Un activo cambia (y sus hooks de aplicabilidad) | `collections/Assets/hooks/reconcileAssessmentApplicability.ts`, `collections/NonNetworkAssets/hooks/reconcileAssessmentApplicability.ts`; con `context.systemJob` solo se encola si cambió la oficina |
| Activo pasa a fuera de línea | `domain/inventories/agingSweep.ts` |
| Un agente cambia entre en línea y fuera de línea | hook `afterChange` en `collections/Agents/index.ts` |
| Cierre de una revisión | `domain/assessments/assessmentLifecycle.ts` (`completeAssessment`), `domain/assessments/bulkAssessmentLifecycle.ts` |
| Cambio de política de revisión | `endpoints/assessments.ts` (`assessmentPolicyEndpoint`) |
| Alta y baja de oficina | `domain/offices/office-lifecycle.ts` |
| Reactivación de organización | `domain/organizations/organization-lifecycle.ts` |
| Diario | `refresh-risk` |

### 7.5 Atomicidad

`persistRiskEvaluation` es atómico por evaluación (§5.3). El encolado comparte la transacción del evento que lo origina (§7.1). La lectura del consolidado en vivo no escribe nada y una prueba verifica que no crea evaluaciones.

### 7.6 Evaluación síncrona en snapshots

`createInventorySnapshot` llama a `recalculateRisk` y guarda el id en `inventory-snapshots.risk_score`, además de un resumen (`score` enmascarado con `scoreVisible`, `coverage`, `unknown_percentage`, `evaluated_at`) en el snapshot. Es el único camino que persiste una evaluación fuera del job.

### 7.7 Puntos de enganche pendientes

Las escrituras llevan comentarios `// AUDIT:` y `// NOTIFY:`. AuditLog y Notification Bell **no existen aún**: son marcas, no código. Ver `SYSTEM_PROMPT.md` §2.

## 8. Frontend

### 8.1 Cadena

- Página: `app/portal/(protected)/risk-score/page.tsx`.
- Componentes (`modules/risk/components/`): `RiskScopeExplanation`, `RiskAlerts`, `TopRiskAssets`, `RiskBandBadge`, `RiskRobot`. Además `modules/risk/risk.columns.tsx`, `risk-labels.ts` y `risk-calculation-message.ts`.
- Hook: `modules/risk/hooks/use-latest-risk.ts`.
- Cliente: `modules/risk/service.ts`, que usa `lib/http-client.ts` contra `/api/v1/risk/latest`.

El Panel general y Revisión de seguridad leen el resumen por otra ruta: `useRiskSummary` → `getSecurityReviewSummary` (`modules/assessments/service.ts`) → `/api/v1/security-review/summary`. El Panel usa `riskSummary.unconfirmed_assets` y `requires_attention` para sus contadores y, si la consulta falla sin datos, quita esos elementos en vez de contarlos como cero (`riskUnavailable`).

### 8.2 Alcance en el cliente

`useConcreteOfficeId` (con `officeRiskScope`) decide qué `office_id` pedir:
- Si la oficina seleccionada pertenece a `tenant.officeIds`, esa; si no hay selección y el usuario tiene una sola oficina, esa; en otro caso, ninguna.
- `requiresOfficeSelection` es verdadero para roles sin alcance organizacional y sin permiso `assignedOfficeRisk`, sin oficina resuelta y con más de una oficina. La página muestra `OfficeRiskSelectionNotice` y no consulta.
- `ready` es falso hasta conocer el tenant. Las consultas usan `enabled: ready`.
- Un OfficeManager con `assignedOfficeRisk` y sin oficina elegida pide sin `office_id` y recibe el consolidado. Un rol con alcance organizacional sin oficina pide sin `office_id` y recibe la evaluación de organización.
- Los enlaces de tareas a una evaluación (`modules/tasks/task-reference-link.ts`) incluyen `evaluation=<id>&officeId=<oficina | all>`, para que una evaluación de oficina se consulte con su oficina.

### 8.3 Consultas (TanStack Query)

| Hook | Clave | Notas |
|---|---|---|
| `useLatestRisk(params)` | `['risk', 'latest', asOrganization, officeId, page ?? 1, limit, sort, direction, evaluationId]` | `refetchInterval` 3 s si `recalculation` es `pending`, `processing` u `outdated`; si no, 30 s; sin refetch con `evaluationId`. `placeholderData: keepPreviousData` mantiene la página visible mientras llega la siguiente. |
| `useRiskSummary(params)` | `['assessments', 'risk-summary', asOrganization, officeId]` | Mismo criterio de refetch (3 s / 30 s). Cuelga del prefijo `['assessments']`. |

La página reinicia `page` a 1 al cambiar oficina, organización, evaluación, tamaño u orden, ordena con `manualSorting` (el servidor ordena toda la evaluación) y muestra los avisos según `getRiskCalculationMessage(recalculation, hasEvaluation)`. El aviso no aparece en vista histórica.

### 8.4 Invalidaciones

`['risk']` se invalida en: cierre masivo de revisiones (`useBulkAssessments`) e `invalidateSecurityReview` (cambios de activos, identificación, incidentes y `ScanResultMonitor`). El cierre individual (`useAssessmentActions`) y el cambio de política (`useUpdateAssessmentPolicy`) invalidan `['assessments']`, que incluye el resumen pero no `['risk']`; la página de riesgo se actualiza por su refetch de 3 o 30 s.

### 8.5 Contrato de tipos

`RiskEvaluationDTO`, `RiskContributionDTO` y `LatestRiskResponse` están en `modules/risk/service.ts`; el endpoint los importa con `satisfies LatestRiskResponse` para mantenerlos sincronizados. Los tipos de dominio (`ConfidenceBand`, `PairStatus`, `AssetRiskScore`, `ControlAggregate`, `RecalculationStatus`) se importan de `domain/risk`.

## 9. Cómo extender

**Nuevo control basado en preguntas.** Agregar preguntas y control a `catalog-v2/catalog.ts` (mismo alcance y tipos de activo en todas las preguntas del control: el validador no lo exige, ver el comentario `TODO(engine-limit)` en `validate-catalog.ts`); agregar su `reason_code` a `modules/risk/risk-labels.ts` (hay una prueba que exige una explicación por cada par que el motor puede producir); cubrir el caso en `domain/risk/*.test.ts`. Si cambian preguntas ya usadas, subir su `version` y revisar `reconcileAssessmentInstance` (compara las preguntas aplicables con el `question_set_snapshot` del ciclo abierto).

**Nuevo control automático.** Agregar la eficacia en `automatic-evidence.ts` o `evaluateAutomaticCompliance.ts`, emitir su par en `buildRiskPairs` (con `gate` para activos no confirmados), y registrar el control en `RISK_CONTROLS_V2` para que tenga severidad y título.

**Nuevo origen de recálculo.** Llamar a `enqueueRiskRecalculation` con todas las oficinas afectadas, preferentemente con el `req` del evento para compartir transacción. No llamar a `recalculateRisk` desde un request: bloquea y duplica trabajo.

**Cambiar umbrales o pesos.** Solo en `constants.ts`; `scoreVisible` y `bandVisible` son la regla única para endpoint, resumen, snapshots y campos de colección. Subir `RISK_ENGINE_VERSION` o `RISK_CATALOG_VERSION` si cambia el significado de lo persistido.

**Nuevo dato en la respuesta.** Tipo en `modules/risk/service.ts`, armado en `evaluationDTO` o `contributionDTO`, y aplicar la regla de enmascarado si es un número derivado del puntaje (y su equivalente en `scoreFieldAccess.ts` si se persiste).

## 10. Comportamientos a tener presentes

Verificados en el código; no son necesariamente defectos, pero conviene conocerlos antes de tocar el feature.

1. **Resumen y feature `risk_score`.** `GET /v1/security-review/summary` exige `security_assessments`, pero solo verifica `risk_score` en la rama del consolidado en vivo. En la vista persistida devuelve riesgo aunque `risk_score` esté apagado. `GET /v1/risk/latest` sí lo exige siempre. La prueba `endpoints/assigned-office-risk.audit.integration.test.ts` cubre el feature solo para los dos endpoints en la rama asignada.
2. **Resumen y permiso.** El resumen no consulta `canDo(..., 'risk-evaluations', 'read')`; `/v1/risk/latest` sí. Hoy todos los roles lo tienen, por lo que no hay diferencia observable.
3. **Cálculo con el feature apagado.** Los trabajos se encolan y se ejecutan, y `createInventorySnapshot` recalcula, sin consultar `risk_score`. El feature solo cierra la lectura.
4. **Enmascarado por `confidence`.** `scoreVisible` y `bandVisible` usan la confianza de cobertura, no `effective_confidence`. Un `unknown_percentage` alto degrada `effective_confidence` (se muestra en la UI) pero no oculta el puntaje.
5. **Orden y paginación en memoria.** Cada petición de la vista persistida carga todas las comprobaciones de la evaluación y todos los rótulos antes de paginar; el consolidado en vivo además mantiene todas las comprobaciones en la caché. El costo crece con activos × controles aplicables. Es un límite documentado en el código.
6. **Consolidado en vivo: costo y frescura.** Cada fallo de caché ejecuta `calculateRiskForScope`: recorre todos los activos de las oficinas, todos los `compliance-results` vigentes de la organización (incluidos los resultados técnicos automáticos, que luego se descartan en memoria) y una consulta de agentes por oficina. La señal de caché depende solo de la última evaluación y del trabajo abiertos de la **organización**; vencimientos y latidos no cambian la señal, por lo que se reflejan al expirar el TTL de 60 s.
7. **Frescura asimétrica.** La vista en vivo refleja vencimientos de respuestas y agentes silenciosos como máximo a los 60 s; la persistida, hasta el siguiente recálculo, que sin eventos es el job diario (`refresh-risk`, 03:45).
8. **Estado de recálculo del consolidado.** `recalculation` es el del trabajo de organización, no el de las oficinas del OfficeManager; un trabajo de oficina en curso no se refleja.
9. **`outdated` y sondeo.** Un alcance sin evaluación y sin trabajo abierto devuelve `outdated`, y el cliente lo sondea cada 3 s mientras la pantalla esté abierta; no hay otro estado que lo distinga de "calculándose".
10. **`evaluation_id` y oficina.** Sin `office_id` la búsqueda por id solo ve evaluaciones de organización: un id de evaluación de oficina sin su `office_id` responde `evaluation_not_found`. Los enlaces de tareas incluyen la oficina por esta razón.
11. **`invalid_query` sin detalle.** `/v1/risk/latest` responde `{ error: 'invalid_query' }` sin `issues`, a diferencia de los endpoints de revisiones, que sí los incluyen.
12. **Respuestas "No aplica".** Una pregunta contestada `not_applicable` con justificación no saca el par de la cobertura: queda `not_evaluable` (`reason_code: not_applicable` en la comprobación persistida del control) y baja la cobertura igual que `unknown`.
13. **Inserciones una a una.** `persistRiskEvaluation` crea cada comprobación con una llamada propia (comentario `ponytail` en el código); evaluaciones con muchos pares alargan la transacción.
14. **Manejo de errores asimétrico.** Solo la rama del consolidado captura errores y responde `risk_unavailable`; un fallo de lectura en la vista persistida se propaga como 500 sin código.

## 11. Cobertura de pruebas

Estado de cobertura automática; sin pruebas de extremo a extremo por ahora.

| Prueba | Cubre |
|---|---|
| `domain/risk/engine.test.ts` | Fórmulas, tope por control, límites de umbrales, degradación de confianza, alertas, fallas sistémicas |
| `domain/risk/reference-fixtures.test.ts` | Dos fixtures de referencia (oficina segmentada; mismo caso con un equipo no identificado en el mismo CIDR) |
| `domain/risk/build-pairs.test.ts` | Pares aplicables, herencia de respuestas, activos no confirmados, excluidos, sin tipo de riesgo, fuera de línea |
| `domain/risk/automatic-evidence.test.ts` | A.8.21, exposición y multiplicador de alcance |
| `domain/risk/control-efficacy.test.ts` | Reglas condicionales, `unknown` y `not_applicable`, política reforzada |
| `domain/risk/constants.test.ts` | Escalas, umbrales y visibilidad por confianza |
| `domain/risk/catalog-v2/catalog.test.ts` | Validez del catálogo |
| `domain/risk/sort-contributions.test.ts` | Orden por activo, resultado y control, y estabilidad por id |
| `domain/risk/assigned-risk-cache.audit.test.ts` | Reutilización por señal, TTL, concurrencia, fallos, tope de 100 y orden de expulsión |
| `domain/risk/assigned-office-risk.audit.test.ts` | Roles rechazados, membresía inactiva, alcance desde la membresía, estado compartido, sin caché dentro de una transacción |
| `domain/risk/enqueueRiskRecalculation.test.ts` | Organización más oficinas distintas, eventos de organización, jobs desactivados |
| `domain/risk/enqueueRiskRecalculation.integration.test.ts` | Una ráfaga deja como máximo un trabajo pendiente por alcance |
| `domain/risk/delivery.audit.test.ts` | Encolado con la transacción del padre, reversión, recuperación al arrancar |
| `domain/risk/recalculateRisk.integration.test.ts` | Persistencia de todos los pares, vencimiento, herencia de organización, políticas ajenas, oficina inactiva |
| `endpoints/risk.integration.test.ts` | Aislamiento por organización y oficina, paginación inválida, ocultamiento de números (endpoint y REST), Viewer con oficina obligatoria, Manager sin oficina |
| `endpoints/assigned-office-risk.audit.integration.test.ts` | Consolidado con el motor (no promedio), sin escrituras, coincidencia con el resumen, conjuntos de oficina forjados, membresía vigente, feature, enmascarado, reutilización entre páginas, estado de recálculo, `risk_unavailable` |
| `endpoints/audit-fixes.audit.integration.test.ts` | Entrega transaccional del recálculo y reemplazo de trabajos (SEC-36, SEC-57, SEC-58) |
| `modules/risk/risk-calculation-message.audit.test.ts` | Mensajes por estado de recálculo |
| `modules/risk/risk-labels.test.ts` | Explicación para cada par que el motor puede producir |
| `modules/offices/office-risk-scope.audit.test.ts` | Resolución de oficina y de consolidado en el cliente |

Las pruebas de integración requieren una base PostgreSQL desechable.
