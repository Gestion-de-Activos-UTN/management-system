# Comandos — SIAM

Referencia rápida de todos los comandos del proyecto: qué hacen y dónde correrlos (host o dentro del contenedor `app`).

Convención: `docker compose exec app <cmd>` corre el comando dentro del contenedor ya levantado (usa su `node_modules` y red hacia Postgres). Si no tenés el stack levantado, `pnpm <cmd>` en el host funciona igual siempre que `DATABASE_URL` en `.env.local` sea alcanzable desde tu máquina (ej. `localhost:5432` en vez de `postgres:5432`).

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

| Comando | Dónde | Qué hace |
|---|---|---|
| `pnpm dev` | Host o `docker compose exec app pnpm dev` | Next dev server (Turbopack). Si usás `docker compose up`, ya corre automáticamente como comando del contenedor. |
| `pnpm build` | Host | Build de producción de Next |
| `pnpm lint` | Host | ESLint |
| `pnpm format` | Host | Prettier sobre todo el repo |
| `pnpm type-check` | Host | `tsc --noEmit` |
| `pnpm spell-check` | Host | cspell manual (no corre en CI) |

## Tests

| Comando | Dónde | Qué hace |
|---|---|---|
| `pnpm test` | Host | Tests unitarios (`node --test` vía `tsx`) |
| `pnpm test:integration` | Host, requiere Postgres accesible (`docker compose up postgres`) | Tests de integración contra DB real |

## Migraciones

Requieren `DATABASE_URL` accesible. Correrlas dentro del contenedor evita configurar una conexión extra desde el host.

| Comando | Dónde | Qué hace |
|---|---|---|
| `docker compose exec app pnpm migrate` | Contenedor | Aplica migraciones pendientes |
| `docker compose exec app pnpm migrate:create` | Contenedor | Genera una nueva migración a partir de cambios en el schema |
| `docker compose exec app pnpm migrate:status` | Contenedor | Lista migraciones aplicadas/pendientes |
| `docker compose exec app pnpm migrate:fresh` | Contenedor | Dropea y recrea el schema, reaplica todas las migraciones (destructivo) |

Alternativa sin Docker: levantar solo Postgres (`docker compose up postgres`) y correr `pnpm migrate` en el host con `DATABASE_URL=postgresql://payload:payload@localhost:5432/payloadcms`.

## Git hooks

| Comando | Dónde | Qué hace |
|---|---|---|
| `pnpm prepare` | Host | Instala hooks de Husky (se corre solo, vía `pnpm install`) |

Pre-commit (`lint-staged`) corre `prettier --write` sobre los archivos staged automáticamente, no se invoca a mano.
