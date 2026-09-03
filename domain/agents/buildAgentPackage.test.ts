import { test } from 'node:test'
import assert from 'node:assert/strict'
import JSZip from 'jszip'
import { buildAgentPackage, isAgentPlatform, type AgentPlatform } from './buildAgentPackage'
import { withScannerFixture } from './scanner-source-fixture'

const BASE_CONFIG = {
  agentId: 'agent-00000000-0000-0000-0000-000000000000',
  platformToken: 'token-de-prueba',
  platformUrl: 'http://localhost/api/v1/reports',
  heartbeatUrl: 'http://localhost/api/v1/heartbeat',
}

async function buildZip(platform: AgentPlatform) {
  return withScannerFixture(async () => {
    const bytes = await buildAgentPackage({ ...BASE_CONFIG, platform })
    return JSZip.loadAsync(bytes)
  })
}

function fileNames(zip: JSZip) {
  return Object.values(zip.files)
    .filter(entry => !entry.dir)
    .map(entry => entry.name)
    .sort()
}

test('buildAgentPackage: el paquete posix trae solo el launcher bash', async () => {
  const zip = await buildZip('posix')
  assert.deepEqual(fileNames(zip), [
    '.env',
    'README.md',
    'requirements.txt',
    'src/siam_agent/agent.py',
    'start-agent.sh',
  ])
})

test('buildAgentPackage: el paquete windows trae el .ps1 y su wrapper .cmd, sin el .sh', async () => {
  const zip = await buildZip('windows')
  assert.deepEqual(fileNames(zip), [
    '.env',
    'README.md',
    'requirements.txt',
    'src/siam_agent/agent.py',
    'start-agent.cmd',
    'start-agent.ps1',
  ])
})

test('buildAgentPackage: el .env lleva las 4 variables en ambas plataformas', async () => {
  for (const platform of ['posix', 'windows'] as const) {
    const zip = await buildZip(platform)
    const env = await zip.file('.env')!.async('string')
    // El paquete windows escribe CRLF: se normaliza antes de comparar el contenido.
    const lines = env.replace(/\r\n/g, '\n').split('\n').filter(Boolean)
    assert.deepEqual(lines, [
      `AGENT_ID=${BASE_CONFIG.agentId}`,
      `PLATFORM_TOKEN=${BASE_CONFIG.platformToken}`,
      `PLATFORM_URL=${BASE_CONFIG.platformUrl}`,
      `HEARTBEAT_URL=${BASE_CONFIG.heartbeatUrl}`,
    ])
  }
})

// Un .cmd con LF solo puede romper de formas raras en cmd.exe, y es justo el detalle que un
// refactor de los strings generados rompe sin que se note en ningún otro test.
test('buildAgentPackage: los archivos del paquete windows usan CRLF', async () => {
  const zip = await buildZip('windows')
  for (const name of ['start-agent.cmd', 'start-agent.ps1', '.env', 'README.md']) {
    const content = await zip.file(name)!.async('string')
    assert.equal(/\n/.test(content), true, `${name} no tiene saltos de línea`)
    assert.equal(/(^|[^\r])\n/.test(content), false, `${name} tiene un LF suelto sin CR`)
  }
})

test('buildAgentPackage: el launcher posix se mantiene en LF', async () => {
  const zip = await buildZip('posix')
  const content = await zip.file('start-agent.sh')!.async('string')
  assert.equal(content.includes('\r'), false)
  assert.equal(content.startsWith('#!/usr/bin/env bash'), true)
})

// Un venv cuyo pip install falló igual tiene intérprete: si el bootstrap se gatea sobre el
// intérprete, la corrida siguiente saltea el bloque y arranca el agente sin dependencias. Los dos
// launchers tienen que gatear sobre el marcador y cortar si el pip devuelve error.
test('buildAgentPackage: los launchers no dan por instalado un venv a medio armar', async () => {
  const sh = await (await buildZip('posix')).file('start-agent.sh')!.async('string')
  assert.equal(sh.includes('if [ ! -f "$VENV_READY" ]; then'), true)
  assert.match(sh, /pip install -r "\$SCRIPT_DIR\/requirements\.txt" \|\| exit 1/)
  assert.equal(sh.includes('touch "$VENV_READY"'), true)

  const ps1 = await (await buildZip('windows')).file('start-agent.ps1')!.async('string')
  assert.equal(ps1.includes('if (-not (Test-Path -LiteralPath $VenvReady)) {'), true)
  // En Windows PowerShell un exe nativo con exit code != 0 no es un error terminante, así que
  // $ErrorActionPreference no alcanza: el chequeo explícito es la única red.
  assert.equal(ps1.split('if ($LASTEXITCODE -ne 0) {').length - 1, 2)
  assert.equal(ps1.includes('New-Item -ItemType File -Path $VenvReady'), true)
})

test('buildAgentPackage: el launcher windows prefiere el py launcher antes que "python"', async () => {
  const ps1 = await (await buildZip('windows')).file('start-agent.ps1')!.async('string')
  assert.equal(ps1.includes('Get-Command py -ErrorAction SilentlyContinue'), true)
  assert.equal(ps1.includes('$PythonArgs = @("-3")'), true)
  // PYTHON_BIN sigue teniendo prioridad sobre la autodetección.
  assert.match(ps1, /if \(\$env:PYTHON_BIN\) \{/)
})

test('buildAgentPackage: el README describe solo la plataforma pedida', async () => {
  const posix = await (await buildZip('posix')).file('README.md')!.async('string')
  assert.equal(posix.includes('## Linux and macOS'), true)
  assert.equal(posix.includes('## Windows'), false)

  const windows = await (await buildZip('windows')).file('README.md')!.async('string')
  assert.equal(windows.includes('## Windows'), true)
  assert.equal(windows.includes('## Linux and macOS'), false)
  // El bloque compartido de troubleshooting tiene que sobrevivir en las dos ramas.
  assert.equal(windows.includes('## Troubleshooting'), true)
  assert.equal(posix.includes('## Troubleshooting'), true)
})

test('isAgentPlatform: acepta los dos valores válidos y rechaza cualquier otra cosa', () => {
  assert.equal(isAgentPlatform('posix'), true)
  assert.equal(isAgentPlatform('windows'), true)
  assert.equal(isAgentPlatform('linux'), false)
  assert.equal(isAgentPlatform(''), false)
  assert.equal(isAgentPlatform(undefined), false)
  assert.equal(isAgentPlatform({ platform: 'windows' }), false)
})
