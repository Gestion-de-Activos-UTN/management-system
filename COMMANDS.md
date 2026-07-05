# Comandos — SIAM

Referencia rápida de todos los comandos del proyecto: qué hacen y dónde correrlos (host o dentro del contenedor `app`, con `docker compose exec app <cmd>`).

## ¿Cuándo hace falta `docker compose exec app`?

Dos motivos independientes obligan a correr algo dentro del contenedor en vez de en el host:

1. **No tenés `node_modules` en el host.** El contenedor instala dependencias en su propio filesystem (no en el bind-mount del código), así que si nunca corriste `pnpm install` localmente, `pnpm <cmd>` en el host va a fallar con "command not found" o módulos faltantes. Solución: correr `pnpm install` una vez en el host, o usar `docker compose exec app`.
2. **El comando necesita hablar con Postgres.** El hostname `postgres` del `DATABASE_URL` (`.env.local`) solo resuelve dentro de la red interna de Compose. Desde el host, esa misma conexión sería `localhost:5432`. Si corrés algo que toca la DB directo en el host, tenés que exportar un `DATABASE_URL` distinto apuntando a `localhost` — más simple: usar `docker compose exec app`, que ya tiene el `DATABASE_URL` correcto seteado como variable de entorno del contenedor.

En la práctica: comandos que **no** tocan la DB (lint, format, type-check, tests unitarios) solo dependen del motivo 1 — corren en el host sin problema si ya instalaste dependencias ahí. Comandos que **sí** tocan la DB (migraciones, tests de integración) dependen también del motivo 2 — por eso se recomienda siempre `docker compose exec app` para esos, salvo que reconfigures `DATABASE_URL` a mano.

## Docker (ciclo de vida del stack)

Se corren siempre en el **host**, desde la raíz del proyecto.

| Comando | Qué hace |
|---|---|
| `docker compose up` | Levanta Postgres + app (logs en foreground) |
| `docker compose up -d` | Igual, en background |
| `docker compose down` | Baja los contenedores, conserva los volúmenes (datos de Postgres, uploads) |
| `docker compose down -v` | Baja los contenedores **y borra los volúmenes** — reset total de la base de datos |
| `docker compose logs -f app` | Sigue los logs de la app |
| `docker compose exec app sh` | Shell dentro del contenedor de la app |

## Desarrollo

No tocan la DB — alcanza con tener `node_modules` en algún lado (host si corriste `pnpm install`, o el contenedor).

| Comando | Dónde | Qué hace |
|---|---|---|
| `pnpm dev` | No hace falta correrlo manual: `docker compose up` ya lo ejecuta dentro del contenedor. Si preferís correrlo en el host, necesitás `pnpm install` local. | Next dev server (Turbopack) |
| `pnpm build` | Host (con deps instaladas) | Build de producción de Next |
| `pnpm lint` | Host (con deps instaladas) | ESLint |
| `pnpm format` | Host (con deps instaladas) | Prettier sobre todo el repo |
| `pnpm type-check` | Host (con deps instaladas) | `tsc --noEmit` |
| `pnpm spell-check` | Host (con deps instaladas) | cspell manual (no corre en CI) |

## Tests

| Comando | Dónde | Qué hace |
|---|---|---|
| `pnpm test` | Host (con deps instaladas) | Tests unitarios (`node --test` vía `tsx`), no tocan la DB |
| `pnpm test:integration` | `docker compose exec app pnpm test:integration` | Toca Postgres real — necesita el `DATABASE_URL` del contenedor (motivo 2) |

## Migraciones

Requieren `DATABASE_URL` accesible. Correrlas dentro del contenedor evita configurar una conexión extra desde el host.

| Comando | Dónde | Qué hace |
|---|---|---|
| `docker compose exec app pnpm migrate` | Contenedor | Aplica migraciones pendientes |
| `docker compose exec app pnpm migrate:create -- <description>` | Contenedor | Genera una nueva migración a partir de cambios en el schema. El `--` es necesario para que `<description>` pase como argumento a `payload migrate:create` y no a `pnpm` |
| `docker compose exec app pnpm migrate:status` | Contenedor | Lista migraciones aplicadas/pendientes |
| `docker compose exec app pnpm migrate:fresh` | Contenedor | Dropea y recrea el schema, reaplica todas las migraciones (destructivo) |

Ejemplo: `docker compose exec app pnpm migrate:create -- add_inventory_items`

Alternativa sin Docker: levantar solo Postgres (`docker compose up postgres`) y correr `pnpm migrate` en el host con `DATABASE_URL=postgresql://payload:payload@localhost:5432/payloadcms`.

## Git hooks

| Comando | Dónde | Qué hace |
|---|---|---|
| `pnpm prepare` | Host | Instala hooks de Husky (se corre solo, vía `pnpm install`) |

Pre-commit (`lint-staged`) corre `prettier --write` sobre los archivos staged automáticamente, no se invoca a mano.
