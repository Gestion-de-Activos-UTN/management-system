import { randomUUID } from 'node:crypto'
import { sql, type PostgresAdapter } from '@payloadcms/db-postgres'
import { getPayload, type Payload, type PayloadRequest } from 'payload'
import config from '../payload.config'
import { withTransaction } from '../domain/with-transaction'
import { addAuditEvent, type AuditEventInput } from '../domain/audit/builder'
import { auditOrganizationLockKey } from '../domain/audit/chain'
import { verifyAuditChains } from '../domain/audit/verify'
import { enqueueRiskRecalculation } from '../domain/risk/enqueueRiskRecalculation'
import { reportsEndpoint } from '../endpoints/reports'

// Prototipo sintético de concurrencia del AuditLog (F1b, paso 9; decisión G5: espera por
// audit:<org> con p95 < 1 s con la demo y los jobs activos). No corre en CI: necesita una base
// DESCARTABLE con la demo sembrada (seed:navigation + seed:demo). Escribe eventos en la cadena de la
// organización demo de esa base.
//
// Sintético porque en F1b ningún escaneo toma audit:<org> (eso llega en F8): una transacción
// REPEATABLE READ toma `auditOrganizationLockKey(org)` al inicio con lockKeys, lo retiene lo que
// tarda de verdad procesar el reporte más grande de la demo (medido antes por POST /v1/reports),
// actualiza filas que también editan los escritores (el cruce de locks de 03 §4.5) y escribe su
// evento. Los escritores son comandos READ COMMITTED que editan una fila y escriben un evento al
// cerrar. Los jobs risk (cada 15 s) y maintenance (cada minuto) corren en este proceso, con
// recálculos de riesgo encolados en las fases con escaneo. La medición real se repite en F8.
//
// Variante (SIAM_AUDIT_PROBE_SCAN_LOCK=none): el escaneo no toma el lock al inicio; solo lo toma al
// cerrar, y una cabeza vieja termina en 23505 y reintento (03 §4.4, sin el lock adelantado).
//
// Uso: SIAM_AUDIT_PROBE=1 DATABASE_URL=postgresql://…@127.0.0.1:…/<base descartable> \
//      PAYLOAD_SECRET=… AUDIT_*=… NODE_ENV=test pnpm audit:contention-probe

/** `pause`: espera entre dos ediciones de un mismo escritor, en ms (mínimo y máximo). */
const PHASES = [
  { name: 'A · 1 escritor (referencia)', seconds: 15, writers: 1, scan: false, pause: [20, 80] },
  { name: 'B · 8 escritores, estrés', seconds: 30, writers: 8, scan: false, pause: [20, 80] },
  {
    name: 'C · 8 escritores, estrés + escaneo + jobs',
    seconds: 75,
    writers: 8,
    scan: true,
    pause: [20, 80],
  },
  {
    name: 'D · 8 escritores, ritmo humano + escaneo + jobs',
    seconds: 75,
    writers: 8,
    scan: true,
    pause: [1000, 3000],
  },
] as const
const SCAN_LOCK = process.env.SIAM_AUDIT_PROBE_SCAN_LOCK === 'none' ? 'none' : 'start'
const SCHEMA = 'siam_test_contention'
const ROWS = 20

/** `failed`: no se pudo confirmar ni con los reintentos (código SQL, por ejemplo 40P01). */
type Sample = { ms: number; attempts: number; failed?: string }

function guard() {
  if (process.env.SIAM_AUDIT_PROBE !== '1') {
    console.error(
      'uso: SIAM_AUDIT_PROBE=1 … pnpm audit:contention-probe (solo contra una base descartable)'
    )
    process.exit(2)
  }
  const url = new URL(process.env.DATABASE_URL ?? 'postgresql://invalid/')
  if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.pathname === '/payloadcms') {
    console.error(
      'El prototipo solo corre contra una base descartable local (no la de desarrollo).'
    )
    process.exit(2)
  }
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
const pick = (n: number) => Math.floor(Math.random() * n)
const drizzle = (payload: Payload) => (payload.db as unknown as PostgresAdapter).drizzle
const sessionDb = async (req: PayloadRequest) =>
  req.payload.db.sessions![(await req.transactionID) as string]!
    .db as unknown as PostgresAdapter['drizzle']
const probeTable = sql`${sql.identifier(SCHEMA)}.rows`
const unknownNetwork = () =>
  ({ source: 'unknown', ip: null, family: null, captured_at: new Date().toISOString() }) as const

function sqlCode(error: unknown): string {
  let cause = error as { code?: unknown; cause?: unknown } | undefined
  while (cause) {
    if (typeof cause.code === 'string') return cause.code
    cause = cause.cause as typeof cause
  }
  return 'otro'
}

/** Corre una transacción contando intentos; si falla del todo, registra el código. */
async function timed(run: (count: () => void) => Promise<unknown>): Promise<Sample> {
  let attempts = 0
  const started = performance.now()
  try {
    await run(() => (attempts += 1))
    return { ms: performance.now() - started, attempts }
  } catch (error) {
    return { ms: performance.now() - started, attempts, failed: sqlCode(error) }
  }
}

function percentile(values: number[], p: number) {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]!
}

function summary(samples: Sample[]) {
  const ok = samples.filter(sample => !sample.failed)
  const ms = ok.map(sample => sample.ms)
  const failures = new Map<string, number>()
  for (const sample of samples)
    if (sample.failed) failures.set(sample.failed, (failures.get(sample.failed) ?? 0) + 1)
  return {
    n: samples.length,
    ok: ok.length,
    failed: [...failures].map(([code, n]) => `${n}×${code}`).join(' ') || '0',
    p50: Math.round(percentile(ms, 50)),
    p95: Math.round(percentile(ms, 95)),
    max: Math.round(Math.max(0, ...ms)),
    retried: ok.filter(sample => sample.attempts > 1).length,
    maxAttempts: Math.max(0, ...samples.map(sample => sample.attempts)),
  }
}

function renameEvent(org: string, index: number): AuditEventInput {
  return {
    action: 'scan.rename',
    scope: { kind: 'organization', organizationId: org },
    entity: { type: 'scan_report', id: `probe-${index}` },
    actor: { type: 'user', id: randomUUID(), role: 'org_admin' },
    origin: 'interactive',
    payload: { probe: true, index },
    network: unknownNetwork(),
  }
}

/** Mide cuánto tarda procesar de verdad el reporte más grande de la demo (POST /v1/reports). */
async function measureScan(payload: Payload): Promise<{ ms: number; assets: number }> {
  const found = await drizzle(payload).execute(sql`SELECT office_id, raw_payload::text AS raw
    FROM scan_reports WHERE raw_payload IS NOT NULL
    ORDER BY jsonb_array_length(raw_payload->'assets') DESC LIMIT 1`)
  const row = found.rows[0] as { office_id: string; raw: string } | undefined
  if (!row)
    throw new Error('La base no tiene reportes de la demo con raw_payload (correr seed:demo).')
  const durations: number[] = []
  let assets = 0
  for (let run = 0; run < 3; run++) {
    const agentId = randomUUID()
    const agent = await payload.create({
      collection: 'agents',
      data: { id: agentId, office: row.office_id },
      overrideAccess: true,
    })
    const report = JSON.parse(row.raw) as { assets: Array<Record<string, unknown>> }
    assets = report.assets.length
    const body = {
      ...report,
      report_id: `probe-${randomUUID()}`,
      agent_id: agentId,
      assets: report.assets.map(asset => ({ ...asset, agent_id: agentId })),
    }
    const started = performance.now()
    const response = await reportsEndpoint.handler({
      payload,
      headers: new Headers({ authorization: `Bearer ${agent.apiKey}`, 'x-agent-id': agentId }),
      json: async () => body,
    } as unknown as PayloadRequest)
    durations.push(performance.now() - started)
    if (response.status !== 200)
      throw new Error(`POST /v1/reports devolvió ${response.status}: ${await response.text()}`)
  }
  return { ms: Math.round(percentile(durations, 50)), assets }
}

async function main() {
  guard()
  const payload = await getPayload({ config, cron: true })
  const db = drizzle(payload)
  const orgRow = (await db.execute(sql`SELECT id FROM organizations ORDER BY created_at LIMIT 1`))
    .rows[0] as { id: string } | undefined
  if (!orgRow) throw new Error('No hay organización demo (correr seed:navigation y seed:demo).')
  const org = orgRow.id

  await db.execute(sql`DROP SCHEMA IF EXISTS ${sql.identifier(SCHEMA)} CASCADE`)
  await db.execute(sql`CREATE SCHEMA ${sql.identifier(SCHEMA)}`)
  await db.execute(sql`CREATE TABLE ${probeTable} (id int PRIMARY KEY, n int NOT NULL)`)
  await db.execute(sql`INSERT INTO ${probeTable} SELECT g, 0 FROM generate_series(1, ${ROWS}) g`)

  const scan = await measureScan(payload)
  console.log(
    `Reporte de la demo: ${scan.assets} activos, procesamiento real p50 ${scan.ms} ms (3 corridas).`
  )
  console.log(
    SCAN_LOCK === 'start'
      ? 'El escaneo sintético toma audit:<org> al inicio y lo retiene ese tiempo en cada corrida.\n'
      : 'Variante: el escaneo sintético dura ese tiempo sin el lock y solo toma audit:<org> al cerrar.\n'
  )

  let index = 0
  const results: Array<{ phase: string; writers: Sample[]; scans: Sample[]; jobs: string }> = []
  for (const phase of PHASES) {
    const until = Date.now() + phase.seconds * 1000
    const phaseStart = new Date()
    const writers: Sample[] = []
    const scans: Sample[] = []

    const writer = async () => {
      while (Date.now() < until) {
        writers.push(
          await timed(count =>
            withTransaction(payload, undefined, async req => {
              count()
              await (
                await sessionDb(req)
              ).execute(sql`UPDATE ${probeTable} SET n = n + 1 WHERE id = ${1 + pick(ROWS)}`)
              await addAuditEvent(req, renameEvent(org, (index += 1)))
            })
          )
        )
        await sleep(phase.pause[0] + pick(phase.pause[1] - phase.pause[0]))
      }
    }

    const scanner = async () => {
      while (Date.now() < until) {
        scans.push(
          await timed(count =>
            withTransaction(
              payload,
              undefined,
              async req => {
                count()
                await sleep(scan.ms) // lo que tarda procesar el reporte, con el lock tomado
                const tx = await sessionDb(req)
                for (let row = 0; row < 5; row++)
                  await tx.execute(
                    sql`UPDATE ${probeTable} SET n = n + 1 WHERE id = ${1 + pick(ROWS)}`
                  )
                await addAuditEvent(req, {
                  action: 'scan.process',
                  scope: { kind: 'organization', organizationId: org },
                  entity: { type: 'scan_report', id: `probe-scan-${(index += 1)}` },
                  actor: { type: 'agent', id: 'probe-agent' },
                  origin: 'agent',
                  payload: { probe: true },
                  network: unknownNetwork(),
                })
              },
              {
                isolationLevel: 'repeatable read',
                lockKeys: SCAN_LOCK === 'start' ? [auditOrganizationLockKey(org)] : [],
              }
            )
          )
        )
        await sleep(1000)
      }
    }

    const riskFeeder = async () => {
      while (Date.now() < until) {
        await enqueueRiskRecalculation(payload, org)
        await sleep(5000)
      }
    }

    await Promise.all([
      ...Array.from({ length: phase.writers }, writer),
      ...(phase.scan ? [scanner(), riskFeeder()] : []),
    ])
    // Payload borra cada job al completarlo: la actividad del job risk se ve en las evaluaciones
    // que guarda.
    const jobs = await db.execute(sql`SELECT count(*)::int AS n FROM risk_evaluations
      WHERE created_at >= ${phaseStart.toISOString()}::timestamptz`)
    results.push({
      phase: phase.name,
      writers,
      scans,
      jobs: `risk: ${(jobs.rows[0] as { n: number }).n} evaluaciones`,
    })
    console.log(`listo: ${phase.name}`)
  }

  const reference = summary(results[0]!.writers).p50
  console.log(
    '\nEscritores (editan una fila y escriben un evento al cerrar), en ms; solo las confirmadas:'
  )
  console.log(
    'fase'.padEnd(50) +
      'n'.padStart(6) +
      'p50'.padStart(7) +
      'p95'.padStart(7) +
      'max'.padStart(7) +
      '  reintentos  fallidas  espera p95 est.  jobs'
  )
  for (const result of results) {
    const s = summary(result.writers)
    console.log(
      result.phase.padEnd(50) +
        String(s.n).padStart(6) +
        String(s.p50).padStart(7) +
        String(s.p95).padStart(7) +
        String(s.max).padStart(7) +
        `  ${String(s.retried).padStart(4)} (máx ${s.maxAttempts})` +
        `  ${s.failed.padStart(8)}` +
        `  ${String(Math.max(0, s.p95 - reference)).padStart(8)}` +
        `         ${result.jobs}`
    )
  }
  for (const result of results.filter(r => r.scans.length > 0)) {
    const s = summary(result.scans)
    console.log(
      `\nEscaneo sintético en ${result.phase.slice(0, 1)}: ${s.n} corridas, ${s.ok} confirmadas, fallidas ${s.failed}; ` +
        `duración p50 ${s.p50} ms, p95 ${s.p95} ms; reintentos ${s.retried} (máx ${s.maxAttempts} intentos).`
    )
  }
  console.log(
    `\n"Espera p95 est." = p95 de la fase − p50 de la fase A (${reference} ms). Criterio G5: < 1000 ms.`
  )

  const report = await verifyAuditChains(payload, { chainIds: [`org:${org}`] })
  const chain = report.chains[0]
  console.log(
    `Cadena org:${org}: ${chain?.error ? `ERROR ${chain.error.kind}` : 'verifica'}, ${chain?.verified ?? 0} eventos, ${chain?.anomalies.length ?? 0} anomalías.`
  )
  await db.execute(sql`DROP SCHEMA IF EXISTS ${sql.identifier(SCHEMA)} CASCADE`)
  process.exit(report.ok ? 0 : 1)
}

main().catch(error => {
  console.error('audit:contention-probe falló:', error)
  process.exit(1)
})
