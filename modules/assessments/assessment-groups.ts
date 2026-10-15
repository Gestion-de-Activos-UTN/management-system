import type { AssessmentInstance } from '@/app/types/payload-types'

/** Ciclos de revisión de un mismo destino (empresa, oficina o activo), del más reciente al más antiguo. */
export type AssessmentGroup = {
  key: string
  target: string
  scope: AssessmentInstance['scope']
  cycles: AssessmentInstance[]
  manuallyEntered: boolean
}

export function groupAssessments(assessments: AssessmentInstance[]): AssessmentGroup[] {
  const groups = new Map<string, AssessmentGroup>()
  for (const item of assessments) {
    const relation =
      item.scope === 'organization'
        ? 'organization'
        : item.scope === 'office'
          ? String(item.office && typeof item.office === 'object' ? item.office.id : item.office)
          : item.manual_asset
            ? `manual:${String(
                typeof item.manual_asset === 'object' ? item.manual_asset.id : item.manual_asset
              )}`
            : String(item.asset && typeof item.asset === 'object' ? item.asset.id : item.asset)
    const key = `${item.scope}:${relation}`
    const target =
      item.scope === 'organization'
        ? item.organization && typeof item.organization === 'object'
          ? item.organization.name
          : 'Empresa'
        : item.scope === 'office'
          ? item.office && typeof item.office === 'object'
            ? item.office.name
            : 'Oficina'
          : item.manual_asset && typeof item.manual_asset === 'object'
            ? item.manual_asset.alias || 'Computadora'
            : item.asset && typeof item.asset === 'object'
              ? item.asset.alias || item.asset.hostname || item.asset.ip || 'Dispositivo'
              : 'Dispositivo'
    const group = groups.get(key) ?? {
      key,
      target,
      scope: item.scope,
      cycles: [],
      manuallyEntered: Boolean(item.manual_asset),
    }
    group.cycles.push(item)
    groups.set(key, group)
  }
  return [...groups.values()].map(group => ({
    ...group,
    cycles: group.cycles.sort(
      (left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt)
    ),
  }))
}
