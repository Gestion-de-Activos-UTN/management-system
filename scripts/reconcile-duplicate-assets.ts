import { getPayload } from 'payload'
import type { Payload } from 'payload'
import config from '../payload.config'

// Fusiona los duplicados que dejó el bug de identidad inestable (asset_id = hash de mac-or-ip,
// arreglado en domain/inventories/ingestScanReport.ts::findExistingAsset): un mismo dispositivo
// escaneado primero en modo degraded (sin mac) y después full (con mac) generaba dos documentos
// Asset para la misma IP, uno huérfano de alias/owner/criticality/identified/status.
//
// Corre una sola vez, DESPUÉS de desplegar ese fix (si no, la próxima ingesta puede volver a
// duplicar lo que este script acaba de fusionar). Por defecto es dry-run — solo imprime qué
// haría. Pasar --apply para escribir/borrar de verdad.
//
//   node --import tsx scripts/reconcile-duplicate-assets.ts           # dry-run
//   node --import tsx scripts/reconcile-duplicate-assets.ts --apply   # aplica

const APPLY = process.argv.includes('--apply')

type AssetDoc = {
  id: string
  agent: string | { id: string }
  ip: string | null
  mac: string | null
  alias?: string | null
  owner?: unknown
  criticality?: string | null
  location?: string | null
  identified?: boolean
  status?: string
  first_viewed_at: string | null
  [key: string]: unknown
}

// Solo estos — nunca alias/owner/criticality/location/status/identified (bloque de negocio,
// ver collections/Assets/index.ts).
const TECHNICAL_FIELDS_TO_COPY = [
  'mac',
  'vendor',
  'hostname',
  'os',
  'os_candidates',
  'os_status',
  'state_reason',
  'host_scripts',
  'services',
  'last_seen',
  'gateway_ip',
  'gateway_mac',
] as const

function agentIdOf(asset: AssetDoc): string {
  return typeof asset.agent === 'string' ? asset.agent : asset.agent.id
}

function hasBusinessData(asset: AssetDoc): boolean {
  return Boolean(
    asset.alias || asset.owner || asset.criticality || asset.location || asset.identified || (asset.status && asset.status !== 'active'),
  )
}

async function findDuplicateGroups(payload: Payload): Promise<AssetDoc[][]> {
  const all = await payload.find({
    collection: 'assets',
    overrideAccess: true,
    limit: 0, // sin límite — asumible para el volumen de un inventario de red
    depth: 0,
  })
  const byAgentIp = new Map<string, AssetDoc[]>()
  for (const asset of all.docs as unknown as AssetDoc[]) {
    if (!asset.ip) continue
    const key = `${agentIdOf(asset)}::${asset.ip}`
    const group = byAgentIp.get(key) ?? []
    group.push(asset)
    byAgentIp.set(key, group)
  }
  return [...byAgentIp.values()].filter((group) => group.length > 1)
}

async function reconcileGroup(payload: Payload, group: AssetDoc[]) {
  const withMac = group.filter((a) => a.mac)
  const withoutMac = group.filter((a) => !a.mac)

  // Solo el patrón conocido del bug: exactamente un doc sin mac (el de antes de tener sudo) y
  // uno con mac (el de después). Más de dos, o dos con mac distinta, son casos que no encajan
  // con el bug (posible IP reciclada por DHCP entre dispositivos reales) — no se tocan.
  if (withoutMac.length !== 1 || withMac.length !== 1) {
    console.log(`  SKIP (no encaja con el patrón conocido, revisar a mano): ${group.map((a) => `${a.id}(mac=${a.mac ?? '—'})`).join(', ')}`)
    return
  }

  const [keep] = withoutMac
  const [source] = withMac

  if (hasBusinessData(source)) {
    console.log(
      `  SKIP (el doc a descartar ${source.id} tiene datos de negocio propios — alias/owner/criticality/location/identified/status — revisar a mano antes de fusionar)`,
    )
    return
  }

  const data = Object.fromEntries(TECHNICAL_FIELDS_TO_COPY.map((field) => [field, source[field]]))

  console.log(
    `  ${APPLY ? 'MERGE' : '[dry-run] MERGE'}: conservar ${keep.id} (alias=${keep.alias ?? '—'}), absorber mac/técnico de ${source.id}, borrar ${source.id}`,
  )
  if (!APPLY) return

  await payload.update({ collection: 'assets', id: keep.id, overrideAccess: true, data })
  await payload.delete({ collection: 'assets', id: source.id, overrideAccess: true })
}

async function main() {
  const payload = await getPayload({ config })
  const groups = await findDuplicateGroups(payload)

  if (groups.length === 0) {
    console.log('No se encontraron duplicados por agent+ip.')
    process.exit(0)
  }

  console.log(`${groups.length} grupo(s) de IP duplicada encontrados${APPLY ? '' : ' (dry-run, pasá --apply para escribir)'}:`)
  for (const group of groups) {
    console.log(`- ip ${group[0].ip} (agent ${agentIdOf(group[0])}):`)
    await reconcileGroup(payload, group)
  }

  process.exit(0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
