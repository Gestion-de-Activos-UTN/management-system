import { NETWORK_BASELINE } from './catalog/network-baseline'

// Textos por motivo que no dependen de una regla del catálogo. Van primero: un servicio que ya
// no se observa conserva el check_key de su regla, pero su texto es otro.
const REASON_TEXT: Record<string, string> = {
  technical_coverage_insufficient:
    'Se detectó una función de red, pero el escaneo no tuvo cobertura suficiente para verificarla.',
  service_unclassified:
    'Se detectó una función de red que no se pudo identificar con certeza. Pide a quien mantiene este equipo que la revise.',
  service_confidence_insufficient:
    'Se detectó una función de red que no se pudo identificar con certeza. Pide a quien mantiene este equipo que la revise.',
  service_no_longer_observed:
    'Un escaneo completo ya no encontró esta función de red en el equipo.',
}

/**
 * Única fuente del texto de un resultado de red. La usa el motor al guardar `explanation` y la
 * UI al mostrarlo, así los resultados guardados antes de un cambio de redacción (p. ej. los que
 * quedaron en inglés) se leen igual que los nuevos sin migrar datos.
 */
export function networkExplanation(result: {
  check_key: string
  reason_code?: string | null
}): string | null {
  if (result.reason_code && REASON_TEXT[result.reason_code]) return REASON_TEXT[result.reason_code]
  const rule = NETWORK_BASELINE.find(candidate => candidate.key === result.check_key)
  return rule ? `${rule.message} ${rule.recommendation}` : null
}
