#!/bin/sh
# Corre tests de integración (node:test contra PostgreSQL real) con la configuración única del
# repo. `pnpm test:integration` lo llama con todos los archivos; `pnpm test:integration:files
# <archivos>` con los que se le pasen (Tani, 23/11: nada de comandos armados a mano).
#
# Siempre igual: NODE_ENV=test (Payload sincroniza el schema y no lee .env.local), jobs apagados
# (PAYLOAD_DISABLE_JOBS=1; si no, los crons de Payload dejan vivo el proceso), un archivo por vez
# (--test-concurrency=1: dos archivos a la vez sincronizan el schema al mismo tiempo y se traban),
# el preload que cierra Payload al terminar cada archivo y el detector de resultados incompletos.
# Las claves del AuditLog llegan por el entorno (COMMANDS.md, "Claves del AuditLog en tests").
# POSIX sh y no bash: también corre en el contenedor (node:22-alpine).
set -eu

if [ "$#" -eq 0 ]; then
  echo "uso: pnpm test:integration:files <archivo>.integration.test.ts [...]" >&2
  exit 2
fi
for file in "$@"; do
  case "$file" in
    *.audit.integration.test.ts)
      echo "$file es de la suite de seguridad: usar pnpm test:audit:integration:all." >&2
      exit 2
      ;;
    *.integration.test.ts)
      if [ ! -f "$file" ]; then
        echo "No existe: $file" >&2
        exit 2
      fi
      ;;
    *)
      echo "No es un test de integración (*.integration.test.ts): $file" >&2
      exit 2
      ;;
  esac
done

export NODE_ENV=test
export PAYLOAD_DISABLE_JOBS=1
exec node --import tsx --import ./testing/integration-teardown.ts --test --test-concurrency=1 \
  --test-reporter=spec --test-reporter-destination=stdout \
  --test-reporter=./scripts/test-completeness-reporter.ts --test-reporter-destination=stderr \
  "$@"
