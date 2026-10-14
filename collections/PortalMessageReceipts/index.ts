import type { CollectionConfig } from 'payload'

export const PortalMessageReceipts: CollectionConfig = {
  slug: 'portal-message-receipts',
  admin: { useAsTitle: 'id' },
  indexes: [{ fields: ['message', 'user'], unique: true }],
  access: {
    create: () => false,
    read: () => false,
    update: () => false,
    delete: () => false,
  },
  fields: [
    {
      name: 'message',
      type: 'relationship',
      relationTo: 'portal-messages',
      required: true,
      index: true,
    },
    { name: 'user', type: 'relationship', relationTo: 'users', required: true, index: true },
    { name: 'delivery_version', type: 'number', required: true, defaultValue: 1 },
    { name: 'seen_at', type: 'date' },
    { name: 'dismissed_at', type: 'date' },
  ],
  timestamps: true,
}

export default PortalMessageReceipts
