import type { CollectionConfig } from 'payload'

// Sin lectura ni escritura externa esta fase — solo lo escribe
// domain/organizations/createOrgWithAdmin.ts vía overrideAccess. Sin AppSettings
// singleton todavía, así que risk_score_policy no tiene lógica de default heredado.
export const OrganizationSettings: CollectionConfig = {
  slug: 'organization-settings',
  admin: {
    useAsTitle: 'industry',
  },
  access: {
    create: () => false,
    read: () => false,
    update: () => false,
    delete: () => false,
  },
  fields: [
    {
      name: 'organization',
      type: 'relationship',
      relationTo: 'organizations',
      required: true,
      unique: true,
      index: true,
    },
    {
      name: 'industry',
      type: 'text',
      required: true,
    },
    {
      name: 'risk_score_policy',
      type: 'json',
    },
    {
      // Default de NonNetworkAssets.next_review_at, aplicado en su beforeChange cuando el usuario
      // no manda fecha (el override por-asset siempre gana).
      name: 'review_policy',
      type: 'json',
    },
  ],
}

export default OrganizationSettings
