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

   La app queda en `http://localhost:3000`, Postgres en `localhost:5432` (user/pass/db: `payload`). El contenedor `app` ya corre `pnpm dev` solo.

3. En otra terminal, aplicar migraciones dentro del contenedor:

   ```bash
   docker compose exec app pnpm migrate
   ```

4. Bajar el stack cuando termines:

   ```bash
   docker compose down          # conserva los datos
   docker compose down -v       # borra también los volúmenes (reset total)
   ```

Ver [COMMANDS.md](./COMMANDS.md) para el resto de los comandos (tests, lint, crear migraciones, etc.) y si corren en el host o dentro del contenedor.

## Estructura

Ver `blueprint-siam.md` en la raíz del monorepo para el detalle de cada carpeta (`access/`, `collections/`, `domain/`, `endpoints/`, `services/`, `app/`, `migrations/`). Fuera de alcance para SIAM: Assessments, Heatmap, VideoTraining.

## Notas

- Sin `src/`: el código vive en la raíz, alias `@/*` apunta ahí.
- No hay configuración de producción todavía (`docker-compose.prod.yml`, Dockerfile multi-stage, CI de deploy) — se agrega cuando el proyecto pase a esa etapa.
