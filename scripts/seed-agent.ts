import { getPayload } from 'payload'
import config from '../payload.config'

const DEMO_AGENT_ID = 'agent-001'

// Paso manual de aprovisionamiento (documentation/05-inventory-architecture.md §5.3, 08-platform-scanner-communication.md §8.4):
// sin Auth0/Users/RBAC todavía, el alta de Organization→Office→Agent pasa por acá, con overrideAccess,
// no por el admin panel ni por la API pública.
//
// Idempotente a propósito: se corre en cada arranque del container (docker-compose.yml) — si
// el agente demo ya existe, no lo recrea.
async function main() {
  const payload = await getPayload({ config })

  const existing = await payload.find({
    collection: 'agents',
    where: { id: { equals: DEMO_AGENT_ID } },
    overrideAccess: true,
    limit: 1,
  })
  if (existing.docs.length > 0) {
    console.log(`seed-agent: '${DEMO_AGENT_ID}' ya existe, no se recrea.`)
    process.exit(0)
  }

  // Reusa la Office de la organización demo de scripts/seed-navigation.ts si ya corrió (debería
  // correr antes, ver docker-compose.yml) — evita una segunda organización solo para el Agent.
  // Sin eso corriendo (ej. seed:agent standalone), crea su propia Organization/Office de fallback.
  const existingOffice = await payload.find({
    collection: 'offices',
    overrideAccess: true,
    limit: 1,
    sort: 'createdAt',
  })

  let office = existingOffice.docs[0]
  if (!office) {
    const organization = await payload.create({
      collection: 'organizations',
      data: { name: 'Org Demo' },
      overrideAccess: true,
    })
    office = await payload.create({
      collection: 'offices',
      data: { organization: organization.id, name: 'Oficina Demo' },
      overrideAccess: true,
    })
  }

  // DEMO_AGENT_API_KEY (docker-compose.yml, dev only): con un token fijo conocido de antemano,
  // scanner-prototype/run_agent.sh puede apuntar a este agente sin copiar nada de los logs —
  // ver access/Agents/index.ts::beforeChange para el otro lado de este canal (`context.seedApiKey`).
  // Sin la env var, cae al comportamiento anterior: token random, mostrado una sola vez acá.
  const fixedApiKey = process.env.DEMO_AGENT_API_KEY
  const agent = await payload.create({
    collection: 'agents',
    data: { id: DEMO_AGENT_ID, office: office.id },
    overrideAccess: true,
    context: fixedApiKey ? { seedApiKey: fixedApiKey } : undefined,
  })

  console.log(`seed-agent: '${agent.id}' creado (office ${office.id}).`)
  if (fixedApiKey) {
    console.log('seed-agent: usando el token fijo de DEMO_AGENT_API_KEY (ver docker-compose.yml) — nada que copiar.')
  } else {
    console.log('API key (texto plano, solo se muestra ahora):', agent.apiKey)
  }

  process.exit(0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
