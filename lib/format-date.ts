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

/** "15/10/2026 · 2:40 → 2:44 (4 min)": fecha una sola vez, horas de inicio y fin y duración. */
export function formatScanWindow(start: string | Date, end?: string | Date | null): string {
  const from = `${formatDate(start)} · ${formatTime(start)}`
  if (!end) return from
  const minutes = Math.max(
    0,
    Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60000)
  )
  const sameDay = formatDate(start) === formatDate(end)
  return `${from} → ${sameDay ? '' : `${formatDate(end)} · `}${formatTime(end)} (${minutes < 1 ? 'menos de 1' : minutes} min)`
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

const DAY_MS = 24 * 60 * 60 * 1000
const relativeDays = new Intl.RelativeTimeFormat('es-AR', { numeric: 'auto' })

// "hoy", "mañana", "en 30 días", "hace 3 días" — por días de calendario locales, no por horas.
export function formatRelativeDays(value: string | Date, now: Date = new Date()): string {
  const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const days = Math.round(
    (startOfDay(new Date(value)).getTime() - startOfDay(now).getTime()) / DAY_MS
  )
  return relativeDays.format(days, 'day')
}
