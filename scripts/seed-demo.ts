import config from '../payload.config'
import { seedDemoData } from '../domain/demo/seedDemoData'
import { initializeSeedPayload } from './seed-payload'

async function main() {
  const payload = await initializeSeedPayload(config)
  try {
    const profile = process.env.SIAM_SEED_PROFILE ?? 'expanded'
    if (profile !== 'standard' && profile !== 'expanded')
      throw new Error('SIAM_SEED_PROFILE debe ser standard o expanded')
    const summary = await seedDemoData(payload, { profile })
    console.log('Seed demo integral OK.', summary)
  } finally {
    await payload.destroy()
  }
  process.exit(0)
}

main().catch(error => {
  console.error('Seed demo integral falló.', error)
  process.exit(1)
})
