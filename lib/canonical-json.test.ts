import { test } from 'node:test'
import assert from 'node:assert/strict'
import { z } from 'zod'
import { canonicalJson } from './canonical-json'
import { ScanReportPayloadSchema } from '../contracts/scan-report.schema'
import { CreateTasksSchema } from '../modules/tasks/schema'

const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)
// Criterio anterior: los fingerprints ya guardados (scan-reports, tareas) se calcularon con él.
const byLocale = (a: string, b: string) => a.localeCompare(b)
const disagreements = (keys: string[]) =>
  keys.flatMap((a, i) =>
    keys
      .slice(i + 1)
      .filter(b => Math.sign(byCodeUnit(a, b)) !== Math.sign(byLocale(a, b)))
      .map(b => `${a} / ${b}`)
  )

/** Property names that can share one object, for every object level of a JSON Schema. */
function siblingKeySets(node: unknown): string[][] {
  if (!node || typeof node !== 'object') return []
  const nested = Object.values(node).flatMap(siblingKeySets)
  const properties = (node as { properties?: object }).properties
  return properties ? [Object.keys(properties), ...nested] : nested
}

test('las claves fijas de los contratos ordenan igual con el criterio anterior', () => {
  for (const schema of [ScanReportPayloadSchema, CreateTasksSchema]) {
    const sets = siblingKeySets(z.toJSONSchema(schema, { unrepresentable: 'any' }))
    assert.ok(sets.length > 1)
    // Una clave nueva que rompa esto cambiaría fingerprints guardados: hace falta migrarlos.
    assert.deepEqual(sets.flatMap(disagreements), [])
  }
})

test('los ids de scripts NSE (claves libres de scripts/host_scripts) ordenan igual', () => {
  const alphabet = [...'abcdefghijklmnopqrstuvwxyz0123456789-']
  assert.deepEqual(disagreements(alphabet), [])
  const nmapIds = [
    'smb2-time',
    'smb2-security-mode',
    'smb-os-discovery',
    'ssl-cert',
    'ssl-date',
    'ssh-hostkey',
    'http-title',
    'http-server-header',
    'rdp-ntlm-info',
    'nbstat',
  ]
  assert.deepEqual(disagreements(nmapIds), [])
})

test('ordena por código de unidad, sin depender del locale', () => {
  assert.equal(
    canonicalJson({ b: 1, B: 2, _a: 3, a1: 4, 'a-': 5 }),
    '{"B":2,"_a":3,"a-":5,"a1":4,"b":1}'
  )
})

test('ordena en todos los niveles y conserva el orden de los arrays', () => {
  assert.equal(
    canonicalJson({ z: [{ b: 1, a: 2 }, 3], a: null, m: 'x' }),
    '{"a":null,"m":"x","z":[{"a":2,"b":1},3]}'
  )
})
