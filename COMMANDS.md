# Comandos — SIAM

Referencia rápida de todos los comandos del proyecto: qué hacen y dónde correrlos (host o dentro del contenedor `app`, con `docker compose exec app <cmd>`).

## ¿Cuándo hace falta `docker compose exec app`?

Dos motivos independientes obligan a correr algo dentro del contenedor en vez de en el host:

1. **No tenés `node_modules` en el host.** El contenedor instala dependencias en su propio filesystem (no en el bind-mount del código), así que si nunca corriste `pnpm install` localmente, `pnpm <cmd>` en el host va a fallar con "command not found" o módulos faltantes. Solución: correr `pnpm install` una vez en el host, o usar `docker compose exec app`.
2. **El comando necesita hablar con Postgres.** El hostname `postgres` del `DATABASE_URL` (`.env.local`) solo resuelve dentro de la red interna de Compose. Desde el host, esa misma conexión sería `localhost:5433`. Si corrés algo que toca la DB directo en el host, tenés que exportar un `DATABASE_URL` distinto apuntando a `localhost` — más simple: usar `docker compose exec app`, que ya tiene el `DATABASE_URL` correcto seteado como variable de entorno del contenedor.

En la práctica: comandos que **no** tocan la DB (lint, format, type-check, tests unitarios) solo dependen del motivo 1 — corren en el host sin problema si ya instalaste dependencias ahí. Comandos que **sí** tocan la DB (tests de integración) dependen también del motivo 2 — por eso se recomienda siempre `docker compose exec app` para esos, salvo que reconfigures `DATABASE_URL` a mano.

## Docker (ciclo de vida del stack)

Se corren siempre en el **host**, desde la raíz del proyecto.

| Comando                      | Qué hace                                                                          |
| ---------------------------- | --------------------------------------------------------------------------------- |
| `docker compose up`          | Levanta Postgres + app (logs en foreground)                                       |
| `docker compose up -d`       | Igual, en background                                                              |
| `docker compose down`        | Baja los contenedores, conserva los volúmenes (datos de Postgres, uploads)        |
| `docker compose down -v`     | Baja los contenedores **y borra los volúmenes** — reset total de la base de datos |
| `docker compose logs -f app` | Sigue los logs de la app                                                          |
| `docker compose exec app sh` | Shell dentro del contenedor de la app                                             |

## Desarrollo

No tocan la DB — alcanza con tener `node_modules` en algún lado (host si corriste `pnpm install`, o el contenedor).

| Comando            | Dónde                                                                                                                                                    | Qué hace                       |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| `pnpm dev`         | No hace falta correrlo manual: `docker compose up` ya lo ejecuta dentro del contenedor. Si preferís correrlo en el host, necesitás `pnpm install` local. | Next dev server (Turbopack)    |
| `pnpm build`       | Host (con deps instaladas)                                                                                                                               | Build de producción de Next    |
| `pnpm lint`        | Host (con deps instaladas)                                                                                                                               | ESLint                         |
| `pnpm format`      | Host (con deps instaladas)                                                                                                                               | Prettier sobre todo el repo    |
| `pnpm type-check`  | Host (con deps instaladas)                                                                                                                               | `tsc --noEmit`                 |
| `pnpm spell-check` | Host (con deps instaladas)                                                                                                                               | cspell manual (no corre en CI) |

## Tests

| Comando                 | Dónde                                           | Qué hace                                                                  |
| ----------------------- | ----------------------------------------------- | ------------------------------------------------------------------------- |
| `pnpm test`             | Host (con deps instaladas)                      | Tests unitarios (`node --test` vía `tsx`), no tocan la DB                 |
| `pnpm test:integration` | `docker compose exec app pnpm test:integration` | Toca Postgres real — necesita el `DATABASE_URL` del contenedor (motivo 2) |

## Schema de la base

Sin migraciones: el deploy de este proyecto recrea imagen y DB desde cero cada vez, así que no hay estado incremental que preservar entre versiones. Con `NODE_ENV=development` (el `docker-compose.yml` de este repo), Payload sincroniza el schema de Postgres solo, en cada arranque de la app (`pushDevSchema`, sin comando manual).

## Provisioning de Agents

| Comando                                      | Dónde                  | Qué hace                                                                                                                      |
| -------------------------------------------- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `Administration > Offices > Install scanner` | Portal de organización | Genera el agente, vincula la oficina y descarga el ZIP preconfigurado. Es el único flujo permitido para aprovisionar agentes. |

## Seed de navegación (usuarios de demo para el frontend)

| Comando                | Dónde                                                                                                   | Qué hace                                                                                                                                                                                                                                                       |
| ---------------------- | ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm seed:navigation` | Ya corre solo en `docker compose up` (idempotente: si `Demo Organization` ya existe, repara datos demo) | Siembra los 4 `Roles` base (`platform_admin`, `org_admin`, `org_viewer`, `office_manager`) + la única organización demo completa (`domain/organizations/createOrgWithAdmin.ts`) + un `Admin`/`User` por rol, credenciales fijas (`scripts/seed-navigation.ts`) |

Credenciales fijas a propósito (demo/navegación, no producción) — recuperables en cualquier momento, a diferencia del token de Agent:

```bash
docker compose logs app | grep -A3 "Credenciales de navegación"
```

## Contratos Scanner-Platform

Pipeline Zod (fuente de verdad, `contracts/*.schema.ts`) → JSON Schema → Pydantic (`scanner-prototype/src/siam_agent/contracts.py`). Los `.schema.json` generados se commitean — `scanner-prototype` los consume sin instalar nada de npm.

| Comando                                           | Dónde                                                      | Qué hace                                                                                 |
| ------------------------------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `pnpm generate:contracts`                         | Host o contenedor (no toca la DB)                          | Zod → `contracts/generated/*.schema.json`                                                |
| `scanner-prototype/scripts/generate_contracts.sh` | Host, dentro de `scanner-prototype/`, con el venv activado | JSON Schema → `src/siam_agent/contracts.py` (requiere `pip install -e ".[dev]"` una vez) |

Correr los dos en orden después de cambiar cualquier `contracts/*.schema.ts`. Test de regresión del lado Python: `pytest tests/test_contracts.py`.

## Git hooks

| Comando        | Dónde | Qué hace                                                   |
| -------------- | ----- | ---------------------------------------------------------- |
| `pnpm prepare` | Host  | Instala hooks de Husky (se corre solo, vía `pnpm install`) |

Pre-commit (`lint-staged`) corre `prettier --write` sobre los archivos staged automáticamente, no se invoca a mano.
