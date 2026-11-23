#!/usr/bin/env bash
# Llaveros del AuditLog para una corrida de CI (decisión G3, PLAN-AUDITLOG F1b): dos claves
# nuevas de 32 bytes (openssl, CSPRNG) en cada corrida, sin secrets guardados en el repo ni en
# GitHub. Payload no termina de iniciar sin llaveros válidos (domain/audit/runtime-keys.ts).
#
# Cada clave se enmascara (::add-mask::) antes de escribirla en $GITHUB_ENV, así no aparece en
# los logs del job. Los ids usan el prefijo ci- (no dev-): valen también con NODE_ENV=production.
# Uso, solo en GitHub Actions: `bash scripts/ci-audit-keys.sh`.
set -euo pipefail

: "${GITHUB_ENV:?solo corre en GitHub Actions (falta GITHUB_ENV)}"
: "${GITHUB_RUN_ID:?falta GITHUB_RUN_ID}"

hmac=$(openssl rand -base64 32)
network=$(openssl rand -base64 32)
echo "::add-mask::${hmac}"
echo "::add-mask::${network}"

id="ci-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT:-1}"
{
  echo "AUDIT_HMAC_KEYS=${id}-h:${hmac}"
  echo "AUDIT_HMAC_ACTIVE_KEY_ID=${id}-h"
  echo "AUDIT_NETWORK_KEYS=${id}-n:${network}"
  echo "AUDIT_NETWORK_ACTIVE_KEY_ID=${id}-n"
} >>"${GITHUB_ENV}"

echo "Llaveros del AuditLog generados para esta corrida (ids ${id}-h y ${id}-n)." >&2
