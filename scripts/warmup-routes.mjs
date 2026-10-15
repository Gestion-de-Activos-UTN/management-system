// DEV ONLY — precalienta `next dev`: Next compila cada ruta la primera vez que alguien la pide,
// y con Payload + Mantine esa primera visita tarda varios segundos por sección. Este script
// pide cada página (y la API) apenas el servidor responde, así la compilación ocurre durante
// el arranque y no cuando el usuario entra a cada sección.
//
// Por qué no `next build` + `next start`: en producción lib/platform-origin.ts exige HTTPS
// (sólo admite HTTP loopback en desarrollo) y las cookies de sesión son `secure`; correrlo sobre
// http://localhost implicaría relajar un control de seguridad.
//
// Las rutas se derivan de app/**/page.tsx: una sección nueva queda incluida sin tocar este
// archivo. Los segmentos dinámicos ([id]) reciben un valor de relleno: alcanza para compilar la
// ruta, aunque la página después no encuentre ese registro.
import { readdirSync } from 'node:fs'
import { join } from 'node:path'

const BASE_URL = `http://127.0.0.1:${process.env.PORT ?? 3001}`
const APP_DIR = join(import.meta.dirname, '..', 'app')
const READY_TIMEOUT_MS = 10 * 60_000
// Una ruta de API alcanza: todas comparten el catch-all de Payload (app/(payload)/api).
const API_ROUTES = ['/api/v1/session']

function pageRoutes() {
  return readdirSync(APP_DIR, { recursive: true })
    .map(file => String(file).split(/[\\/]/))
    .filter(parts => parts.at(-1) === 'page.tsx' && !parts.includes('(payload)'))
    .map(parts => {
      const segments = parts
        .slice(0, -1)
        .filter(segment => !/^\(.*\)$/.test(segment)) // route groups no aparecen en la URL
        .map(segment => (/^\[.*\]$/.test(segment) ? 'warmup' : segment))
      return `/${segments.join('/')}`
    })
    .sort()
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

async function waitForServer() {
  const deadline = Date.now() + READY_TIMEOUT_MS
  while (Date.now() < deadline) {
    try {
      await fetch(`${BASE_URL}/login`, { redirect: 'manual' })
      return true
    } catch {
      await sleep(2000)
    }
  }
  return false
}

async function warm(route) {
  const started = Date.now()
  try {
    // El status no importa (una página protegida o un id de relleno pueden fallar en el
    // cliente): lo que se busca es que el servidor compile la ruta.
    const response = await fetch(`${BASE_URL}${route}`, { redirect: 'manual' })
    await response.arrayBuffer()
    console.log(`[warmup] ${route} ${response.status} ${Date.now() - started} ms`)
  } catch (error) {
    console.log(`[warmup] ${route} falló: ${error instanceof Error ? error.message : error}`)
  }
}

if (!(await waitForServer())) {
  console.log('[warmup] el servidor no respondió a tiempo; se omite el precalentado')
  process.exit(0)
}
const routes = [...pageRoutes(), ...API_ROUTES]
const started = Date.now()
console.log(`[warmup] compilando ${routes.length} rutas…`)
// Secuencial a propósito: compilar todo en paralelo dispara memoria y CPU del contenedor.
for (const route of routes) await warm(route)
console.log(`[warmup] listo en ${Math.round((Date.now() - started) / 1000)} s — todas las secciones ya están compiladas`)
