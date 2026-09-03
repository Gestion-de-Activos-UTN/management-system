import fs from 'node:fs/promises'
import path from 'node:path'
import JSZip from 'jszip'

// SO destino del paquete — no confundir con la "plataforma" SIAM de platformUrl/platformToken.
// 'posix' cubre Linux y macOS: los dos usan el mismo launcher bash.
export type AgentPlatform = 'posix' | 'windows'

const AGENT_PLATFORMS: readonly string[] = ['posix', 'windows']

export function isAgentPlatform(value: unknown): value is AgentPlatform {
  return typeof value === 'string' && AGENT_PLATFORMS.includes(value)
}

export interface AgentPackageConfig {
  agentId: string
  platformToken: string
  platformUrl: string
  heartbeatUrl: string
  platform: AgentPlatform
}

const scannerRoot = () =>
  process.env.SCANNER_SOURCE_ROOT || path.resolve(process.cwd(), '../scanner-prototype')

async function addDirectory(zip: JSZip, sourceDirectory: string, archiveDirectory: string) {
  const entries = await fs.readdir(sourceDirectory, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.name === '__pycache__' || entry.name.endsWith('.pyc')) continue
    const sourcePath = path.join(sourceDirectory, entry.name)
    const archivePath = `${archiveDirectory}/${entry.name}`
    if (entry.isSymbolicLink()) throw new Error(`Symlink no permitido en el paquete: ${sourcePath}`)
    if (entry.isDirectory()) {
      await addDirectory(zip, sourcePath, archivePath)
    } else if (entry.isFile()) {
      zip.file(archivePath, await fs.readFile(sourcePath))
    }
  }
}

// Todo el texto generado acá se escribe con LF; para el paquete Windows se traduce a CRLF al
// meterlo en el zip. Un .cmd con LF solo puede romper de formas raras (labels/goto), y el .env
// y el README abiertos en Notepad quedarían en una sola línea.
function addTextFile(
  zip: JSZip,
  archivePath: string,
  content: string,
  platform: AgentPlatform,
  options?: JSZip.JSZipFileOptions
) {
  zip.file(archivePath, platform === 'windows' ? content.replace(/\n/g, '\r\n') : content, options)
}

function generatedEnv(config: AgentPackageConfig) {
  return [
    `AGENT_ID=${config.agentId}`,
    `PLATFORM_TOKEN=${config.platformToken}`,
    `PLATFORM_URL=${config.platformUrl}`,
    `HEARTBEAT_URL=${config.heartbeatUrl}`,
    '',
  ].join('\n')
}

const POSIX_LAUNCHER = [
  '#!/usr/bin/env bash',
  'set -a',
  'source "$(dirname "${BASH_SOURCE[0]}")/.env"',
  'set +a',
  '',
  'SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"',
  'PYTHON_BIN="${PYTHON_BIN:-python3}"',
  'VENV_DIR="$SCRIPT_DIR/.siam-agent-venv"',
  'VENV_READY="$VENV_DIR/.siam-requirements-installed"',
  '# Gated on the marker, not on the interpreter: a venv whose pip install failed still has a',
  '# bin/python, and gating on that would skip the retry and start the agent without its deps.',
  'if [ ! -f "$VENV_READY" ]; then',
  '  if [ ! -x "$VENV_DIR/bin/python" ]; then',
  '    "$PYTHON_BIN" -m venv "$VENV_DIR" || exit 1',
  '  fi',
  '  "$VENV_DIR/bin/python" -m pip install -r "$SCRIPT_DIR/requirements.txt" || exit 1',
  '  touch "$VENV_READY"',
  'fi',
  'PYTHONPATH="$SCRIPT_DIR/src" exec "$VENV_DIR/bin/python" -m siam_agent.agent "$@"',
].join('\n')

// Equivalente 1:1 del launcher POSIX. Dos diferencias que no son estéticas: PowerShell no tiene
// el `set -a; source` de bash (el .env se parsea a mano) y el intérprete del venv vive en
// Scripts\python.exe, no en bin/python.
const WINDOWS_LAUNCHER_PS1 = [
  '$ErrorActionPreference = "Stop"',
  '$ScriptDir = $PSScriptRoot',
  '',
  'foreach ($line in Get-Content -LiteralPath (Join-Path $ScriptDir ".env")) {',
  '  $trimmed = $line.Trim()',
  '  if ($trimmed -eq "" -or $trimmed.StartsWith("#")) { continue }',
  '  $pair = $trimmed -split "=", 2',
  '  if ($pair.Count -eq 2) {',
  '    [Environment]::SetEnvironmentVariable($pair[0].Trim(), $pair[1].Trim(), "Process")',
  '  }',
  '}',
  '',
  '# Plain "python" resolves to the Microsoft Store stub on a Windows box without Python, which',
  '# opens the Store instead of failing: prefer the py launcher, which only exists for a real one.',
  'if ($env:PYTHON_BIN) {',
  '  $PythonBin = $env:PYTHON_BIN',
  '  $PythonArgs = @()',
  '} elseif (Get-Command py -ErrorAction SilentlyContinue) {',
  '  $PythonBin = "py"',
  '  $PythonArgs = @("-3")',
  '} else {',
  '  $PythonBin = "python"',
  '  $PythonArgs = @()',
  '}',
  '',
  '$VenvDir = Join-Path $ScriptDir ".siam-agent-venv"',
  '$VenvPython = Join-Path $VenvDir "Scripts\\python.exe"',
  '$VenvReady = Join-Path $VenvDir ".siam-requirements-installed"',
  '# Gated on the marker, not on the interpreter: a venv whose pip install failed still has a',
  '# Scripts\\python.exe, and gating on that would skip the retry and start the agent without its',
  '# deps. $ErrorActionPreference does not catch this on its own — in Windows PowerShell a native',
  '# executable returning a non-zero exit code is not a terminating error, hence the explicit checks.',
  'if (-not (Test-Path -LiteralPath $VenvReady)) {',
  '  if (-not (Test-Path -LiteralPath $VenvPython)) {',
  '    & $PythonBin @PythonArgs -m venv $VenvDir',
  '    if ($LASTEXITCODE -ne 0) {',
  '      throw "Could not create the virtual environment (exit $LASTEXITCODE). Install Python 3.10+ and retry."',
  '    }',
  '  }',
  '  & $VenvPython -m pip install -r (Join-Path $ScriptDir "requirements.txt")',
  '  if ($LASTEXITCODE -ne 0) {',
  '    throw "pip install failed (exit $LASTEXITCODE). Check network access and retry."',
  '  }',
  '  New-Item -ItemType File -Path $VenvReady -Force | Out-Null',
  '}',
  '',
  '$env:PYTHONPATH = Join-Path $ScriptDir "src"',
  '& $VenvPython -m siam_agent.agent @args',
  '# `&` does not replace the process the way bash `exec` does: forward the agent exit code.',
  'exit $LASTEXITCODE',
].join('\n')

// El .ps1 es el launcher real; este wrapper existe solo para que el doble clic funcione sin que
// el usuario pelee con la política de ejecución de PowerShell. `%~dp0` ya trae la barra final.
const WINDOWS_LAUNCHER_CMD = [
  '@echo off',
  'powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-agent.ps1" %*',
].join('\n')

const README_HEADER = `# SIAM Agent

This package is preconfigured for one SIAM office. Do not edit .env: it contains the
agent identity and credential generated by the platform.
`

const README_POSIX = `## Linux and macOS

Requirements: Python 3.10+, python3-venv, and nmap.

On Ubuntu/Debian:

  sudo apt install python3 python3-venv nmap

On macOS with Homebrew:

  brew install python nmap

Run one scan:

  chmod +x start-agent.sh
  ./start-agent.sh --once

Run continuously:

  ./start-agent.sh

To scan a specific network:

  ./start-agent.sh --once --network 192.168.1.0/24

The first run creates a local virtual environment and installs requirements.txt.
The launcher is a source script; this package does not contain native binaries.

## Permissions

Without elevated permissions the agent falls back to an unprivileged TCP-connect
scan. Run with sudo only when raw-socket scans or OS detection are required:

  sudo ./start-agent.sh --once
`

const README_WINDOWS = `## Windows

Requirements: Python 3.10+ and Nmap for Windows, whose installer also provides the
Npcap driver:

  winget install Python.Python.3.12
  winget install Insecure.Nmap

Nmap can also be downloaded from https://nmap.org/download#windows.

Before extracting: right-click the .zip file, open Properties and tick Unblock.
Windows marks files downloaded from the internet, and unblocking the archive clears
that mark on everything extracted from it.

Run one scan, by double-clicking start-agent.cmd or from a terminal:

  .\\start-agent.cmd --once

Run continuously:

  .\\start-agent.cmd

To scan a specific network:

  .\\start-agent.cmd --once --network 192.168.1.0/24

start-agent.cmd only forwards to start-agent.ps1, which does the real work: it reads
.env, and on the first run creates a local virtual environment and installs
requirements.txt. Both launchers are source scripts; this package does not contain
native binaries.

## Permissions

Without elevated permissions the agent falls back to an unprivileged TCP-connect
scan. Right-click start-agent.cmd and choose "Run as administrator" only when
raw-socket scans or OS detection are required.
`

const README_TROUBLESHOOTING = `## Troubleshooting

- A 401 response means the agent credential is invalid or revoked. Download a new
  package from Administration > Offices.
- If the platform is unreachable, verify PLATFORM_URL in .env and network access.
- The scanner must be installed on the network represented by this office.
`

function generatedReadme(platform: AgentPlatform) {
  const body = platform === 'windows' ? README_WINDOWS : README_POSIX
  return [README_HEADER, body, README_TROUBLESHOOTING].join('\n')
}

export async function buildAgentPackage(config: AgentPackageConfig): Promise<Uint8Array> {
  const root = scannerRoot()
  const { platform } = config
  const zip = new JSZip()

  await addDirectory(zip, path.join(root, 'src', 'siam_agent'), 'src/siam_agent')
  zip.file('requirements.txt', await fs.readFile(path.join(root, 'requirements.txt')))

  // Solo el launcher del SO elegido: el paquete llega sin archivos que ese usuario no puede correr.
  if (platform === 'windows') {
    addTextFile(zip, 'start-agent.ps1', WINDOWS_LAUNCHER_PS1, platform)
    addTextFile(zip, 'start-agent.cmd', WINDOWS_LAUNCHER_CMD, platform)
  } else {
    addTextFile(zip, 'start-agent.sh', POSIX_LAUNCHER, platform, { unixPermissions: '755' })
  }
  addTextFile(zip, '.env', generatedEnv(config), platform, { unixPermissions: '600' })
  addTextFile(zip, 'README.md', generatedReadme(platform), platform)

  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
}
