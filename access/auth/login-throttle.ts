import { isIP } from 'node:net'
import { APIError, type CollectionBeforeOperationHook } from 'payload'

/** Process-local token bucket; no account-wide lock, database writes or timers. */
export class LoginThrottle {
  private buckets = new Map<string, { tokens: number; at: number }>()
  constructor(
    private capacity = 60,
    private refillPerSecond = 1,
    private maxKeys = 4096
  ) {}
  clear() {
    this.buckets.clear()
  }
  take(key: string, now = Date.now()): boolean {
    const previous = this.buckets.get(key)
    const tokens = previous
      ? Math.min(
          this.capacity,
          previous.tokens + (Math.max(0, now - previous.at) * this.refillPerSecond) / 1000
        )
      : this.capacity
    if (!previous && this.buckets.size >= this.maxKeys) {
      for (const [id, bucket] of this.buckets)
        if (now - bucket.at >= (this.capacity * 1000) / this.refillPerSecond)
          this.buckets.delete(id)
      // Do not evict an active bucket and let rotating keys reset its limit.
      if (this.buckets.size >= this.maxKeys) return false
    }
    this.buckets.set(key, { tokens: tokens >= 1 ? tokens - 1 : tokens, at: now })
    return tokens >= 1
  }
}

// Shared across both auth collections. Always bound aggregate password-check work.
export const loginBudget = new LoginThrottle(120, 2, 1)
export const loginOrigins = new LoginThrottle()

export function loginOrigin(headers?: Headers): string | null {
  // Only enable when a trusted proxy REPLACES this header; client-provided headers are ignored.
  if (process.env.SIAM_TRUST_LOGIN_PROXY !== '1') return null
  const value = headers?.get('x-real-ip')?.trim()
  return value && isIP(value) ? value : null
}

export const throttleLogin: CollectionBeforeOperationHook = ({ operation, req, args }) => {
  if (operation !== 'login') return args
  const origin = loginOrigin(req.headers)
  if (!loginBudget.take('all') || (origin && !loginOrigins.take(origin))) {
    req.responseHeaders ??= new Headers()
    req.responseHeaders.set('Retry-After', '1')
    throw new APIError('Demasiados intentos. Espera unos segundos y vuelve a intentar.', 429)
  }
  return args
}
