# API del panel general (dashboard del portal)

Referencia técnica del panel general de una organización (`/portal/dashboard`): el endpoint de métricas, la composición con datos de otros features (resumen de riesgo, tareas propias, mensajes del portal), el cálculo de cada contador y el comportamiento de la pantalla cuando una de las fuentes falla. Dirigida a quien mantiene o extiende el feature.

El panel de **plataforma** (`GET /v1/platform-admin/dashboard`, página `/` del StaffPortal) es otro feature y está documentado en `organizations-platform-api.md`.

Verificado contra el código el 2026-10-31. Si algo de este documento contradice el código, gana el código: corregir el documento.

Documentos relacionados: `risk-api.md` (resumen de riesgo `/v1/security-review/summary`, alcance por oficina y estados de recálculo), `task-api.md` (`GET /v1/tasks`, `view=mine`, `is_overdue`), `portal-messages-api.md` (bandeja `/v1/portal-messages`), `scanner-api.md` (agentes y heartbeat), `assets-api.md` (activos de red y manuales), `session-and-access.md` (contexto de tenant, oficina seleccionada, `?asOrganization=`).

## 1. Capas y archivos

| Capa | Archivo | Responsabilidad |
|---|---|---|
| Endpoint | `endpoints/dashboardMetrics.ts` | `dashboardMetricsEndpoint` y el tipo `DashboardMetrics`. Registrado en `payload.config.ts`. |
| Cliente HTTP | `modules/dashboard/service.ts` | `getDashboardMetrics`. Importa el tipo `DashboardMetrics` del endpoint. |
| Estado de servidor | `modules/dashboard/hooks/use-dashboard-metrics.ts` | `useDashboardMetrics`. |
| UI | `modules/dashboard/components/RiskOverviewCard.tsx` | Tarjeta de riesgo. |
| | `modules/dashboard/components/EvidenceCoverageStrip.tsx` | Franja de cobertura de evidencia. |
| | `modules/dashboard/components/AttentionCard.tsx` | Lista "Requiere atención". |
| | `modules/dashboard/components/ActivityTabsCard.tsx` | Tarjeta con pestañas "Mis tareas" y "Mensajes". |
| | `modules/dashboard/components/MyTasksList.tsx` | Lista de tareas abiertas y helper `openTasks`. |
| | `modules/dashboard/components/DashboardLayout.module.css` | Distribución en grilla. |
| | `components/ui/MetricsStrip.tsx` | Franja de cifras (compartida). |
| Página | `app/portal/(protected)/dashboard/page.tsx` | `PortalDashboardPage`: compone todo. |
| Fuentes ajenas | `modules/assessments/hooks/use-risk-summary.ts`, `modules/tasks/hooks/use-tasks.ts`, `modules/portal-messages/hooks/use-portal-messages.ts`, `modules/portal-messages/components/PortalMessagesList.tsx`, `modules/offices/hooks/use-concrete-office-id.ts`, `modules/offices/office-risk-scope.ts` | Datos que la página combina con las métricas. |

Cadena: `PortalDashboardPage` → `useDashboardMetrics` → `getDashboardMetrics` → `httpClient` → `dashboardMetricsEndpoint`. Las demás tarjetas no pasan por `modules/dashboard`: consumen los hooks de sus features.

El endpoint no define esquema Zod de entrada: su único parámetro es el `office_id` de la query, leído directamente de la URL.

## 2. Modelo de datos

El panel no tiene colección ni estado propio. `GET /v1/dashboard/metrics` lee con `overrideAccess: true` de `offices`, `assets`, `scan-reports`, `agents` y `non-network-assets`, y aplica el alcance por su cuenta (§3).

## 3. Permisos y alcance

### 3.1 Quién accede

`getTenantContext` resuelve el contexto; el endpoint **no** consulta la matriz de permisos (`canDo`) ni features de la suscripción. Todo rol con contexto activo y organización accede:

| Rol | Resultado |
|---|---|
| Sin sesión, o cuenta inactiva (`!ctx.isActive`) | 401 `unauthenticated` |
| PlatformAdmin sin `?asOrganization=` (sin `organizationId`) | 400 `organization_required` |
| PlatformAdmin con `?asOrganization=` | se evalúa como OrgAdmin de esa organización |
| `org_admin` | métricas sobre sus oficinas (todas las de la organización) |
| `office_manager`, `org_viewer` | métricas sobre sus oficinas asignadas |

Una `asOrganization` inexistente hace que `getTenantContext` lance `TenantResolutionError` (error 500 de Payload, sin captura en este endpoint).

### 3.2 Alcance por oficina

`ctx.officeIds` define las oficinas permitidas:

- `org_admin`: las de su membership. El hook `enforceOrgAdminOffices` mantiene en esa lista todas las oficinas de la organización, activas e inactivas.
- `office_manager` y `org_viewer`: las oficinas que tienen asignadas (pueden incluir oficinas inactivas).
- PlatformAdmin visitante: todas las oficinas de la organización (activas e inactivas), por `findOfficeIdsByOrganization`.

Parámetro `office_id` (opcional): si viene y no está en `ctx.officeIds`, 403 `office_forbidden`. Si viene y está permitido, las métricas se calculan solo sobre esa oficina; si no viene, sobre **todas** las de `ctx.officeIds`. No existe un alcance "organización" separado: los datos que no tienen oficina no entran en ninguna cifra.

Si `ctx.officeIds` (o la oficina pedida) queda vacío, o la consulta de oficinas (filtrada por organización e ids) no devuelve ninguna, el endpoint responde 200 con el objeto en cero (`EMPTY`): contadores en 0 y `last_scan_at: null`.

## 4. Contrato HTTP

| Método y ruta | Entrada | Respuesta OK |
|---|---|---|
| `GET /api/v1/dashboard/metrics` | query `office_id?` (+ `asOrganization?` para PlatformAdmin) | 200 `DashboardMetrics` |

Prefijo `/api`. El cliente envía `office_id` solo si hay una oficina seleccionada (`selectedOfficeId` distinto de `null`) y reenvía `asOrganization` también automáticamente desde la URL (`lib/organization-request-context.ts`).

### 4.1 DTO `DashboardMetrics`

```
{
  total_assets: number
  active_offices: number
  online_scanners: number
  total_scanners: number
  overdue_manual_reviews: number
  last_scan_at: string | null
}
```

### 4.2 Cálculo de cada contador

Sea `S` el conjunto de ids de oficinas resultante de §3.2, verificado contra las oficinas existentes de la organización (`limit: 1000`). Todas las consultas se hacen en paralelo.

| Campo | Cálculo |
|---|---|
| `total_assets` | `totalDocs` de `assets` con `office in S`. **Sin filtro de `status` ni de `deleted_at`**: cuenta también los activos de red `retired` y los eliminados lógicamente, y los aún no identificados. |
| `active_offices` | De las oficinas encontradas en `S`, cuántas tienen `is_active` verdadero. Con `office_id` de una oficina inactiva da 0. |
| `total_scanners` | Cantidad de `agents` con `office in S` e `is_active: true`, hasta `limit: 5000` (cuenta los documentos devueltos). Incluye agentes aprovisionados que nunca enviaron heartbeat. |
| `online_scanners` | De esos agentes, los que cumplen `isOnline(last_heartbeat_at)` (`lib/agentStatus.ts` → `isAgentOnline`): heartbeat presente, no futuro y a lo sumo `OFFLINE_THRESHOLD_SECONDS` (600 s, el doble de `HEARTBEAT_INTERVAL_SECONDS` = 300) atrás. |
| `overdue_manual_reviews` | `totalDocs` de `non-network-assets` con `office in S`, `status: 'active'` y `next_review_at < ahora`. Un activo sin `next_review_at` no cuenta. No filtra `deleted_at`. El comentario del tipo indica el mismo criterio que `review_status`. |
| `last_scan_at` | `processed_at` del `scan-reports` más reciente (`sort: '-processed_at'`) con `office in S` y `status: 'processed'`; `null` si no hay. |

El número de oficinas inactivas, agentes revocados y activos retirados no se desglosa en el DTO.

## 5. Composición de la página

`PortalDashboardPage` combina cuatro fuentes. Parámetros comunes: `asOrganization` (del query string de la URL) y la oficina.

### 5.1 Resolución de la oficina

Dos valores distintos de oficina conviven:

- **Para las métricas**: `selectedOfficeId` del store de UI (`useUiStore`), tal cual; `null` significa "todas".
- **Para riesgo y tareas**: `officeId` de `useConcreteOfficeId(asOrganization)` → `officeRiskScope(tenant, selectedOfficeId)`. Devuelve `{ officeId, requiresOfficeSelection, ready }`:
  - `officeId` = `selectedOfficeId` si está entre las oficinas del usuario; si no hay selección y el usuario tiene una sola oficina, esa oficina; en otro caso `null`.
  - `requiresOfficeSelection` = verdadero si el usuario no es org-wide, no tiene el permiso `assignedOfficeRisk`, no hay oficina concreta y tiene más de una oficina.
  - `ready` = hay contexto de tenant, no se requiere selección, y la selección (si hay) es válida.
  - Además, si la URL trae `?officeId=` (enlace profundo) y el usuario puede usarla (`all` solo si es org-wide), la sincroniza con el store.

### 5.2 Fuentes

| Fuente | Hook y clave | Parámetros | Refetch |
|---|---|---|---|
| Métricas | `useDashboardMetrics(asOrganization)`, `['dashboard-metrics', asOrganization, selectedOfficeId]` | `office_id` = `selectedOfficeId` | Sin intervalo propio |
| Riesgo | `useRiskSummary({ officeId, asOrganization, enabled: ready })`, `['assessments', 'risk-summary', asOrganization, officeId]` → `GET /v1/security-review/summary` | `office_id` = `officeId` concreto | 3 s mientras `recalculation` sea `pending`, `processing` u `outdated`; si no, 30 s |
| Tareas | `useTasks({ view: 'mine', officeId, asOrganization })`, `['tasks', params]` → `GET /v1/tasks?view=mine` | `office_id` = `officeId` concreto | 30 s |
| Mensajes | `usePortalMessages(session.collection === 'users')`, `['portal-messages', 'mine']` → `/v1/portal-messages` | — | 60 s |

El cliente TanStack reintenta una vez ante errores (`lib/query-client.ts`, `retry: 1`), así que una consulta fallida queda en `isPending` hasta agotar el reintento.

Las reglas del resumen de riesgo (alcance `organization`, `office` o `assigned_offices`, 403 `feature_disabled`, 503 `risk_unavailable`, estados de `recalculation`) están en `risk-api.md`. El DTO que consume el panel es `SecurityReviewSummary` (`modules/assessments/service.ts`): `scope?`, `recalculation?`, `risk_score`, `evaluated_percentage`, `applicable_checks`, `not_evaluable`, `requires_attention`, `excluded_assets`, `risk_band`, `unconfirmed_assets`. Las reglas de `view=mine` (reclamadas por el actor o con `assigned_user` igual al actor; sin tareas archivadas) y de `is_overdue` están en `task-api.md`. La bandeja de mensajes y su filtro `isInPortalMessageHistory` están en `portal-messages-api.md`.

Un PlatformAdmin visitante no consulta mensajes (`usePortalMessages` queda deshabilitado, porque `/v1/portal-messages` es personal de cada miembro) y la tarjeta muestra el texto "La bandeja de mensajes es personal de cada miembro de la organización."

### 5.3 Bloques y datos que usan

| Bloque | Componente | Datos |
|---|---|---|
| Riesgo | `RiskOverviewCard` (o `OfficeRiskSelectionNotice` si `requiresOfficeSelection`) | `risk.data`. Título según `scope`: `organization` "Riesgo global de la organización", `assigned_offices` "Riesgo de tus oficinas", otro "Riesgo actual". Puntaje `Math.round(risk_score)` con `%`, o `—` si es `null`. Insignia de banda (`RiskBandBadge`), o "Sin datos suficientes" (puntaje `null`) / "Preliminar" (puntaje sin banda). Si `recalculation` no es `current` ni `outdated`: insignia "Actualizando riesgo", o "No se pudo completar el cálculo" cuando es `failed`. |
| Requiere atención | `AttentionCard` | Cinco ítems (§5.4). |
| Cifras | `MetricsStrip` | `total_assets` ("activos de red"), `active_offices`, `online_scanners de total_scanners` ("escáneres en línea"), `last_scan_at` (relativo con `formatRelativeDays` y fecha con `formatDate`, o "Nunca"). |
| Cobertura | `EvidenceCoverageStrip` (no se muestra si `requiresOfficeSelection`) | `evaluated_percentage` redondeado; `applicable_checks`; evaluadas = `max(0, applicable_checks - not_evaluable)`. |
| Actividad | `ActivityTabsCard` | Pestaña "Mis tareas (n)" con `MyTasksList` y pestaña "Mensajes (n)" con `PortalMessagesList`. |

### 5.4 Ítems de "Requiere atención"

`AttentionCard` solo muestra los ítems con `count > 0`; cada uno enlaza a donde se resuelve (con `portalHref`, que conserva `asOrganization`).

| Clave | Cuenta | Origen | Enlace |
|---|---|---|---|
| `overdue-tasks` | Tareas con `is_overdue` en `useTasks(view=mine)` | tareas | `/portal/tasks` |
| `unconfirmed` | `unconfirmed_assets` | resumen de riesgo | `/portal/inventory` |
| `controls` | `requires_attention` | resumen de riesgo | `/portal/risk-score` |
| `manual-reviews` | `overdue_manual_reviews` | métricas | `/portal/inventory?tab=non-network` |
| `offline-scanners` | `total_scanners - online_scanners` | métricas | `/portal/administration/offices` |

Con la lista vacía muestra "Sin pendientes detectados". Con elementos, una insignia "n tema(s)" con la cantidad de ítems visibles. Mientras `metrics.isPending`, o el riesgo está pendiente (y no se requiere selección), o `tasks.isPending`, muestra esqueletos.

`openTasks` (usado por la pestaña y su contador) filtra las tareas cuyo `effective_status` no es `completed` ni `cancelled` y las ordena por `due_at` ascendente, con las que no tienen vencimiento al final. Cada fila enlaza al detalle y muestra "Vence" o "Venció" con la fecha relativa, o "Sin vencimiento".

## 6. Estados de error y datos parciales

El panel no tiene un estado de error global: cada fuente falla por separado.

| Fuente | Qué ocurre si falla |
|---|---|
| Métricas | `Alert` rojo "No se pudieron cargar las métricas." La franja de cifras muestra `—` en activos, oficinas y escáneres, y **"Nunca"** en el último escaneo (la rama sin dato de `last_scan_at` no distingue "sin datos" de "no cargó"). Los ítems `manual-reviews` y `offline-scanners` valen 0 y no se muestran. |
| Riesgo | Sin dato previo: `RiskOverviewCard` muestra un `Alert` rojo "No se pudo cargar el riesgo." (en lugar de un puntaje vacío); `EvidenceCoverageStrip` no se muestra, para no dibujar un 0 % falso. Los ítems `unconfirmed` y `controls` se filtran (variable `riskUnavailable`) para no contar la falla como cero. Con un dato previo en caché, el error se ignora y se sigue mostrando ese dato. Un 403 `feature_disabled` (sin `security_assessments`, o sin `risk_score` en la rama de oficinas asignadas) se trata como cualquier otro error. |
| Tareas | `tasksAvailable = !tasks.isError`. Ante cualquier error (el endpoint responde 403 `feature_disabled` si la organización no tiene `tasks`, pero la página no distingue la causa) desaparece la pestaña "Mis tareas" y su contador, la tarjeta muestra solo "Mensajes" sin pestañas, y el ítem `overdue-tasks` vale 0. |
| Mensajes | `PortalMessagesList` muestra "No se pudieron cargar los mensajes."; el contador de la pestaña queda sin número. |
| Selección de oficina requerida | No se pide riesgo (`ready` falso); se muestra `OfficeRiskSelectionNotice`; `riskSummary` queda `undefined`, de modo que `unconfirmed` y `controls` valen 0 y no se muestran. Las demás tarjetas siguen con "todas tus oficinas asignadas". |

Si las tres fuentes que alimentan "Requiere atención" fallan, la tarjeta muestra "Sin pendientes detectados".

## 7. Concurrencia y consistencia

Todas las lecturas son independientes y no transaccionales. Las cifras del endpoint se consultan en paralelo en un mismo request, pero el resumen de riesgo y las tareas son requests separados con sus propios intervalos de refetch (3 o 30 s, 30 s, 60 s), por lo que pueden reflejar momentos distintos. El resumen de riesgo acelera su refetch mientras se recalcula. No hay escrituras, transacciones ni AUDIT/NOTIFY en este feature.

## 8. Frontend

### 8.1 Cadena

- Página: `app/portal/(protected)/dashboard/page.tsx`.
- Componentes (`modules/dashboard/components/`): `RiskOverviewCard`, `EvidenceCoverageStrip`, `AttentionCard`, `ActivityTabsCard`, `MyTasksList`.
- Hook propio: `modules/dashboard/hooks/use-dashboard-metrics.ts`. La página también usa hooks de otros features: `useRiskSummary`, `useTasks`, `usePortalMessages` y `useConcreteOfficeId`.
- Cliente: `modules/dashboard/service.ts`, que usa `lib/http-client.ts` contra `/api/v1/dashboard/metrics`.

### 8.2 Consultas (TanStack Query)

Ver §5.2. Resumen de claves: `['dashboard-metrics', asOrganization, selectedOfficeId]`, `['assessments', 'risk-summary', asOrganization, officeId]`, `['tasks', params]`, `['portal-messages', 'mine']`.

### 8.3 Invalidaciones y refetch

El feature no define mutaciones. La actualización de sus datos viene de:

- `useTaskCommand`, `useCreateTasks` y `useEditTask` invalidan `['tasks']` (prefijo de la consulta del panel) y la pestaña de tareas se refresca (`task-api.md` §8).
- `usePortalMessageReceipt` invalida `['portal-messages', 'mine']` al marcar un mensaje como visto o descartado.
- Cambiar de oficina en el selector cambia `selectedOfficeId`, que forma parte de las claves de métricas y, a través de `officeId`, de riesgo y tareas: se piden de nuevo.
- Las métricas no tienen `refetchInterval`; se actualizan con el comportamiento por defecto de TanStack (montaje, foco de ventana, reconexión) y al cambiar sus claves. `useDashboardMetrics` no se invalida desde ninguna mutación.

### 8.4 Distribución

`DashboardLayout.module.css` ordena en una columna en pantallas angostas (riesgo, atención, cifras y cobertura, actividad) y, desde `lg`, deja riesgo, cifras y actividad a la izquierda y "Requiere atención" en una columna lateral.

### 8.5 Contrato de tipos

`DashboardMetrics` se importa desde `endpoints/dashboardMetrics.ts` en `service.ts` (una sola definición, compartida entre servidor y cliente). `SecurityReviewSummary` y `TaskDTO` se importan de sus módulos.

## 9. Cómo agregar un contador

1. Agregar el campo a `DashboardMetrics` y a `EMPTY` en `endpoints/dashboardMetrics.ts`.
2. Sumar la consulta al `Promise.all` usando `scopedOfficeIds` (el alcance por oficina ya está resuelto) y al objeto de respuesta (que usa `satisfies DashboardMetrics`).
3. Mostrarlo en `MetricsStrip` o como `AttentionItem` en `page.tsx`, con `portalHref` para el enlace.
4. Decidir qué se muestra si las métricas fallan: hoy una cifra ausente vale `—` o 0 según el bloque (§6).
5. Extender `endpoints/dashboardMetrics.integration.test.ts`.

## 10. Comportamientos a tener presentes

Verificados en el código; no son necesariamente defectos.

1. **`total_assets` incluye activos retirados y eliminados.** La consulta de `assets` no filtra `status` ni `deleted_at`, a diferencia de otros cálculos del sistema (por ejemplo `deactivationImpact` y `liveIn`, que excluyen `retired` y `deleted_at`). La etiqueta de la UI es "activos de red".
2. **Sin chequeo de permisos ni de features en el endpoint.** Cualquier rol con contexto y organización lo consulta; no responde 403 `feature_disabled` aunque la organización tenga apagado algún feature.
3. **Dos nociones de oficina.** Las métricas usan `selectedOfficeId` crudo (`null` = todas las oficinas del usuario), mientras que riesgo y tareas usan `officeId` concreto o `null`. Un usuario con varias oficinas y sin permiso `assignedOfficeRisk` ve métricas agregadas sobre todas sus oficinas y, en la misma pantalla, el aviso de seleccionar una oficina para el riesgo.
4. **Límites fijos.** La consulta de oficinas tiene `limit: 1000` y la de agentes `limit: 5000`; `total_scanners` cuenta los documentos devueltos, de modo que más de 5000 agentes activos en el alcance se truncan en silencio. Las oficinas de `S` por encima de 1000 quedarían fuera.
5. **Falla de métricas se ve como "Nunca".** Ver §6: el último escaneo muestra "Nunca" cuando no hay datos, tanto si la organización nunca escaneó como si la consulta falló.
6. **El error de tareas oculta la pestaña sin distinguir la causa.** Un 500 y un 403 `feature_disabled` producen el mismo resultado visual.
7. **Escáneres "sin conexión" incluye los no conectados todavía.** `total_scanners - online_scanners` cuenta también agentes `is_active` aprovisionados que nunca enviaron heartbeat.
8. **`overdue_manual_reviews` y `last_scan_at` no dependen de la política de assessment.** Se calculan solo con `next_review_at` y `processed_at`.
9. **Visitante.** Un PlatformAdmin visitante no ve mensajes, y sus "Mis tareas" dependen de cómo `view=mine` resuelve al actor administrador (`task-api.md`); no se verificó con una prueba.
10. **`asOrganization` inexistente** produce 500, no un 4xx (§3.1).

## 11. Cobertura de pruebas

Estado de cobertura automática; sin pruebas de extremo a extremo por ahora.

| Prueba | Cubre |
|---|---|
| `endpoints/dashboardMetrics.integration.test.ts` | Tres casos: 401 sin sesión; 403 si `office_id` está fuera del alcance del usuario; 200 con un escáner en línea dentro del alcance (`active_offices`, `online_scanners`, `total_scanners`, `overdue_manual_reviews`). |
| `endpoints/assigned-office-risk.audit.integration.test.ts` | Un caso verifica que el resumen del panel (`/v1/security-review/summary`) y el detalle de riesgo devuelven el mismo puntaje, cobertura y conteos. |
| `lib/portal-href.test.ts` | Armado de enlaces con `asOrganization` (usado por los ítems del panel). |
| `lib/organization-request-context.audit.test.ts` | Reenvío de `asOrganization` en los requests del cliente. |

Sin cobertura automática encontrada para: `total_assets`, `last_scan_at` y `overdue_manual_reviews` con datos; el acceso de PlatformAdmin (400 `organization_required` y visita); componentes del panel y sus estados de error; `useConcreteOfficeId` y `officeRiskScope`.
