import { getPayload } from 'payload'
import config from '../payload.config'
import { seedDemoData } from '../domain/demo/seedDemoData'

async function main() {
  const payload = await getPayload({ config })
  const summary = await seedDemoData(payload)
  console.log('Seed demo integral OK.', summary)
  process.exit(0)
}

main().catch(error => {
  console.error('Seed demo integral falló.', error)
  process.exit(1)
})
