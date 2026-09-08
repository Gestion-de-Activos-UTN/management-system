import type { CollectionBeforeChangeHook } from 'payload'
import { relationId } from '@/lib/relationId'

export const enforceOrgAdminOffices: CollectionBeforeChangeHook = async ({
  data,
  originalDoc,
  req,
}) => {
  const organizationId = data?.organization
    ? relationId(data.organization)
    : originalDoc?.organization
      ? relationId(originalDoc.organization)
      : null
  const roleId = data?.role
    ? relationId(data.role)
    : originalDoc?.role
      ? relationId(originalDoc.role)
      : null
  if (!organizationId || !roleId) return data

  const role = await req.payload.findByID({
    collection: 'roles',
    id: roleId,
    overrideAccess: true,
    req,
    depth: 0,
  })
  if (role.slug !== 'org_admin') return data

  const offices = await req.payload.find({
    collection: 'offices',
    where: { organization: { equals: organizationId } },
    overrideAccess: true,
    req,
    depth: 0,
    limit: 1000,
  })

  return { ...data, offices: offices.docs.map(office => office.id) }
}
