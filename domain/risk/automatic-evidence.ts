import type { Criticality } from './constants'

// Automatic controls derived from the current asset record (contracts §3).

/**
 * A.5.9 inventory readiness, single rule for Assessment results and the index lists: identified,
 * with an owner and a decided authorization. Criticality is A.5.12; an unauthorized asset is A.8.20.
 */
export const inventoryEfficacy = (identified: boolean, hasOwner: boolean, authorization: string) =>
  identified && hasOwner && authorization !== 'pending' ? 1 : null

export const classificationEfficacy = (criticality: Criticality) =>
  criticality === 'unknown' ? null : 1

export const shadowItEfficacy = (identified: boolean, authorization: string) =>
  !identified || authorization === 'pending' ? null : authorization === 'authorized' ? 1 : 0
