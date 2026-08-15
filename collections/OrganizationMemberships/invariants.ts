// Funciones puras, testeables sin DB — los hooks del index.ts las llaman con los datos
// ya resueltos (rank del actor, rank del rol destino, conteo de otros admins activos).

export class RankEscalationError extends Error {}
export class LastActiveOrgAdminError extends Error {}

// rank: 1 = máxima autoridad. Un actor nunca puede asignar un rol de rank MENOR (más
// autoridad) que el propio. actorRank null = sin actor autenticado (bootstrap/overrideAccess),
// siempre permitido.
export function assertNoRankEscalation(actorRank: number | null, targetRank: number): void {
  if (actorRank === null) return
  if (targetRank < actorRank) {
    throw new RankEscalationError('No podés asignar un rol de mayor autoridad que el tuyo')
  }
}

// activeAdminCountAfter = cuántas memberships org_admin activas quedarían en la organización
// DESPUÉS de la operación (sin contar la que se está desactivando/borrando).
export function assertNotLastActiveOrgAdmin(activeAdminCountAfter: number): void {
  if (activeAdminCountAfter <= 0) {
    throw new LastActiveOrgAdminError('No se puede desactivar/eliminar el último OrgAdmin activo de la organización')
  }
}
