# API de riesgo

Referencia técnica del feature `risk`: índice de deficiencias (B pura, `engine_version` 3), evaluaciones persistidas, consolidado en vivo del OfficeManager, cola de recálculo, contrato HTTP y la cadena que lo conecta con el frontend. Dirigida a quien mantiene o extiende el feature. Las revisiones de seguridad que alimentan el motor se documentan en `docs/assessments-api.md`; el ciclo de vida de tareas que referencian evaluaciones, en `docs/task-api.md`.

Verificado contra el código el 2026-11-20 (fase 5 del [plan del índice de deficiencias](../../documentation/planes/indice-deficiencias/plan-indice-deficiencias.md)). Si algo de este documento contradice el código, gana el código: corregir el documento.

## 1. Capas y archivos

| Capa | Archivo | Responsabilidad |
|---|---|---|
| Contrato (tipos) | `modules/risk/service.ts` | Tipos `RiskEvaluationDTO`, `DeficiencyItemDTO`, `PendingItemDTO`, `Subject`, `ReasonDTO`, `LatestRiskResponse`, `RiskScope`, `RiskList` y la función `getLatestRisk`. No hay schema Zod compartido: la query se valida en el endpoint. |
| Contrato (constantes) | `domain/risk/constants.ts` | Pesos de criticidad, umbrales de banda, versiones de motor y catálogo, tamaños de página. Las reglas de lectura `indexVisible` / `bandVisible` están en `domain/risk/deficiency-index.ts`. |
| Endpoint de detalle | `endpoints/risk.ts` | `GET /v1/risk/latest`. Autenticación, permisos, feature flag, query, selección de vista, paginación, enmascarado y serialización. Registrado en `payload.config.ts` como `latestRiskEvaluationEndpoint`. |
| Endpoint de resumen | `endpoints/assessments.ts` (`securityReviewSummaryEndpoint`) | `GET /v1/security-review/summary`. Vive junto a las revisiones pero lee riesgo (§4.6). |
| Alcance | `access/rbac/risk-scope.ts` | `canReadAssignedOfficeRisk`: quién puede pedir el consolidado en vivo. |
| | `access/tenant/officeQueryError.ts` | Valida `office_id` contra el alcance del rol. |
| Motor | `domain/risk/deficiency-index.ts` | `calculateDeficiencyIndex` (B pura), importancias, umbrales de visibilidad y banda, `indexVisible`/`bandVisible`. |
| | `domain/risk/deficiency-pairs.ts` | `buildDeficiencyPairs`: pares (activo, control) con evidencia, motivos y prioridad; contadores de activos y contexto. |
| | `domain/risk/answer-evidence.ts` | Evidencia de respuestas humanas y precedencia (`selectAnswer`). |
| | `domain/risk/network-evidence.ts` | A.8.21: observación, agregado por servicio (D25) y antecedente histórico (D26). |
| | `domain/risk/priority.ts` | Motivos, prioridad y contadores de deficiencias y de servicios pendientes. |
| | `domain/risk/automatic-evidence.ts` | Cumplimiento de A.5.9, A.5.12 y A.8.20. |
| | `domain/risk/control-efficacy.ts` | `evaluateControlEfficacy`: eficacia de un control basado en preguntas. Lo usa el cierre de revisiones, no el recálculo. |
| | `domain/risk/risk-asset-type.ts` | Mapeo explícito de categoría de activo a tipo de riesgo, y categorías que reciben revisión. |
| | `domain/risk/catalog-v2/` | Catálogo de preguntas, controles y reglas condicionales (`catalog.ts`), tipos (`types.ts`), validación al importar (`validate-catalog.ts`, `index.ts`). |
| Cálculo y persistencia | `domain/risk/recalculateRisk.ts` | `calculateRiskForScope` (lectura pura, compartida) y `recalculateRisk` (calcula y persiste). |
| | `domain/risk/evaluation-from-pairs.ts` | `evaluationFromPairs`: campos de la evaluación, comunes a la persistida y la en vivo. |
| | `domain/risk/persistRiskEvaluation.ts` | Escribe una evaluación y todos sus pares en una transacción; `contributionFromPair` es el mapper compartido con el consolidado. |
| Consolidado en vivo | `domain/risk/assigned-office-risk.ts` | `assignedOfficeRisk`: calcula y cachea el consolidado de las oficinas asignadas. |
| | `domain/risk/assigned-risk-cache.ts` | Caché por proceso con señal de evidencia, TTL y tope. |
| Estado de recálculo | `domain/risk/recalculation-status.ts` | `openRiskJob`, `riskJobStatus`, `riskRecalculationStatus`. |
| Cola | `domain/risk/enqueueRiskRecalculation.ts` | `enqueueRiskRecalculation`, `enqueueOrganizationRiskRecalculation`. |
| | `domain/risk/recover-jobs.ts` | Recuperación de jobs al arrancar el proceso. |
| | `payload.config.ts` | Tareas `recalculate-risk` y `refresh-risk`, cola `risk`, `autoRun`, `onInit`. |
| Listas | `domain/risk/risk-lists.ts` | `buildRiskLists`: Deficiencias y Pendientes agrupadas, con orden fijo, a partir de las filas de contribución (misma función para la vista persistida y el consolidado). |
| Persistencia | `collections/RiskEvaluations/index.ts`, `collections/RiskEvaluations/scoreFieldAccess.ts` | Colección `risk-evaluations` y acceso por campo. |
| | `collections/RiskContributions/index.ts` | Colección `risk-contributions`. |
| Estado de servidor | `modules/risk/hooks/use-latest-risk.ts` | `useLatestRisk` (TanStack Query). |
| | `modules/assessments/hooks/use-risk-summary.ts` | `useRiskSummary` (resumen del Panel y de Revisión de seguridad). |
| UI | `app/portal/(protected)/risk-score/page.tsx`, `modules/risk/components/*`, `modules/risk/risk-controls.columns.tsx`, `modules/risk/risk-labels.ts`, `modules/risk/risk-calculation-message.ts` | Presentación. |
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
| `catalog_version`, `engine_version` | number | `RISK_CATALOG_VERSION` = 2, `RISK_ENGINE_VERSION` = 3. |
| `policy_key` | `essential` \| `reinforced` | Política de revisión vigente al calcular. |
| `evaluated_at` | date | Momento en que se **leyó** la evidencia, no en que se guardó (§5.3). Indexado. |
| `index` | number, opcional | Índice 0–100. Visible por REST solo si `indexVisible(visibility)`. |
| `band` | `low` \| `moderate` \| `high` \| `very_high`, opcional | Visible por REST solo si `bandVisible(visibility)`. |
| `coverage` | number, opcional | Información disponible 0–100, ponderada por importancia; nula si no hay controles puntuables aplicables. Siempre visible. |
| `visibility` | `undetermined` \| `hidden` \| `preliminary` \| `banded` | Única entrada de las reglas de lectura (§4.5). |
| `control_summary` | json `ControlIndex[]` | `control_key`, `importance`, `deficiency` (D_c), `coverage` (0–1), `evaluated_pairs`, `pending_pairs`, `warning`. Visible por REST solo si `indexVisible`. |
| `warnings` | json | Controles con importancia ≥ 4 y cobertura < 80 %: `control_key`, `importance`, `coverage`, `pending_pairs`. Siempre visible. |
| `asset_summary` | json `AssetIndex[]` | Índice de cada activo sobre sus propios pares: `asset_key`, `index`, `coverage`, `visibility`, `band`. Visible por REST solo si `indexVisible`. |
| `counts` | json `EvaluationCounts` | `pairs` por estado (solo controles del índice), `assets` (dimensiones superpuestas, no se suman), `deficiencies` por prioridad (motivos únicos), `network` (servicios pendientes y equipos afectados). |
| `context` | json `EvaluationContext` | `office_visibility` (A.8.16, una por oficina) y `shared_cidr` (por oficina + CIDR). |

Si un `select` parcial deja afuera `visibility`, el acceso por campo la lee una vez por evaluación y la guarda en `req.context`; sin id o ante un error, oculta.

#### `risk-contributions`

Una fila por par (activo, control) de la evaluación.

| Campo | Tipo | Notas |
|---|---|---|
| `organization`, `office`, `evaluation` | relación | `office` es el de la evaluación. `evaluation` requerido e indexado. |
| `asset_key` | text | `asset:<id>` o `manual:<id>`. Indexado. |
| `asset`, `manual_asset` | relación | Solo la que corresponde al prefijo de `asset_key`. |
| `asset_office` | relación | Oficina del activo; agrupa pendientes y avisos. Indexado. |
| `asset_type` | tipo de riesgo, opcional | Nulo si el activo no tiene tipo confirmado. |
| `control_key` | text | Indexado. |
| `criticality` | `low` \| `medium` \| `high` \| `critical` \| `unknown` | |
| `criticality_weight` | number | 1/2/4/8; `unknown` pesa 2. |
| `applicability` | `applicable` \| `not_applicable` | |
| `compliance` | number, opcional | 0–1; nulo = no evaluable. |
| `status` | `compliant` \| `partially_effective` \| `non_compliant` \| `not_evaluable` \| `not_applicable` | |
| `reason_code` | text | Resumen del par. |
| `priority` | `low` \| `medium` \| `high` \| `critical`, opcional | Máximo de los motivos de deficiencia no subordinados. Indexado **solo para filtrar**: ordenar por él en la base da orden alfabético con los nulos primero; el orden se arma en memoria con `priority.ts`. |
| `evidence` | json `PairEvidence` | Respuesta, comprobación automática u observación de red con sus hallazgos. |
| `reasons` | json `Reason[]` | Motivos de Deficiencias y de Pendientes. |

Por par no hay números ocultos: el cumplimiento de un par es una respuesta o una comprobación, no el índice.

### 2.2 Catálogo v2 y motor

`domain/risk/catalog-v2/catalog.ts` define 20 preguntas (4 de alcance organización, 3 de oficina, 13 de activo), 18 controles (13 basados en preguntas y los 5 automáticos de abajo), y 3 reglas condicionales (`force_zero` o `multiply`). Dos preguntas son exclusivas de la política `reinforced`; las demás aplican a ambas. Toda pregunta ofrece además las opciones `unknown` y `not_applicable` (esta última exige justificación) con eficacia nula. `validateRiskCatalogV2` corre al importar `catalog-v2/index.ts`: un catálogo inválido hace fallar el arranque.

Controles automáticos (no tienen preguntas):

| Control | Unidad | Origen |
|---|---|---|
| `A.5.9` Inventario | activo | `inventoryEfficacy`: identificado, con responsable y autorización decidida (`authorized` o `unauthorized`) = 1; si no, nulo. La criticidad es A.5.12 y un no autorizado es A.8.20. Es el mismo criterio que usa `evaluateAssetFacts` para el resultado `asset.inventory.complete` del Assessment. Fuera del índice: alimenta «Estado del relevamiento». |
| `A.5.12` Clasificación | activo | `classificationEfficacy`: criticidad distinta de `unknown` = 1; si no, nulo. Fuera del índice. |
| `A.8.16` Monitoreo | oficina | `evaluateOfficeMonitoring` sobre los agentes de la oficina: compliant = 1, non_compliant = 0, sin agentes = nulo. Solo activos de red. Fuera del índice: un aviso por oficina en `context.office_visibility`. |
| `A.8.20` Shadow IT | activo | `shadowItEfficacy`: autorizado = 1, no autorizado = 0, pendiente o no identificado = nulo. Solo activos de red. Importancia 4; no autorizado = motivo `high`. |
| `A.8.21` Servicios de red | activo | `summarizeNetwork` (`network-evidence.ts`) sobre `evaluateNetworkBaseline`: un prohibido válido = 0 aunque otros servicios sean inciertos; sin prohibidos y con pendientes = nulo; solo esperados = 1; offline o cobertura incompleta = nulo. Un motivo por servicio. Solo activos de red. |

Índice (`deficiency-index.ts`, B pura): `D_c = Σ k_a(1−c)/Σ k_a` por control, con `k_a` el peso de criticidad (1/2/4/8, `unknown` 2); índice = `100 · Σ imp_c·D_c / Σ imp_c` sobre los controles con algún par evaluado. A.5.9, A.5.12 y A.8.16 quedan fuera del índice. La cobertura es la importancia evaluada sobre la aplicable y se informa al lado, nunca multiplica al índice. Visibilidad: sin controles puntuables `undetermined`; cobertura < 40 `hidden`; < 80 `preliminary` (índice sin banda); ≥ 80 `banded`. Bandas: < 25 `low`, < 50 `moderate`, < 75 `high`, si no `very_high`.

Armado de pares (`buildDeficiencyPairs`): por cada activo se crean primero todos los pares aplicables y recién después se decide la evaluabilidad, así la evidencia faltante o vencida queda en el denominador de cobertura. Un activo de red no identificado o con autorización `pending` deja todos sus pares en nulo con `reason_code: asset_unconfirmed` y un único pendiente en A.5.9. La respuesta más específica gana: la del activo, la de su oficina y la de la organización; los controles de alcance `asset` nunca heredan. Un activo excluido de las revisiones no genera pares de preguntas, pero sí los automáticos. Un «No aplica» justificado genera un par `not_applicable`, fuera de la cobertura y del índice. Motivos y prioridad: `priority.ts` (propuesta de prioridades §4–§6).

### 2.2.1 Importancias (D20)

`CONTROL_IMPORTANCE` (`deficiency-index.ts`) fija cuánto pesa en el índice que falle cada control frente a los demás. No mide urgencia (eso es la prioridad de los motivos), ni la eficacia de una respuesta, ni la cantidad de activos. El criterio es propio (Plan del índice §3, D20), sin revisión de la directora: el **rol del control frente a un compromiso**, con prácticas básicas de referencia (CIS Controls v8 IG1, Essential Eight, CISA CPG) como orientación, no como fuente de los números.

| Nivel | Rol | Pregunta que lo define |
|---:|---|---|
| 8 | Amplificador | ¿Si falla, anula o debilita a los demás controles? |
| 4 | Barrera o recuperación esencial | ¿Impide directamente un compromiso o una pérdida, o permite recuperarse, y es una práctica básica para organizaciones chicas? |
| 2 | Capa complementaria | ¿Reduce el riesgo solo en un escenario acotado, se solapa con un control de nivel 4, o la evidencia de SIAM es limitada? |
| 1 | Proceso o registro | ¿Mejora el seguimiento o el aprendizaje, sin proteger directamente? |

Cada nivel pesa el doble que el anterior: es la misma escala 1/2/4/8 que la criticidad de los activos, y una falla de un nivel equivale a dos del inferior. Una escala lineal (1/2/3/4) separaría demasiado poco una barrera esencial de una capa complementaria.

| Control | imp_c | Rol | Fundamento |
|---|---:|---|---|
| A.8.2 Accesos privilegiados | 8 | Amplificador | Con credenciales administrativas se desactivan antivirus, se borran registros y se cifran respaldos. |
| A.5.15 Control de acceso | 4 | Barrera | Cuentas individuales y baja de accesos impiden el acceso de quien ya no debe tenerlo. |
| A.8.7 Malware | 4 | Barrera | Protección activa y actualizada contra software dañino. |
| A.8.8 Vulnerabilidades técnicas | 4 | Barrera | Software con soporte recibe correcciones. |
| A.8.9/A.8.20 Configuración de red | 4 | Barrera | Contraseñas por defecto y firmware sin mantener exponen la infraestructura de la oficina. |
| A.8.13 Copias de seguridad | 4 | Recuperación | Lo único que permite recuperarse de ransomware o de una pérdida. |
| A.8.20 Autorización de activos | 4 | Barrera | Un equipo no autorizado es un punto de entrada que nadie gestiona. |
| A.8.22 Segregación de redes | 4 | Barrera | Separar la red de invitados evita compartir la red de trabajo. |
| A.7.9 Activos fuera de instalaciones | 2 | Complementaria | Protege solo ante pérdida o robo del equipo. |
| A.8.1 Uso de endpoints | 2 | Complementaria | El uso compartido pide gobierno, pero no abre por sí una vía de compromiso. |
| A.8.5 Autenticación y bloqueo | 2 | Complementaria | Acceso local; se solapa con A.5.15. |
| A.8.15 Registros | 2 | Complementaria | Detecta y reconstruye; no impide. |
| A.8.19 Instalación de software | 2 | Complementaria | Se solapa con A.8.2; pesarlo más contaría dos veces la misma falla. |
| A.8.21 Servicios de red | 2 | Complementaria (D23) | Por rol sería barrera, pero la baseline tiene 4 reglas y el escaneo cubre un rango limitado. |
| A.5.25 Evaluación de eventos | 1 | Proceso | Mejora el seguimiento; no protege directamente. |

A.5.9, A.5.12 y A.8.16 no tienen importancia: quedan fuera del índice y de su cobertura (`INDEX_EXCLUDED_CONTROLS`). Las importancias son una preferencia de ponderación documentada, no una medición de daño ni valores prescritos por ISO. Sensibilidad medida con `scripts/simulate-deficiency-index.ts`: la escala lineal 1/2/3/4 y los casos dudosos (A.7.9 = 4, A.8.22 = 2) mueven el índice unos ±3 puntos sobre la seed. `deficiency-index.ts` rechaza un control puntuable sin importancia.

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

**Una evaluación persistida.** Un evento (escaneo, cambio de un activo, respuesta de revisión, cambio de política, agente que cambia de en línea a fuera de línea) llama a `enqueueRiskRecalculation`, que encola un trabajo `recalculate-risk` para la organización y otro por cada oficina afectada. El worker toma el trabajo, descarta organizaciones u oficinas inactivas (sin escribir nada) y llama a `recalculateRisk`: `calculateRiskForScope` carga evidencia, `buildDeficiencyPairs` arma los pares con sus motivos, `evaluationFromPairs` calcula el índice con `calculateDeficiencyIndex` y `persistRiskEvaluation` crea la evaluación y sus comprobaciones en una sola transacción. La vista persistida siempre muestra la última evaluación completada; mientras hay un trabajo abierto, `recalculation` lo indica y la evaluación mostrada puede estar desactualizada.

**Ráfaga de eventos.** Un escaneo que actualiza muchos activos genera muchos encolados. La clave de concurrencia de la tarea (`risk:<org>:<oficina|org>`, `exclusive: true`, `supersedes: true`) hace que un trabajo nuevo reemplace al pendiente del mismo alcance y que solo corra uno a la vez por alcance. Solo importa el último estado. Una prueba de integración verifica que una ráfaga deja como máximo un trabajo pendiente por alcance.

**Vista de OfficeManager sin oficina.** Un OfficeManager que no indica `office_id` no lee una evaluación persistida (no existe una para "mis oficinas"): `assignedOfficeRisk` calcula en el momento, con el motor, el conjunto exacto de sus oficinas asignadas y no escribe nada. La respuesta lleva `scope: 'assigned_offices'` y `evaluation.id: null`. El resultado no es el promedio de los índices por oficina: es una evaluación conjunta.

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
| `list` | `deficiencies` \| `pending` | Por defecto `deficiencies`. Otro valor: `invalid_query`. |

No hay orden elegible: el servidor ordena ambas listas con un orden fijo (§5.5). Parámetros desconocidos, como un `sort` viejo, se ignoran.

La query se valida **antes** de calcular el consolidado en vivo. Un valor inválido responde `400 { error: 'invalid_query' }` sin detalle.

### 4.3 Vistas y forma de la respuesta

`LatestRiskResponse`: `{ scope?, recalculation?, evaluation, list, items, totals, pagination }`. `items` son `DeficiencyItemDTO[]` si `list` es `deficiencies` y `PendingItemDTO[]` si es `pending`; `totals = { deficiencies, pending }` es la cantidad de ítems de cada lista sobre toda la evaluación.

| Vista | Condición | `scope` | `evaluation.id` | `recalculation` |
|---|---|---|---|---|
| Consolidado en vivo | Sin `office_id` ni `evaluation_id`, y `read_assigned` | `assigned_offices` | `null` | Estado del trabajo de **organización** (§5.4) |
| Organización persistida | Sin `office_id`, rol con alcance organizacional | `organization` | uuid | Estado del alcance organización |
| Oficina persistida | Con `office_id` permitido | `office` | uuid | Estado del alcance oficina |
| Histórica | Con `evaluation_id` | `organization` u `office` | uuid | **Ausente** (`undefined`, no se serializa) |

Sin evaluación en la vista persistida (alcance nunca evaluado) responde 200 con `evaluation: null`, `items: []`, `totals` en 0 y `pagination: { page, totalPages: 0, totalDocs: 0, hasNextPage: false }`. Con `evaluation_id` que no existe en ese alcance: 404 `evaluation_not_found`.

`pagination`: `{ page, totalPages, totalDocs, hasNextPage }`. En la vista persistida `hasNextPage = page < totalPages`; en el consolidado, `page * limit < totalDocs`. Pedir una página más allá del final devuelve `items: []` con el `totalDocs` real.

### 4.4 Forma exacta de los DTO

`RiskEvaluationDTO` (`modules/risk/service.ts`, armado en `evaluationDTO` de `endpoints/risk.ts`, contratos §7):

| Campo | Tipo | Notas |
|---|---|---|
| `id` | `string \| null` | `null` en el consolidado en vivo. |
| `evaluated_at` | string ISO | |
| `engine_version`, `catalog_version` | number | |
| `policy_key` | `essential` \| `reinforced` | |
| `index` | `number \| null` | Enmascarado, §4.5. |
| `band` | `IndexBand \| null` | Enmascarada. |
| `coverage` | `number \| null` | Siempre visible. |
| `visibility` | `IndexVisibility` | Siempre visible. |
| `controls` | `ControlIndex[]` | Siempre presentes (cobertura y advertencias); `deficiency` es `null` si el índice está oculto. |
| `counts` | `EvaluationCounts` | Siempre visible. |
| `context` | `EvaluationContext & { labels }` | `labels` resuelve `asset:<id>`, `manual:<id>` y `office:<id>`; lo que ya no se encuentra se rotula `Activo no disponible` u `Oficina no disponible`. |
| `top_assets` | `Array<{ asset_key, asset_label, index, band }>` | Hasta 10 activos cuyo propio índice es visible, por índice descendente y `asset_key`; `[]` si el índice de la evaluación está oculto. |

Ítems (contrato §7, `domain/risk/risk-lists.ts`):

- `Subject`: `{ kind: 'asset', asset_key, asset_label, criticality }` o `{ kind: 'office' | 'organization', id, label, affected_assets }`. El sujeto sale del prefijo de la clave de los motivos: una declaración de organización u oficina, o una respuesta faltante de un control de ese alcance, es **un** ítem con la cantidad de equipos alcanzados.
- `ReasonDTO`: el `Reason` de `priority.ts` con el origen aplanado (`question_key`, `option_key`, `check_key`, `service_key`) y, en servicios pendientes, `previous` (antecedente D26 guardado en la evidencia del par).
- `DeficiencyItemDTO`: `key`, `control_key`, `priority` (`medium`, `high` o `critical`; los motivos `low` solo aparecen dentro de otro ítem), `subject`, `compliance`, `status`, `reasons` (todos los del par, incluidos `low` y pendientes).
- `PendingItemDTO`: `key`, `group` (`survey` para A.5.9, A.5.12 y A.8.16; `control` para el resto), `control_key`, `importance` (`null` en `survey`), `subject`, `reasons` (solo pendientes). Un par puede estar en las dos listas. A.8.16 es un ítem por oficina del alcance cuyo agente no reporta o no existe, a partir de `context.office_visibility`.

Las listas no se enmascaran con la visibilidad del índice: explican qué falta o qué no cumple (contratos §10.5).

### 4.5 Enmascarado por visibilidad

Una sola regla, en `deficiency-index.ts`, sobre `visibility`:

| `visibility` | `indexVisible` | `bandVisible` | Efecto |
|---|---|---|---|
| `undetermined`, `hidden` | no | no | `index`, `band`, `top_assets` y la `deficiency` de cada control salen vacíos. |
| `preliminary` | sí | no | Hay índice; `band` es `null`. |
| `banded` | sí | sí | Sin enmascarado. |

`coverage`, `visibility`, la cobertura y las advertencias de cada control, `counts`, `context` y los pares se devuelven siempre. El mismo enmascarado se aplica en el consolidado en vivo, en el resumen (§4.6) y en el resumen congelado de los snapshots (§7.6). La API REST nativa de Payload lo replica a nivel de campo (`scoreFieldAccess.ts`).

### 4.6 `GET /v1/security-review/summary`

Definido en `endpoints/assessments.ts`; se documenta aquí porque lee riesgo. Respuesta `SecurityReviewSummary`:

`{ scope?, recalculation?, index, band, visibility, evaluated_percentage, applicable_checks, not_evaluable, requires_attention, excluded_assets, unidentified_assets, authorization_pending_assets }`

Derivación (`riskSummaryDTO`): `index` y `band` con las mismas reglas de enmascarado; `evaluated_percentage` = `coverage` (0 si es nula); `applicable_checks` = suma de `compliant`, `partially_effective`, `non_compliant` y `not_evaluable` de `counts.pairs` (un «No aplica» no es una comprobación por responder); `requires_attention` = `non_compliant` + `partially_effective`; `excluded_assets`, `unidentified_assets` y `authorization_pending_assets` salen de `counts.assets` y se muestran por separado porque se superponen.

Orden de verificaciones: sesión (401); organización (400 `organization_context_required`); feature `security_assessments` apagado (403 `feature_disabled`). Luego, con `read_assigned` y sin `office_id`: feature `risk_score` apagado (403 `feature_disabled`) y consolidado en vivo (`risk_unavailable` 503 si falla). En otro caso, `officeQueryError` y la última evaluación persistida de la organización o la oficina. Sin evaluación, 200 con ceros, `visibility: 'undetermined'` e `index` y `band` en `null`. No acepta `evaluation_id` ni paginación.

## 5. Reglas por operación

### 5.1 Lectura persistida

Se busca la evaluación (`sort: -evaluated_at`, `limit: 1`) filtrada por organización, oficina (o `office` vacío) y, si se pidió, `id`. Sin `evaluation_id`, la evaluación mostrada es siempre la más reciente por `evaluated_at`. Luego se cargan **todas** las contribuciones de la evaluación (`pagination: false`), se arman las dos listas, se pagina en memoria y se resuelven los rótulos solo de los sujetos de la página y de las referencias de la evaluación (consultas `in` sobre `assets`, `non-network-assets` y `offices`, más el nombre de la organización, siempre filtradas por organización) (§5.5).

### 5.2 Carga de evidencia (`calculateRiskForScope`)

Lectura pura, compartida por el job y el consolidado en vivo:
- Oficinas activas de la organización, filtradas por `officeId` u `officeIds`. Las oficinas inactivas no cuentan: sus activos salen de la exposición.
- `organization-settings` (política `assessment_policy_key`; si no es una clave válida, `essential`).
- Activos de red y activos manuales no retirados de esas oficinas, paginados de a 200 hasta agotar el resultado (una truncación silenciosa quitaría pares de la cobertura). Un activo manual cuya categoría no tiene tipo de riesgo se omite.
- `compliance-results` **de toda la organización** con `valid_until` posterior a ahora: una evaluación de oficina hereda las respuestas de organización. Solo se usan las filas con `check_key` que empieza por `manual:` y `policy_key` igual a la política vigente; las respuestas dadas bajo otra política se ignoran. Los resultados técnicos automáticos no alimentan el cumplimiento: los controles automáticos se derivan de la evidencia actual.
- Historial A.8.21 confirmado (`compliant`/`non_compliant`) de los activos de red del alcance, en una consulta paginada y sin filtro de vigencia, solo para fechar el antecedente D26.
- Un activo sin oficina, de una oficina fuera del alcance o de una oficina inactiva no entra en pares, contadores, contexto ni historial.
- Agentes por oficina (para `A.8.16`), solo de oficinas que tienen activos de red.

### 5.3 Persistencia (`persistRiskEvaluation`)

Crea la evaluación (`evaluationFromPairs`) y luego una fila de `risk-contributions` por par (`contributionFromPair`), **una inserción por fila**, en una transacción: propia, o la del request si la trae. Una falla revierte todo, de modo que nunca queda publicada una evaluación incompleta. Hereda `evaluated_at` del momento de lectura de la evidencia: una corrida lenta sobre evidencia más vieja no pasa a ser la "última" frente a una más reciente. Tras confirmar, hay una marca `NOTIFY` (Notification Bell no existe aún).

### 5.4 Consolidado en vivo (`assignedOfficeRisk`)

1. `canReadAssignedOfficeRisk` debe ser verdadero y haber organización, o lanza `forbidden`.
2. Se calcula la señal de evidencia (`evidenceSignal`): la última evaluación de **organización** (id) y el trabajo de organización abierto (id), unidos como `token`. Se lee **antes** de calcular: un cambio durante el cálculo obliga a recalcular en la próxima petición en lugar de ocultarse. De la misma lectura sale el estado de recálculo, que es el del trabajo de organización (`current` si no hay trabajo abierto).
3. La clave de caché es `<organizationId>|<officeIds ordenados>`. `createAssignedRiskCache` reutiliza la entrada si el `token` no cambió y tiene menos de 60 s (`ttlMs`). Hasta 100 entradas (`maxEntries`); al exceder se expulsa la inserción más antigua, y reinsertar una clave la mueve al final. Los llamadores concurrentes comparten una promesa; una promesa rechazada nunca se conserva, y un fallo viejo no borra una entrada más nueva de la misma clave.
4. Si el request ya tiene `transactionID`, se calcula sin caché, porque una promesa compartida no debe depender de la transacción de otro request.
5. `calculateAssignedRisk` llama a `calculateRiskForScope` con `officeIds`: la evaluación sale de `evaluationFromPairs` (mismos campos que una persistida, `id: null`) y los pares se mapean con `contributionFromPair`, con id `"<asset_key>:<control_key>"`.

Un fallo de cálculo se registra (`req.payload.logger.error`), no se cachea y responde 503 `risk_unavailable` sin detalle. La caché es por proceso: varias instancias guardan cada una la suya y siguen siendo correctas porque el `token` se revisa en cada petición.

### 5.5 Orden y paginación

`buildRiskLists` ordena **todos** los ítems antes de paginar, con rangos explícitos (nunca por texto):
- Deficiencias: prioridad ↓, importancia del control ↓, criticidad ↓, `control_key` ↑, clave del sujeto ↑.
- Pendientes: primero el bloque `survey` (A.5.12, A.5.9, A.8.16); después importancia ↓, criticidad ↓, `control_key` ↑, clave del sujeto ↑.
- La criticidad de un sujeto compartido es la del equipo más crítico que alcanza; solo ordena, nunca eleva la prioridad.
- `control_key` en orden natural (`byControlKey`: `A.8.2` < `A.8.9/A.8.20` < `A.8.19`); las claves de sujeto, por código de carácter.

Armado y paginación son en memoria sobre todas las filas de la evaluación (comentario `ponytail` en `endpoints/risk.ts`).

## 6. Catálogo de errores

Cuerpo: `{ error: <código> }`. `GET /v1/risk/latest` no devuelve `message` ni `issues`. El cliente muestra el texto de `lib/user-facing-error.ts`, indexado por código.

| Código | HTTP | Cuándo |
|---|---|---|
| `unauthenticated` | 401 | Sin sesión activa |
| `organization_context_required` | 400 | PlatformAdmin sin `asOrganization` |
| `forbidden` | 403 | Rol sin permiso `read` sobre `risk-evaluations` |
| `feature_disabled` | 403 | Feature `risk_score` apagado (o `security_assessments` en el resumen) |
| `invalid_query` | 400 | Query inválida (`limit` fuera de 10/25/50, `page` < 1, `list` inválida, `evaluation_id` no UUID) |
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

`createInventorySnapshot` llama a `recalculateRisk` y guarda el id en `inventory-snapshots.risk_score`, además de un resumen (`index` y `band` enmascarados con `indexVisible`/`bandVisible`, `visibility`, `coverage`, `excluded_assets`, `evaluated_at`) en el snapshot. Es el único camino que persiste una evaluación fuera del job.

### 7.7 Puntos de enganche pendientes

Las escrituras llevan comentarios `// AUDIT:` y `// NOTIFY:`. AuditLog y Notification Bell **no existen aún**: son marcas, no código. Ver `SYSTEM_PROMPT.md` §2.

## 8. Frontend

### 8.1 Cadena

- Página: `app/portal/(protected)/risk-score/page.tsx`.
- Componentes (`modules/risk/components/`): `RiskScopeExplanation`, `RiskAlerts`, `ControlCoverage`, `TopRiskAssets`, `RiskItemList`, `PriorityBadge`, `RiskBandBadge`, `RiskRobot`. Además `modules/risk/risk-controls.columns.tsx`, `risk-labels.ts` y `risk-calculation-message.ts`.
- Listas: pestañas «Deficiencias (n)» y «Pendientes (n)» (`totals`). `RiskItemList` muestra cada ítem como un `Accordion` desplegable en el orden del servidor:
  - fila: prioridad (`PriorityBadge`, con texto), control, sujeto («Organización: X · alcanza N equipos») y estado;
  - detalle de una deficiencia: todos sus motivos de mayor a menor prioridad, incluidos los `low`, con su clase (`REASON_CLASS_LABEL`) y ajustes (`ADJUSTMENT_LABEL`); los subordinados van bajo su causa como «Consecuencia de: …»; los pendientes del mismo par van en «Además falta información» (vienen en el propio ítem);
  - Pendientes: un `Accordion` por tramo de grupo de la página, bajo un título «Estado del relevamiento» o «Información de controles» (fuera del acordeón, para que las flechas recorran un grupo);
  - acción: `itemAction` decide el enlace (revisiones, inventario del activo, de la oficina o general; ninguno para A.8.16) y conserva `asOrganization`;
  - un estado vacío nunca afirma que todo está protegido.
- Textos de motivo: `reasonLabel` devuelve `{ title, detail }`. Respuestas: opción y enunciado del catálogo. Servicios de red: «TCP 23» y `networkExplanation` (la misma fuente que Assessment), más el antecedente D26 con su fecha de observación o de evaluación.
- Hook: `modules/risk/hooks/use-latest-risk.ts`.
- Cliente: `modules/risk/service.ts`, que usa `lib/http-client.ts` contra `/api/v1/risk/latest`.

El Panel general y Revisión de seguridad leen el resumen por otra ruta: `useRiskSummary` → `getSecurityReviewSummary` (`modules/assessments/service.ts`) → `/api/v1/security-review/summary`. El Panel usa `riskSummary.unidentified_assets` y `requires_attention` para sus contadores y, si la consulta falla sin datos, quita esos elementos en vez de contarlos como cero (`riskUnavailable`).

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
| `useLatestRisk(params)` | `['risk', 'latest', asOrganization, officeId, page ?? 1, limit, list ?? 'deficiencies', evaluationId]` | `refetchInterval` 3 s si `recalculation` es `pending`, `processing` u `outdated`; si no, 30 s; sin refetch con `evaluationId`. `placeholderData: keepPreviousData` mantiene la página visible mientras llega la siguiente. |
| `useRiskSummary(params)` | `['assessments', 'risk-summary', asOrganization, officeId]` | Mismo criterio de refetch (3 s / 30 s). Cuelga del prefijo `['assessments']`. |

La página reinicia `page` a 1 al cambiar oficina, organización, evaluación, tamaño o lista (el servidor ordena toda la evaluación; no hay orden en el cliente), cierra los ítems abiertos al cambiar de página o lista, y muestra los avisos según `getRiskCalculationMessage(recalculation, hasEvaluation)`. El aviso no aparece en vista histórica.

### 8.4 Invalidaciones

`['risk']` se invalida en: cierre masivo de revisiones (`useBulkAssessments`) e `invalidateSecurityReview` (cambios de activos, identificación, incidentes y `ScanResultMonitor`). El cierre individual (`useAssessmentActions`) y el cambio de política (`useUpdateAssessmentPolicy`) invalidan `['assessments']`, que incluye el resumen pero no `['risk']`; la página de riesgo se actualiza por su refetch de 3 o 30 s.

### 8.5 Contrato de tipos

`RiskEvaluationDTO`, los ítems y `LatestRiskResponse` están en `modules/risk/service.ts`; el endpoint los importa con `satisfies LatestRiskResponse` para mantenerlos sincronizados. Los tipos de dominio (`IndexBand`, `IndexVisibility`, `ControlIndex`, `PairStatus`, `EvaluationCounts`, `EvaluationContext`, `Priority`, `RecalculationStatus`) se importan de `domain/risk`. Las etiquetas de banda, visibilidad y estado (`RISK_BAND_LABEL`, `RISK_VISIBILITY_LABEL`, `RISK_PAIR_STATUS_LABEL`, `RISK_BAND_COLOR`) están tipadas con esos enums: una clave faltante o vieja no compila.

## 9. Cómo extender

**Nuevo control basado en preguntas.** Agregar preguntas y control a `catalog-v2/catalog.ts` (mismo alcance y tipos de activo en todas las preguntas del control: lo exige `validate-catalog.ts`), su importancia en `CONTROL_IMPORTANCE` y su política en `priority.ts::ANSWER_PRIORITY` (las dos se validan al importar); agregar su `reason_code` a `REASONS` en `modules/risk/risk-labels.ts` (una prueba exige un texto legible por cada motivo que pueden llevar las listas); cubrir el caso en `domain/risk/*.test.ts`. Si cambian preguntas ya usadas, subir su `version` y revisar `reconcileAssessmentInstance` (compara las preguntas aplicables con el `question_set_snapshot` del ciclo abierto).

**Nuevo control automático.** Agregar el cumplimiento en `automatic-evidence.ts` o `evaluateAutomaticCompliance.ts`, emitir su par en `buildDeficiencyPairs` (el bloqueo de activos no confirmados ya se aplica en `push`), sus motivos en `priority.ts::pairReasons`, su importancia (o su exclusión del índice) en `deficiency-index.ts`, y registrar el control en `RISK_CONTROLS_V2` para que tenga título.

**Nuevo origen de recálculo.** Llamar a `enqueueRiskRecalculation` con todas las oficinas afectadas, preferentemente con el `req` del evento para compartir transacción. No llamar a `recalculateRisk` desde un request: bloquea y duplica trabajo.

**Cambiar umbrales o pesos.** Pesos y bandas en `constants.ts`, importancias y visibilidad en `deficiency-index.ts`; `indexVisible` y `bandVisible` son la regla única para endpoint, resumen, snapshots y campos de colección. Subir `RISK_ENGINE_VERSION` o `RISK_CATALOG_VERSION` si cambia el significado de lo persistido.

**Nuevo dato en la respuesta.** Tipo en `modules/risk/service.ts`, armado en `evaluationDTO` o `contributionDTO`, y aplicar la regla de enmascarado si es un número derivado del índice (y su equivalente en `scoreFieldAccess.ts` si se persiste).

## 10. Comportamientos a tener presentes

Verificados en el código; no son necesariamente defectos, pero conviene conocerlos antes de tocar el feature.

1. **Resumen y feature `risk_score`.** `GET /v1/security-review/summary` exige `security_assessments`, pero solo verifica `risk_score` en la rama del consolidado en vivo. En la vista persistida devuelve riesgo aunque `risk_score` esté apagado. `GET /v1/risk/latest` sí lo exige siempre. La prueba `endpoints/assigned-office-risk.audit.integration.test.ts` cubre el feature solo para los dos endpoints en la rama asignada.
2. **Resumen y permiso.** El resumen no consulta `canDo(..., 'risk-evaluations', 'read')`; `/v1/risk/latest` sí. Hoy todos los roles lo tienen, por lo que no hay diferencia observable.
3. **Cálculo con el feature apagado.** Los trabajos se encolan y se ejecutan, y `createInventorySnapshot` recalcula, sin consultar `risk_score`. El feature solo cierra la lectura.
4. **Enmascarado por `visibility`.** Depende solo de la cobertura; los equipos sin identificar se informan en `counts.assets` y no degradan ni ocultan el índice.
5. **Listas en memoria.** Cada petición de la vista persistida carga todas las contribuciones de la evaluación y arma las dos listas antes de paginar (los rótulos, solo de la página); el consolidado en vivo además mantiene todas las comprobaciones en la caché. El costo crece con activos × controles aplicables. Es un límite documentado en el código.
6. **Consolidado en vivo: costo y frescura.** Cada fallo de caché ejecuta `calculateRiskForScope`: recorre todos los activos de las oficinas, todos los `compliance-results` vigentes de la organización (incluidos los resultados técnicos automáticos, que luego se descartan en memoria) y una consulta de agentes por oficina. La señal de caché depende solo de la última evaluación y del trabajo abiertos de la **organización**; vencimientos y latidos no cambian la señal, por lo que se reflejan al expirar el TTL de 60 s.
7. **Frescura asimétrica.** La vista en vivo refleja vencimientos de respuestas y agentes silenciosos como máximo a los 60 s; la persistida, hasta el siguiente recálculo, que sin eventos es el job diario (`refresh-risk`, 03:45).
8. **Estado de recálculo del consolidado.** `recalculation` es el del trabajo de organización, no el de las oficinas del OfficeManager; un trabajo de oficina en curso no se refleja.
9. **`outdated` y sondeo.** Un alcance sin evaluación y sin trabajo abierto devuelve `outdated`, y el cliente lo sondea cada 3 s mientras la pantalla esté abierta; no hay otro estado que lo distinga de "calculándose".
10. **`evaluation_id` y oficina.** Sin `office_id` la búsqueda por id solo ve evaluaciones de organización: un id de evaluación de oficina sin su `office_id` responde `evaluation_not_found`. Los enlaces de tareas incluyen la oficina por esta razón.
11. **`invalid_query` sin detalle.** `/v1/risk/latest` responde `{ error: 'invalid_query' }` sin `issues`, a diferencia de los endpoints de revisiones, que sí los incluyen.
12. **Respuestas "No aplica".** Un control con todas sus subpreguntas en «No aplica» justificado queda `not_applicable`, fuera de la cobertura y del índice; si solo algunas lo están, el par usa el promedio de las demás.
13. **Inserciones una a una.** `persistRiskEvaluation` crea cada comprobación con una llamada propia (comentario `ponytail` en el código); evaluaciones con muchos pares alargan la transacción.
14. **Manejo de errores asimétrico.** Solo la rama del consolidado captura errores y responde `risk_unavailable`; un fallo de lectura en la vista persistida se propaga como 500 sin código.

## 11. Cobertura de pruebas

Estado de cobertura automática; sin pruebas de extremo a extremo por ahora.

| Prueba | Cubre |
|---|---|
| `domain/risk/deficiency-index.test.ts` | B pura, exclusiones, caso 11,71, advertencias, visibilidad |
| `domain/risk/deficiency-pairs.test.ts`, `answer-evidence.test.ts` | Pares aplicables, herencia y precedencia, activos no confirmados, excluidos, «No aplica», gateway D25 |
| `domain/risk/network-evidence.test.ts` | D25 (matriz completa, TCP/UDP, 4096 servicios) y D26 (antecedente, corte por observación, elegibilidad) |
| `domain/risk/priority.test.ts` | Política de prioridad, casos de referencia, motivos por servicio, contadores |
| `domain/risk/evaluation-from-pairs.test.ts` | Contadores, índice por activo, mapper de contribución, regla de visibilidad |
| `collections/RiskEvaluations/scoreFieldAccess.test.ts` | Acceso por campo con `select` parcial y falla cerrada |
| `domain/risk/automatic-evidence.test.ts` | A.5.9, A.5.12 y A.8.20 |
| `domain/risk/control-efficacy.test.ts` | Reglas condicionales, `unknown` y `not_applicable`, política reforzada |
| `domain/risk/catalog-v2/catalog.test.ts` | Validez del catálogo |
| `domain/risk/risk-lists.test.ts` | Agrupación de declaraciones compartidas, `low` fuera de la lista, pares en ambas listas, bloque de relevamiento, A.8.16 por oficina del alcance, D26 en el motivo, orden natural y determinismo entre páginas |
| `domain/risk/assigned-risk-cache.audit.test.ts` | Reutilización por señal, TTL, concurrencia, fallos, tope de 100 y orden de expulsión |
| `domain/risk/assigned-office-risk.audit.test.ts` | Roles rechazados, membresía inactiva, alcance desde la membresía, estado compartido, sin caché dentro de una transacción |
| `domain/risk/enqueueRiskRecalculation.test.ts` | Organización más oficinas distintas, eventos de organización, jobs desactivados |
| `domain/risk/enqueueRiskRecalculation.integration.test.ts` | Una ráfaga deja como máximo un trabajo pendiente por alcance |
| `domain/risk/delivery.audit.test.ts` | Encolado con la transacción del padre, reversión, recuperación al arrancar |
| `domain/risk/recalculateRisk.integration.test.ts` | Persistencia de todos los pares, vencimiento, herencia de organización, políticas ajenas, oficina inactiva, alcance de un subconjunto de oficinas |
| `endpoints/risk.integration.test.ts` | Aislamiento por organización y oficina, paginación inválida, ocultamiento de números (endpoint y REST, también con `select` parcial), Viewer con oficina obligatoria, Manager sin oficina |
| `endpoints/assigned-office-risk.audit.integration.test.ts` | Consolidado con el motor (no promedio), sin escrituras, coincidencia con el resumen, conjuntos de oficina forjados, membresía vigente, feature, enmascarado, reutilización entre páginas, estado de recálculo, `risk_unavailable` |
| `endpoints/audit-fixes.audit.integration.test.ts` | Entrega transaccional del recálculo y reemplazo de trabajos (SEC-36, SEC-57, SEC-58) |
| `modules/risk/risk-calculation-message.audit.test.ts` | Mensajes por estado de recálculo |
| `modules/risk/risk-labels.test.ts` | Explicación para cada par que el motor puede producir |
| `modules/offices/office-risk-scope.audit.test.ts` | Resolución de oficina y de consolidado en el cliente |

Las pruebas de integración requieren una base PostgreSQL desechable.
