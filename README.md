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

   La app queda en `http://localhost:3001`, Postgres en `localhost:5433` (user/pass/db: `payload`). El contenedor `app` ya corre `pnpm seed:navigation && pnpm seed:agent && pnpm dev` solo — sin migraciones: el deploy de este proyecto recrea imagen y DB desde cero, así que Payload sincroniza el schema directo contra Postgres en cada arranque (dev-only, requiere `NODE_ENV=development`).

3. Bajar el stack cuando termines:

   ```bash
   docker compose down          # conserva los datos
   docker compose down -v       # borra también los volúmenes (reset total)
   ```

Ver [COMMANDS.md](./COMMANDS.md) para el resto de los comandos (tests, lint, seed, contratos, etc.) y si corren en el host o dentro del contenedor.

## Login del frontend (Admin Portal / Portal de Organización)

`docker compose up` corre `pnpm seed:navigation` en el arranque (además de `seed:agent`), que siembra los 4 `Roles` base y un usuario de demo por rol — email/password fijos a propósito (seed de navegación, no producción), idempotente (si `Org Demo Navegación` ya existe, no recrea nada):

```bash
docker compose logs app | grep -A3 "Credenciales de navegación"
```

Un único login (`http://localhost:3001/login`) para los dos portales — prueba `admins` y, si falla, `users`; el que responda decide a dónde redirige:

| Rol | Portal | Ve "Administración" |
|---|---|---|
| `platform_admin` | Platform Admin (`/`) | — |
| `org_admin` | Organización (`/portal`) | Sí |
| `org_viewer` | Organización (`/portal`) | No |
| `office_manager` | Organización (`/portal`) | No |

## Ingesta Scanner ↔ Platform

El canal HTTP real (no el mock) ya está andando: `POST /api/v1/reports`, `POST /api/v1/heartbeat`, `GET /api/v1/vendor`, servidos por Payload vía el catch-all de Next en [app/(payload)/api/[...slug]/route.ts](<app/(payload)/api/[...slug]/route.ts>) — sin ese archivo, cualquier request a `/api/*` cae en el 404 de Next, Payload nunca la recibe.

Auth por token único por Agent (no por oficina): `docker compose up` corre `pnpm seed:agent` en el arranque, que crea (si no existe) una Organization/Office/Agent demo (`agent-001`). El `docker-compose.yml` incluido setea `DEMO_AGENT_API_KEY` con un token fijo de desarrollo (nunca un secreto real) — con eso, `scanner-prototype/run_agent.sh` apunta directo a este stack sin copiar nada de los logs. Sin esa env var, `seed:agent` genera un token random e imprime el texto plano una sola vez:

```bash
docker compose logs app | grep "API key"
```

Con el token (fijo o del log), ejemplo real de ingesta:

```bash
curl -X POST http://localhost:3001/api/v1/reports \
  -H "Authorization: Bearer <token-del-seed>" \
  -H "X-Agent-ID: agent-001" \
  -H "Content-Type: application/json" \
  -d '{"report_id":"test-1","agent_id":"agent-001","network":"192.168.0.0/24","scan_start":"2026-01-01T00:00:00Z","scan_end":"2026-01-01T00:01:00Z","hosts_up":1,"assets":[{"asset_id":"a-1","agent_id":"agent-001","ip":"192.168.0.1","mac":"AA:BB:CC:DD:EE:FF","vendor":"","hostname":"","os":null,"services":[],"scan_time":"2026-01-01T00:01:00Z"}]}'
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

## Estructura

Ver `blueprint-siam.md` en la raíz del monorepo para el detalle de cada carpeta (`access/`, `collections/`, `domain/`, `endpoints/`, `services/`, `app/`). Sin `migrations/`: no se usan migraciones en este proyecto (ver sección "Levantar el proyecto"). Fuera de alcance para SIAM: Assessments, Heatmap, VideoTraining.

## Notas

- Sin `src/`: el código vive en la raíz, alias `@/*` apunta ahí.
- No hay configuración de producción todavía (`docker-compose.prod.yml`, Dockerfile multi-stage, CI de deploy) — se agrega cuando el proyecto pase a esa etapa.
