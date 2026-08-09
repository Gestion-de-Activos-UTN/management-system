import fs from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import { ScanReportPayloadSchema } from '../contracts/scan-report.schema'
import { AssetPayloadSchema } from '../contracts/asset.schema'
import { HeartbeatPayloadSchema } from '../contracts/heartbeat.schema'

// Zod es la única fuente de verdad (SYSTEM_PROMPT.md §5) — este script solo vuelca JSON Schema
// a build-time. El artefacto se commitea para que scanner-prototype lo consuma sin instalar nada de npm.
//
// NOTA: la decisión original era usar `zod-to-json-schema` directo (ver plan de esta fase).
// Con zod@4.3.6 real instalado, `zodToJsonSchema(...)` devuelve `{ definitions: { X: {} } }`
// vacío para estos 3 schemas — a pesar de que el package.json de zod-to-json-schema declara
// soporte peer para "^4", su introspección de `_def` no reconoce el shape interno de esta
// versión de Zod 4 en runtime. `z.toJSONSchema` (nativo de Zod 4, ya evaluado como alternativa
// en la misma decisión) sí produce el schema correcto, incluyendo `.passthrough()` como
// `additionalProperties: {}` y `.nullable()` como `anyOf`. Se usa el nativo acá; si esto
// necesita reabrirse, `zod-to-json-schema` queda como dependencia instalada pero sin uso.
const OUTPUT_DIR = path.resolve(__dirname, '../contracts/generated')

const SCHEMAS = {
  'scan-report.schema.json': ScanReportPayloadSchema,
  'asset.schema.json': AssetPayloadSchema,
  'heartbeat.schema.json': HeartbeatPayloadSchema,
} as const

fs.mkdirSync(OUTPUT_DIR, { recursive: true })

for (const [filename, schema] of Object.entries(SCHEMAS)) {
  const jsonSchema = z.toJSONSchema(schema)
  fs.writeFileSync(path.join(OUTPUT_DIR, filename), JSON.stringify(jsonSchema, null, 2) + '\n')
  console.log(`generated ${filename}`)
}
