type Entry<T> = { token: string; createdAt: number; promise: Promise<T> }

/**
 * Reuses a live consolidation while the evidence token is unchanged and the entry is younger than
 * `ttlMs`. Concurrent callers share the same promise; a rejected promise is never kept.
 */
// ponytail: per-process cache; several instances each keep their own and stay correct because the
// token is checked on every request. Move to a shared store only if recalculation cost demands it.
export function createAssignedRiskCache<T>({
  maxEntries = 100,
  ttlMs = 60_000,
  now = Date.now,
}: { maxEntries?: number; ttlMs?: number; now?: () => number } = {}) {
  const entries = new Map<string, Entry<T>>()
  return {
    size: () => entries.size,
    get(key: string, token: string, compute: () => Promise<T>): Promise<T> {
      const cached = entries.get(key)
      if (cached && cached.token === token && now() - cached.createdAt < ttlMs) return cached.promise
      // Re-inserting moves the key to the end, so eviction drops the oldest insertion.
      entries.delete(key)
      if (entries.size >= maxEntries) entries.delete(entries.keys().next().value!)
      const promise = compute()
      entries.set(key, { token, createdAt: now(), promise })
      // Identity check: a newer entry for the same key must survive an older failure. This handler
      // also marks the cleanup branch as handled; callers still receive the rejection.
      promise.catch(() => {
        if (entries.get(key)?.promise === promise) entries.delete(key)
      })
      return promise
    },
  }
}
