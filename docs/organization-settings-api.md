# API de configuración de la organización

Referencia técnica del feature `organization-settings`: el documento de configuración de cada organización (ajustes de inventario, perfil de madurez, política de revisión de seguridad y rubro), qué endpoint edita cada parte, qué efectos tiene cada cambio y la cadena que lo conecta con la página de Configuración. Dirigida a quien mantiene o extiende el feature.

Verificado contra el código el 2026-10-31. Si algo de este documento contradice el código, gana el código: corregir el documento.

Documentos relacionados: `assessments-api.md` (revisiones de seguridad y reconciliación), `risk-api.md` (recálculo de riesgo), `scanner-api.md` (ingesta de escaneos), `assets-api.md` (envejecimiento de activos), `organizations-platform-api.md` (alta de organizaciones y edición de nombre y rubro por el administrador de plataforma) y `offices-api.md` (la ubicación geográfica pertenece a las oficinas).

## 1. Alcance y mapa de qué edita cada endpoint

El documento `organization-settings` reúne datos que se editan por **tres vías distintas**. La página `administration/settings` solo expone las tres primeras.

| Dato | Campos | Endpoint que lo edita | Quién |
|---|---|---|---|
| Ajustes de inventario | `offline_after_hours`, `snapshot_before_each_scan`, `snapshot_interval_days` | `PATCH /v1/organization-settings` (`endpoints/organizationSettings.ts`) | OrgAdmin |
| Perfil de madurez | `maturity_it_owner`, `maturity_security_budget` (y `maturity_updated_at`, `maturity_updated_by`) | `PATCH /v1/organization-settings/maturity` (`endpoints/organizationSettings.ts`) | OrgAdmin |
| Política de revisión de seguridad | `assessment_policy_key`, `assessment_policy_version`, `assessment_policy_selected_at`, `assessment_policy_selected_by` | `PATCH /v1/organization/assessment-policy` (`endpoints/assessments.ts`, `assessmentPolicyEndpoint`) | OrgAdmin |
| Rubro | `industry`, `industry_details` | `PATCH /v1/platform-admin/organizations/:id` (`endpoints/platformOrganizations.ts`, `updateOrganizationDetails`) | Solo administrador de plataforma |

Lectura: `GET /v1/organization-settings` devuelve el documento completo y lo usa la página para los tres bloques editables.

Importante: el endpoint `PATCH /v1/organization-settings` **no** modifica la política de revisión, el perfil de madurez ni el rubro. Su schema solo acepta los tres campos de inventario y descarta cualquier otro. Un OrgAdmin no tiene ninguna vía en el portal para editar el rubro de su organización; el formulario con "Otro" y su descripción vive en el modal de organizaciones de la plataforma.

El perfil que la UI llama "Perfil de la organización" (tarjeta de Configuración) es el perfil de **madurez**, no el rubro.

## 2. Capas y archivos

| Capa | Archivo | Responsabilidad |
|---|---|---|
| Contrato | `modules/organization-settings/schema.ts` | `OrganizationSettingsFormSchema` (inventario) y `OrganizationMaturitySchema`. |
| | `modules/assessments/schema.ts` | `UpdateAssessmentPolicySchema`. |
| | `modules/organizations/schema.ts` | `OrganizationDetailsSchema` (rubro; endpoint de plataforma). |
| Endpoints | `endpoints/organizationSettings.ts` | Lectura, ajustes de inventario y perfil de madurez. Registrados en `payload.config.ts`. |
| | `endpoints/assessments.ts` | `assessmentPolicyEndpoint`. |
| Dominio | `domain/organizations/settings-options.ts` | Valores permitidos de umbral y de intervalo y sus opciones de UI. |
| | `domain/organizations/maturity.ts` | Valores y cálculo del nivel de madurez. |
| | `domain/organizations/industry-options.ts` | Lista de rubros. |
| | `domain/organizations/update-organization-details.ts` | Edición de nombre y rubro (plataforma). |
| | `domain/assessments/reconcileAssessmentInstance.ts` | `reconcileOrganizationAssessments` al cambiar la política. |
| | `domain/risk/enqueueRiskRecalculation.ts` | `enqueueOrganizationRiskRecalculation`. |
| | `domain/inventories/agingSweep.ts`, `domain/inventories/autoSnapshot.ts` | Consumidores de los ajustes de inventario. |
| Persistencia | `collections/OrganizationSettings/index.ts` | Colección Payload, cerrada al acceso directo. |
| Cliente HTTP | `modules/organization-settings/service.ts` | Funciones sobre `lib/http-client.ts`. |
| Estado de servidor | `modules/organization-settings/hooks/*`, `modules/assessments/hooks/use-update-assessment-policy.ts` | TanStack Query. |
| UI | `app/portal/(protected)/administration/settings/page.tsx`, `modules/organization-settings/components/MaturityProfileForm.tsx` | Presentación. |

Cadena de una acción de inventario: `SettingsForm` (en la página) → `useSaveOrganizationSettings` → `service.ts` (`updateOrganizationSettings`) → `httpClient` → `organizationSettingsUpdateEndpoint` → `payload.update` sobre `organization-settings`.

## 3. Modelo

### 3.1 Colección `organization-settings`

Acceso: `create`, `read`, `update` y `delete` son `() => false`. Todo pasa por los endpoints propios, que escriben con `overrideAccess: true`. El documento inicial lo crea `createOrgWithAdmin` al dar de alta la organización. Hay un documento por organización (`organization` es `unique`).

| Campo | Tipo | Notas |
|---|---|---|
| `organization` | relación, requerido, único | |
| `industry` | text, requerido | Texto libre a nivel de colección; los endpoints validan contra `INDUSTRY_VALUES` (§6). |
| `industry_details` | textarea, ≤ 300 | Solo tiene sentido con `industry = 'other'`. |
| `assessment_policy_key` | `essential` \| `reinforced`, requerido, por defecto `essential` | |
| `assessment_policy_version` | number, requerido, por defecto 2 | |
| `assessment_policy_selected_at` | date, requerido | |
| `assessment_policy_selected_by` | relación a `users` \| `admins` | Quién eligió la política. |
| `maturity_it_owner` | `yes` \| `no` | Sin valor = sin responder. |
| `maturity_security_budget` | `none` \| `occasional` \| `recurring` | Sin valor = sin responder. |
| `maturity_updated_at`, `maturity_updated_by` | date, relación a `users` \| `admins` | Los fija el endpoint de madurez. |
| `offline_after_hours` | number | Validación de colección: vacío o uno de 24, 48, 72, 96, 168. |
| `snapshot_before_each_scan` | checkbox, por defecto `false` | |
| `snapshot_interval_days` | number | Validación de colección: vacío o uno de 1, 3, 7, 14, 30. La condición `admin.condition` (solo si `snapshot_before_each_scan` es falso) afecta únicamente al panel de Payload. |

Al crear la organización, `createOrgWithAdmin` escribe `industry`, `industry_details` (solo si vino), `assessment_policy_key = 'essential'`, `assessment_policy_version = 2` y `assessment_policy_selected_at = now`. No fija `assessment_policy_selected_by`, ni los ajustes de inventario, ni la madurez: arrancan vacíos.

### 3.2 Valores permitidos

`domain/organizations/settings-options.ts`:
- `OFFLINE_AFTER_HOURS_VALUES = [24, 48, 72, 96, 168]`.
- `SNAPSHOT_INTERVAL_DAYS_VALUES = [1, 3, 7, 14, 30]`.

Las opciones de UI (`OFFLINE_AFTER_HOURS_OPTIONS`, `SNAPSHOT_INTERVAL_DAYS_OPTIONS`) rotulan 72 h y 7 días como "predeterminado". Esos valores son los de las constantes `DEFAULT_OFFLINE_AFTER_HOURS` (72, `agingSweep.ts`) y `DEFAULT_SNAPSHOT_INTERVAL_DAYS` (7, `autoSnapshot.ts`), que se aplican cuando el campo está vacío. No hay un documento de plataforma con defaults editables (los comentarios del código lo señalan).

### 3.3 Madurez

`maturityLevel(itOwner, budget)` (`domain/organizations/maturity.ts`) devuelve `null` si falta alguna respuesta; `initial` si `no` y `none`; `advanced` si `yes` y `recurring`; `managed` en cualquier otro caso. El nivel nunca se guarda: la UI lo deriva de las dos respuestas. El comentario del dominio indica que solo prioriza recomendaciones y nunca entra en el puntaje de riesgo. En el código revisado, el único consumidor del perfil es el formulario de la página (y el seed de demostración); ningún cálculo de riesgo ni de recomendaciones lo lee.

### 3.4 Flujos

**Ajustes de inventario.** El OrgAdmin elige el umbral de "sin conexión", marca si se toma una instantánea antes de cada escaneo o fija un intervalo. Se guardan por organización y aplican a todas sus oficinas. "Restaurar valores predeterminados" envía `null`, `false` y `null`, lo que deja la organización sin override y vuelve a las constantes de código. La página refleja lo guardado (`reset(values)`) recién cuando el servidor confirma.

**Perfil de madurez.** Dos respuestas obligatorias a la vez. Se guardan junto con la fecha y el autor. La tarjeta muestra el nivel derivado y la última actualización.

**Política de revisión.** La tarjeta ofrece "Esencial" (anual) y "Reforzada" (cada 6 meses). Elegir otra política pide confirmación y, al confirmar, el endpoint guarda la política y reconcilia las revisiones de toda la organización en la misma transacción (§5.3).

## 4. Permisos y alcance

### 4.1 Ajustes de inventario y madurez (`loadSettings`)

Mismo guardián para los tres endpoints de `endpoints/organizationSettings.ts`:

1. `getTenantContext` sin contexto activo → 401 `unauthenticated`.
2. `ctx.role !== 'org_admin'` o sin `organizationId` → 403 `forbidden`. Un PlatformAdmin con `?asOrganization=` tiene `role = 'org_admin'` en el contexto, así que pasa. Sin `asOrganization` no tiene organización y recibe 403.
3. No hay documento de configuración para la organización → 404 `not_found`.

No comprueba la matriz de permisos (`canDo`) ni el rol por `hasOrgWideScope`: es una comparación literal con `org_admin`. No comprueba que la organización esté activa ni ningún feature flag de suscripción. Un Responsable de oficina o un Observador reciben 403 incluso para la lectura.

### 4.2 Política de revisión (`assessmentPolicyEndpoint`)

`authenticated` (401 sin contexto activo; 403 si no es PlatformAdmin y no tiene organización), luego `ctx.role !== 'org_admin'` o sin `organizationId` → 403 `forbidden`, y feature `security_assessments` apagado para la organización → 403 `feature_disabled`. A diferencia de los otros, **depende del feature de suscripción**. Tampoco comprueba que la organización esté activa.

## 5. Contrato HTTP

Prefijo `/api`. Cuerpos JSON. Un cuerpo ausente o inválido se parsea como `{}`. El cliente agrega `?asOrganization=` a las requests del portal. Las respuestas con el documento lo devuelven con `depth: 0` (las relaciones como ids, sin documentos de usuario incrustados).

| Método y ruta | Rol | Entrada | Respuesta OK |
|---|---|---|---|
| `GET /v1/organization-settings` | `org_admin` | — | 200 documento completo |
| `PATCH /v1/organization-settings` | `org_admin` | `OrganizationSettingsFormSchema` | 200 documento actualizado |
| `PATCH /v1/organization-settings/maturity` | `org_admin` | `OrganizationMaturitySchema` | 200 documento actualizado |
| `PATCH /v1/organization/assessment-policy` | `org_admin` + feature `security_assessments` | `UpdateAssessmentPolicySchema` | 200 documento (actualizado o el vigente) |

Ninguno usa `adminErrorResponse` ni `organizationAdminLock`.

### 5.1 `PATCH /v1/organization-settings`

`OrganizationSettingsFormSchema`: objeto con **los tres campos obligatorios**:
- `offline_after_hours`: entero en {24, 48, 72, 96, 168}, o `null`.
- `snapshot_before_each_scan`: booleano.
- `snapshot_interval_days`: entero en {1, 3, 7, 14, 30}, o `null`.

Los campos desconocidos se descartan sin error (el schema no es estricto). Un valor fuera de la lista: 400 `invalid_settings` con `issues`. Se escribe con `payload.update` los tres valores tal cual: `null` borra el override. El endpoint no valida la relación entre campos: se puede guardar `snapshot_before_each_scan = true` junto con un `snapshot_interval_days`, que queda guardado pero sin efecto mientras el booleano sea verdadero. La UI deshabilita el selector de intervalo en ese caso y no limpia el valor.

### 5.2 `PATCH /v1/organization-settings/maturity`

`OrganizationMaturitySchema`: `maturity_it_owner` (`yes` \| `no`) y `maturity_security_budget` (`none` \| `occasional` \| `recurring`), ambos obligatorios. Inválido: 400 `invalid_maturity`. Escribe los dos valores más `maturity_updated_at = now` y `maturity_updated_by = actorRelation(req, userId)` (`users` para una persona, `admins` para un administrador de plataforma). Va separado del endpoint genérico justamente porque registra quién respondió.

### 5.3 `PATCH /v1/organization/assessment-policy`

`UpdateAssessmentPolicySchema`: `policy_key` (`essential` \| `reinforced`), `policy_version` (entero positivo). Orden de verificaciones:

1. Permisos y feature (§4.2).
2. Schema → 400 `invalid_policy` con `issues`.
3. `policy_key` debe estar en `RISK_POLICY_KEYS` y `policy_version` debe ser exactamente 2 → 400 `policy_version_unavailable`. La página envía `RISK_CATALOG_V2.version`.
4. Documento de configuración inexistente → 404 `settings_not_found`.
5. Si la política y la versión ya son las vigentes: devuelve el documento con 200 **sin escribir ni reconciliar nada**.
6. En una transacción (propia, si la request no traía una): actualiza `assessment_policy_key`, `assessment_policy_version`, `assessment_policy_selected_at = now` y `assessment_policy_selected_by`; ejecuta `reconcileOrganizationAssessments(..., 'policy_changed')`; encola `enqueueOrganizationRiskRecalculation`; confirma.
7. Cualquier excepción dentro de ese bloque revierte la transacción y responde 400 `policy_change_failed` con el mensaje de la excepción.

No toma el lock de organización.

## 6. Reglas y efectos

### 6.1 Efecto de cambiar la política de revisión

`reconcileOrganizationAssessments` recorre la organización y, para cada alcance, reconcilia la revisión abierta con la política vigente:
- Revisión de la **organización** y de **cada oficina** (`reconcileAssessmentInstance`), y de **cada activo** de red y activo manual evaluable (`reconcileAssetAssessmentInstance`, `reconcileManualAssetAssessmentInstance`).
- Solo se consideran revisiones abiertas (`pending` o `in_progress`). **Las revisiones completadas no se modifican** (el aviso de la UI lo dice).
- Si una revisión abierta ya coincide en política, versión y conjunto de preguntas, se conserva (`preserved`). Si no, se marca `superseded` y se crea una nueva en `pending` con las preguntas de la política elegida, el motivo `created_reason = 'policy_changed'` y un vencimiento de 365 días (`essential`) o 180 días (`reinforced`) desde la apertura.
- Una oficina u organización inactiva no abre revisiones; si tenía una abierta, la deja `superseded`.
- Si la suscripción no tiene el feature de revisiones o el documento de configuración no existe, la reconciliación no hace nada (`none`). El endpoint ya habría devuelto 403 por el feature.
- Si la política guardada no existe en el catálogo, la reconciliación lanza un error, que el endpoint convierte en `policy_change_failed`.

Después se encola el recálculo de riesgo de las oficinas activas de la organización (`enqueueOrganizationRiskRecalculation`); no hace nada si `PAYLOAD_DISABLE_JOBS = '1'` o no hay cola. `recalculateRisk` lee `assessment_policy_key` del documento y, si no coincide con el catálogo, usa `essential`.

La guarda de atomicidad la cubre una prueba: si falla la inserción del trabajo de recálculo, la política queda en el valor anterior y los trabajos previos se conservan (§9).

### 6.2 Efecto de los ajustes de inventario

| Campo | Quién lo lee | Efecto |
|---|---|---|
| `offline_after_hours` | `fetchOfflineAfterHours` (`agingSweep.ts`), job de envejecimiento | Un activo `active` que no aparece en un escaneo durante ese tiempo pasa a `offline`; se recalcula el riesgo de las oficinas afectadas. Vacío o no positivo: 72 h. Es un umbral por organización, no global. |
| `snapshot_before_each_scan` | `maybeCreateAutoSnapshot` (`autoSnapshot.ts`), invocado desde el procesamiento de reportes de escaneo (`domain/inventories/processScanReport.ts`) | Si es verdadero, toma una instantánea programada en cada escaneo procesado e ignora el intervalo. |
| `snapshot_interval_days` | `maybeCreateAutoSnapshot` | Con el booleano falso, toma una instantánea programada si pasó al menos ese intervalo desde la última de **esa oficina** (o si no había ninguna). Vacío o no positivo: 7 días. |

Guardar estos ajustes no dispara recálculos ni reconciliaciones: solo cambian lo que leen la próxima ejecución del job de envejecimiento y la próxima ingesta. Los activos que ya estaban `offline` o `active` no se reevalúan al guardar.

### 6.3 Rubro y "Otro"

El rubro no se edita desde el portal de la organización (§1). Las reglas de dato:

- `INDUSTRY_OPTIONS` (`domain/organizations/industry-options.ts`): 16 valores estables, entre ellos `technology`, `healthcare`, `education`, `retail`, `manufacturing`, `professional_services`, `finance_insurance`, `nonprofit` y `other` ("Otro"). `INDUSTRY_VALUES` es la lista para validar.
- `OrganizationDetailsSchema` (estricto, rechaza campos extra): `name` (1–200, regla `label`), `industry` (debe estar en `INDUSTRY_VALUES`), `industry_details` (opcional, ≤ 300, regla `free`). Si `industry` no es `other` y `industry_details` trae texto, la validación falla ("La descripción sólo se usa cuando eliges “Otro”").
- **Limpieza**: `updateOrganizationDetails` guarda `industry_details: data.industry_details || null`: omitir o vaciar la descripción la borra. El modal de edición de organizaciones vacía la descripción al cambiar el rubro (`setValue('industry_details', '')`), de modo que el cliente envía sin ella. No hay otra limpieza automática: el servidor depende de que la descripción no llegue (si llega con otro rubro, se rechaza).
- `updateOrganizationDetails` corre en `withTransaction` con el lock de organización, exige organización activa (`organization_inactive`) y documento de configuración existente (`organization_settings_missing`, 409), y actualiza el nombre en `organizations` y rubro y descripción en `organization-settings` en la misma transacción. La prueba verifica que, si la segunda escritura falla, el nombre se revierte.
- En el alta (`createOrgWithAdmin`), `industry_details` solo se guarda si vino.
- `industry` es `text` en la colección: la restricción a los 16 valores existe en Zod, no a nivel de base. Una escritura directa (seed, script) podría guardar otro valor.

### 6.4 Datos geográficos

`lib/argentina-geo.json` (con `lib/argentina-geo.ts`) **no se usa en la configuración de la organización**: no hay provincia ni departamento en `organization-settings` ni en `organizations`. Solo lo usan las oficinas (`province_id`, `department_id`; ver `offices-api.md`) y el perfil propio (`myProfile`, ubicación de las oficinas).

## 7. Catálogo de errores

Cuerpo de error: `{ error: <código> }` en la mayoría; los de validación agregan `issues`; `policy_change_failed` agrega `message`. El cliente muestra el texto de `lib/user-facing-error.ts` indexado por `error` cuando existe.

| Código | HTTP | Endpoint | Cuándo |
|---|---|---|---|
| `unauthenticated` | 401 | todos | Sin contexto activo |
| `forbidden` | 403 | todos | No es `org_admin` o no hay organización |
| `feature_disabled` | 403 | política | Feature `security_assessments` apagado |
| `not_found` | 404 | inventario, madurez | La organización no tiene documento de configuración |
| `settings_not_found` | 404 | política | Ídem, en el endpoint de política |
| `invalid_settings` | 400 | inventario | Valor fuera de las listas (`issues`). Sin texto en `user-facing-error.ts` |
| `invalid_maturity` | 400 | madurez | Respuestas inválidas (`issues`). Sin texto propio |
| `invalid_policy` | 400 | política | Cuerpo inválido (`issues`). Sin texto propio |
| `policy_version_unavailable` | 400 | política | Clave fuera de `RISK_POLICY_KEYS` o versión distinta de 2 |
| `policy_change_failed` | 400 | política | Cualquier excepción durante la actualización, la reconciliación o el encolado; incluye `message` del error. Sin texto propio |

Los endpoints de inventario y madurez no tienen `try/catch`: una excepción de Payload llega como 500 sin código. El de política captura todas las excepciones del bloque transaccional y las devuelve como 400 `policy_change_failed`, incluso las que no son del usuario.

## 8. Concurrencia y atomicidad

- Ajustes de inventario y madurez: un solo `payload.update`; sin lock ni transacción explícita. Dos guardados simultáneos se resuelven por orden de llegada (el último gana). El documento se lee antes (`loadSettings`) solo para obtener el id.
- Política: `assessmentPolicyEndpoint` abre una transacción si la request no traía una (`req.transactionID`), guarda, reconcilia y encola, y confirma o revierte todo junto. No usa `withTransaction` ni el lock de organización; dos cambios de política simultáneos no se serializan entre sí. Si la política pedida ya está vigente, retorna antes de abrir la transacción.
- Edición de rubro (plataforma): `withTransaction` con `organizationAdminLock`.

Puntos de enganche pendientes: `// AUDIT:` en cada escritura (inventario, madurez, política, rubro) y `// NOTIFY:` en política y rubro. AuditLog y Notification Bell **no existen aún**: son marcas, no código. Ver `SYSTEM_PROMPT.md`.

## 9. Frontend

### 9.1 Cadena

- Página: `app/portal/(protected)/administration/settings/page.tsx` (`AdminSettingsPage`). Cuelga de `administration/layout.tsx`, que muestra 404 si el contexto no es de OrgAdmin efectivo (control del cliente; el servidor aplica el suyo).
- La página tiene tres tarjetas: el formulario de inventario (`SettingsForm`, `react-hook-form` con `zodResolver(OrganizationSettingsFormSchema)`), el perfil de madurez (`MaturityProfileForm`, con `OrganizationMaturitySchema`) y la elección de política con modal de confirmación.
- Hooks: `use-organization-settings.ts`, `use-save-organization-settings.ts`, `use-save-organization-maturity.ts` y `use-update-assessment-policy.ts` (de `modules/assessments`).
- Cliente: `modules/organization-settings/service.ts` (inventario y madurez) y `modules/assessments/service.ts` (`updateAssessmentPolicy`).

La página no reenvía `asOrganization` a estos hooks: `getOrganizationSettings`, `updateOrganizationSettings` y `updateOrganizationMaturity` no reciben el parámetro. El cliente HTTP agrega `?asOrganization=` automáticamente cuando está en la URL del portal (`lib/organization-request-context.ts`; `SYSTEM_PROMPT.md`), de modo que el PlatformAdmin visitando una organización edita la configuración de esa organización.

### 9.2 Consultas y mutaciones (TanStack Query)

| Hook | Clave | Notas |
|---|---|---|
| `useOrganizationSettings()` | `['organization-settings']` (vía `useListQuery`) | Alimenta las tres tarjetas. |
| `useSaveOrganizationSettings()` | — | Invalida `['organization-settings']`; aviso "Configuración guardada"; en error, `showApiError`. |
| `useSaveOrganizationMaturity()` | — | Invalida `['organization-settings']`; aviso "Perfil de la organización guardado"; en error, `showApiError`. |
| `useUpdateAssessmentPolicy()` | — | Invalida `['organization-settings']` y `['assessments']` en éxito. No define `onError` ni aviso de éxito: la página cierra el modal en `onSuccess`. |

`useUpdateAssessmentPolicy` no invalida `risk` ni `dashboard-metrics` aunque el endpoint encole un recálculo de riesgo. Una consulta de riesgo ya cacheada se actualiza por su propio ciclo.

### 9.3 Comportamientos del formulario de inventario

- "Antigüedad": selector "Umbral sin conexión" (vacío = predeterminado de la plataforma, 72 h).
- "Instantáneas": casilla "antes de cada escaneo" (deshabilita el intervalo) e intervalo (vacío = 7 días).
- "Restaurar valores predeterminados" está deshabilitado si ya está todo en predeterminados; envía `null`/`false`/`null`.
- `persist` impide reentradas con un estado `pendingAction` y conserva los valores del formulario si el guardado falla.

## 10. Comportamientos a tener presentes

Verificados en el código; no son necesariamente defectos.

1. **Tres endpoints para una colección.** Inventario y madurez en `organizationSettings.ts`, política en `assessments.ts`, rubro en `platformOrganizations.ts`. Un comentario del encabezado de `organizationSettings.ts` dice que los endpoints están "acotados a los campos de config de Inventario" y que la política "tendrá su endpoint dedicado"; hoy el archivo también contiene el de madurez y el de política ya existe, en otro archivo.
2. **El OrgAdmin no edita el rubro.** Solo el administrador de plataforma, desde el modal de organizaciones.
3. **Guardián literal.** `loadSettings` compara `role !== 'org_admin'` en lugar de usar la matriz; no hay entrada de `organization-settings` en `permissions.ts`.
4. **Sin comprobación de organización activa** en inventario, madurez ni política. La edición del rubro sí la exige (`organization_inactive`).
5. **Esquema completo en inventario.** `PATCH /v1/organization-settings` exige los tres campos (con `null` permitido); no admite actualizaciones parciales.
6. **Intervalo guardado pero inactivo.** Con `snapshot_before_each_scan = true`, el intervalo guardado se ignora y permanece en el documento.
7. **Política repetida.** Elegir la política vigente responde 200 sin cambios (la UI ya deshabilita el botón de la política actual).
8. **`policy_change_failed` agrupa todo.** Errores de validación del catálogo, de reconciliación o de la cola se devuelven como 400 con el mensaje de la excepción.
9. **Recálculo de riesgo sin invalidación de riesgo en el cliente.** §9.2.
10. **La madurez no alimenta nada todavía.** Solo se guarda y se muestra; ningún cálculo la usa (§3.3).
11. **Último en escribir gana** en inventario y madurez (§8).
12. **`industry` sin restricción en la colección.** La lista cerrada vive en Zod (§6.3).
13. **Comentarios desactualizados.** El encabezado de `endpoints/organizationSettings.ts` menciona `/admin` y `admin/layout.tsx`; la ruta vigente es `administration`.

## 11. Cobertura de pruebas

Estado de cobertura automática; sin pruebas de extremo a extremo por ahora.

| Prueba | Cubre |
|---|---|
| `endpoints/organizationSettings.integration.test.ts` | Perfil de madurez: un Responsable recibe 403, valor inválido 400, el OrgAdmin guarda y queda registrado el autor y la fecha |
| `endpoints/audit-fixes.audit.integration.test.ts` | Cambio de política: si falla el encolado del recálculo, la política vuelve al valor anterior y se conservan los trabajos previos |
| `endpoints/organization-details.audit.integration.test.ts` | Edición de nombre y rubro (plataforma): rechazo de cuentas anónimas y de organización, limpieza de la descripción al salir de "Otro", campos inválidos o ajenos, reversión del nombre si falla el guardado de la configuración, organización inactiva |
| `domain/organizations/update-organization-details.audit.test.ts` | Organización activa y configuración existente antes de escribir; solo se escriben nombre y rubro |
| `domain/organizations/maturity.test.ts` | `maturityLevel`: tabla de niveles y ausencia de nivel con respuestas faltantes |
| `domain/organizations/createOrgWithAdmin.test.ts` | Alta de organización, incluida la configuración inicial |
| `domain/assessments/reconcileAssessmentInstance.test.ts` | Reconciliación de revisiones de activos con motivo `policy_changed` |
| `endpoints/assessments.integration.test.ts` | Reconciliación de la organización con motivo `policy_changed` |

Sin cobertura automática en el código revisado: `GET` y `PATCH /v1/organization-settings` (ajustes de inventario), los permisos del endpoint de política, y el recálculo de riesgo resultante de un cambio de política exitoso. 
