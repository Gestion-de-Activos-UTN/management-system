/** Compare search text without case or diacritics; never alter the stored/displayed value. */
export function normalizeSearchText(value: string): string {
  return value.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('es').trim()
}

export function matchesSearch(
  values: readonly (string | null | undefined)[],
  query: string
): boolean {
  const needle = normalizeSearchText(query)
  return (
    !needle || values.some(value => value != null && normalizeSearchText(value).includes(needle))
  )
}

/**
 * Patrón para el operador `like` de Payload (ILIKE en Postgres), que ignora mayúsculas pero no
 * tildes. Cada letra que puede llevar tilde (vocales, n/ñ) pasa a `_`, el comodín de un carácter:
 * "deposito" → "d_p_s_t_" coincide con "Depósito". Los `%` y `_` que escriba la persona se
 * descartan para que no actúen como comodines.
 * ponytail: puede dar coincidencias de más en búsquedas muy cortas; si molesta, una columna de
 * texto normalizado (normalizeSearchText) por colección permite comparar exacto.
 */
export function accentInsensitiveLikePattern(query: string): string {
  return normalizeSearchText(query)
    .replace(/[%_]/g, '')
    .replace(/[aeioun]/g, '_')
}
