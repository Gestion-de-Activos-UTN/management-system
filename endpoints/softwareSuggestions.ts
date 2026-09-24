import type { Endpoint } from 'payload'
import { getTenantContext } from '../access/tenant/resolveTenantContext'
import { canDo } from '../access/rbac/permissions'

function json(body: unknown, status = 200) {
  return Response.json(body, { status })
}

// Alimenta los dos Autocomplete del form de NonNetworkAssets con lo que la propia organización ya
// escribió: sin catálogo canónico de productos, la consistencia sale de que el segundo que carga
// elija en vez de tipear. Scopeado por organización y nunca por oficina — dos sedes de la misma
// empresa comparten proveedores, y cruzar tenants revelaría qué productos usa otra empresa.
export const softwareSuggestionsEndpoint: Endpoint = {
  path: '/v1/software-suggestions',
  method: 'get',
  handler: async req => {
    const ctx = await getTenantContext(req)
    if (!ctx || !ctx.isActive) return json({ error: 'unauthenticated' }, 401)
    if (!ctx.organizationId) return json({ vendors: [], products: [] })
    if (!canDo(ctx.role, 'non-network-assets', 'read', ctx.organizationId))
      return json({ error: 'forbidden' }, 403)

    // COSTE: esto trae hasta 5000 filas COMPLETAS de non-network-assets a la memoria del proceso
    // para devolver dos listas de strings cortos. Es la parte cara del autocompletado y conviene
    // tenerla presente:
    //   - Por qué así: la Local API de Payload no expone DISTINCT ni agregaciones, así que la
    //     deduplicación tiene que pasar en Node. Un `find` grande y un fold es preferible a N
    //     consultas por tecla — el endpoint se llama UNA vez al abrir el form, nunca por keystroke;
    //     el filtrado mientras se tipea lo hace Mantine sobre la lista ya cacheada por React Query.
    //   - Techo real: una organización con miles de activos manuales con software cargado hace que
    //     cada apertura del form mueva esas filas enteras (Postgres -> app -> GC). No hay `select`
    //     acotando columnas porque no se usa en ningún find del repo todavía; agregarlo acá es la
    //     primera mejora, y es barata.
    //   - Si eso no alcanza: query cruda con SELECT DISTINCT vía payload.db.drizzle, o un endpoint
    //     que reciba el texto tipeado y filtre server-side. Paginar esto NO sirve: para deduplicar
    //     hay que ver todas las filas igual.
    // find + fold en memoria hasta que un tenant real muestre que duele.
    const assets = await req.payload.find({
      collection: 'non-network-assets',
      where: {
        and: [
          { organization: { equals: ctx.organizationId } },
          { software_vendor: { exists: true } },
        ],
      },
      overrideAccess: true,
      req,
      depth: 0,
      limit: 5000,
    })

    const vendors = new Set<string>()
    const products = new Set<string>()
    for (const asset of assets.docs) {
      if (asset.software_vendor) vendors.add(asset.software_vendor)
      if (asset.software_product) products.add(asset.software_product)
    }

    return json({ vendors: [...vendors].sort(), products: [...products].sort() })
  },
}
