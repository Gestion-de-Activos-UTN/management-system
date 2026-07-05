# SIAM — Sistema de Gestión de Activos

Andamiaje inicial, basado en la arquitectura de SafeLink (multi-tenant, RBAC, risk score, inventario, documentos, audit log). Entorno actual: **solo desarrollo local**.

## Requisitos

- Docker + Docker Compose
- Node.js 22 (ver `.nvmrc`) si querés correr fuera de Docker
- pnpm (`corepack enable pnpm`)

## Levantar el proyecto localmente

1. Copiar variables de entorno:

   ```bash
   cp .env.example .env.local
   ```

   Completar `PAYLOAD_SECRET`, `AUDIT_LOG_ENCRYPTION_KEY` y credenciales de Auth0.

2. Levantar Postgres + app:

   ```bash
   docker-compose up
   ```

   La app queda disponible en `http://localhost:3000`, Postgres en `localhost:5432` (user/pass/db: `payload`).

3. Correr migraciones (dentro del contenedor `app` o localmente con `DATABASE_URL` apuntando al Postgres levantado):

   ```bash
   pnpm migrate
   ```

## Scripts

| Script | Descripción |
|---|---|
| `pnpm dev` | Next dev server (Turbopack) |
| `pnpm build` | Build de producción |
| `pnpm test` | Tests unitarios (`node --test` vía `tsx`) |
| `pnpm test:integration` | Tests de integración |
| `pnpm type-check` | `tsc --noEmit` |
| `pnpm lint` | ESLint (flat config) |
| `pnpm format` | Prettier sobre todo el repo |
| `pnpm migrate` / `migrate:create` / `migrate:status` / `migrate:fresh` | Migraciones de Payload |
| `pnpm spell-check` | cspell manual |

## Estructura

Ver `blueprint-siam.md` en la raíz del monorepo para el detalle de cada carpeta (`access/`, `collections/`, `domain/`, `endpoints/`, `services/`, `app/`, `migrations/`). Fuera de alcance para SIAM: Assessments, Heatmap, VideoTraining.

## Notas

- Sin `src/`: el código vive en la raíz, alias `@/*` apunta ahí.
- No hay configuración de producción todavía (`docker-compose.prod.yml`, Dockerfile multi-stage, CI de deploy) — se agrega cuando el proyecto pase a esa etapa.
