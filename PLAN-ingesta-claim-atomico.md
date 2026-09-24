# Plan — Claim atómico del ScanReport en la ingesta

> Documento de plan. No aplica ningún cambio: describe qué tocar, por qué y cómo verificarlo.
> Destino: rama personal → PR contra `dev` (SYSTEM_PROMPT.md §1).

## Contexto

`endpoints/reports.ts` protege la ingesta contra entregas repetidas con una guarda por `report_id`
(`:53-65`): si el reporte ya existe y su estado **no** es `received`, devuelve 200 sin reprocesar.
La guarda tiene dos agujeros:

1. **No cubre la ejecución en curso.** El estado sigue en `received` durante todo el procesamiento,
   así que dos entregas simultáneas del mismo `report_id` la pasan las dos y ejecutan el ingest en
   paralelo.
2. **No filtra por agente.** `where: { id: { equals: body.report_id } }` (`:55`) mira el id sin
   acotar a `auth.agentId`, así que un `report_id` que pertenece a otro agente se lee y se pisa.

Que la entrega duplicada ocurra no es hipotético: el agente tiene **dos hilos** llamando a
`flush_queue` (`scanner-prototype/src/siam_agent/agent.py:101` en el hilo de heartbeat, `:145` en
`scan_once`), `queue_store.list_pending()` no reclama las filas, y la fila solo se borra **después**
de una entrega exitosa.

Objetivo: que un `report_id` lo procese exactamente un worker, y que un reporte de otro agente nunca
sea leído ni modificado — sin perder reportes con los agentes ya desplegados.

## El fallo concreto que se corrige

Timeline real, con los valores de configuración del agente (`HEARTBEAT_INTERVAL = 300s`,
`_TIMEOUT = 30s`, `SCAN_INTERVAL = 3600s`):

- `t=0` — `scan_once` termina el scan de un /24 (200 hosts), pone el status en `idle`
  (`agent.py:116`, en el `finally`, **antes** de enviar), encola el reporte R y llama a
  `flush_queue` → POST #1 de R.
- `t=0..N` — la plataforma procesa: `maybeCreateAutoSnapshot`, y después ~600 round-trips
  secuenciales (1-2 `find` + 1 write por asset, `ingestScanReport.ts:161-209`). El reporte queda en
  `received` todo ese tiempo.
- `t=20s` — tick del hilo de heartbeat. Como el status es `idle`, llama a `flush_queue`
  (`agent.py:101`). `list_pending()` devuelve R **otra vez** (la fila sigue ahí porque POST #1 no
  terminó) → POST #2 de R, concurrente con el primero.
- En la plataforma, POST #2 lee el reporte en estado `received` → pasa la guarda de `:63` → arranca
  un segundo ingest del mismo reporte, en paralelo con el primero.

Qué rompe, en orden de aparición:

- **Snapshot duplicado**: con `snapshot_before_each_scan` activo se crean dos snapshots del mismo
  instante.
- **Duplicación de activos**: los dos workers procesan el mismo asset nuevo; los dos ejecutan
  `findExistingAsset` (`:118-149`), los dos no encuentran nada, y los dos hacen `create`. Es
  exactamente el duplicado que `findExistingAsset` se escribió para evitar — el fix del matching no
  ayuda acá porque el problema es el read-modify-write sin lock, no la clave de búsqueda.
- **500 e inventario a medias**: si en vez de duplicar chocan contra el `unique` global de
  `asset_id` (`collections/Assets/index.ts:31-35`), el segundo `create` tira y, como no hay
  transacción ni try/catch por asset, el reporte queda escrito a la mitad.
- **Pérdida silenciosa del reporte**: `sender.py::_post_once` hace `raise_for_status()`, y cualquier
  HTTPError — 4xx **y 5xx** — devuelve `retryable=False`; `flush_queue` entonces **borra** la fila
  de la cola (`sender.py:108-118`). Un 500 no se reintenta: se descarta.
- **Estado final mentiroso**: los dos workers terminan marcando el reporte `processed`.

No hace falta ni un timeout para llegar acá: alcanza con que el ingest dure más que el tiempo hasta
el próximo tick de heartbeat (entre 0 y 300s). El timeout de 30s del POST #1 solo agranda la
ventana, porque no cancela el trabajo del lado del servidor.

Y el agujero 2 tampoco necesita un atacante: una VM clonada con su `data/queue.db` ya poblado y
después re-aprovisionada como Agent nuevo reenvía `report_id`s que ya pertenecen al Agent viejo. Hoy
eso devuelve 200 `processed` de la fila ajena y los assets nunca se ingestan, sin ningún rastro.

## Diseño

**El INSERT es el candado.** `ScanReports.id` es el `report_id` del agente y es la PK de la tabla
(`collections/ScanReports/index.ts:19-26`), así que crear la fila ya es un compare-and-swap atómico
a nivel base de datos: de dos entregas concurrentes, una crea y la otra choca. No hace falta ni
transacción explícita ni SQL crudo (el repo evita queries crudas por convención).

El cambio invierte el orden actual: en vez de "crear la fila y después decidir", se **clama**
primero, con `status: 'processing'`, y solo el ganador ingesta.

Estados de `ScanReports.status`: `received` (legado) → `processing` (nuevo) → `processed` | `failed`.
Nada en el código nuevo escribe `received`; una fila en ese estado solo puede venir del deploy
anterior, así que su exposición a concurrencia es una ventana de rollout única, no un caso
permanente.

**Claim vencido**: si el proceso muere entre el claim y el fin del ingest, la fila queda en
`processing` para siempre. Se recupera con `claimed_at` + una ventana (`STALE_CLAIM_MS`, 15 min):
pasado ese tiempo, otra entrega puede re-clamar.

**Respuesta a la entrega perdedora**: 200 con `status: 'processing'`, no 409. Con el agente actual
un 409 haría que `flush_queue` borre la fila igual (todo status ≠ 2xx es no-retryable), así que el
409 no compraría nada y sí rompería a los agentes ya desplegados. Queda como `TODO` para cuando
`scanner-prototype` trate 409/429/5xx como retryable (PR aparte, otro repo).

## Cambios

### 1. `collections/ScanReports/index.ts`

- `status.options`: agregar `'processing'` → `['received', 'processing', 'processed', 'failed']`.
  Comentar que `received` es solo legado del código anterior al claim.
- Campo nuevo `claimed_at` (`type: 'date'`, `admin: { readOnly: true }`), con comentario explicando
  que es la marca del claim y la base de la ventana de recuperación.

### 2. `endpoints/reports.ts`

Extraer la lógica de claim a una función local `claimReport(payload, body, auth)` que devuelve un
resultado tipado, y reordenar el handler alrededor de ella.

```ts
import { relationId } from '@/lib/relationId'   // ya existe, se reusa

// Un claim más viejo que esto se considera huérfano (proceso muerto entre el claim y el ingest).
const STALE_CLAIM_MS = 15 * 60 * 1000

type ClaimOutcome =
  | { kind: 'claimed' }
  | { kind: 'already-done'; status: string }
  | { kind: 'in-progress' }
  | { kind: 'foreign' }

// El PK de scan-reports es el report_id que manda el agente (collections/ScanReports/index.ts:19-26),
// así que este INSERT es el candado: de dos entregas concurrentes del mismo reporte, exactamente una
// lo crea. No se usa transacción ni SQL crudo — la unicidad de la PK ya da el compare-and-swap.
async function claimReport(
  payload: Payload,
  body: ScanReportPayload,
  auth: AgentAuthResult,
): Promise<ClaimOutcome> {
  try {
    await payload.create({
      collection: 'scan-reports',
      overrideAccess: true,
      data: {
        id: body.report_id,
        agent: auth.agentId,
        office: auth.officeId,
        network: body.network,
        scan_start: body.scan_start,
        scan_end: body.scan_end,
        hosts_up: body.hosts_up,
        gateway_ip: body.gateway_ip,
        gateway_mac: body.gateway_mac,
        raw_payload: body,
        status: 'processing',
        claimed_at: new Date().toISOString(),
      },
    })
    return { kind: 'claimed' }
  } catch (err) {
    // No se asume la forma del error de unicidad (Payload lo envuelve distinto según el path):
    // se re-consulta y, si la fila no existe, el error era otra cosa y se propaga.
    const existing = (
      await payload.find({
        collection: 'scan-reports',
        where: { id: { equals: body.report_id } },
        overrideAccess: true,
        limit: 1,
        depth: 0,
      })
    ).docs[0]
    if (!existing) throw err

    // Scoping por tenant: un report_id de otro agente no se lee, no se pisa y no se filtra su estado.
    if (relationId(existing.agent) !== auth.agentId) return { kind: 'foreign' }

    if (existing.status === 'processed' || existing.status === 'failed') {
      return { kind: 'already-done', status: existing.status }
    }

    const claimedAtMs = existing.claimed_at ? new Date(existing.claimed_at).getTime() : 0
    if (existing.status === 'processing' && Date.now() - claimedAtMs < STALE_CLAIM_MS) {
      return { kind: 'in-progress' }
    }

    // Re-claim de un claim huérfano, o de una fila 'received' creada por el deploy anterior.
    // El `where` incluye el estado y el claimed_at leídos: si otro worker se adelantó, no matchea
    // ninguna fila y este pierde el claim.
    const reclaimed = await payload.update({
      collection: 'scan-reports',
      overrideAccess: true,
      where: {
        id: { equals: body.report_id },
        status: { equals: existing.status },
        ...(existing.claimed_at ? { claimed_at: { equals: existing.claimed_at } } : {}),
      },
      data: { status: 'processing', claimed_at: new Date().toISOString() },
    })
    return reclaimed.docs.length === 1 ? { kind: 'claimed' } : { kind: 'in-progress' }
  }
}
```

Handler, reemplazando `:53-108`:

```ts
const claim = await claimReport(req.payload, body, auth)

if (claim.kind === 'foreign') {
  // Nunca se devuelve el estado ni el contenido del reporte ajeno — solo que ese id está tomado.
  return json({ error: 'report_id conflict' }, 409)
}
if (claim.kind === 'already-done') {
  return json({ report_id: body.report_id, status: claim.status }, 200)
}
if (claim.kind === 'in-progress') {
  // 200 a propósito: sender.py::_post_once trata TODO status != 2xx como no-retryable y
  // flush_queue borra la fila de la cola (sender.py:108-118) — un 409 acá perdería el reporte en
  // los agentes ya desplegados. Sacarlo de la cola es correcto: la entrega que ganó el claim lo
  // está aplicando.
  // TODO(scanner-retryable): pasar a 409 cuando scanner-prototype trate 409/429/5xx como retryable.
  return json({ report_id: body.report_id, status: 'processing' }, 200)
}

// Solo el ganador del claim llega acá. El snapshot queda adentro del claim: un reintento del mismo
// reporte ya no lo repite (antes corría antes de la guarda de idempotencia).
try {
  await maybeCreateAutoSnapshot(req.payload, auth.officeId, auth.organizationId)
} catch {
  // ponytail: sin logging estructurado todavía — un snapshot perdido no debe tumbar la ingesta.
}

let result
try {
  result = await ingestScanReport(req.payload, body, auth)
} catch (err) {
  // Libera el claim marcándolo terminal: 'failed' es visible en el panel y no se re-clama sola.
  // Hasta ahora nada escribía este estado, aunque la opción existía en la colección.
  await req.payload.update({
    collection: 'scan-reports',
    id: body.report_id,
    overrideAccess: true,
    data: {
      status: 'failed',
      processed_at: new Date().toISOString(),
      error: err instanceof Error ? err.message : String(err),
    },
  })
  throw err
}

await req.payload.update({ /* ...igual que hoy: status 'processed', processed_at, error */ })
```

El `create` de ScanReports que hoy vive en `:67-85` desaparece (lo absorbe `claimReport`), y el
`await authDeps.resetAttempts(auth.agentId)` queda donde está.

## Verificación

- `pnpm test:integration` — `endpoints/reports.integration.test.ts` ya tiene el harness (Postgres
  real, `fakeRequest` + handler directo, `seedAgent`). Casos a agregar:
  - **Concurrencia**: `Promise.all([handler(req1), handler(req2)])` con el mismo `report_id` y un
    payload de varios assets → un solo doc por asset, un solo snapshot, y una de las dos respuestas
    con `status: 'processing'`.
  - **Tenant**: agente B postea un `report_id` que ya existe para el agente A → 409, la fila de A
    queda intacta (mismo `status`, mismo `raw_payload`) y no se creó ningún asset para B.
  - **Claim huérfano**: fila en `processing` con `claimed_at` de hace 20 min → la nueva entrega
    re-clama y procesa.
  - **Legado**: fila en `received` sin `claimed_at` → se re-clama y procesa (ruta de rollout).
  - Los tests actuales de idempotencia (`:65`) y del scan degradado→full (`:99`) deben seguir verdes
    sin tocarlos.
- `pnpm test` — nada en `domain/` cambia; sirve como red de seguridad.
- `pnpm type-check`.
- Manual: `docker-compose up`, correr el agente contra un rango chico dos veces con el mismo
  `report_id` forzado y mirar `scan-reports` en el panel (`processing` → `processed`, un solo
  snapshot).

## Fuera de alcance (anotado, no incluido)

- **`scanner-prototype`, PR aparte**: `_post_once` debería tratar 409/429/5xx como `retryable=True`
  para que `flush_queue` no descarte reportes ante fallos transitorios. Es prerequisito del `TODO`
  del 409.
- try/catch por asset volcando a `rejectedAssets`, guarda de monotonía sobre `last_seen`, `sort` en
  la búsqueda por IP, y transacción real pasando `req` a la Local API — puntos 2, 4 y 5 de la review
  previa.
- Todo el flujo sigue necesitando el comentario `// AUDIT:` que ya está en `:15-16`; no cambia.
