#!/usr/bin/env bash
# Corre las suites *.audit.integration.test.ts (Vitest), cada una contra su propia base vacía.
#
# Cada suite tiene en su beforeAll una guarda que exige un usuario, un puerto y un prefijo de
# base propios (tabla SUITES, abajo). Por eso `pnpm test:audit:integration` con una sola
# DATABASE_URL no alcanza para la corrida completa: este script crea una base nueva por suite
# y corre esa suite sola. No modifica las guardas.
#
# Requisitos: un PostgreSQL DESECHABLE en 127.0.0.1 que escuche en 55443, 55447 y 55448, en
# modo trust (las URLs de las guardas no llevan contraseña), con un superusuario para crear
# roles y bases (AUDIT_PG_ADMIN, por defecto postgres). Los roles siam_audit y siam_test se
# crean acá si no existen. Cómo levantarlo en local: COMMANDS.md, "Regresiones de la auditoría".
#
# Uso:
#   scripts/audit-integration-all.sh                       # las suites principales
#   scripts/audit-integration-all.sh --with-remaining      # también remaining-corroboration
#   scripts/audit-integration-all.sh bulk-scope crud-lifecycle   # solo esas
set -uo pipefail
cd "$(dirname "$0")/.."

ADMIN=${AUDIT_PG_ADMIN:-postgres}
HOST=127.0.0.1 # las guardas solo aceptan 127.0.0.1

# suite | usuario | puerto | prefijo de la base (el sufijo aleatorio lo agrega el script)
# security-policy va primero: verifica el seed sobre una base recién creada (como el
# AuditSequencer de vitest.audit.config.ts).
SUITES=(
  "security-policy|siam_audit|55443|siam_audit_security_"
  "audit-fixes|siam_audit|55443|siam_audit_security_"
  "concurrent-quotas|siam_audit|55443|siam_quotas_"
  "permissions-matrix|siam_audit|55443|siam_permissions_"
  "platform-onboarding|siam_audit|55443|siam_onboarding_"
  "agent-exposure|siam_audit|55443|siam_scope_agents_"
  "batches-contract|siam_audit|55443|siam_scope_batches_"
  "bulk-scope|siam_audit|55443|siam_scope_bulk_"
  "crud-lifecycle|siam_audit|55443|siam_scope_crud_"
  "evidence-contract|siam_audit|55443|siam_scope_evidence_"
  "inactive-organization-writes|siam_audit|55443|siam_scope_inactive_"
  "incidents-lifecycle|siam_audit|55443|siam_scope_incidents_"
  "manual-scope|siam_audit|55443|siam_scope_manual_"
  "messages-receipts|siam_audit|55443|siam_scope_receipts_"
  "messages-scope|siam_audit|55443|siam_scope_messages_"
  "offices-lifecycle|siam_audit|55443|siam_scope_offices_"
  "profiles-contract|siam_audit|55443|siam_scope_profiles_"
  "review-findings|siam_audit|55443|siam_scope_findings_"
  "settings-contract|siam_audit|55443|siam_scope_settings_"
  "snapshots-contract|siam_audit|55443|siam_scope_snapshots_"
  "task-operations|siam_audit|55443|siam_scope_operations_"
  "validity-contract|siam_audit|55443|siam_scope_validity_"
  "member-manager-status|siam_test|55447|siam_member_status_"
  "organization-details|siam_test|55447|siam_org_details_"
  "assigned-office-risk|siam_test|55447|siam_risk_scope_checks_"
  "manual-assessment-categories|siam_test|55447|siam_manual_reviews_checks_"
  "task-assignment-regressions|siam_test|55448|siam_task_checks_"
)
# Se corre solo con --with-remaining (o nombrándola): necesita SIAM_AUDIT_REMAINING=1 y su
# guarda admite solo letras en el sufijo.
REMAINING="remaining-corroboration|siam_audit|55443|siam_audit_security_remaining_"

fail() { echo "ERROR: $*" >&2; exit 2; }

command -v psql > /dev/null || fail "falta psql (cliente de PostgreSQL): en Arch, pacman -S postgresql-libs; en Debian/Ubuntu, apt install postgresql-client"
[ -n "${PAYLOAD_SECRET:-}" ] || fail "falta PAYLOAD_SECRET (cualquier valor sirve: solo firma sesiones de bases descartables)"

# 1. Toda suite del repo tiene que estar en la tabla (y al revés): una suite nueva no puede
#    quedar afuera del CI sin que nadie lo note.
known=$(printf '%s\n' "${SUITES[@]}" "$REMAINING" | cut -d'|' -f1 | sort)
found=$(find . -name '*.audit.integration.test.ts' -not -path './node_modules/*' -not -path './.next/*' \
  -exec basename {} .audit.integration.test.ts \; | sort)
missing=$(comm -13 <(echo "$known") <(echo "$found"))
stale=$(comm -23 <(echo "$known") <(echo "$found"))
[ -z "$missing" ] || fail "suites sin registrar en SUITES (agregar usuario, puerto y prefijo según su guarda en beforeAll): $(echo $missing)"
[ -z "$stale" ] || fail "suites registradas que ya no existen (sacarlas de SUITES): $(echo $stale)"
for f in $(find . -name '*.audit.integration.test.ts' -not -path './node_modules/*' -not -path './.next/*'); do
  [ "$(dirname "$f")" = ./endpoints ] || fail "$f no está en endpoints/: ajustar la ruta en este script"
done

# 2. Qué se corre.
selected=()
if [ $# -eq 0 ]; then
  selected=("${SUITES[@]}")
elif [ "$*" = --with-remaining ]; then
  selected=("${SUITES[@]}" "$REMAINING")
else
  for name in "$@"; do
    row=$(printf '%s\n' "${SUITES[@]}" "$REMAINING" | grep "^$name|") || fail "suite desconocida: $name"
    selected+=("$row")
  done
fi

psql_admin() { psql -X -q -v ON_ERROR_STOP=1 -h "$HOST" -p "$1" -U "$ADMIN" -d postgres -c "$2"; }

# 3. Roles de las guardas (los tres puertos apuntan al mismo servidor).
psql_admin 55443 "DO \$\$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'siam_audit') THEN CREATE ROLE siam_audit LOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'siam_test') THEN CREATE ROLE siam_test LOGIN; END IF;
END \$\$;" || fail "no se pudo conectar a $ADMIN@$HOST:55443 (¿está levantado el Postgres desechable?)"

# 4. Una base vacía nueva por suite y la suite sola contra ella.
results=()
failed=0
total_start=$(date +%s)
for row in "${selected[@]}"; do
  IFS='|' read -r suite user port prefix <<< "$row"
  extra=()
  if [ "$suite" = remaining-corroboration ]; then
    suffix=$(LC_ALL=C tr -dc 'a-z' < /dev/urandom | head -c 8)
    extra=(SIAM_AUDIT_REMAINING=1)
  else
    suffix=$(od -An -N4 -tx1 /dev/urandom | tr -d ' \n')
  fi
  db="$prefix$suffix"
  [ -n "${GITHUB_ACTIONS:-}" ] && echo "::group::$suite ($db)" || echo "=== $suite ($db)"
  start=$(date +%s)
  if psql_admin "$port" "CREATE DATABASE \"$db\" OWNER $user" &&
    env "${extra[@]}" SIAM_AUDIT_INTEGRATION=1 DATABASE_URL="postgresql://$user@$HOST:$port/$db" \
      pnpm exec vitest run --config vitest.audit.config.ts "endpoints/$suite.audit.integration.test.ts"; then
    status=OK
  else
    status=FALLÓ
    failed=$((failed + 1))
  fi
  [ -n "${GITHUB_ACTIONS:-}" ] && echo "::endgroup::"
  results+=("$(printf '%-30s %-6s %4ss' "$suite" "$status" $(($(date +%s) - start)))")
  [ "$status" = OK ] || { [ -n "${GITHUB_ACTIONS:-}" ] && echo "::error::Falló la suite $suite"; }
done

echo
echo "Resumen (cada suite con su propia base):"
printf '  %s\n' "${results[@]}"
echo "  Total: ${#selected[@]} suites, $failed con fallos, $(($(date +%s) - total_start))s"
[ "$failed" -eq 0 ]
