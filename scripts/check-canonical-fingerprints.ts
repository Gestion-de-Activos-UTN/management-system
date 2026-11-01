import { createHash } from 'node:crypto'
import { getPayload } from 'payload'
import config from '../payload.config'
import { canonicalJson } from '../lib/canonical-json'

// Solo lectura. Recalcula content_fingerprint de los scan-reports que aún conservan raw_payload
// (el cuerpo validado que se hasheó, ver domain/inventories/processScanReport.ts) con el orden
// anterior (localeCompare) y con el actual (código de unidad), para confirmar que el cambio de
// lib/canonical-json.ts no invalida reintentos de reportes ya recibidos. Los raw_payload
// vencidos ya no pueden reintentarse con sentido, y las tareas no guardan su entrada original:
// sus claves están cerradas por CreateTasksSchema (ver lib/canonical-json.test.ts).
//
//   node --import tsx scripts/check-canonical-fingerprints.ts

function legacyCanonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(legacyCanonicalJson).join(',')}]`
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${legacyCanonicalJson(item)}`)
      .join(',')}}`
  return JSON.stringify(value)
}
const sha256 = (text: string) => createHash('sha256').update(text).digest('hex')

const payload = await getPayload({ config })
const counts = { unchanged: 0, changed: 0, notReproducible: 0 }
const changed: string[] = []
for (let page = 1, hasNextPage = true; hasNextPage; page++) {
  const result = await payload.find({
    collection: 'scan-reports',
    where: { raw_payload: { exists: true } },
    overrideAccess: true,
    depth: 0,
    limit: 200,
    page,
  })
  hasNextPage = result.hasNextPage
  for (const report of result.docs) {
    if (!report.raw_payload) continue
    const stored = report.content_fingerprint
    if (sha256(legacyCanonicalJson(report.raw_payload)) !== stored) counts.notReproducible++
    else if (sha256(canonicalJson(report.raw_payload)) === stored) counts.unchanged++
    else {
      counts.changed++
      changed.push(String(report.id))
    }
  }
}
console.log(counts)
if (changed.length) console.log('Fingerprint distinto con el orden nuevo:', changed)
process.exit(counts.changed ? 1 : 0)
