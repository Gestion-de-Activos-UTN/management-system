// Inferencia explicable compartida por ingesta y UI. Nunca reemplaza la confirmación humana.
// Escaneo real: IP-only o IP+vendor es la norma, no la excepción (doc 05
// "qué no asumir") — por eso esto puntúa señales por peso en vez de exigir un AND estricto de
// puertos/servicios, que casi nunca están disponibles. vendor/hostname (resueltos por ARP/DNS)
// son mucho más frecuentes que services/os (requieren un port-scan exitoso), así que pesan
// parecido a un match de OS explícito, y el caso sin ninguna señal es de esperar, no una falla.
import type { ScannedAssetType } from './asset-types'

export type DeviceCategory = Exclude<ScannedAssetType, 'other'>

export type DeviceInferenceTier = 'likely' | 'possible' | 'unknown'

export interface DeviceInferenceInput {
  ip?: string | null
  mac?: string | null
  gateway_ip?: string | null
  gateway_mac?: string | null
  gateway_match_conflict?: boolean | null
  hostname?: string | null
  vendor?: string | null
  os?: { name?: string | null; accuracy?: number | null; device_type?: string | null } | null
  services?: Array<{
    port?: number | null
    product?: string | null
    name?: string | null
    state?: string | null
  }> | null
  is_scanner_host?: boolean | null
  scanner_host_match?: 'ip' | 'mac' | 'both' | 'conflict' | 'none' | 'unknown' | null
  mac_metadata?: { kind?: string | null } | null
  names?: Array<{ value?: string | null; source?: string | null }> | null
  asset_coverage?: {
    port_scan?: 'complete' | 'partial' | 'not_attempted' | 'unknown' | null
    service_detection?: 'complete' | 'partial' | 'not_attempted' | 'unknown' | null
    os_detection?: 'complete' | 'partial' | 'not_attempted' | 'unknown' | null
    name_resolution?: 'complete' | 'partial' | 'not_attempted' | 'unknown' | null
  } | null
}

export interface DeviceInference {
  category: DeviceCategory | null
  tier: DeviceInferenceTier
  signals: string[]
}

// Vendors ambiguos a propósito (ej. HP hace impresoras y PCs, Huawei hace routers y celulares) —
// el orden de esta lista es la interpretación default cuando ninguna otra señal desambigua.
const VENDOR_HINTS: Array<{ category: DeviceCategory; keywords: string[] }> = [
  {
    category: 'printer',
    keywords: ['hp', 'canon', 'epson', 'brother', 'lexmark', 'xerox', 'kyocera', 'zebra'],
  },
  {
    category: 'gateway',
    keywords: [
      'cisco',
      'tp-link',
      'tplink',
      'ubiquiti',
      'mikrotik',
      'netgear',
      'd-link',
      'dlink',
      'arris',
      'technicolor',
      'tenda',
      'huawei',
      'zte',
      'juniper',
      'aruba',
      'fortinet',
      'sagemcom',
    ],
  },
  {
    category: 'mobile',
    keywords: [
      'apple',
      'samsung',
      'xiaomi',
      'oneplus',
      'motorola',
      'oppo',
      'vivo',
      'realme',
      'google',
      'lg electronics',
      'sony',
      'nokia',
    ],
  },
  {
    category: 'workstation',
    keywords: ['dell', 'lenovo', 'asus', 'acer', 'microsoft', 'intel corporate', 'msi'],
  },
]

// ISP-issued CPE hostnames (ver doc: PTR asignado por el ISP, ej. "*.fibertel.com.ar") suelen
// llevar la marca/modelo del equipo en el propio hostname aunque `vendor` venga vacío — por eso
// esto también prueba las marcas de VENDOR_HINTS contra el hostname, no solo contra `vendor`.
const HOSTNAME_HINTS: Array<{ category: DeviceCategory; pattern: RegExp }> = [
  {
    category: 'gateway',
    pattern:
      /gateway|router|access-?point|\bap-|switch|modem|docsis|\bont\b|flowbox|homebox|livebox|fritz-?box|speedport|\bhgw\b|\bcpe\b/i,
  },
  { category: 'printer', pattern: /printer|\bmfp\b|jetdirect/i },
  // A propósito NUNCA se codifica un modelo/generación puntual (ej. "S25", "iPhone15") — eso
  // rompe con cada lanzamiento nuevo. Solo nombres de marca/línea de producto, estables en el
  // tiempo (no numerados), más la convención de nombre default de Android (no depende de marca).
  {
    category: 'mobile',
    pattern:
      /iphone|ipad|android|galaxy|pixel|redmi|poco|oneplus|honor|xperia|-phone\b|^android[-_][0-9a-f]{4,}/i,
  },
  { category: 'workstation', pattern: /^desktop-|^win-|^pc-|^laptop-/i },
]

const OS_HINTS: Array<{ category: DeviceCategory; pattern: RegExp }> = [
  // "iOS"/"Cisco IOS" colisionan en un regex case-insensitive genérico — se exige el nombre
  // completo tal como lo devuelve el fingerprint (Apple iOS/iPhone OS) para evitar falsos mobile.
  { category: 'mobile', pattern: /apple ios|iphone os|\bandroid\b/i },
  // VxWorks y kernels Linux viejos (2.x/3.0-3.2) son la firma típica de firmware embebido de
  // routers/CPE/IoT (confirmado contra datos reales: Docsis-Gateway/Tenda de este dataset caen
  // acá) — mucho más frecuente en la práctica que un server real corriendo esos kernels.
  {
    category: 'gateway',
    pattern: /vxworks|cisco ios|junos|routeros|openwrt|dd-wrt|^linux 2\.|^linux 3\.[0-2]\b/i,
  },
  { category: 'server', pattern: /windows server|ubuntu|centos|debian|red hat|fedora/i },
  { category: 'workstation', pattern: /windows(?! server)/i },
]

const NMAP_DEVICE_TYPE_HINTS: Array<{ category: DeviceCategory; pattern: RegExp }> = [
  { category: 'mobile', pattern: /phone|tablet/i },
  { category: 'gateway', pattern: /router|broadband router/i },
  { category: 'network_device', pattern: /switch|wireless access point|wap/i },
  { category: 'printer', pattern: /printer/i },
  { category: 'server', pattern: /server/i },
  { category: 'workstation', pattern: /general purpose|workstation/i },
  { category: 'iot', pattern: /embedded|specialized|media device|webcam|camera/i },
]

const PORT_HINTS: Array<{ category: DeviceCategory; ports: number[]; weight: number }> = [
  { category: 'printer', ports: [515, 631, 9100], weight: 3 },
  { category: 'workstation', ports: [445, 139, 3389], weight: 3 },
  { category: 'server', ports: [22, 3306, 5432, 1433, 27017, 6379], weight: 2 },
  // Servir DHCP a la red es casi por definición ser el gateway — señal más fuerte que cualquier
  // otra de esta tabla. DNS/NTP propios son más débiles (un asset cualquiera puede exponerlos)
  // pero siguen inclinando hacia "es la infraestructura de red", no un endpoint.
  { category: 'gateway', ports: [67, 68], weight: 4 },
  { category: 'gateway', ports: [53], weight: 2 },
  { category: 'gateway', ports: [123], weight: 1 },
]

// Software embebido típico de la interfaz web/DNS de un router doméstico — aparece en
// `services[].product`/`name`, no en el puerto (80/443 solos son demasiado ambiguos para pesar
// algo). Los productos "server" de acá pesan poco a propósito: en datos reales, nginx apareció
// en el propio gateway (panel admin embebido), no en un server real.
const PRODUCT_HINTS: Array<{ category: DeviceCategory; keywords: string[]; weight: number }> = [
  { category: 'gateway', keywords: ['goahead', 'rompager', 'boa httpd', 'dnsmasq'], weight: 2 },
  { category: 'printer', keywords: ['jetdirect', 'cups', 'ipp'], weight: 2 },
  {
    category: 'server',
    keywords: ['nginx', 'apache', 'openssh', 'mysql', 'postgresql', 'iis', 'powerdns'],
    weight: 1,
  },
]

export function inferDeviceCategory(asset: DeviceInferenceInput): DeviceInference {
  const scores: Partial<Record<DeviceCategory, number>> = {}
  const signals: Partial<Record<DeviceCategory, string[]>> = {}

  const add = (category: DeviceCategory, weight: number, reason: string) => {
    scores[category] = (scores[category] ?? 0) + weight
    signals[category] = [...(signals[category] ?? []), reason]
  }

  const vendor =
    asset.mac_metadata?.kind === 'locally_administered' ? '' : (asset.vendor?.toLowerCase() ?? '')
  const hostname = asset.hostname ?? ''
  const hostnameLower = hostname.toLowerCase()
  const osName = asset.os?.name ?? ''
  const nmapDeviceType = asset.os?.device_type ?? ''
  // Distinción real: el contrato del scanner garantiza `services` como array siempre presente
  // (nunca "no se escaneó") para cualquier Asset realmente ingresado — así que `[]` es una
  // observación confirmada. `services` ausente del todo (`servicesKnown` false) solo puede pasar
  // con datos sintéticos/incompletos, nunca con un Asset real; ahí no hay base para inferir nada.
  const services = asset.services ?? []
  const openServices = services.filter(service => service.state === 'open')
  const ports = openServices.map(s => s.port).filter((p): p is number => typeof p === 'number')
  const portCoverageComplete = asset.asset_coverage?.port_scan === 'complete'
  const allObservedPortsFiltered =
    services.length > 0 &&
    services.every(service => service.state === 'filtered' || service.state === 'open|filtered')

  const matchesGateway = Boolean(
    (asset.gateway_ip && asset.ip === asset.gateway_ip) ||
    (asset.gateway_mac && asset.mac?.toLowerCase() === asset.gateway_mac.toLowerCase())
  )
  const matchesScanner = Boolean(
    asset.is_scanner_host &&
    asset.scanner_host_match !== 'conflict' &&
    asset.scanner_host_match !== 'none' &&
    asset.scanner_host_match !== 'unknown'
  )

  if (
    asset.gateway_match_conflict ||
    asset.scanner_host_match === 'conflict' ||
    (matchesGateway && matchesScanner)
  ) {
    return {
      category: null,
      tier: 'unknown',
      signals: ['evidencia de identidad directa contradictoria'],
    }
  }

  // El gateway resuelto desde la tabla de ruteo/ARP del agente es una señal directa y mucho más
  // fuerte que inferir un router por marca o por un puerto común.
  if (matchesGateway) {
    add('gateway', 6, 'coincide con el gateway de la red')
  }

  if (matchesScanner) {
    add('workstation', 6, 'el escáner corre en este equipo')
  }

  const matchVendorKeyword = (text: string) =>
    VENDOR_HINTS.find(hint => hint.keywords.some(k => text.includes(k)))

  if (vendor) {
    const hint = matchVendorKeyword(vendor)
    if (hint) add(hint.category, 2, `fabricante "${asset.vendor}"`)
  }

  if (hostname) {
    for (const hint of HOSTNAME_HINTS) {
      if (hint.pattern.test(hostname)) {
        add(hint.category, 2, `nombre de host "${hostname}"`)
        break // primer patrón estructural que matchea gana — evita sumar en dos categorías a la vez
      }
    }
    // Además del patrón estructural, el hostname puede llevar directamente el nombre de marca
    // (ISP-CPE naming: "Tenda.fibertel.com.ar") aunque `vendor` esté vacío.
    const brandHint = matchVendorKeyword(hostnameLower)
    if (brandHint)
      add(
        brandHint.category,
        2,
        `el nombre de host menciona "${brandHint.keywords.find(k => hostnameLower.includes(k))}"`
      )
  }

  for (const name of asset.names ?? []) {
    if (!name.value || name.value === hostname) continue
    const sourceWeight = name.source === 'netbios' || name.source === 'mdns' ? 2 : 1
    const hint = HOSTNAME_HINTS.find(candidate => candidate.pattern.test(name.value ?? ''))
    if (hint) add(hint.category, sourceWeight, `nombre ${name.source ?? 'de red'} "${name.value}"`)
  }

  // "Windows" (o cualquier match hacia workstation) con cero puertos confirmados es
  // contradictorio: una PC Windows real casi siempre expone algo (SMB 445/mDNS/NetBIOS). Nmap
  // puede fingerprint-ear un celular como "Windows" con accuracy=100 (el problema no es baja
  // confianza declarada, es que su base de firmas TCP/IP no cubre bien mobile) — así que ese
  // combo específico se pesa menos en vez de confiar ciegamente en el nombre del OS.
  const workstationOsContradictsPorts =
    portCoverageComplete && !allObservedPortsFiltered && ports.length === 0
  if (osName) {
    for (const hint of OS_HINTS) {
      if (hint.pattern.test(osName)) {
        const weight = hint.category === 'workstation' && workstationOsContradictsPorts ? 1 : 3
        add(hint.category, weight, `sistema operativo "${osName}"`)
        break
      }
    }
  }

  if (nmapDeviceType) {
    const hint = NMAP_DEVICE_TYPE_HINTS.find(candidate => candidate.pattern.test(nmapDeviceType))
    if (hint) {
      const weight = (asset.os?.accuracy ?? 0) >= 85 ? 4 : 2
      add(hint.category, weight, `clase de dispositivo de Nmap "${nmapDeviceType}"`)
    }
  }

  if (ports.length > 0) {
    for (const hint of PORT_HINTS) {
      const matched = hint.ports.find(p => ports.includes(p))
      if (matched) add(hint.category, hint.weight, `puerto ${matched} abierto`)
    }
  }

  for (const service of openServices) {
    const text = `${service.product ?? ''} ${service.name ?? ''}`.toLowerCase()
    if (!text.trim()) continue
    for (const hint of PRODUCT_HINTS) {
      const matched = hint.keywords.find(k => text.includes(k))
      if (matched) add(hint.category, hint.weight, `servicio "${matched}"`)
    }
  }

  // `services: []` no es "no sabemos" — el contrato del scanner solo crea un Asset para hosts
  // que respondieron ("up"; ver ingestScanReport.ts) y `services` siempre es array, nunca
  // opcional. Cero puertos abiertos en un host confirmadamente vivo es entonces una observación
  // real: un PC/servidor/gateway/impresora casi siempre expone algo (SMB/RDP/mDNS, DHCP/DNS,
  // SSH/HTTP, 9100/631); un celular o tablet casi nunca. Peso moderado (no "likely" por sí
  // solo) porque un firewall agresivo puede producir el mismo resultado en cualquier equipo.
  if (portCoverageComplete && !allObservedPortsFiltered && ports.length === 0) {
    add('mobile', 2, 'sin puertos abiertos en el escaneo estándar completo')
  }

  const ranked = (Object.entries(scores) as Array<[DeviceCategory, number]>).sort(
    (a, b) => b[1] - a[1]
  )
  const [topCategory, topScore] = ranked[0] ?? [null, 0]
  const secondScore = ranked[1]?.[1] ?? 0

  if (!topCategory || topScore === 0) {
    return { category: null, tier: 'unknown', signals: [] }
  }

  return {
    category: topCategory,
    tier: topScore >= 3 && topScore - secondScore >= 2 ? 'likely' : 'possible',
    signals: signals[topCategory] ?? [],
  }
}

export const DEVICE_CATEGORY_LABEL: Record<DeviceCategory, string> = {
  workstation: 'Computadora / PC',
  mobile: 'Teléfono móvil',
  gateway: 'Gateway / Router',
  printer: 'Impresora',
  server: 'Servidor',
  network_device: 'Switch / Punto de acceso',
  iot: 'Dispositivo IoT / embebido',
}

export const DEVICE_CATEGORY_HELP: Record<DeviceCategory, string[]> = {
  workstation: [
    'Windows: ejecuta `hostname` en una consola, o revisa Configuración → Sistema → Acerca de.',
    'Linux: ejecuta `hostnamectl`.',
    'Compara la MAC que se muestra acá con `ipconfig /all` (Windows) o `ip link` (Linux) en el equipo.',
  ],
  mobile: [
    'En el dispositivo, revisa Ajustes → Acerca del teléfono / Wi-Fi → Dirección MAC.',
    'Compara esa MAC con la de este activo y contrástala con la lista de clientes conectados del router.',
  ],
  gateway: [
    'Abre la IP de este activo en un navegador: la mayoría de los routers/gateways muestra una página de administración.',
    'Revisa la etiqueta física del equipo para ver modelo y fabricante.',
  ],
  printer: [
    'Revisa la configuración de red en el panel de la propia impresora.',
    'Imprime una página de configuración de red desde el menú de la impresora (suele estar en Configuración/Red).',
  ],
  server: [
    'Revisa los servicios en ejecución del equipo (`systemctl list-units`, `netstat -tlnp` en Linux; `services.msc` en Windows).',
    'Confírmalo con quien administra la infraestructura de esa oficina: un servidor suele ser un activo conocido, no una sorpresa.',
  ],
  network_device: [
    'Revisa la etiqueta física y la interfaz de administración para conocer su función exacta en la red.',
    'Compara su MAC con la lista de clientes/dispositivos del router o controlador.',
  ],
  iot: [
    'Busca la dirección MAC de red en el propio dispositivo o en su aplicación.',
    'Confirma para qué se usa con la persona responsable de esta oficina.',
  ],
}

export const GENERIC_IDENTIFICATION_HELP: string[] = [
  'Busca esta IP o MAC en la lista de clientes DHCP del router/switch: muchos muestran el fabricante o el nombre del equipo.',
  'Si el dispositivo tiene pantalla o etiqueta física, búscalo ahí por MAC o fabricante.',
  'Abre esta IP en un navegador: si responde, puede mostrar una página de administración o de estado.',
  'Pregunta a la persona responsable de esa oficina o ubicación qué equipo tiene esta IP.',
]
