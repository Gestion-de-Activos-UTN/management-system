# Plan de correcciones: observaciones de demo-agent-main

**Fecha:** 15/10/2026
**Origen:** `revision-observaciones-demo-agent-main.md` + decisiones cerradas en conversación.
**Rama:** `fix/observaciones-demo` → PR contra `dev` (SYSTEM_PROMPT §1). Hoy el working tree está en `dev`: crear la rama antes del primer cambio.

## Decisiones cerradas que modifican SYSTEM_PROMPT (mismo PR)

| # | Regla actual (§3) | Nueva regla |
|---|---|---|
| D1 | "A boolean filter is a `Switch` … No `SegmentedControl` for filters" | Filtro con dos opciones nombradas → `SegmentedControl`; `Switch` sólo para encender/apagar una cosa. Controles binarios dentro de formularios → `SettingRow`. |
| D2 | "Detail-page summaries → `SimpleGrid` de `StatCard`s" | Toda franja de cifras usa `MetricsStrip`, también en detalles. Se elimina `StatCard`. |

Mockups de referencia: artifact "Opciones visuales de SIAM" (pestañas Toggles, Detalle de tarea, Detalle de activo, Métricas).

## Fase 1 — Navegación y mensajes (bugs lógicos)

1. **Helper único de hrefs del portal.** Hook `usePortalHref()` en `modules/auth/hooks/` (o junto a `use-tenant-context`) que agrega `?asOrganization=` cuando existe. Reemplazar los `suffix` armados a mano y los links que hoy lo pierden:
   - `modules/risk/risk.columns.tsx:54`, `modules/risk/components/RiskAlerts.tsx:30`, `modules/assets/components/RowActions.tsx:16`.
   - Columnas son funciones planas: recibir el href builder por parámetro (`riskContributionsColumns(href)`).
2. **SidebarProfile (punto 3 y 5).** `pathname === '/portal' || pathname.startsWith('/portal/')`. En portal, el link de cuenta conserva `asOrganization`; el layout portal no debe redirigir al admin visitante desde `/portal/account` (la página ya tiene el mensaje para admins).
3. **Sidebar plataforma.** "Mensajes" agrega `suffix` como los otros ítems.
4. **Mensajes del admin visitante (punto 4).** `usePortalMessages(enabled)` sólo con sesión `users` en `PortalMessagesList` y en el dashboard. En modo visita, la pestaña Mensajes muestra un estado explícito ("La bandeja es personal de cada miembro") en vez del error.

**Verificación:** integración existente de `portalMessages`; prueba manual como admin visitante: dashboard sin 403, cuenta y detalle de activo sin rebote a `/`.

## Fase 2 — Reglas globales de UI

1. **Breadcrumb (punto 6).** En `buildBreadcrumbs`: quitar el crumb actual; si queda ≤ 1 crumb, no renderizar. Test unitario colocado (`Breadcrumbs.test.ts`).
2. **Badges (punto 7).** Migrar los `<Badge>` directos con significado de estado (17 `variant="light"`) a `StatusBadge` con mapa de tonos en el `*-labels.ts` del dominio. `outline` queda sólo para contadores neutros.
3. **PageHeader.** Nueva prop `badge` junto al título. Usar en detalles de escaneo, instantánea, tarea y revisión (punto 15).
4. **Toggles (punto 21).**
   - `lib/theme.ts`: `Switch.extend` radio `xs` + transición lineal 120 ms (variante B).
   - `components/ui/SettingRow.tsx`: `Paper withBorder`, etiqueta + descripción a la izquierda, control a la derecha; en angosto el control baja a ancho completo.
   - Aplicación:

     | Lugar | Control | Valores / descripción |
     |---|---|---|
     | Tareas, filtro | E (D1) | `Activas` \| `Todas` |
     | TaskForm "Tarea global" | `SettingRow` + E | `Oficinas específicas` \| `Toda la organización`; descripción según valor |
     | PortalMessageForm "Mensaje global" | `SettingRow` + E | `Organizaciones específicas` \| `Todas las organizaciones`; descripción según valor |
     | PortalMessageForm "Mensaje activo" | `SettingRow` + B | fila propia bajo la fecha (sacar `mt="xl"`) |
     | Tabla de mensajes, "Activo" | B solo | sin cambios de estructura |

5. **Métricas (punto 19).** `MetricsStrip` en detalles de escaneo, instantánea y `PlatformDashboard`; borrar `components/ui/StatCard.tsx`.
6. **Login (punto 2).** Quitar el toast de éxito en `use-login.ts`; el error queda inline.

## Fase 3 — Riesgo

1. **Origen del activo (punto 9).** Agregar `asset_source: 'network' | 'manual' | null` a `RiskContributionDTO` (endpoint `endpoints/risk.ts`). Segunda línea en "Dónde": `Manual` / `Detectado por escáner` (+ `· sin identificar` si aplica).
2. **Tamaño de página.** Selector 10/25/50, default 25, junto a `Pagination`; `limit` viaja al endpoint (validar máximo 50 del lado servidor). Cambiar tamaño vuelve a página 1.
3. **Identificar dispositivos (punto 8).** Botón `size="sm"` en el encabezado del Alert, lista máxima de 5 + "y N más", ancho completo en móvil.

**Verificación:** test de integración del endpoint de riesgo cubre `asset_source` y `limit`.

## Fase 4 — Revisión de seguridad

1. **Lista (punto 10).** Estado abierto de "Revisiones de dispositivos" en la URL (`?devices=open`). "cycle/cycles" → "ciclo/ciclos". Quitar badges de historial; dejar "Ciclo N · fecha".
2. **Formulario (puntos 11 y 20).** Botón secundario "Volver a Revisión de seguridad" a la izquierda de Guardar/Completar. Guardar borrador: sin scroll. Completar: volver a la lista (conservando `asOrganization`, oficina y `devices=open`).
3. **Responder varias (punto 12).** Ruta `/portal/security-review/bulk` con `Stepper`; paso en URL (`?step=`). Selección y respuestas en `modules/assessments/assessments.store.ts` (Zustand + `persist` en `sessionStorage`, primer store del repo, SYSTEM_PROMPT §4). Aviso al salir con respuestas sin enviar. Selección como `DataTable` con filtros. Se mantiene el límite de 100. Borrar `BulkAssessmentModal`.

## Fase 5 — Tareas e inventario

1. **TaskDetail (punto 13) — opción B con acciones abajo.** Encabezado: título + estado. Una sola card: descripción, grilla etiqueta/valor (prioridad, inicio, vencimiento, persona asignada), referencia como fila, `Divider`, actividad en `Timeline` (los "cambios vinculados al activo" entran como eventos del timeline). Debajo de la card, la fila de acciones (`available_actions`) como hoy.
2. **AssetDetailView (punto 14) — opción C (pestañas).**
   - Encabezado: nombre + estado + acción "Identificar"; línea secundaria con IP · MAC · fabricante · visto hace X.
   - Pestañas (icono Lucide por tab, §3): `Datos de negocio` (primera: formulario + "Ayuda para la identificación") · `Red e identidad` (identidad, posición en red, observaciones, en una card con grilla etiqueta/valor) · `Puertos (n)` (tabla actual) · `Revisión de seguridad`.
   - Pestaña activa en la URL (`?tab=`), conservando `asOrganization`.

## Fase 6 — Escaneos e instantáneas

1. **Nombre editable (puntos 17 y 18).**
   - Campo `display_name` (text, máx. 80) en `ScanReports` e `InventorySnapshots`. Las colecciones siguen con `update: () => false`.
   - Endpoints `PATCH /api/v1/scan-reports/:id/name` y `PATCH /api/v1/inventory-snapshots/:id/name`: sólo escriben `display_name`; vacío → `null`.
   - Permisos: `org_admin` siempre; `office_manager` sólo en sus oficinas; admin de plataforma visitante, sólo lectura. Scoping por oficina además de RBAC (§7).
   - Comentarios `// AUDIT:` y `// TODO(audit-feature):` sobre la escritura (§2). AuditLog aún no existe.
   - Test de integración por endpoint: permisos, scoping, que no se altere otro campo.
   - UI: lápiz junto al título → `TextInput` en el lugar. Listados muestran el nombre si existe.
2. **Encabezado.** Título = `display_name` ?? "Informe de escaneo" / "Instantánea". Descripción: `15/10/2026 · 02:40 → 02:44 (4 min) · Escáner de <oficina>` con tooltip del id técnico del agente (`report.office` ya llega con `depth: 1`).
3. **Explicación de resultados (punto 16).** `SCAN_RUN_DESCRIPTION` en `scan-report-labels.ts` (tooltip sobre el badge) + línea en el detalle indicando si el escaneo actualizó el inventario. Definiciones tomadas del contrato en `scanner-prototype`.

## Fuera de alcance

- ~~**Punto 1 (lentitud):** requiere medición; no entra en este PR.~~ Resuelto aparte con **A1**: `scripts/warmup-routes.mjs` (`pnpm warmup`) corre en segundo plano al levantar el compose y compila cada sección durante el arranque. Se descartó `next build` + `next start` porque en producción `lib/platform-origin.ts` exige HTTPS y las cookies de sesión son `secure`; hacerlo sobre `http://localhost` obligaba a relajar un control de seguridad.
- Selector de tamaño en otras tablas: sólo riesgo.

## Cierre

- `pnpm type-check`, `pnpm lint`, `pnpm test`, `pnpm test:integration`.
- Nota: SYSTEM_PROMPT §8 menciona Vitest, pero `pnpm test` usa `node --test`; los tests nuevos siguen lo que el repo usa hoy.
- Actualizar `revision-observaciones-demo-agent-main.md` con los estados corregidos (3, 11, 19 → corroboradas; diagnóstico del 10).

## Estado (15/10/2026)

Fases 1–6 implementadas. `pnpm type-check`, `pnpm test` (336) y `pnpm test:audit` (58) en verde.

**Pendiente de verificar:**
- `endpoints/evidenceNames.integration.test.ts` está escrito pero no se ejecutó: requiere Postgres (`pnpm test:integration`).
- `pnpm lint` no corre: ESLint falla al cargar su configuración ("Converting circular structure to JSON"). El problema ya existía antes de estos cambios.
- Falta la prueba manual en navegador (admin visitante, pestañas del activo, flujo "Responder varias").

**Desvíos respecto del plan:**
- Origen del activo en riesgo: no hizo falta `asset_source` en el DTO. La clave del par (`asset:` / `manual:`) ya lo indica.
- Filtro de Tareas: "Sin archivar | Todas" en lugar de "Activas | Todas". "Activas" contradecía el filtro de estado (por ejemplo, Estado = Completada).
- TaskDetail no muestra "Persona asignada": `TaskDTO` no trae ese dato y agregarlo implicaba tocar el endpoint.
- "Responder varias": alcance y selección persisten en `sessionStorage` (Zustand). Las respuestas del cuestionario no se guardan; la página avisa con `beforeunload` antes de cerrar o recargar en el paso final. Una navegación interna de Next (clic en el sidebar) no dispara ese aviso.
- `MetricsStrip` ganó un campo opcional `description`, para no perder el detalle que mostraba `PlatformDashboard`.
- El detalle de activo ya no tiene chips de servicios ni el modal de puertos: la tabla vive en la pestaña "Puertos".

## Segunda ronda (15/10/2026)

Observaciones de la revisión en navegador, todas implementadas. `pnpm type-check`, `pnpm test` (344) y `pnpm test:audit` (58) en verde.

| # | Cambio |
|---|---|
| 1 | `lib/text-rules.ts`: `personName`, `label`, `title`, `free` aplicadas en todos los schemas con texto escrito por el usuario (regla nueva en SYSTEM_PROMPT §5). No se bloquea el tipeo: el error aparece mientras se escribe (`mode: 'onChange'` o `textRuleError` en los formularios que validan al guardar). |
| 2 | "Exposición no determinada": todos los dispositivos en una línea separados por `;`, botón abajo a la izquierda. |
| 3 | "Qué necesita atención": al cambiar de página la vista vuelve al inicio de la tabla. El servidor ordena toda la evaluación y después pagina (`sort`/`direction` en `/v1/risk/latest`, `domain/risk/sort-contributions.ts` con desempate fijo). Columnas renombradas a **Control** y **Activo**. Orden y paginación en memoria: límite anotado en `endpoints/risk.ts`. |
| 4 | Revisión de seguridad: dos secciones apiladas, sin plegado ni pestañas. "Empresa y oficinas" como lista; "Dispositivos" en `DataTable` (`getDeviceReviewColumns`) con buscador. Volver desde la revisión de un dispositivo baja a esa sección (`#dispositivos`). |
| 5 | Responder varias: paso 1 a todo el ancho (campos en una fila); "Volver a la selección" en el pie del cuestionario junto a "Completar revisiones". |
| 6 | Actividad de la tarea: se mantiene descendente (lo último arriba). |
| 7 | Liberar una tarea suma el paso "Liberada": campo server-only `claim_history` (reclamos y liberaciones). La actividad tiene scroll propio (máx. 360 px). |
| 8 | Detalle de activo: dos pestañas, "Datos y revisión" (ayuda de identificación → revisión de seguridad → datos de negocio) y "Red y puertos (n)". Fundido de 180 ms al cambiar de pestaña (regla global `.mantine-Tabs-panel`). |
| 9 | Escaneos e instantáneas: con nombre, la fecha va al lado en gris y más chica (`DateTimeCell title`); lápiz en Acciones abre `RenameAction`; el campo del título valida y alinea con el encabezado. |

**Pendiente de verificar:** `pnpm test:integration` y `pnpm test:audit:integration` (requieren Postgres; se agregaron casos de `sort` inválido y de liberar/re-reclamar). Prueba manual en navegador.

**Fuera de alcance:** reasignar o replanificar una tarea también corta el reclamo, pero todavía no aparece en la actividad.
