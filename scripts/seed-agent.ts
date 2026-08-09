import { getPayload } from 'payload'
import config from '../payload.config'

const DEMO_AGENT_ID = 'agent-001'

// Paso manual de aprovisionamiento (documentation/05-inventory-architecture.md §5.3, 08-platform-scanner-communication.md §8.4):
// sin Auth0/Users/RBAC todavía, el alta de Organization→Office→Agent pasa por acá, con overrideAccess,
// no por el admin panel ni por la API pública.
//
// Idempotente a propósito: se corre en cada arranque del container (docker-compose.yml) — si
// el agente demo ya existe, no lo recrea (no hay token plano para re-mostrar, ya quedó hasheado).
async function main() {
  const payload = await getPayload({ config })

  const existing = await payload.find({
    collection: 'agents',
    where: { id: { equals: DEMO_AGENT_ID } },
    overrideAccess: true,
    limit: 1,
  })
  if (existing.docs.length > 0) {
    console.log(`Agent '${DEMO_AGENT_ID}' ya existe — no se recrea.`)
    console.log('Si perdiste el token, revocá este agente en la DB y volvé a correr el seed.')
    process.exit(0)
  }

  const organization = await payload.create({
    collection: 'organizations',
    data: { name: 'Org Demo' },
    overrideAccess: true,
  })

  const office = await payload.create({
    collection: 'offices',
    data: { organization: organization.id, name: 'Oficina Demo' },
    overrideAccess: true,
  })

  const agent = await payload.create({
    collection: 'agents',
    data: { id: DEMO_AGENT_ID, office: office.id },
    overrideAccess: true,
  })

  console.log('Organization:', organization.id)
  console.log('Office:', office.id)
  console.log('Agent:', agent.id)
  console.log('API key (texto plano, solo se muestra ahora):', agent.apiKey)

  process.exit(0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
