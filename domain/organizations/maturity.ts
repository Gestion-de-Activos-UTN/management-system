// Organization maturity profile (grounding-md/Diccionario-Recomendaciones-Nivel-Madurez.md).
// It only prioritizes remediation advice; it never enters the Risk Score.

export const MATURITY_IT_OWNER_VALUES = ['yes', 'no'] as const
export type MaturityItOwner = (typeof MATURITY_IT_OWNER_VALUES)[number]

export const MATURITY_BUDGET_VALUES = ['none', 'occasional', 'recurring'] as const
export type MaturityBudget = (typeof MATURITY_BUDGET_VALUES)[number]

export type MaturityLevel = 'initial' | 'managed' | 'advanced'

/**
 * Inicial = neither criterion; Avanzado = someone in charge AND a recurring budget; any other
 * combination = Gestionado. A budget without anyone to use it never reaches Avanzado.
 * `null` while either answer is missing: the assistant must ask, never assume a level.
 */
export function maturityLevel(
  itOwner: MaturityItOwner | null | undefined,
  budget: MaturityBudget | null | undefined
): MaturityLevel | null {
  if (!itOwner || !budget) return null
  if (itOwner === 'no' && budget === 'none') return 'initial'
  if (itOwner === 'yes' && budget === 'recurring') return 'advanced'
  return 'managed'
}
