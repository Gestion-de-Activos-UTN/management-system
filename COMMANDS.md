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

### Regresiones de la auditoría

`pnpm test:audit` ejecuta las pruebas unitarias nuevas con Vitest, sin base de datos.
`pnpm test:audit:integration` requiere Node >=22 y una PostgreSQL **desechable** con
una base **vacía** con URL como
`DATABASE_URL=postgresql://siam_audit@127.0.0.1:55443/siam_audit_security_run1`.
El guard exige host, puerto, usuario y prefijo de nombre aislados; no usar la base de desarrollo.
Crear otra base vacía para repetir la suite completa: la primera prueba verifica el seed desde cero.
La suite crea usuarios, activos y jobs de prueba, y también arranca otro proceso de Payload.

El lockfile aplica `patches/@payloadcms__drizzle@3.86.0.patch` y `patches/payload@3.86.0.patch`
durante la instalación. Al actualizar Payload/Drizzle, revisar ambos parches y repetir las pruebas
de commit/rollback, sesiones y concurrencia. El segundo parche cambia el orden de `beforeLogin`
para que nuestros hooks validen el estado actual antes de agregar una sesión.

## Schema de la base

Sin migraciones: el deploy de este proyecto recrea imagen y DB desde cero cada vez, así que no hay estado incremental que preservar entre versiones. Con `NODE_ENV=development` (el `docker-compose.yml` de este repo), Payload sincroniza el schema de Postgres solo, en cada arranque de la app (`pushDevSchema`, sin comando manual).

## Provisioning de Agents

| Comando                                      | Dónde                  | Qué hace                                                                                                                      |
| -------------------------------------------- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `Administration > Offices > Install scanner` | Portal de organización | Genera el agente, vincula la oficina y descarga el ZIP preconfigurado. Es el único flujo permitido para aprovisionar agentes. |

## Seed de navegación (usuarios de demo para el frontend)

| Comando                | Dónde                                                                                                   | Qué hace                                                                                                                                                                                                                                                       |
| ---------------------- | ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm seed:navigation` | Ya corre solo en `docker compose up` (idempotente: si `Demo Organization` ya existe, repara datos demo) | Siembra los 4 `Roles` base (`platform_admin`, `org_admin`, `org_viewer`, `office_manager`) + la única organización demo completa (`domain/organizations/createOrgWithAdmin.ts`) + un `Admin`/`User` por rol, credenciales fijas, y datos de Administración: oficinas con provincia/departamento (CABA y Rosario), la sucursal Córdoba (nace activa; `seed:demo` la cierra), Lucía Fernández a cargo de Córdoba y Rosario, y otra persona en incorporación, sin credenciales (`scripts/seed-navigation.ts`) |
| `pnpm seed:demo`       | Ya corre después de `seed:navigation` en `docker compose up`                                            | Demo compacta: 21 activos de red, 21 manuales y 24 tareas; incluye reasignación, retiro y conflicto de ubicación, mensajes del portal en todos sus estados (accionable, aviso por rol, enlazado a una tarea, vencido e inactivo) y el cierre de Córdoba con el flujo real: un activo movido a Rosario sin responsable, otro dado de baja, tareas liberadas y canceladas, revisiones de una oficina inactiva y Lucía desactivada. Idempotente y no destructiva. `SIAM_SEED_PROFILE=standard` selecciona el escenario base sin eliminar datos. |

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
