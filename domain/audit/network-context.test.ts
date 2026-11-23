import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createSecretKey } from 'node:crypto'
import { FIXTURE_ENVELOPE, FIXTURE_NETWORK_CONTEXT } from './envelope.fixture'
import { computeNetworkDigest } from './hmac'
import { AuditNetworkContextError, canonicalIp, parseNetworkContext } from './network-context'

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
