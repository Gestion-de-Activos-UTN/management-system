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
