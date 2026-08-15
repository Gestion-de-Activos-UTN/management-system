// Un campo relationship puede llegar como id crudo (string/number) o poblado (objeto con `.id`)
// según la profundidad (`depth`) con la que corrió la operación que disparó el hook — nunca
// asumir una forma fija acá adentro.
export function relationId(value: unknown): string {
  if (value && typeof value === 'object' && 'id' in value) {
    return String((value as { id: unknown }).id)
  }
  return String(value)
}
