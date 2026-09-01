import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

// Helper solo para tests. buildAgentPackage() lee el fuente del scanner desde SCANNER_SOURCE_ROOT
// (buildAgentPackage.ts): se apunta a un fixture mínimo generado en tmp para no depender del repo
// hermano scanner-prototype, que ni siquiera está clonado en CI.
export async function withScannerFixture<T>(run: () => Promise<T>): Promise<T> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'siam-scanner-fixture-'))
  await fs.mkdir(path.join(root, 'src', 'siam_agent'), { recursive: true })
  await fs.writeFile(path.join(root, 'src', 'siam_agent', 'agent.py'), '# fixture\n')
  await fs.writeFile(path.join(root, 'requirements.txt'), '')
  const previous = process.env.SCANNER_SOURCE_ROOT
  process.env.SCANNER_SOURCE_ROOT = root
  try {
    return await run()
  } finally {
    if (previous == null) delete process.env.SCANNER_SOURCE_ROOT
    else process.env.SCANNER_SOURCE_ROOT = previous
    await fs.rm(root, { recursive: true, force: true })
  }
}
