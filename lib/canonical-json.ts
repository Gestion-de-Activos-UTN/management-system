/**
 * JSON with object keys sorted at every level: equal values always give the same text.
 * Keys sort by UTF-16 code unit, never by locale: the hash of this text is persisted as an
 * idempotency fingerprint and must not change with the runtime's ICU or LANG.
 */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(',')}}`
  return JSON.stringify(value)
}
