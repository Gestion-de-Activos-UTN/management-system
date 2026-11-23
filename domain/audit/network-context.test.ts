import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createSecretKey } from 'node:crypto'
import { FIXTURE_ENVELOPE, FIXTURE_NETWORK_CONTEXT } from './envelope.fixture'
import { computeNetworkDigest } from './hmac'
import {
  AuditNetworkConfigError,
  AuditNetworkContextError,
  canonicalIp,
  parseNetworkContext,
  requestNetwork,
  trustedProxyHops,
} from './network-context'

function issuesFor(value: unknown): string[] {
  try {
    parseNetworkContext(value)
  } catch (error) {
    assert.ok(
      error instanceof AuditNetworkContextError,
      `se esperaba AuditNetworkContextError: ${error}`
    )
    return [...error.issues]
  }
  assert.fail('se esperaba que el contexto fuera rechazado')
}

test('canonicalIp normaliza IPv4, IPv6 (RFC 5952) e IPv4 mapeada', () => {
  const cases: Array<[string, string, 'ipv4' | 'ipv6']> = [
    ['203.0.113.7', '203.0.113.7', 'ipv4'],
    ['0.0.0.0', '0.0.0.0', 'ipv4'],
    ['2001:DB8:0:0:0:0:0:1', '2001:db8::1', 'ipv6'],
    ['2001:0db8::0001', '2001:db8::1', 'ipv6'],
    ['2001:db8:0:0:1:0:0:1', '2001:db8::1:0:0:1', 'ipv6'],
    ['0:0:0:0:0:0:0:0', '::', 'ipv6'],
    ['::1', '::1', 'ipv6'],
    ['::ffff:192.0.2.1', '192.0.2.1', 'ipv4'],
    ['::FFFF:c000:0201', '192.0.2.1', 'ipv4'],
    ['::ffff:5', '::ffff:5', 'ipv6'],
  ]
  for (const [raw, ip, family] of cases) assert.deepEqual(canonicalIp(raw), { ip, family }, raw)
})

test('canonicalIp rechaza lo que no es una IP literal admitida', () => {
  for (const raw of [
    '',
    'localhost',
    '01.2.3.4',
    '1.2.3',
    '256.1.1.1',
    ' 1.2.3.4',
    '1.2.3.4 ',
    '1.2.3.4:80',
    '[::1]',
    '[::1]:443',
    'fe80::1%eth0',
    '2001:db8::1::2',
    '1.2.3.4, 5.6.7.8',
    `${'1'.repeat(70)}`,
  ])
    assert.equal(canonicalIp(raw), null, JSON.stringify(raw))
})

test('acepta contextos con IP y sin IP', () => {
  assert.deepEqual(parseNetworkContext(FIXTURE_NETWORK_CONTEXT), FIXTURE_NETWORK_CONTEXT)
  const at = '2026-11-22T21:05:39.123Z'
  assert.doesNotThrow(() =>
    parseNetworkContext({ source: 'direct', ip: '2001:db8::1', family: 'ipv6', captured_at: at })
  )
  for (const source of ['unknown', 'none'])
    assert.doesNotThrow(() =>
      parseNetworkContext({ source, ip: null, family: null, captured_at: at })
    )
})

test('rechaza cada regla del contexto indicando el campo', () => {
  const base = FIXTURE_NETWORK_CONTEXT
  const cases: Array<[string, Record<string, unknown>, string]> = [
    ['fuente desconocida', { ...base, source: 'header' }, 'source'],
    ['sin proxy pero con IP', { ...base, source: 'unknown' }, 'ip'],
    ['job con familia', { ...base, source: 'none', ip: null }, 'family'],
    ['proxy sin IP', { ...base, ip: null, family: null }, 'ip'],
    ['IPv6 no canónica', { ...base, ip: '2001:DB8::1', family: 'ipv6' }, 'ip'],
    ['IPv4 mapeada sin convertir', { ...base, ip: '::ffff:192.0.2.1', family: 'ipv6' }, 'ip'],
    ['IP con puerto', { ...base, ip: '203.0.113.7:443' }, 'ip'],
    ['familia que no corresponde', { ...base, family: 'ipv6' }, 'family'],
    ['fecha sin milisegundos', { ...base, captured_at: '2026-11-22T21:05:39Z' }, 'captured_at'],
    ['campo de más', { ...base, user_agent: 'Mozilla' }, '(contexto)'],
  ]
  for (const [name, value, field] of cases) {
    const issues = issuesFor(value)
    assert.ok(
      issues.some(issue => issue.startsWith(`${field}: `)),
      `${name}: se esperaba un error en ${field}, hubo ${JSON.stringify(issues)}`
    )
  }
})

test('los mensajes no incluyen la IP', () => {
  const issues = issuesFor({ ...FIXTURE_NETWORK_CONTEXT, ip: '198.51.100.23:8080' })
  assert.ok(!issues.join('\n').includes('198.51.100.23'))
})

test('el digest no se calcula sobre un contexto inválido', () => {
  const keys = new Map([['test-2026-11', createSecretKey(Buffer.alloc(32, 1))]])
  const input = {
    chain_id: FIXTURE_ENVELOPE.chain_id,
    event_id: FIXTURE_ENVELOPE.id,
    context: { ...FIXTURE_NETWORK_CONTEXT, ip: '2001:DB8::1', family: 'ipv6' },
  }
  assert.throws(() => computeNetworkDigest(input, 'test-2026-11', keys), AuditNetworkContextError)
})

// --- requestNetwork (02 §6) ---

const NOW = new Date('2026-11-23T12:34:56.789Z')
const withHeader = (value?: string) => ({
  headers: new Headers(value === undefined ? {} : { 'x-forwarded-for': value }),
})
const network = (hops: string | undefined, header?: string) =>
  requestNetwork(withHeader(header), { env: { AUDIT_TRUSTED_PROXY_HOPS: hops }, now: NOW })
const UNKNOWN = { source: 'unknown', ip: null, family: null, captured_at: NOW.toISOString() }

test('requestNetwork sin proxy configurado: unknown, aunque venga X-Forwarded-For', () => {
  assert.deepEqual(network(undefined, '203.0.113.7'), UNKNOWN)
  assert.deepEqual(network('0', '203.0.113.7'), UNKNOWN)
  assert.deepEqual(requestNetwork(withHeader('203.0.113.7'), { env: {}, now: NOW }), UNKNOWN)
})

test('requestNetwork con un proxy: la entrada de más a la derecha, nunca la primera', () => {
  assert.deepEqual(network('1', '203.0.113.7'), {
    source: 'trusted_proxy',
    ip: '203.0.113.7',
    family: 'ipv4',
    captured_at: NOW.toISOString(),
  })
  // Un cliente que manda su propio X-Forwarded-For: el proxy agrega la dirección real al final.
  assert.equal(network('1', '10.0.0.1, 192.0.2.99,198.51.100.4').ip, '198.51.100.4')
})

test('requestNetwork con varios proxies: la entrada N desde la derecha', () => {
  assert.equal(network('2', 'falsa, 203.0.113.7, 10.0.0.2').ip, '203.0.113.7')
  assert.equal(network('3', '203.0.113.7, 10.0.0.3, 10.0.0.2').ip, '203.0.113.7')
  // Menos entradas que proxies: el pedido no pasó por todos (o la configuración no coincide).
  assert.deepEqual(network('2', '203.0.113.7'), UNKNOWN)
})

test('requestNetwork normaliza IPv6 e IPv4 mapeada', () => {
  assert.deepEqual(
    [network('1', '2001:DB8:0:0::1').ip, network('1', '2001:DB8:0:0::1').family],
    ['2001:db8::1', 'ipv6']
  )
  assert.deepEqual(
    [network('1', '::ffff:203.0.113.7').ip, network('1', '::ffff:203.0.113.7').family],
    ['203.0.113.7', 'ipv4']
  )
})

test('requestNetwork: lo que no es una IP literal admitida da unknown', () => {
  for (const header of [
    '',
    '203.0.113.7:8080',
    '[2001:db8::1]:443',
    'fe80::1%eth0',
    'proxy.interno',
    'unknown',
    '203.0.113.7,',
    '203.0.113.256',
    `${'1.1.1.1, '.repeat(500)}203.0.113.7`,
  ])
    assert.deepEqual(network('1', header), UNKNOWN, JSON.stringify(header).slice(0, 40))
  assert.deepEqual(network('1'), UNKNOWN, 'sin la cabecera')
})

test('requestNetwork devuelve solo el contexto v1: nunca la cabecera cruda', () => {
  const context = network('1', 'cliente-falso, 203.0.113.7')
  assert.deepEqual(Object.keys(context).sort(), ['captured_at', 'family', 'ip', 'source'])
  assert.ok(!JSON.stringify(context).includes('cliente-falso'))
  assert.deepEqual(parseNetworkContext(context), context)
})

test('AUDIT_TRUSTED_PROXY_HOPS: entero de 0 a 5; el error no muestra el valor', () => {
  assert.equal(trustedProxyHops({}), 0)
  for (const [raw, expected] of [
    ['0', 0],
    ['1', 1],
    ['5', 5],
  ] as const)
    assert.equal(trustedProxyHops({ AUDIT_TRUSTED_PROXY_HOPS: raw }), expected)
  for (const raw of ['', '6', '-1', '01', '1.0', ' 1', 'dos', '10']) {
    assert.throws(
      () => trustedProxyHops({ AUDIT_TRUSTED_PROXY_HOPS: raw }),
      (error: unknown) =>
        error instanceof AuditNetworkConfigError && !error.message.includes(`"${raw}"`),
      JSON.stringify(raw)
    )
    assert.throws(() => network(raw, '203.0.113.7'), AuditNetworkConfigError)
  }
})
