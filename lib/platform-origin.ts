/** Never derive credential-bearing package URLs or cookie trust from the caller's Host. */
export function platformOrigin(): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL
  if (!configured && process.env.NODE_ENV === 'production') throw new Error('NEXT_PUBLIC_SITE_URL is required in production')
  const url = new URL(configured || 'http://localhost:3001')
  const localDevelopment = process.env.NODE_ENV !== 'production' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if ((url.protocol !== 'https:' && !(localDevelopment && url.protocol === 'http:')) || url.username || url.password || url.search || url.hash || url.pathname !== '/')
    throw new Error('NEXT_PUBLIC_SITE_URL must be a canonical HTTPS origin (HTTP loopback only in development)')
  return url.origin
}
