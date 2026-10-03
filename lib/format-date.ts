// Explicit 'en-US' locale — `toLocaleString()`/`toLocaleDateString()` with no locale argument
// render using the browser's own locale, which would show Spanish month/day names or date
// ordering on a machine set to es-*. El texto de la interfaz está en español por definición; the same has to hold
// for anything the runtime formats implicitly, not just literal strings we wrote ourselves.
export function formatDateTime(value: string | Date): string {
  return new Date(value).toLocaleString('es-AR')
}

export function formatDate(value: string | Date): string {
  return new Date(value).toLocaleDateString('es-AR')
}

export function formatTime(value: string | Date): string {
  return new Date(value).toLocaleTimeString('es-AR', { hour: 'numeric', minute: '2-digit' })
}

export function formatDateInput(value: string | Date): string {
  const date = new Date(value)
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 10)
}

// Una fecha elegida como inicio comienza al principio de ese día en el huso del usuario.
export function localDateStartToISOString(value: string): string {
  return new Date(`${value}T00:00:00.000`).toISOString()
}

// A chosen end date remains effective for that entire calendar day in the user's timezone.
export function localDateEndToISOString(value: string): string {
  const date = new Date(`${value}T23:59:59.999`)
  return date.toISOString()
}
