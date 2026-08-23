// Explicit 'en-US' locale — `toLocaleString()`/`toLocaleDateString()` with no locale argument
// render using the browser's own locale, which would show Spanish month/day names or date
// ordering on a machine set to es-*. The UI text is English by policy; the same has to hold
// for anything the runtime formats implicitly, not just literal strings we wrote ourselves.
export function formatDateTime(value: string | Date): string {
  return new Date(value).toLocaleString('en-US');
}

export function formatDate(value: string | Date): string {
  return new Date(value).toLocaleDateString('en-US');
}
