# SIAM — Sistema de Gestión de Activos

Andamiaje inicial, basado en la arquitectura de SafeLink (multi-tenant, RBAC, risk score, inventario, documentos, audit log). Entorno actual: **solo desarrollo local**.

## Requisitos

- Docker Engine con el plugin Compose v2 (comando `docker compose`)
- Node.js 22 (ver `.nvmrc`) y pnpm, solo si querés correr algo fuera de Docker
- pnpm (`corepack enable pnpm`)

## Levantar el proyecto

1. Variables de entorno:

   ```bash
   cp .env.example .env.local
   ```

   Completar `PAYLOAD_SECRET`, `AUDIT_LOG_ENCRYPTION_KEY` y credenciales de Auth0.

2. Levantar Postgres + app:

   ```bash
   docker compose up
   ```

La app queda en `http://localhost:3001`, Postgres en `localhost:5433` (user/pass/db: `payload`). El contenedor `app` ya corre `pnpm seed:navigation && pnpm seed:demo && pnpm dev` solo — sin migraciones: el deploy de este proyecto recrea imagen y DB desde cero, así que Payload sincroniza el schema directo contra Postgres en cada arranque (dev-only, requiere `NODE_ENV=development`). La segunda semilla completa el escenario funcional con agentes, escaneos, inventario, revisiones, riesgo, snapshots y tareas. Es idempotente y no reemplaza cambios realizados después desde el frontend.

3. Bajar el stack cuando termines:

   ```bash
   docker compose down          # conserva los datos
   docker compose down -v       # borra también los volúmenes (reset total)
   ```

Ver [COMMANDS.md](./COMMANDS.md) para el resto de los comandos (tests, lint, seed, contratos, etc.) y si corren en el host o dentro del contenedor.

Los scripts de seed no ejecutan ni recuperan jobs: pueden encolar recálculos, pero el único worker
es el proceso de aplicación. Tampoco generan archivos de tipos/import maps y cierran sus conexiones
al terminar. La repetición se corroboró con conteos estables y un alias de activo de red editado;
la identidad de tareas/activos manuales ante renombrados necesita una verificación adicional.

### Integridad de transacciones y jobs

Payload y sus adaptadores están fijados en 3.86.0. pnpm aplica un parche reproducible a
`@payloadcms/drizzle` para propagar fallos de COMMIT y a `payload` para validar/serializar login
antes de escribir sesiones; tanto la instalación local como Docker
necesitan la carpeta `patches/`. No eliminar el parche al actualizar sin repetir las regresiones.

Las mutaciones cubiertas de activos y assessments guardan el job de recálculo en la misma
transacción. La vista de riesgo muestra recálculo pendiente/en curso o fallo, conservando el
último score disponible. Los jobs de riesgo tienen reintentos; los barridos actuales siguen activos.

La recuperación al arrancar libera jobs abandonados de `risk` y `maintenance`. Supone **un único
worker**. Si varios procesos comparten la base, establecer `SIAM_JOB_RECOVERY_ON_START=0` y
añadir leases antes de activar recuperación compartida. La opción no implementa leases.

## Login del frontend (Admin Portal / Portal de Organización)

`docker compose up` corre las semillas de navegación y datos funcionales en el arranque. La primera siembra los 4 `Roles` base y un usuario de demo por rol; la segunda agrega un escenario integral realista. Los email/password son fijos a propósito (demo, no producción):

```bash
docker compose logs app | grep -A3 "Credenciales de navegación"
```

Un único login (`http://localhost:3001/login`) para los dos portales — prueba `admins` y, si falla, `users`; el que responda decide a dónde redirige:

No se bloquea una cuenta por intentos incorrectos. Ambas colecciones comparten un presupuesto
de login en memoria (120 intentos de capacidad, reposición de dos por segundo); al excederlo,
HTTP 429 y `Retry-After: 1`. Los contadores se reinician con el proceso. Por defecto no se confían
headers de IP del cliente. `SIAM_TRUST_LOGIN_PROXY=1` requiere un proxy que reemplace `x-real-ip`.
Desactivar Users/Admins revoca todas sus sesiones; reactivar exige volver a iniciar sesión.

| Rol              | Portal                   | Ve "Administración" |
| ---------------- | ------------------------ | ------------------- |
| `platform_admin` | Platform Admin (`/`)     | —                   |
| `org_admin`      | Organización (`/portal`) | Sí                  |
| `org_viewer`     | Organización (`/portal`) | No                  |
| `office_manager` | Organización (`/portal`) | No                  |

## Ingesta Scanner ↔ Platform

El canal HTTP real (no el mock) ya está andando: `POST /api/v1/reports`, `POST /api/v1/heartbeat`, `GET /api/v1/vendor`, servidos por Payload vía el catch-all de Next en [app/(payload)/api/[...slug]/route.ts](<app/(payload)/api/[...slug]/route.ts>) — sin ese archivo, cualquier request a `/api/*` cae en el 404 de Next, Payload nunca la recibe.

Auth por token único por Agent (no por oficina): en el uso normal se aprovisiona desde `Administration > Offices > Install scanner`. El endpoint genera el token, lo guarda hasheado y descarga el paquete preconfigurado. El seed crea dos agentes exclusivos de demostración, uno por oficina.

`pnpm seed:demo` completa una demo compacta con 21 activos de red, 18 manuales y 22 tareas. Incluye reasignación tras un traslado, cancelación por retiro, conflicto de ubicación y referencias a inventario/riesgo con evidencia de origen. Repetirlo conserva los datos existentes. `SIAM_SEED_PROFILE=standard pnpm seed:demo` selecciona el escenario base de 9 activos de red, 10 manuales y 6 tareas; no elimina los ejemplos ya creados.

```bash
docker compose logs app | grep "API key"
```

Ejemplo de ingesta manual para diagnóstico usando un agente ya aprovisionado:

```bash
curl -X POST http://localhost:3001/api/v1/reports \
  -H "Authorization: Bearer <token-del-seed>" \
  -H "X-Agent-ID: <agent-id-del-zip>" \
  -H "Content-Type: application/json" \
  -d '{"report_id":"test-1","agent_id":"<agent-id-del-zip>","network":"192.168.0.0/24","scan_start":"2026-01-01T00:00:00Z","scan_end":"2026-01-01T00:01:00Z","hosts_up":1,"assets":[]}'
```

Contrato compartido con `scanner-prototype` (Zod → JSON Schema → Pydantic): ver [COMMANDS.md](./COMMANDS.md#contratos-scanner-platform).

## Inventario

En el portal de organización (`/portal/inventory`, roles `org_admin`/`office_manager`/`org_viewer`):

- **Network** — `Assets` descubiertos por el escáner. Bloque técnico (ip/mac/os/services) siempre
  de solo lectura; `org_admin`/`office_manager` pueden editar el bloque de negocio (alias,
  criticality, owner, location, status) desde el detalle de cada activo.
- **Other Assets** — `NonNetworkAssets` cargados a mano (licencias, backups, antivirus/EDR,
  activos en la nube). Incluye workflow de revisión (`next_review_at`/`review_status`, badge
  "Review Overdue") con confirmación vía `PATCH /v1/non-network-assets/:id/review`.
- **Snapshot History** (sub-sección de Inventory en el sidebar) — fotografías inmutables del
  inventario con el risk score del momento (`InventorySnapshots`), generadas a mano desde la UI
  (`POST /v1/inventory-snapshots/generate`, requiere una oficina seleccionada en la barra superior).

**Job de aging (RF-37/38)** — pasa `Assets` de `active` a `offline` según `last_seen` vs. un umbral
configurable por organización. **Sin scheduler cableado todavía** (decisión explícita, pendiente de
la infra de deploy real) — se dispara a mano contra un endpoint interno con token de servicio:

```bash
curl -X POST http://localhost:3001/api/v1/internal/jobs/aging-sweep \
  -H "Authorization: Bearer <INTERNAL_JOBS_TOKEN>"
```

`INTERNAL_JOBS_TOKEN` no viene seteada en `docker-compose.yml` por default — agregarla ahí para
poder probar este endpoint localmente.

**Retención de reportes crudos (Fase 4)** — el cuerpo completo de cada `ScanReport` se conserva
30 días. Payload agenda diariamente la tarea local `expire-raw-scan-payloads` y la ejecuta desde
la cola `maintenance`; se elimina `raw_payload`, manteniendo el resumen y la cobertura
del reporte. También caducan salidas crudas de scripts en activos y snapshots a los 30 días
desde su observación (`last_seen`), preservando inventario normalizado y score histórico.
El mismo proceso puede dispararse manualmente con
`POST /api/v1/internal/jobs/expire-scan-payloads` y `INTERNAL_JOBS_TOKEN`. No requiere un scheduler
ni almacenamiento externos.

El permiso `scan-reports.read_technical` habilita el payload completo y salidas de scripts para
OrgAdmin y OfficeManager dentro de sus ámbitos. PlatformAdmin requiere seleccionar organización
para ver esos campos. OrgViewer conserva resumen e inventario; la API también redacta los scripts
incluidos en el JSON de snapshots. Una nueva snapshot no renueva el vencimiento de una salida
cruda anterior. La limpieza usa el cron diario existente; no se añade otro scheduler.

## Security Review y Risk Score

`/portal/security-review` reúne ciclos por organización, oficina, workstation confirmada y
computadora activa cargada manualmente. Las
preguntas usan lenguaje cotidiano; puertos y servicios se evalúan automáticamente mediante la
Línea Base Segura y aparecen separados como observaciones técnicas.

- Política **Essential v1**: respuestas manuales por 365 días, salvo prueba de recuperación
  (180 días).
- Política **Reinforced v1**: respuestas manuales por 180 días.
- Evidencia técnica: 30 días.
- Los activos de red y los cargados manualmente pueden excluirse del Security Review y del Risk
  Score sin retirarlos del inventario. La exclusión exige un motivo y un vencimiento futuro de
  hasta 90 días; el escáner continúa actualizando la evidencia técnica del activo.
- Un activo no autorizado también puede excluirse, pero la interfaz advierte que hacerlo oculta un
  hallazgo de seguridad del Risk Score. Los activos existentes y nuevos están incluidos por default.
- Una respuesta ausente, desconocida o vencida es `not_evaluable`: baja la cobertura y nunca
  incrementa el Risk Score.
- Los ciclos completados conservan historial. Una nueva versión sólo nace desde la última y copia
  respuestas compatibles como borrador para su reconfirmación.
- Cambiar alias, owner, criticidad o frecuencia del activo no crea versiones. Al moverlo de oficina,
  su historia se conserva pero los filtros lo muestran únicamente en la oficina actual.

Payload ejecuta diariamente `reconcile-expired-assessments` en la cola local `maintenance`. El
estado vencido se deriva al leer; el job sólo abre un nuevo ciclo cuando no existe uno abierto.
Los reintentos son idempotentes y no requieren infraestructura externa.

El Risk Score usa únicamente resultados vigentes `non_compliant`, ponderados por control,
severidad y criticidad. La cobertura se muestra por separado. Si no existe evidencia evaluable,
el score es “Not evaluable”, no cero. Los snapshots congelan política, ponderaciones, resultados
y cobertura utilizados.

## Estructura

Ver [`../documentation/README.md`](../documentation/README.md) para arquitectura, contratos,
inventario y Security Reviews. Sin `migrations/`: no se usan migraciones en este proyecto (ver
sección "Levantar el proyecto"). Heatmap y VideoTraining continúan fuera de alcance.

## Notas

- Sin `src/`: el código vive en la raíz, alias `@/*` apunta ahí.
- No hay configuración de producción todavía (`docker-compose.prod.yml`, Dockerfile multi-stage, CI de deploy) — se agrega cuando el proyecto pase a esa etapa.
