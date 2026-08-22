const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

// JSON.parse itself can never execute code (unlike eval/new Function, it only ever produces
// plain data) — but a free-form JSON field typed by a user can still carry a `__proto__` key,
// and if that parsed object is ever spread/Object.assign'd into another object later, that key
// pollutes Object.prototype for the whole process. No such merge exists in this codebase today
// (details.details stays nested under its own key, never spread — see
// modules/non-network-assets/service.ts), but stripping these keys at parse time closes that
// door permanently instead of relying on every future consumer to remember not to merge it.
export function safeJsonParse(text: string): unknown {
  return JSON.parse(text, (key, value) => (DANGEROUS_KEYS.has(key) ? undefined : value));
}
