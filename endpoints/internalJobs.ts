import type { Endpoint } from 'payload'
import { agingSweep } from '../domain/inventories/agingSweep'

function json(body: unknown, status = 200) {
  return Response.json(body, { status })
}

// Autenticación mínima: un token de servicio compartido (env var), no una sesión de usuario ni
// el auth de Agent — quien llama a esto es infraestructura (un cron/systemd timer), no una
// persona ni el scanner. Mismo criterio de "fail closed sin fallback" que Auth0 en producción
// (SYSTEM_PROMPT.md §7): sin INTERNAL_JOBS_TOKEN configurado, el endpoint rechaza todo.
function isAuthorized(req: { headers: Headers }): boolean {
  const expected = process.env.INTERNAL_JOBS_TOKEN
  if (!expected) return false
  const provided = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  return provided === expected
}

// ponytail: no hay scheduler cableado a este endpoint todavía (ni Vercel Cron, ni node-cron, ni
// Payload Jobs Queue) — el deploy real es una VM de Oracle Cloud, no serverless, y ese mecanismo
// se decide junto con el resto de la infra de deploy. Por ahora se dispara a mano (curl con el
// token) o desde un cron/systemd timer del propio SO una vez exista la VM. La lógica de negocio
// (agingSweep) ya está completa y registrada en JobRun independientemente de quién la dispare.
export const agingSweepEndpoint: Endpoint = {
  path: '/v1/internal/jobs/aging-sweep',
  method: 'post',
  handler: async (req) => {
    if (!isAuthorized(req)) return json({ error: 'unauthorized' }, 401)

    try {
      const summary = await agingSweep(req.payload)
      return json({ status: 'ok', summary })
    } catch (err) {
      return json({ status: 'error', message: err instanceof Error ? err.message : String(err) }, 500)
    }
  },
}
