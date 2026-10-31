# API de revisiones de seguridad (assessments)

Referencia técnica del feature `assessments` (en la UI, "Revisión de seguridad"): ciclos de revisión, respuestas, resultados de cumplimiento, cierre individual y masivo, reapertura, vencimiento, exclusiones y su conexión con el recálculo de riesgo. Dirigida a quien mantiene o extiende el feature. El motor de riesgo, el resumen de riesgo (`GET /v1/security-review/summary`) y la cola de recálculo se documentan en `docs/risk-api.md`; aquí solo se referencian.

Verificado contra el código el 2026-10-31. Si algo de este documento contradice el código, gana el código: corregir el documento.

## 1. Capas y archivos

| Capa | Archivo | Responsabilidad |
|---|---|---|
| Contrato | `modules/assessments/schema.ts` | Schemas Zod de entrada: listado, borrador, cierre, reapertura, política, selector y cierre masivo. Los usan el cliente y los endpoints. Fuente de verdad. |
| | `domain/assessments/assessment-scope-schema.ts` | Schema de exclusión de activos de las revisiones (lo usan los formularios de activos, no estos endpoints). |
| Endpoints | `endpoints/assessments.ts` | Listado, detalle, borrador, cierre, reapertura, política de la organización y resumen de riesgo. Exporta también `authenticated`, `featureEnabled` y `buildAssessmentOfficeScope`. |
| | `endpoints/bulkAssessments.ts` | Vista previa y cierre masivo. |
| | `payload.config.ts` | Registro de endpoints (el orden importa, §4) y de las tareas de mantenimiento. |
| Permisos | `domain/assessments/assessmentAccess.ts` | `canReadAssessment`, `canAnswerAssessment`. |
| Ciclo de vida | `domain/assessments/assessmentLifecycle.ts` | `saveAssessmentDraft`, `completeAssessment`, `buildCopiedAssessmentDraft`. |
| | `domain/assessments/bulkAssessmentLifecycle.ts` | `resolveBulkAssessmentPreview`, `completeBulkAssessments`, `questionSetSignature`. |
| | `domain/assessments/reconcileAssessmentInstance.ts` | Crea, preserva o reemplaza ciclos según la aplicabilidad (organización, oficina, activo de red, activo manual) y sincroniza el responsable. |
| | `domain/assessments/reconcileExpiredAssessments.ts` | Tarea diaria que abre un ciclo nuevo para los completados vencidos. |
| | `domain/assessments/reconcileExpiredAssetExclusions.ts` | Tarea horaria que reincluye activos cuya exclusión venció. |
| | `domain/assessments/assessmentExpiration.ts` | Estado derivado `expired`. |
| | `domain/assessments/asset-assessment-scope.ts` | Campos y regla de exclusión de activos. |
| | `domain/assessments/resolveInheritedEvidence.ts`, `evaluateCompliance.ts` | Evidencia efectiva (propia, heredada, excepción) para mostrar en el formulario. |
| | `domain/assessments/evaluateAutomaticCompliance.ts`, `evaluateNetworkBaseline.ts`, `network-explanations.ts`, `catalog/` | Resultados automáticos (hechos del activo, monitoreo de oficina, línea base de red). |
| | `domain/with-transaction.ts` | `withTransaction`, `transactionLock`. |
| Persistencia | `collections/AssessmentInstances/` (`index.ts`, `invariants.ts`, `hooks/validateAssessmentInstance.ts`), `collections/AssessmentAnswers/` (`index.ts`, `hooks/validateAssessmentAnswer.ts`), `collections/ComplianceResults/` (`index.ts`, `hooks/validateComplianceResult.ts`) | Colecciones `assessment-instances`, `assessment-answers`, `compliance-results`. |
| Catálogo de preguntas | `domain/risk/catalog-v2/` | Preguntas, opciones y reglas. Compartido con el motor de riesgo. |
| Cliente HTTP | `modules/assessments/service.ts` | Funciones sobre `lib/http-client.ts` y tipos de respuesta. |
| Estado de servidor | `modules/assessments/hooks/*.ts`, `modules/assessments/invalidate-security-review.ts` | TanStack Query. |
| UI | `modules/assessments/components/*`, `app/portal/(protected)/security-review/` (`page.tsx`, `[id]/page.tsx`, `bulk/page.tsx`) | Presentación. |
| Estado local | `modules/assessments/assessments.store.ts`, `assessment-form-state.ts`, `assessment-groups.ts`, `assessment-labels.ts` | Selección masiva persistida, mapeo del formulario, agrupación por destino, etiquetas y permiso de UI. |

Cadena de un cierre individual: `AssessmentForm` → `useAssessmentActions().complete` → `service.completeAssessment` → `httpClient` → `assessmentCompleteEndpoint` → `writableAssessment` → `completeAssessment` (dominio) → `payload.update` / `payload.create` sobre las tres colecciones → `enqueueRiskRecalculation`.

## 2. Modelo

### 2.1 Colecciones

Las tres tienen `create`, `update` y `delete` en `() => false`: la API REST de Payload solo permite leer, con `orgScopedAccess(..., { kind: 'org_offices', field: 'office' })` (en `assessment-answers`, `assessment.office`). Todo se escribe desde el dominio con `overrideAccess: true`.

#### `assessment-instances`

Un ciclo de revisión para un destino (organización, oficina o activo).

| Campo | Tipo | Notas |
|---|---|---|
| `open_cycle_key` | text, único, oculto | Hash SHA-256 de (organización, alcance, destino, `manual`/`network`, política, versión) mientras el ciclo está abierto; `null` si está cerrado. Garantiza a nivel de base un solo ciclo abierto por destino y política aun con escrituras concurrentes. |
| `expiry_reconciled_at` | date | Marca de la tarea de vencimiento (§7.2). Indexado. |
| `organization` | relación, requerido | |
| `scope` | `organization` \| `office` \| `asset` | |
| `office` | relación | Vacío solo en `organization`. En `asset` es la oficina del activo al abrir el ciclo. |
| `asset`, `manual_asset` | relación | En `asset`, exactamente uno de los dos. |
| `policy_key` | `essential` \| `reinforced` | Inmutable. |
| `policy_version`, `catalog_version` | number | Hoy 2. Inmutables. |
| `question_set_snapshot` | json | Lista de `{ key, version, prompt_snapshot, options_snapshot, control_key }` congelada al abrir. Define qué preguntas admite el ciclo. |
| `status` | `pending` \| `in_progress` \| `completed` \| `expired` \| `superseded` | Ver §2.2. |
| `assigned_to` | relación a `users` | Responsable del activo al abrir; se sincroniza con el dueño del activo mientras el ciclo está abierto. |
| `created_reason` | `initial` \| `asset_identified` \| `assessment_scope_changed` \| `office_changed` \| `policy_changed` \| `answer_expired` \| `manual_review` \| `office_reactivated` \| `organization_reactivated` | |
| `opened_at`, `due_at` | date | `due_at` inicial = apertura + 365 días (`essential`) o 180 (`reinforced`); al completar pasa a ser el menor `valid_until` de las respuestas. |
| `completed_at`, `completed_by` | date, relación `users` \| `admins` | |
| `completion_summary` | grupo | Cantidades por estado de control: `compliant`, `partially_effective`, `non_compliant`, `not_evaluable`. |

#### `assessment-answers`

Una fila por pregunta y ciclo. Índice único `(assessment, question_key)`.

| Campo | Tipo | Notas |
|---|---|---|
| `organization`, `assessment` | relación | |
| `question_key`, `question_version` | text, number | Deben pertenecer al `question_set_snapshot`. |
| `option_key`, `option_snapshot` | text, json | `option_snapshot`: `{ key, label, efficacy }`. |
| `justification`, `evidence_note` | textarea, ≤ 2000 y ≤ 4000 | `justification` obligatoria con `not_applicable`. |
| `answered_by`, `answered_at` | relación, date | |
| `valid_until` | date | Se fija al guardar y se vuelve a fijar al completar (§5.3). |
| `evaluation_effect_snapshot` | json | Efecto de la respuesta; al completar incluye eficacias por pregunta y combinada. |

#### `compliance-results`

Resultado por control. Los escriben dos orígenes (§2.4).

| Campo | Notas |
|---|---|
| `organization`, `office`, `asset`, `manual_asset`, `service_key` | Destino. Un activo exige oficina; `service_key` exige activo de red. |
| `control_key`, `check_key` | Los resultados de revisiones usan `check_key = manual:<question_key>`. |
| `status` | `compliant` \| `non_compliant` \| `not_evaluable` (`COMPLIANCE_STATUSES`). |
| `severity`, `policy_key`, `policy_version`, `evaluated_at`, `valid_until`, `reason_code`, `explanation`, `evidence_snapshot` | |
| `supersedes` | Relación al resultado anterior de la misma clave (solo los automáticos la completan). |

### 2.2 Estados

| Estado persistido | Significado |
|---|---|
| `pending` | Abierto, sin respuestas guardadas. |
| `in_progress` | Abierto, con al menos un borrador guardado (el primer `PATCH .../draft` con respuestas lo pasa de `pending` a `in_progress`). |
| `completed` | Cerrado con todas las respuestas. Inmutable. |
| `superseded` | Reemplazado: cambió el conjunto de preguntas aplicables, el destino dejó de aplicar o su oficina u organización se desactivó. Inmutable. |
| `expired` | Existe como opción de la colección, pero **ningún código lo escribe**. |

`expired` es un estado **derivado** (`deriveAssessmentStatus`): un ciclo `completed` con `due_at` ≤ ahora se muestra como `expired` en el listado y el detalle (`withDerivedAssessmentStatus`), sin reescribir la historia. Los ciclos `pending` / `in_progress` nunca vencen. Las respuestas de `completed`, `expired` y `superseded` no se pueden modificar (`assertAssessmentMutable`, 409 desde los hooks de colección).

Transiciones:

| Evento | Origen | Destino |
|---|---|---|
| Reconciliación crea ciclo | — | `pending` |
| Primer borrador con respuestas | `pending` | `in_progress` |
| `complete` | `pending` o `in_progress` | `completed` |
| Reconciliación con preguntas distintas, destino que dejó de aplicar, oficina u organización inactiva | `pending` o `in_progress` | `superseded` |

### 2.3 Qué se revisa y a quién se asigna

Las preguntas salen de `RISK_QUESTIONS_V2`, filtradas por alcance (`organization`, `office`, `asset`), política y, para activos, tipo de riesgo (`v2Questions` en `reconcileAssessmentInstance.ts`). Hay 4 preguntas de organización, 3 de oficina y 13 de activo; dos son exclusivas de `reinforced`.

| Destino | Condición para tener ciclo |
|---|---|
| Organización | Organización activa, `security_assessments` activo en su suscripción y política válida. |
| Oficina | Lo mismo, para cada oficina activa. |
| Activo de red (`assets`) | Identificado, `identification_status = confirmed`, con `confirmed_type` que mapea a tipo de riesgo (`riskAssetTypeForScanned`), no retirado, oficina activa, no excluido, y con preguntas de activo para ese tipo. |
| Activo manual (`non-network-assets`) | Categoría en `ASSESSABLE_MANUAL` (`computer`, `software_license`, `cloud_asset`, `information_repository`), no retirado, oficina activa, no excluido, y suscripción con el feature. |

El activo manual `mobile_device`, `server` y `network_device` están en la población de riesgo pero no reciben revisión (`isManualCategoryAssessable`).

### 2.4 Resultados de cumplimiento

- **De revisión** (`completeAssessment`): una fila por **control** (no por pregunta), con `check_key = manual:<primera pregunta del control en el snapshot>`, `status` derivado de la eficacia combinada (`partially_effective` se guarda como `non_compliant`, porque el enum no tiene ese valor; la eficacia real queda en `evidence_snapshot.evaluation_effect.combined_efficacy`), `valid_until` = `valid_until` de la respuesta (365 o 180 días) y `reason_code` = estado de la evaluación del control (`evaluable`, `not_evaluable` o `not_applicable`). Estas filas son las que el motor de riesgo lee (`docs/risk-api.md`, §5.2).
- **Automáticos** (`evaluateAutomaticComplianceForAssessment`): hechos del activo (A.5.9, A.5.12, A.8.20), monitoreo de oficina (A.8.16) y línea base de red (A.8.21, una fila por servicio). Validez fija de 30 días, encadenados con `supersedes`. Se generan al completar una revisión y tras procesar un reporte de escaneo (`reevaluateComplianceAfterScan`, que usa el ciclo más reciente de la política vigente o uno sintético en memoria `automatic:<id>` si el activo no tiene ciclo). El motor de riesgo **no** los lee: recalcula los controles automáticos desde la evidencia actual.

### 2.5 Flujos

**Un ciclo normal.** La reconciliación abre un ciclo `pending` con las preguntas aplicables congeladas. Alguien guarda borradores (el ciclo pasa a `in_progress`) y lo completa: se validan todas las respuestas, se calcula la eficacia por control, se crean los resultados de cumplimiento, se recalculan los automáticos y el ciclo queda `completed` con `due_at` igual a la primera caducidad. Se encola el recálculo de riesgo.

**Vencimiento.** Al llegar `due_at`, el ciclo sigue `completed` en la base pero se muestra como `expired`. No hay ciclo nuevo hasta que corre `reconcile-expired-assessments` (diario, 03:30), que crea uno `pending` con `created_reason: answer_expired` y marca `expiry_reconciled_at` en el vencido. Mientras tanto las respuestas vencidas ya no cuentan para el riesgo (el motor solo lee resultados con `valid_until` futuro) y el par queda no evaluable.

**Reapertura (nuevo ciclo).** `POST /v1/assessments/:id/reopen` sobre un ciclo cerrado no reabre ese registro: invoca la reconciliación con motivo `manual_review`, que crea un ciclo nuevo `pending` (201) o encuentra el abierto vigente (`preserved`, 200), y copia en él las respuestas del ciclo cerrado que no existan ya en el destino, usando la versión de pregunta del snapshot nuevo (`buildCopiedAssessmentDraft`). El ciclo de origen conserva su historia.

**Cambio de política.** `PATCH /v1/organization/assessment-policy` guarda la política, reconcilia toda la organización con motivo `policy_changed` (los ciclos abiertos cuyo conjunto de preguntas ya no coincide pasan a `superseded` y se crean los nuevos) y encola el recálculo de la organización y todas sus oficinas, todo en una transacción.

**Activo que cambia.** El hook `afterChange` de activos y activos manuales reconcilia su ciclo cuando cambian la oficina, el tipo confirmado, el retiro o la exclusión; sincroniza el responsable cuando cambia el dueño; y encola el recálculo (§7.3).

**Cierre masivo.** Una misma respuesta se aplica a todos los ciclos de activos elegidos que comparten conjunto de preguntas (§5.6).

## 3. Permisos y alcance

### 3.1 Contexto y feature

`authenticated` (compartida con los endpoints masivos): sin sesión activa, 401 `unauthenticated`; usuario no PlatformAdmin sin organización, 403 `forbidden`. Un PlatformAdmin sin `asOrganization` pasa este filtro; el resto de la lógica lo rechaza según el endpoint (§6). Con `asOrganization`, el contexto es `org_admin`.

Feature: `featureEnabled` = `organizationFeatures(req, org).security_assessments`. Si es falso, 403 `feature_disabled`. `organizationFeatures` completa con `true` las claves ausentes (`normalizeFeatures`), incluso si la organización no tiene suscripción. La reconciliación, en cambio, lee la suscripción por su cuenta y no crea ciclos sin ella (§10).

### 3.2 Lectura (`canReadAssessment`)

- PlatformAdmin: sin organización, cualquier ciclo; con organización, solo los de ella.
- Resto: misma organización; ciclo de alcance `organization` solo para roles con alcance organizacional (`hasOrgWideScope`); los demás, solo si `assessment.office` está en `ctx.officeIds`.

### 3.3 Escritura (`canAnswerAssessment`)

- Exige `ctx.organizationId` igual al del ciclo (un PlatformAdmin sin `asOrganization` no escribe).
- `org_admin` y PlatformAdmin con organización: sí.
- `office_manager`: ciclos de alcance `office` o `asset` cuya oficina esté en sus oficinas; nunca los de organización.
- `org_viewer`: solo ciclos de activo cuyo `owner` sea el propio usuario (no se compara la oficina). Sin dueño, no.

### 3.4 Selector del cierre masivo (`selectorAllowed`, `endpoints/bulkAssessments.ts`)

| Selector | Quién |
|---|---|
| Cualquiera, PlatformAdmin (incluso con `asOrganization`) | Nadie: 403 `forbidden` |
| `organization` | `org_admin` |
| `office` | `org_admin`, o `office_manager` con esa oficina |
| `owner` | `org_admin`, `office_manager`, o `org_viewer` con `owner_id` igual a su usuario |

Además, el dominio filtra cada candidato con `canAnswerAssessment`.

## 4. Contrato HTTP

Prefijo `/api`. Cuerpos JSON; un cuerpo ausente o inválido se parsea como `{}` y falla la validación. El cliente agrega `?asOrganization=` automáticamente en el portal; solo tiene efecto para PlatformAdmin.

| Método y ruta | Quién | Entrada | Respuesta OK |
|---|---|---|---|
| `GET /v1/assessments` | rol con organización | query `AssessmentListQuerySchema` | 200 `{ docs, totalDocs, ... }` |
| `GET /v1/assessments/:id` | `canReadAssessment` | — | 200 detalle (§4.3) |
| `PATCH /v1/assessments/:id/draft` | `canAnswerAssessment` | `SaveAssessmentDraftSchema` | 200 `{ assessment_id, answers }` |
| `POST /v1/assessments/:id/complete` | `canAnswerAssessment` | `CompleteAssessmentSchema` | 200 ciclo |
| `POST /v1/assessments/:id/reopen` | `canAnswerAssessment` | `ReopenAssessmentSchema` | 201 o 200 `{ action, id? }` |
| `PATCH /v1/organization/assessment-policy` | `org_admin` | `UpdateAssessmentPolicySchema` | 200 `organization-settings` |
| `POST /v1/assessments/bulk/preview` | ver §3.4 | `BulkAssessmentPreviewSchema` | 200 `BulkAssessmentPreview` |
| `POST /v1/assessments/bulk/complete` | ver §3.4 | `BulkAssessmentCompleteSchema` | 200 `BulkAssessmentResult` |
| `GET /v1/security-review/summary` | — | — | Ver `docs/risk-api.md`, §4.6 |

Orden de registro en `payload.config.ts`: `bulkAssessmentPreviewEndpoint` y `bulkAssessmentCompleteEndpoint` van **antes** que `assessmentDetailEndpoint` y los `:id/*`; de lo contrario Payload trataría `bulk` como un `:id`. Una prueba (`endpoints/assessments.test.ts`) fija la ruta y el método del cierre masivo. Mantener ese orden al agregar rutas estáticas bajo `/v1/assessments/`.

### 4.1 `GET /v1/assessments`

Query (`AssessmentListQuerySchema`):

| Parámetro | Valores | Notas |
|---|---|---|
| `scope` | `organization` \| `office` \| `asset` | |
| `office_id` | texto | Fuera de las oficinas del rol: 403 `office_forbidden`. |
| `asset_id` | texto | Filtra solo por `asset` (activo de red); no existe filtro por `manual_asset`. |

Orden de verificaciones: sesión; organización (400 `organization_context_required`); query (400 `invalid_query` con `issues`); `office_id` (403); armado del filtro; feature (403 `feature_disabled`). Es decir, el feature se comprueba después de armar el filtro, que con `office_id` hace dos consultas de activos.

Semántica del filtro:
- Siempre misma organización.
- Sin alcance organizacional: se agrega `office in ctx.officeIds`, que deja fuera los ciclos de organización (sin oficina).
- Con `office_id` (`buildAssessmentOfficeScope`): ciclos de organización (solo roles con alcance organizacional), ciclos de oficina con esa oficina, y ciclos de activo cuyo activo **hoy** pertenece a esa oficina (se resuelve contra `assets` y `non-network-assets` actuales, no contra la oficina congelada en el ciclo; un activo movido conserva ambos ciclos). Si la oficina no tiene activos, no se agrega rama de activos.
- Se excluyen los ciclos cuyo activo (poblado) está excluido de las revisiones (`isAssetExcludedFromAssessments`).
- Orden `-createdAt`. **Sin paginación**: `totalDocs` es la cantidad devuelta, `totalPages` 0 o 1, `page` 1.

Respuesta: la de `payload.find` con `depth: 1`, con `docs` reemplazado por los ciclos filtrados y su estado derivado (`withDerivedAssessmentStatus`). Las relaciones (`organization`, `office`, `asset`, `manual_asset`, `assigned_to`, `completed_by`) llegan pobladas con el mismo `overrideAccess: true` de la consulta.

### 4.2 `PATCH .../draft`, `POST .../complete`, `POST .../reopen`

Orden común (`writableAssessment`) antes de leer el cuerpo:
1. Sesión (§3.1).
2. Ciclo inexistente: 404 `not_found`.
3. Activo del ciclo excluido de las revisiones: 409 `asset_excluded_from_assessments`.
4. `canAnswerAssessment` falso: 403 `forbidden`.
5. Feature apagado: 403 `feature_disabled`.
6. Oficina (la **actual** del activo, o la del ciclo) u organización inactiva: 409 `office_inactive` / `organization_inactive`.
Luego el cuerpo se valida con su schema.

Cuerpo de borrador y cierre (`SaveAssessmentDraftSchema`, `CompleteAssessmentSchema`): `{ answers: AssessmentAnswerDraft[] }`, hasta 100. Cada respuesta: `question_key` (1–160), `question_version` (entero positivo), `option_key` (1–160), `justification?` (≤ 2000, `TEXT_RULES.free`), `evidence_note?` (≤ 4000, `TEXT_RULES.free`). Con `option_key = not_applicable` la `justification` es obligatoria.

- **Borrador.** Los errores del dominio (cualquier excepción) responden 400 `draft_rejected` con `message`. El cuerpo inválido, 400 `invalid_draft` con `issues`. Respuesta: `{ assessment_id, answers }`, con las filas guardadas.
- **Cierre.** Errores del dominio (cualquier excepción): 400 `completion_rejected` con `message`. Cuerpo inválido: 400 `invalid_completion`. Respuesta: el ciclo actualizado (sin estado derivado). Si el ciclo ya está `completed`, responde 200 con él sin escribir (idempotente).
- **Reapertura.** Cuerpo inválido: 400 `invalid_reopen` (`reason`: 1–500, `TEXT_RULES.free`). Ciclo abierto (`pending`, `in_progress`): 409 `assessment_already_open`. Respuesta `{ action: 'created' | 'preserved' | 'superseded' | 'none', id? }`; 201 si `created`, 200 en los demás. El `reason` se valida pero no se guarda ni se usa (§10).

### 4.3 `GET /v1/assessments/:id`

Respuesta (`AssessmentDetailResponse`):

| Campo | Contenido |
|---|---|
| `assessment` | El ciclo (`depth: 0`) con estado derivado. |
| `inactive_subject` | `office_inactive`, `organization_inactive` o `null`. La UI lo muestra de solo lectura. |
| `answers` | Respuestas del ciclo (hasta 100). |
| `previous_answers` | Solo para ciclos abiertos: respuestas del ciclo cerrado más reciente (`completed` o `superseded`) del mismo destino, política y versión. Vacío en ciclos cerrados. |
| `assessment_history` | Hasta 100 ciclos del mismo destino, `-createdAt`, con estado derivado. |
| `effective_evidence` | `Record<question_key, EffectiveAnswer>`: respuesta efectiva por pregunta (`resolveInheritedAssessmentEvidence`). |

Evidencia efectiva: para un ciclo de activo se consideran el ciclo mismo, el ciclo de oficina completado de su oficina y el de organización completado; para uno de oficina, el suyo y el de organización; para uno de organización, el suyo. Las respuestas de organización se omiten para quien no tiene alcance organizacional. Por pregunta, `resolveEffectiveAnswer` descarta las vencidas y prioriza `exact`, luego `inherited`, luego `exception` (`not_applicable`); si no queda ninguna vigente devuelve `{ state: 'not_evaluable', reason_code: 'answer_expired' | 'answer_missing' }`.

Errores: 404 `not_found`; 403 `forbidden` (sin lectura, incluido un ciclo de otra organización); 403 `feature_disabled` (según el feature de la organización del ciclo).

### 4.4 `PATCH /v1/organization/assessment-policy`

Cuerpo (`UpdateAssessmentPolicySchema`): `{ policy_key: 'essential' | 'reinforced', policy_version: entero positivo }`.

Orden: sesión; rol distinto de `org_admin` o sin organización: 403 `forbidden` (un PlatformAdmin necesita `asOrganization`); feature: 403 `feature_disabled`; cuerpo: 400 `invalid_policy` (`issues`); `policy_version` distinta de 2 o clave fuera del catálogo: 400 `policy_version_unavailable`; `organization-settings` inexistente: 404 `settings_not_found`. Si la política ya es la vigente, responde 200 con los ajustes sin escribir ni encolar.

Si cambia: transacción única que actualiza `assessment_policy_key`, `assessment_policy_version`, `assessment_policy_selected_at` y `assessment_policy_selected_by`, ejecuta `reconcileOrganizationAssessments(..., 'policy_changed')` y `enqueueOrganizationRiskRecalculation`. Cualquier error revierte todo y responde 400 `policy_change_failed` con `message` (texto de la excepción). Respuesta: el documento de ajustes actualizado.

### 4.5 Cierre masivo

**Vista previa.** Cuerpo `{ selector }`, con `selector` unión discriminada por `mode`: `owner` (`risk_asset_type`, `owner_id`), `office` (`risk_asset_type`, `office_id`) u `organization` (`risk_asset_type`). `risk_asset_type` es uno de `RISK_ASSET_TYPES`.

Respuesta (`BulkAssessmentPreview`):

| Campo | Contenido |
|---|---|
| `question_set_signature` | Firma del conjunto de preguntas dominante, o `null`. |
| `question_set_snapshot` | Snapshot del primer ciclo compatible, o `null`. |
| `representative_assessment` | Ese primer ciclo compatible, o `null`. |
| `applicable` | `BulkAssessmentSummary[]`: ciclos abiertos compatibles que el actor puede responder. |
| `preserved_completed` | `BulkAssessmentSummary[]`: destinos sin ciclo abierto cuyo ciclo cerrado más reciente es `completed` (o derivado `expired`) y que el actor puede responder. |
| `incompatible` | Cantidad de ciclos abiertos con otro conjunto de preguntas. |

`BulkAssessmentSummary`: `{ assessment_id, asset_id, asset_label, asset_source: 'network' | 'manual', office_id, owner_id, status, has_draft }`.

**Cierre.** Cuerpo `{ selector, assessment_ids (1–100, sin repetidos), question_set_signature (1–4000), answers (≤ 100) }`. Respuesta (`BulkAssessmentResult`): `{ completed, preserved_completed, affected_office_ids }`.

Errores comunes: 401, 400 `organization_context_required`, 403 `feature_disabled`, 400 `invalid_bulk_preview` / `invalid_bulk_completion` (`issues`), 403 `forbidden` (§3.4). Específicos: vista previa, 400 `bulk_preview_failed` (`message`); cierre, 409 `bulk_preview_stale` o `bulk_selection_stale` (con un mensaje fijo en español), 400 `bulk_completion_failed` (`message` de la excepción del dominio).

## 5. Reglas por operación

### 5.1 Reconciliación (`reconcileAssessmentInstance` y variantes)

Decide el ciclo que corresponde a un destino. Orden de decisiones (organización y oficina):
1. Si el destino está inactivo (`is_active` falso): todo ciclo abierto pasa a `superseded`, sin crear nada.
2. Sin ajustes, sin suscripción o con `security_assessments` apagado: `none`, **sin tocar** los ciclos abiertos.
3. Política inexistente en el catálogo: lanza error.
4. Preguntas aplicables (alcance, política y, para activos, tipo). Si un ciclo abierto tiene la misma política, versión y exactamente el mismo conjunto `key@version`: `preserved` (devuelve su id).
5. Si no, los ciclos abiertos pasan a `superseded`; sin preguntas aplicables termina (`superseded` o `none`); con preguntas, crea un ciclo `pending` con `snapshot`, `assigned_to` (dueño del activo), `due_at` según política y `completion_summary` con todo `not_evaluable`.

Variante de activo de red: la aplicabilidad exige las condiciones de §2.3. Variante manual: no devuelve `none` cuando el feature está apagado, sino que trata el destino como no elegible, de modo que sus ciclos abiertos pasan a `superseded` (§10). `reconcileOrganizationAssessments` recorre organización, todas las oficinas, todos los activos de red y los activos manuales de categorías evaluables, **de forma secuencial**.

`syncAssetAssessmentAssignee` / `syncManualAssetAssessmentAssignee` actualizan `assigned_to` de los ciclos abiertos del activo cuando cambia su dueño, sin crear ciclo.

### 5.2 Borrador (`saveAssessmentDraft`)

En `withTransaction`, tras un lock transaccional `assessment:<id>`:
1. Verifica que el activo del ciclo no esté excluido.
2. Solo ciclos `pending` / `in_progress`; si no, lanza (400 `draft_rejected`).
3. Por cada respuesta: la pregunta (clave y versión) debe estar en el snapshot; debe existir en el catálogo y aplicar a la política; la opción debe existir; si la opción exige justificación, debe haberla.
4. Inserta o actualiza la respuesta (upsert por ciclo y pregunta). Fija `answered_by` (con `actorRelation`), `answered_at`, `valid_until` (+365 o +180 días) y un efecto simple.
5. Si el ciclo estaba `pending` y se guardó al menos una respuesta, pasa a `in_progress`.

### 5.3 Cierre (`completeAssessment`)

1. Transacción (la del request o una propia) y lock `assessment:<id>`.
2. Si el ciclo ya está `completed`, confirma y lo devuelve.
3. Guarda las respuestas recibidas con las reglas del borrador. Todas las preguntas del snapshot deben tener respuesta: si faltan, lanza `Responde todas las preguntas visibles para completar la revisión: <claves>.`
4. `evaluateControlEfficacy` por control: aplica reglas condicionales, descarta subpreguntas `not_applicable` justificadas y promedia; una subpregunta sin eficacia (`unknown`) hace al control `not_evaluable`; si todas son `not_applicable` es `not_applicable`.
5. Actualiza cada respuesta con `valid_until` desde el momento del cierre y el efecto (`status`, `reason_code`, eficacias, reglas aplicadas).
6. Crea un `compliance-results` por control (§2.4).
7. `evaluateAutomaticComplianceForAssessment` (§2.4).
8. Marca el ciclo `completed` con `completed_at`, `completed_by`, `due_at` = menor `valid_until` y `completion_summary` por control.
9. Encola riesgo (§7.4) salvo `enqueueRisk: false` (lo usa el cierre masivo).
10. Confirma; ante cualquier error revierte todo (una prueba verifica que un cierre fallido conserva el borrador guardado antes y que reintentar no duplica resultados).

### 5.4 Reapertura

Sobre `completed` o `superseded` (el estado persistido nunca es `expired`; un ciclo vencido se reabre por ser `completed`): según el destino llama a `reconcileAssetAssessmentInstance`, `reconcileManualAssetAssessmentInstance` o `reconcileAssessmentInstance` (con `is_active: true`, porque `writableAssessment` ya rechazó destinos inactivos) con motivo `manual_review`. Si el resultado es `created` o `preserved`, copia las respuestas del ciclo de origen que el destino aún no tiene. Estos pasos no comparten transacción: la reconciliación y la copia son escrituras separadas.

### 5.5 Vencimiento y exclusiones

`reconcileExpiredAssessments` recorre en lotes de 200, ordenados por id con cursor, los ciclos `completed` sin `expiry_reconciled_at` y con `due_at` ≤ ahora; para cada uno invoca la reconciliación de su destino con `answer_expired` (que crea o preserva el ciclo abierto, o no hace nada si el destino ya no existe o no aplica) y marca `expiry_reconciled_at` con un contexto (`assessmentExpiryMaintenance`) que el hook de colección admite como única modificación posible de un ciclo `completed`. Devuelve `expired_cycles_examined`, `cycles_created`, `cycles_preserved`, `cycles_skipped`.

Exclusión de un activo (`assessment_scope = excluded`): requiere motivo (`ASSESSMENT_EXCLUSION_REASON_VALUES`), nota si el motivo es `other`, y una fecha de fin posterior a ahora y de a lo sumo 90 días (`ASSESSMENT_EXCLUSION_MAX_DAYS`). Sin fecha, la exclusión no vence (`isAssetExcludedFromAssessments`), aunque el schema actual exige fecha. Efectos: el listado oculta sus ciclos; borrador, cierre y reapertura responden 409 `asset_excluded_from_assessments`; la reconciliación lo trata como no aplicable (el ciclo abierto pasa a `superseded`); y en el riesgo sus pares de preguntas quedan `excluded`. `reconcileExpiredAssetExclusions` (cada hora) pasa a `included` los activos y activos manuales con exclusión vencida, bajo lock de fila, lo que dispara de nuevo el hook de aplicabilidad.

### 5.6 Cierre masivo (`bulkAssessmentLifecycle.ts`)

**Vista previa** (`resolveBulkAssessmentPreview`): carga **todos** los ciclos de alcance `asset` de la organización y sus activos; agrupa por activo los que cumplen el selector (tipo de riesgo y dueño u oficina); descarta activos retirados o excluidos; por activo toma el ciclo abierto (si el actor puede responderlo) o, si no hay abierto, el cerrado más reciente `completed` / `expired` (si puede responderlo). Entre los abiertos elige la **firma** de preguntas más frecuente (desempate por orden alfabético de la firma) y llama compatibles a los que la comparten; el resto cuenta en `incompatible`. `has_draft` indica si el ciclo tiene alguna respuesta guardada.

**Cierre** (`completeBulkAssessments`):
1. Recalcula la vista previa. Si su firma existe y difiere de `question_set_signature`: `bulk_preview_stale`.
2. Todo `assessment_id` debe estar en `applicable` o `preserved_completed`; si no, `bulk_selection_stale`.
3. En **una** transacción, por cada id en el orden recibido: si el ciclo está `completed`/`expired`, cuenta como preservado y se salta; si no está abierto, `bulk_selection_stale`; si su firma no coincide, `bulk_preview_stale`; si no, `completeAssessment` con las mismas respuestas y `enqueueRisk: false`. Las respuestas del cuerpo **sobrescriben** los borradores existentes.
4. Una sola llamada a `enqueueRiskRecalculation` con la organización y las oficinas de los ciclos cerrados.
5. Cualquier error revierte todos los ciclos del lote.

## 6. Catálogo de errores

Cuerpo: `{ error: <código> }`, más `issues` (de Zod) en los de validación o `message` en los que encapsulan una excepción. El cliente muestra el texto de `lib/user-facing-error.ts` indexado por `error`; para `message`, solo pasan los textos en español que empiezan con prefijos permitidos en `translateKnownMessage` (por ejemplo `La revisión `, `Justifica por qué `, `Responde todas las preguntas visibles `); el resto cae al texto genérico de cada acción.

| Código | HTTP | Cuándo |
|---|---|---|
| `unauthenticated` | 401 | Sin sesión activa |
| `forbidden` | 403 | Sin acceso al ciclo; usuario sin organización; política de otro rol; selector no permitido; PlatformAdmin en el cierre masivo |
| `organization_context_required` | 400 | PlatformAdmin sin `asOrganization` (listado, resumen y masivos) |
| `feature_disabled` | 403 | Feature `security_assessments` apagado |
| `invalid_query` | 400 | Query inválida en el listado (`issues`) |
| `office_forbidden` | 403 | `office_id` fuera del alcance (listado) |
| `not_found` | 404 | Ciclo inexistente |
| `asset_excluded_from_assessments` | 409 | Activo del ciclo excluido |
| `office_inactive` / `organization_inactive` | 409 | El destino (oficina actual del activo, oficina del ciclo u organización) está inactivo |
| `invalid_draft` / `invalid_completion` / `invalid_reopen` / `invalid_policy` | 400 | Cuerpo inválido (`issues`) |
| `draft_rejected` | 400 | Cualquier excepción al guardar el borrador (`message`) |
| `completion_rejected` | 400 | Cualquier excepción al completar (`message`) |
| `assessment_already_open` | 409 | Reabrir un ciclo `pending` o `in_progress` |
| `policy_version_unavailable` | 400 | Clave o versión de política fuera del catálogo |
| `settings_not_found` | 404 | La organización no tiene `organization-settings` |
| `policy_change_failed` | 400 | Excepción al cambiar la política (`message`) |
| `invalid_bulk_preview` / `invalid_bulk_completion` | 400 | Cuerpo masivo inválido (`issues`) |
| `bulk_preview_failed` | 400 | Excepción en la vista previa (`message`) |
| `bulk_preview_stale` | 409 | La firma del conjunto de preguntas cambió |
| `bulk_selection_stale` | 409 | Un ciclo elegido ya no es seleccionable |
| `bulk_completion_failed` | 400 | Otra excepción del cierre masivo (`message`) |

Los hooks de colección (`validateAssessmentInstance`, `validateAssessmentAnswer`, `validateComplianceResult`) lanzan errores propios en español (`APIError` 400 o 409 en `invariants.ts`, `Error` en el resto). Dentro de borrador, cierre masivo y política se convierten en 400 con `message`; fuera de esas rutas (por ejemplo en la reapertura, que no tiene `try/catch`) llegan a Payload como 500.

## 7. Concurrencia, atomicidad y efectos del sistema

### 7.1 Bloqueo y transacciones

- Borrador y cierre toman `pg_advisory_xact_lock(hashtextextended('assessment:<id>', 0))` (`transactionLock`) antes de leer el ciclo. Dos cierres simultáneos se serializan; el segundo ve `completed` y devuelve el ciclo sin duplicar resultados.
- `saveAssessmentDraft` usa `withTransaction`; `completeAssessment` abre o reutiliza la transacción del request y la confirma o revierte (en el cierre masivo el dueño del commit es `completeBulkAssessments`).
- La unicidad de ciclo abierto se refuerza en la base con `open_cycle_key` (único); el hook también consulta antes de crear.
- Fallan con error si no hay transacciones PostgreSQL.

### 7.2 Tareas de mantenimiento (`payload.config.ts`, cola `maintenance`)

| Tarea | Cron | Efecto |
|---|---|---|
| `reconcile-expired-assessments` | `0 30 3 * * *` | §5.5 |
| `reconcile-expired-asset-exclusions` | `0 0 * * * *` | §5.5 |
| `refresh-risk` | `0 45 3 * * *` | Recalcula riesgo de todas las organizaciones activas; ver `docs/risk-api.md`. Corre 15 minutos después del vencimiento de ciclos, que no encola riesgo por sí mismo. |

### 7.3 Hooks de activos

`afterChange` de `assets` y `non-network-assets` (`collections/*/hooks/reconcileAssessmentApplicability.ts`):
- Reconcilia el ciclo si cambió la aplicabilidad. En activos de red: oficina, `confirmed_type`, entrada o salida de retiro, `assessment_scope` o `assessment_excluded_until` (al crear, solo si el tipo confirmado es `workstation` y no está retirado). El motivo es `assessment_scope_changed`, `office_changed` o `asset_identified`, en ese orden de prioridad.
- Sincroniza el responsable si cambió el dueño.
- Encola riesgo para la oficina del activo y la anterior si se movió; con `context.systemJob` (ingesta y barrido de envejecimiento, que encolan por su cuenta) solo si cambió la oficina.

### 7.4 Conexión con el riesgo

| Evento | Encolado (`domain/risk/enqueueRiskRecalculation.ts`) |
|---|---|
| Cierre de ciclo con oficina (oficina o activo) | `enqueueRiskRecalculation(org, [oficina])`: organización y esa oficina |
| Cierre de ciclo de organización | `enqueueOrganizationRiskRecalculation`: organización y todas las oficinas activas |
| Cierre masivo | Una llamada con las oficinas de los ciclos cerrados |
| Cambio de política | `enqueueOrganizationRiskRecalculation` |

El encolado usa la transacción del request: se confirma o revierte junto con el cierre. El motor lee los `compliance-results` `manual:*` de la organización con `valid_until` futuro y política vigente, por lo que una respuesta vencida o dada bajo otra política deja el par `not_evaluable`. Detalle en `docs/risk-api.md`, §5.2 y §7.

### 7.5 Puntos de enganche pendientes

Las escrituras llevan comentarios `// AUDIT:` y `// NOTIFY:`. AuditLog y Notification Bell **no existen aún**: son marcas, no código. Ver `SYSTEM_PROMPT.md` §2.

## 8. Frontend

### 8.1 Cadena

- Páginas: `app/portal/(protected)/security-review/page.tsx` (lista y resumen), `security-review/[id]/page.tsx` (detalle y formulario) y `security-review/bulk/page.tsx` (asistente de cierre masivo).
- Componentes (`modules/assessments/components/`): `SecurityReviewOverview`, `AssessmentForm`, `BulkAssessmentWizard`, `AssetSecurityReviewCard`, `AssessmentExclusionFields`.
- Hooks (`modules/assessments/hooks/`): `use-assessments`, `use-assessment`, `use-assessment-actions`, `use-bulk-assessments`, `use-risk-summary`, `use-update-assessment-policy`.
- Cliente: `modules/assessments/service.ts`, que usa `lib/http-client.ts` contra `/api/v1/assessments...` y `/api/v1/organization/assessment-policy`.

La lista pide siempre todos los ciclos del alcance del rol (`useAssessments({ asOrganization })`, sin `office_id`) y filtra en el cliente: estado (por defecto todos menos `superseded`), "Mías" (por `assigned_to`), oficinas inactivas y, para el resumen, la oficina elegida más los ciclos de organización. El resumen de riesgo usa la oficina concreta resuelta por `useConcreteOfficeId`. `AssetSecurityReviewCard` usa `useAssessments({ scope: 'asset', assetId })`. `canUseBulkAssessments` muestra el botón "Responder varias" a `org_admin`, `office_manager` y `org_viewer` (no a PlatformAdmin).

El detalle es de solo lectura en la UI si el estado (derivado) es `completed`, `expired` o `superseded`, si `inactive_subject` está presente o si es PlatformAdmin. "Iniciar nuevo ciclo de revisión" aparece solo con el ciclo más reciente en estado `completed` (el derivado `expired` no lo muestra) y para `org_admin`, o `office_manager` con la oficina del ciclo en un ciclo que no es de organización; envía el motivo fijo `Solicitado desde una revisión completada` y navega al ciclo devuelto en `id`. `AssessmentForm` precarga como valores iniciales las `previous_answers` mezcladas con las `answers` guardadas (estas ganan), muestra la evidencia heredada o vencida según `effective_evidence`, y valida con el mismo `SaveAssessmentDraftSchema` mediante `assessmentFormResolver`. Los índices del formulario son posiciones numéricas porque las claves de pregunta contienen puntos. Al completar con éxito vuelve a la lista.

El asistente masivo usa el parámetro `step` (0 Alcance, 1 Revisiones, 2 Respuestas; cada paso es una entrada del historial). El selector y los ids elegidos se guardan en `sessionStorage` (`siam.bulk-assessment`, `assessments.store.ts`); la vista previa del servidor no se guarda, se vuelve a pedir con el selector. Las respuestas del cuestionario no se guardan y el paso 2 avisa antes de cerrar la pestaña.

### 8.2 Consultas (TanStack Query)

| Hook | Clave | Notas |
|---|---|---|
| `useAssessments(params)` | `['assessments', scope ?? 'all', officeId ?? null, assetId ?? null, asOrganization ?? null]` | Sin refetch periódico. |
| `useAssessment(id, asOrganization)` | `['assessments', 'detail', id, asOrganization ?? null]` | Habilitada si hay `id`. Sin refetch periódico. |
| `useRiskSummary(params)` | `['assessments', 'risk-summary', asOrganization, officeId]` | Refetch cada 3 s si `recalculation` es `pending`, `processing` u `outdated`; si no, cada 30 s. Lo usan Revisión de seguridad y el Panel. |

### 8.3 Mutaciones

| Hook | Efecto |
|---|---|
| `useAssessmentActions(id).saveDraft` | Invalida `['assessments']`; aviso "Borrador guardado". |
| `useAssessmentActions(id).complete` | Invalida `['assessments']`; aviso "Revisión de seguridad completada". |
| `useAssessmentActions(id).startNewCycle` | Invalida `['assessments']`; aviso "Nuevo ciclo de revisión creado". |
| `useBulkAssessments().preview` | Mutación sin caché; error con `showApiError`. |
| `useBulkAssessments().complete` | Invalida `['assessments']` y `['risk']`; aviso con la cantidad completada. |
| `useUpdateAssessmentPolicy` | Invalida `['organization-settings']` y `['assessments']`. |
| `invalidateSecurityReview` (`invalidate-security-review.ts`) | Invalida `['assessments']`, `['risk']` y `['tasks']` con `refetchType: 'all'`. La llaman los cambios de activos, identificación, incidentes y el monitor de resultados de escaneo, porque modifican ciclos como efecto de la reconciliación. |

Los errores pasan por `showApiError`.

### 8.4 Contrato de tipos

Los schemas de entrada se importan directamente de `modules/assessments/schema.ts` (`SYSTEM_PROMPT.md` §5). `service.ts` tipa las respuestas con los tipos de Payload (`AssessmentInstance`, `AssessmentAnswer`) y con `BulkAssessmentPreview` / `BulkAssessmentResult` importados del dominio. `reopenAssessment` declara `action: 'created' | 'preserved'`, aunque el servidor también puede devolver `superseded` y `none`.

## 9. Cómo extender

**Nueva pregunta o cambio de una existente.** En `domain/risk/catalog-v2/catalog.ts`; subir `version` si cambia el significado. La reconciliación compara `key@version` con el snapshot del ciclo abierto: un cambio supersede los ciclos abiertos y crea otros con las preguntas nuevas la próxima vez que se reconcilie cada destino (cambio de política, evento del activo, vencimiento). Detalle del motor en `docs/risk-api.md`, §9.

**Nueva categoría de activo manual revisable.** Agregarla a `ASSESSABLE_MANUAL` y a `MANUAL` en `domain/risk/risk-asset-type.ts` (hoy son dos fuentes), y verificar que `reconcileOrganizationAssessments` (filtra por `ASSESSABLE_MANUAL`) y `validateAssessmentInstance` (`isManualCategoryAssessable`) la admitan.

**Nuevo endpoint bajo `/v1/assessments`.** Registrarlo en `payload.config.ts` antes de `assessmentDetailEndpoint` si su ruta puede confundirse con `:id`. Empezar con `authenticated`, resolver permisos con `canReadAssessment` / `canAnswerAssessment` (o `writableAssessment` si escribe), comprobar `featureEnabled`, validar con un schema en `modules/assessments/schema.ts`, y devolver el código de error en `lib/user-facing-error.ts`.

**Nuevo origen de reconciliación.** Llamar a la variante que corresponda con un motivo de `ReconcileReason` (y agregarlo al `select` de `created_reason` si es nuevo) y encolar riesgo con `enqueueRiskRecalculation` en la misma transacción.

**Pruebas.** Dominio con dobles de `payload` (ver `reconcileAssessmentInstance.test.ts`); integración en `endpoints/assessments.integration.test.ts` o `endpoints/manual-assessment-categories.audit.integration.test.ts`.

## 10. Comportamientos a tener presentes

Verificados en el código; no son necesariamente defectos, pero conviene conocerlos antes de tocar el feature.

1. **Mensaje de `upsertAnswers` para ciclos cerrados.** Al guardar sobre un ciclo que no está abierto (`completed`, `expired`, `superseded`), el dominio lanza "La revisión en curso no se puede modificar." En esa rama el estado nunca es `pending`, así que el texto siempre dice "en curso", incluso para un ciclo completado o reemplazado. Responde 400 (`draft_rejected` / `completion_rejected`) y no el 409 con el texto correcto que define `assertAssessmentMutable`, que queda alcanzable solo desde los hooks de colección.
2. **`reason` de la reapertura.** `ReopenAssessmentSchema` exige `reason` (1–500 caracteres), pero el endpoint no lo usa ni lo guarda. La UI envía un texto fijo. No queda registro del motivo.
3. **`reopen` no reabre el registro.** Crea o localiza otro ciclo y copia respuestas; la respuesta `action` puede ser `superseded` o `none` (por ejemplo, si el activo ya no aplica) con 200, y el tipo del cliente solo declara `created | preserved`. La reconciliación y la copia de respuestas no están en una transacción única y el endpoint no captura excepciones: un fallo en la copia deja el ciclo nuevo sin respuestas y responde 500.
4. **Reconciliación con el feature apagado.** Organización, oficina y activo de red devuelven `none` sin tocar los ciclos abiertos; el activo manual los pasa a `superseded`. Además, `organizationFeatures` trata la ausencia de suscripción como feature activo, mientras que la reconciliación (las cuatro variantes) no crea ciclos si no existe suscripción.
5. **`expired` no se persiste.** Es solo derivado. El estado `expired` figura en la colección y se acepta en chequeos (`reopen`, hooks, vista previa masiva), pero el valor almacenado de un ciclo vencido es `completed`. Entre el vencimiento y la corrida diaria no existe ciclo nuevo.
6. **Botón de nuevo ciclo y vencidos.** La UI muestra "Iniciar nuevo ciclo de revisión" solo con estado `completed`; como el detalle devuelve el estado derivado, un ciclo vencido no lo ofrece, aunque el endpoint lo acepte.
7. **Costo de las listas.** `GET /v1/assessments` no pagina y usa `depth: 1`; la vista previa masiva carga todos los ciclos de activos de la organización y sus activos; `reconcileOrganizationAssessments` recorre organización, oficinas y todos los activos de forma secuencial dentro de la transacción del cambio de política. El costo crece con el tamaño de la organización.
8. **Límites de 100.** El detalle devuelve como máximo 100 respuestas y 100 ciclos de historial; el cierre lee hasta 100 respuestas. El schema limita a 100 las respuestas por solicitud.
9. **`previous_answers` redundante.** Hay un segundo intento de obtener respuestas previas cuando el primero queda vacío, pero aplica los mismos criterios (misma organización, alcance, destino, política y versión, estado `completed` o `superseded`) y elige el mismo ciclo previo, de modo que no encuentra uno anterior distinto.
10. **Orden de las verificaciones.** Un id inexistente da 404 `not_found`, mientras que el de un ciclo de otra organización da 403 `forbidden`: la respuesta distingue ambos casos. En borrador, cierre y reapertura, el activo excluido (409) se comprueba antes que el permiso (403).
11. **`asset_id` solo para activos de red.** El filtro del listado compara con el campo `asset`; no hay equivalente para `manual_asset`.
12. **Hook de creación de activos.** Al crear un activo de red solo reconcilia si `confirmed_type` es `workstation`; el resto de tipos con preguntas (por ejemplo `gateway`) se reconcilian en la primera actualización que cambie su tipo confirmado, oficina, retiro o exclusión.
13. **`canAnswerAssessment` del Viewer.** Para `org_viewer` solo se compara el dueño del activo con el usuario, no su oficina.
14. **Efecto de `not_applicable` en el riesgo.** Una respuesta `not_applicable` justificada resulta en un control `not_applicable` y su par de riesgo `not_evaluable`: no sale del denominador de cobertura (`docs/risk-api.md`, §10).
15. **`policy_change_failed`.** Devuelve el texto de la excepción original en `message`, que puede ser un mensaje técnico; el cliente solo lo muestra si coincide con un prefijo permitido.

## 11. Cobertura de pruebas

Estado de cobertura automática; sin pruebas de extremo a extremo por ahora.

| Prueba | Cubre |
|---|---|
| `domain/assessments/assessmentLifecycle.test.ts` | Copia de respuestas a un ciclo nuevo, upsert idempotente del borrador, cierre atómico y sin duplicados, reversión si falta una respuesta |
| `domain/assessments/reopenCopy.test.ts` | Copia 1:1 de respuestas al reabrir |
| `domain/assessments/bulkAssessmentLifecycle.test.ts` | Firma del conjunto de preguntas y vista previa (abiertos, completados preservados, reemplazados ignorados) |
| `domain/assessments/reconcileAssessmentInstance.test.ts` | Preguntas por tipo de activo, exclusión, retiro, oficina inactiva, preservar y reemplazar ciclos, feature apagado, activo manual, sincronización de responsable |
| `domain/assessments/reconcileExpiredAssessments.test.ts` | Un ciclo nuevo por vencimiento, idempotente |
| `domain/assessments/reconcileExpiredAssetExclusions.test.ts` | Reinclusión de exclusiones vencidas en ambos inventarios |
| `domain/assessments/assessmentAccess.test.ts` | Lectura y escritura por rol |
| `domain/assessments/assessmentExpiration.test.ts` | Estado derivado `expired` |
| `domain/assessments/asset-assessment-scope.test.ts`, `assessment-scope-schema.audit.test.ts` | Regla y validación de exclusiones (90 días) |
| `domain/assessments/evaluateCompliance.test.ts` | Evidencia efectiva: vencida, ausente, propia sobre heredada |
| `domain/assessments/evaluateAutomaticCompliance.test.ts`, `evaluateNetworkBaseline.test.ts`, `network-explanations.test.ts` | Resultados automáticos y línea base de red |
| `collections/AssessmentInstances/hooks/validateAssessmentInstance.test.ts`, `invariants.test.ts` | Coherencia de tenant, inmutabilidad de cerrados, destinos por alcance |
| `collections/Assets/hooks/reconcileAssessmentApplicability.test.ts`, `collections/NonNetworkAssets/hooks/reconcileAssessmentApplicability.test.ts` | Qué cambios del activo alteran la aplicabilidad |
| `modules/assessments/schema.test.ts` | Justificación de `not_applicable`, política, selector masivo, tope de 100 |
| `modules/assessments/assessment-form-state.test.ts`, `assessment-form-state.audit.test.ts` | Mapeo del formulario y errores por pregunta |
| `endpoints/assessments.test.ts` | Filtro por oficina con relaciones actuales, ciclos de organización fuera para roles de oficina, ruta del cierre masivo |
| `endpoints/assessments.integration.test.ts` | Computadora manual movida (ambos ciclos), ocultamiento de ciclos y respuestas de organización a roles de oficina, cierre masivo que sobrescribe borradores y preserva cerrados |
| `endpoints/manual-assessment-categories.audit.integration.test.ts` | Cierre de cada categoría manual evaluable, reintento sin duplicados, Viewer sin dueño prohibido, reversión que conserva el borrador |
| `endpoints/audit-fixes.audit.integration.test.ts` | Validación de exclusiones (VAL-01), entrega transaccional de riesgo y reemplazo de trabajos (SEC-36/57/58) |
| `endpoints/offices.integration.test.ts`, `endpoints/platformOrganizations.integration.test.ts` | Ciclos abiertos al desactivar y reactivar oficinas y organizaciones (la primera también usa `assessmentDraftEndpoint`) |
| `endpoints/memberLifecycle.integration.test.ts` | El ciclo sigue al responsable del activo |
| `endpoints/remaining-corroboration.audit.integration.test.ts` | Reconciliación concurrente inicial, borradores y la tarea de vencimiento (casos puntuales; no hay una suite propia de estos efectos) |

Las pruebas de integración requieren una base PostgreSQL desechable.
