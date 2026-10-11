// Oficinas de la organización demo, compartidas por scripts/seed-navigation.ts (las crea) y
// domain/demo/seedDemoData.ts (las busca). `legacyName` es el nombre genérico de bases sembradas
// antes: se sigue reconociendo y se reemplaza al reparar, sin tocar un nombre editado a mano.
export const DEMO_OFFICES = {
  main: {
    name: 'Casa Central Palermo',
    legacyName: 'Main Office',
    province_id: '02',
    department_id: '02098', // CABA, Comuna 14
  },
  secondary: {
    name: 'Centro Logístico Rosario',
    legacyName: 'Secondary Office',
    province_id: '82',
    department_id: '82084', // Santa Fe, Rosario
  },
} as const

export type DemoOffice = (typeof DEMO_OFFICES)[keyof typeof DEMO_OFFICES]

/** Coincide con el nombre actual o con el heredado. */
export function isDemoOffice(name: string | null | undefined, office: DemoOffice) {
  return name === office.name || name === office.legacyName
}
