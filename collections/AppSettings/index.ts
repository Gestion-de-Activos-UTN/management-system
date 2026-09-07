import type { CollectionConfig } from 'payload'

// Singleton de plataforma — mismo patrón cerrado que OrganizationSettings: sin lectura/escritura
// externa esta fase, solo se toca vía overrideAccess. Cierra el gap señalado en
// domain/inventories/agingSweep.ts y collections/OrganizationSettings/index.ts.
export const AppSettings: CollectionConfig = {
  slug: 'app-settings',
  admin: {
    useAsTitle: 'id',
  },
  access: {
    create: () => false,
    read: () => false,
    update: () => false,
    delete: () => false,
  },
  fields: [
    {
      // Default de plataforma para OrganizationSettings.offline_after_hours cuando una
      // organización no tiene override propio. Reemplaza (con fallback) la constante
      // DEFAULT_OFFLINE_AFTER_HOURS hardcodeada en domain/inventories/agingSweep.ts.
      name: 'default_offline_after_hours',
      type: 'number',
    },
  ],
}

export default AppSettings
