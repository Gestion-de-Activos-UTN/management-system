import type { Endpoint, PayloadRequest, Where } from 'payload'
import { getTenantContext, type TenantContext } from '@/access/tenant/resolveTenantContext'
import { assertCanReadTask, loadTask } from '@/domain/tasks/task-actions'
import { resolveTaskReference, tenantCanReadTaskReference } from '@/domain/tasks/task-reference'
import { messageTargetsUser } from '@/domain/portal-messages/targeting'
import { relationId } from '@/lib/relationId'
import { getTaskReferenceHref } from '@/modules/tasks/task-reference-link'
import { PORTAL_MESSAGE_SECTION_LINKS } from '@/modules/portal-messages/portal-message-labels'
import { PORTAL_MESSAGE_ROLES, PortalMessageInputSchema } from '@/modules/portal-messages/schema'
import { TASK_REFERENCE_COLLECTIONS } from '@/modules/tasks/schema'

const json = (body: unknown, status = 200) => Response.json(body, { status })
// ponytail: tope fijo de opciones; agregar búsqueda server-side si una organización lo supera.
const ENTITY_OPTIONS_LIMIT = 200

type MessageLink = {
  kind: 'section' | 'entity'
  relationTo: string
  value?: string
  label?: string
  href?: string | null
  access: 'allowed' | 'denied' | 'unavailable'
}

/** Resuelve, para quien recibe el mensaje, la sección o entidad enlazada y si puede abrirla. */
async function resolveMessageLink(
  req: PayloadRequest,
  ctx: TenantContext,
  message: { linked_section?: unknown; linked_entity?: unknown }
): Promise<MessageLink | null> {
  if (message.linked_entity) {
    const raw = message.linked_entity as { relationTo: string; value: unknown }
    const reference = { relationTo: raw.relationTo, value: relationId(raw.value) }
    try {
      if (reference.relationTo === 'tasks') {
        const task = await loadTask(req, reference.value)
        await assertCanReadTask(req, ctx, task)
        return {
          kind: 'entity',
          ...reference,
          label: task.title,
          href: `/portal/tasks/${reference.value}`,
          access: 'allowed',
        }
      }
      const resolved = await resolveTaskReference(req, reference as never)
      if (resolved.unavailable)
        return { kind: 'entity', relationTo: resolved.relationTo, access: 'unavailable' }
      if (!tenantCanReadTaskReference(ctx, resolved))
        return { kind: 'entity', relationTo: resolved.relationTo, access: 'denied' }
      return {
        kind: 'entity',
        relationTo: resolved.relationTo,
        value: resolved.value,
        label: resolved.label,
        href: getTaskReferenceHref(
          { ...resolved, available: true, office_id: resolved.officeId },
          undefined
        ),
        access: 'allowed',
      }
    } catch {
      return {
        kind: 'entity',
        relationTo: reference.relationTo,
        access: reference.relationTo === 'tasks' ? 'denied' : 'unavailable',
      }
    }
  }
  const section = message.linked_section ? String(message.linked_section) : null
  const sectionLink = section
    ? PORTAL_MESSAGE_SECTION_LINKS[section as keyof typeof PORTAL_MESSAGE_SECTION_LINKS]
    : undefined
  if (!section) return null
  return {
    kind: 'section',
    relationTo: section,
    label: sectionLink?.label,
    href: sectionLink?.href ?? null,
    access: sectionLink ? 'allowed' : 'unavailable',
  }
}

/** Etiqueta legible de la entidad enlazada, para la vista previa del panel de administración. */
async function adminEntityLabel(req: PayloadRequest, linkedEntity: unknown) {
  if (!linkedEntity) return null
  const raw = linkedEntity as { relationTo: string; value: unknown }
  const value = relationId(raw.value)
  try {
    if (raw.relationTo === 'tasks') return (await loadTask(req, value)).title
    return (await resolveTaskReference(req, { relationTo: raw.relationTo, value } as never)).label
  } catch {
    return null
  }
}

async function platformAdmin(req: PayloadRequest) {
  const ctx = await getTenantContext(req)
  if (!ctx || !ctx.isActive) return { response: json({ error: 'unauthenticated' }, 401) }
  if (!ctx.isPlatformAdmin || ctx.organizationId || req.user?.collection !== 'admins') {
    return { response: json({ error: 'forbidden' }, 403) }
  }
  return { ctx }
}

async function orgUser(req: PayloadRequest) {
  const ctx = await getTenantContext(req)
  if (!ctx || !ctx.isActive) return { response: json({ error: 'unauthenticated' }, 401) }
  if (ctx.isPlatformAdmin || !ctx.organizationId || !ctx.role) {
    return { response: json({ error: 'forbidden' }, 403) }
  }
  return { ctx }
}

function payloadData(input: ReturnType<typeof PortalMessageInputSchema.parse>, createdBy?: string) {
  const audience = input.audience
  return {
    title: input.title,
    description: input.description,
    message_type: input.message_type,
    template_key: input.template_key ?? null,
    cta_label: input.cta_label ?? null,
    scope: audience.scope,
    target_organizations: audience.scope === 'organizations' ? audience.organization_ids : [],
    target_kind: audience.scope === 'organizations' ? audience.target_kind : 'all',
    target_roles:
      audience.scope === 'organizations' && audience.target_kind === 'role'
        ? audience.role_slugs
        : [],
    target_users:
      audience.scope === 'organizations' && audience.target_kind === 'user'
        ? audience.user_ids
        : [],
    linked_section: input.linked_section ?? null,
    linked_entity_type: input.linked_entity_type ?? null,
    linked_entity: input.linked_entity
      ? { relationTo: input.linked_entity.relationTo, value: input.linked_entity.value }
      : null,
    expires_at: input.expires_at || null,
    is_active: input.is_active,
    ...(createdBy ? { created_by: createdBy } : {}),
  }
}

function messageInputFromDoc(doc: Record<string, unknown>) {
  const scope = doc.scope === 'global' ? 'global' : 'organizations'
  const target_kind = ['all', 'role', 'user'].includes(String(doc.target_kind))
    ? doc.target_kind
    : 'all'
  const audience =
    scope === 'global'
      ? { scope: 'global' as const }
      : target_kind === 'role'
        ? {
            scope: 'organizations' as const,
            target_kind: 'role' as const,
            organization_ids: ((doc.target_organizations as unknown[]) ?? []).map(relationId),
            role_slugs: (doc.target_roles as string[]) ?? [],
          }
        : target_kind === 'user'
          ? {
              scope: 'organizations' as const,
              target_kind: 'user' as const,
              organization_ids: ((doc.target_organizations as unknown[]) ?? []).map(relationId),
              user_ids: ((doc.target_users as unknown[]) ?? []).map(relationId),
            }
          : {
              scope: 'organizations' as const,
              target_kind: 'all' as const,
              organization_ids: ((doc.target_organizations as unknown[]) ?? []).map(relationId),
            }
  return {
    id: String(doc.id),
    title: String(doc.title ?? ''),
    description: String(doc.description ?? ''),
    message_type: doc.message_type,
    template_key: doc.template_key || undefined,
    cta_label: doc.cta_label ? String(doc.cta_label) : null,
    audience,
    linked_section: doc.linked_section ? String(doc.linked_section) : null,
    linked_entity_type: doc.linked_entity_type ? String(doc.linked_entity_type) : null,
    linked_entity: doc.linked_entity
      ? {
          relationTo: (doc.linked_entity as { relationTo: string }).relationTo,
          value: relationId((doc.linked_entity as { value: unknown }).value),
        }
      : null,
    expires_at: doc.expires_at ? String(doc.expires_at) : null,
    is_active: Boolean(doc.is_active),
    linked_entity_label: (doc.linked_entity_label as string | null | undefined) ?? null,
    delivery_version: Math.max(1, Number(doc.delivery_version ?? 1)),
    createdAt: doc.createdAt,
  }
}

async function validateAudience(
  req: PayloadRequest,
  input: ReturnType<typeof PortalMessageInputSchema.parse>
) {
  let orgIds: string[]
  if (input.audience.scope === 'organizations') {
    orgIds = input.audience.organization_ids
    const organizations = await req.payload.find({
      collection: 'organizations',
      where: { and: [{ id: { in: orgIds } }, { is_active: { equals: true } }] },
      overrideAccess: true,
      req,
      depth: 0,
      limit: orgIds.length,
    })
    if (organizations.docs.length !== new Set(orgIds).size) {
      throw new Error('Una organización no existe o está inactiva.')
    }
  } else {
    const organizations = await req.payload.find({
      collection: 'organizations',
      where: { is_active: { equals: true } },
      overrideAccess: true,
      req,
      depth: 0,
      pagination: false,
    })
    orgIds = organizations.docs.map(organization => String(organization.id))
  }
  if (input.audience.scope === 'organizations' && input.audience.target_kind === 'user') {
    const memberships = await req.payload.find({
      collection: 'organization-memberships',
      where: {
        and: [
          { organization: { in: orgIds } },
          { user: { in: input.audience.user_ids } },
          { is_active: { equals: true } },
          { status: { equals: 'active' } },
        ],
      },
      overrideAccess: true,
      req,
      depth: 0,
      limit: input.audience.user_ids.length,
    })
    const eligible = new Set(memberships.docs.map(membership => relationId(membership.user)))
    if (input.audience.user_ids.some(id => !eligible.has(id))) {
      throw new Error(
        'Cada persona seleccionada debe pertenecer a una organización destinataria y estar activa.'
      )
    }
  }
  if (input.linked_entity) {
    if (input.linked_entity.relationTo === 'tasks') {
      const task = await loadTask(req, input.linked_entity.value)
      const taskOrgId = relationId(task.organization)
      if (orgIds.length !== 1 || orgIds[0] !== taskOrgId) {
        throw new Error(
          'La tarea debe estar disponible para todas las organizaciones destinatarias.'
        )
      }
    } else {
      const resolved = await resolveTaskReference(req, input.linked_entity as never)
      if (orgIds.length !== 1 || orgIds[0] !== resolved.organizationId || resolved.unavailable) {
        throw new Error(
          'La entidad debe estar disponible para todas las organizaciones destinatarias.'
        )
      }
    }
  }
}

async function listAdminOptions(req: PayloadRequest, organizationIds: string[]) {
  const [organizations, roles, memberships] = await Promise.all([
    req.payload.find({
      collection: 'organizations',
      where: { is_active: { equals: true } },
      overrideAccess: true,
      req,
      depth: 0,
      pagination: false,
      sort: 'name',
      select: { name: true },
    }),
    req.payload.find({
      collection: 'roles',
      where: { is_platform_role: { equals: false } },
      overrideAccess: true,
      req,
      depth: 0,
      pagination: false,
      sort: 'name',
      select: { slug: true, name: true },
    }),
    organizationIds.length
      ? req.payload.find({
          collection: 'organization-memberships',
          where: {
            and: [
              { organization: { in: organizationIds } },
              { is_active: { equals: true } },
              { status: { equals: 'active' } },
            ],
          },
          overrideAccess: true,
          req,
          depth: 1,
          pagination: false,
        })
      : Promise.resolve({ docs: [] }),
  ])
  return {
    organizations: organizations.docs,
    roles: roles.docs.filter(role =>
      PORTAL_MESSAGE_ROLES.includes(role.slug as (typeof PORTAL_MESSAGE_ROLES)[number])
    ),
    users: memberships.docs.map(membership => {
      const user = membership.user as unknown as { id: string; name: string; email: string }
      const role = membership.role as unknown as { slug: string; name: string }
      return {
        id: relationId(user),
        organization_id: relationId(membership.organization),
        name: user.name,
        email: user.email,
        role: role.slug,
      }
    }),
  }
}

const adminMessagesEndpoint: Endpoint = {
  path: '/v1/platform-admin/portal-messages',
  method: 'get',
  handler: async req => {
    const auth = await platformAdmin(req)
    if (auth.response) return auth.response
    const params = new URL(req.url ?? 'http://localhost').searchParams
    const organizationIds = params
      .getAll('organization_id')
      .flatMap(value => value.split(','))
      .filter(Boolean)
    // Con organization_id lo pide el formulario, que sólo necesita las opciones de audiencia:
    // se evita resolver la etiqueta de cada entidad enlazada en cada cambio de selección.
    const messages = organizationIds.length
      ? { docs: [] }
      : await req.payload.find({
          collection: 'portal-messages',
          overrideAccess: true,
          req,
          depth: 0,
          pagination: false,
          sort: '-createdAt',
        })
    return json({
      docs: await Promise.all(
        messages.docs.map(async message =>
          messageInputFromDoc({
            ...(message as unknown as Record<string, unknown>),
            linked_entity_label: await adminEntityLabel(req, message.linked_entity),
          })
        )
      ),
      ...(await listAdminOptions(req, organizationIds)),
    })
  },
}

const createMessageEndpoint: Endpoint = {
  path: '/v1/platform-admin/portal-messages',
  method: 'post',
  handler: async req => {
    const auth = await platformAdmin(req)
    if (auth.response) return auth.response
    const parsed = PortalMessageInputSchema.safeParse(await req.json!().catch(() => ({})))
    if (!parsed.success) return json({ error: 'invalid_message', issues: parsed.error.issues }, 400)
    try {
      await validateAudience(req, parsed.data)
      // AUDIT: this action must emit an AuditLogs entry (chain_hash over {portal message, audience, expiry, active state}, previous hash for the platform scope)
      // TODO(audit-feature): wire into domain/audit/builder.ts::addAuditEvent once AuditLog write path exists
      // NOTIFY: publishing this message delivers an in-product modal to its selected audience
      // TODO(notification-feature): a separate persistent bell entry can be considered when that feature is scoped
      const message = await req.payload.create({
        collection: 'portal-messages',
        data: payloadData(parsed.data, auth.ctx.userId) as never,
        overrideAccess: true,
        req,
        depth: 0,
      })
      return json(message, 201)
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : 'message_create_failed' }, 400)
    }
  },
}

const updateMessageEndpoint: Endpoint = {
  path: '/v1/platform-admin/portal-messages/:id',
  method: 'patch',
  handler: async req => {
    const auth = await platformAdmin(req)
    if (auth.response) return auth.response
    const id = String(req.routeParams?.id ?? '')
    const parsed = PortalMessageInputSchema.safeParse(await req.json!().catch(() => ({})))
    if (!id || !parsed.success)
      return json(
        { error: 'invalid_message', issues: parsed.success ? undefined : parsed.error.issues },
        400
      )
    try {
      // Un mensaje inactivo no se entrega, así que su audiencia puede haber quedado obsoleta
      // (organización desactivada, persona que dejó la organización, entidad borrada) sin
      // impedir desactivarlo. Se vuelve a validar completa al reactivarlo.
      if (parsed.data.is_active) await validateAudience(req, parsed.data)
      // AUDIT: this action must emit an AuditLogs entry (chain_hash over {portal message, audience, expiry, active state}, previous hash for the platform scope)
      // TODO(audit-feature): wire into domain/audit/builder.ts::addAuditEvent once AuditLog write path exists
      // NOTIFY: changing or activating this message changes what its selected audience sees
      // TODO(notification-feature): a separate persistent bell entry can be considered when that feature is scoped
      const message = await req.payload.update({
        collection: 'portal-messages',
        id,
        data: payloadData(parsed.data) as never,
        overrideAccess: true,
        req,
        depth: 0,
      })
      return json(message)
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : 'message_update_failed' }, 400)
    }
  },
}

const replayMessageEndpoint: Endpoint = {
  path: '/v1/platform-admin/portal-messages/:id/replay',
  method: 'post',
  handler: async req => {
    const auth = await platformAdmin(req)
    if (auth.response) return auth.response
    const id = String(req.routeParams?.id ?? '')
    if (!id) return json({ error: 'invalid_message' }, 400)
    const message = await req.payload
      .findByID({ collection: 'portal-messages', id, overrideAccess: true, req, depth: 0 })
      .catch(() => null)
    if (!message) return json({ error: 'message_not_found' }, 404)
    if (
      !message.is_active ||
      (message.expires_at && new Date(message.expires_at).getTime() <= Date.now())
    ) {
      return json({ error: 'message_inactive_or_expired' }, 409)
    }
    const deliveryVersion = Math.max(1, Number(message.delivery_version ?? 1)) + 1
    // AUDIT: this action must emit an AuditLogs entry (chain_hash over {portal message, delivery version}, previous hash for the platform scope)
    // TODO(audit-feature): wire into domain/audit/builder.ts::addAuditEvent once AuditLog write path exists
    // NOTIFY: resurfacing the modal delivers the message again to its selected audience
    // TODO(notification-feature): a separate persistent bell entry can be considered when that feature is scoped
    await req.payload.update({
      collection: 'portal-messages',
      id,
      data: { delivery_version: deliveryVersion },
      overrideAccess: true,
      req,
    })
    return json({ ok: true, delivery_version: deliveryVersion })
  },
}

const myMessagesEndpoint: Endpoint = {
  path: '/v1/portal-messages',
  method: 'get',
  handler: async req => {
    const auth = await orgUser(req)
    if (auth.response) return auth.response
    const now = new Date().toISOString()
    const found = await req.payload.find({
      collection: 'portal-messages',
      where: {
        and: [
          { is_active: { equals: true } },
          {
            or: [
              { expires_at: { exists: false } },
              { expires_at: { equals: null } },
              { expires_at: { greater_than: now } },
            ],
          },
        ],
      },
      overrideAccess: true,
      req,
      depth: 0,
      pagination: false,
      sort: '-createdAt',
    })
    const targeted = found.docs.filter(message =>
      messageTargetsUser(message as never, auth.ctx.organizationId!, auth.ctx.role, auth.ctx.userId)
    )
    const receipts = targeted.length
      ? await req.payload.find({
          collection: 'portal-message-receipts',
          where: {
            and: [
              { user: { equals: auth.ctx.userId } },
              { message: { in: targeted.map(message => message.id) } },
            ],
          },
          overrideAccess: true,
          req,
          depth: 0,
          pagination: false,
        })
      : { docs: [] }
    const receiptsByMessage = new Map(
      receipts.docs.map(receipt => [relationId(receipt.message), receipt])
    )
    const docs = await Promise.all(
      targeted.map(async message => {
        const rawReceipt = receiptsByMessage.get(String(message.id))
        const deliveryVersion = Math.max(1, Number(message.delivery_version ?? 1))
        const receipt =
          rawReceipt && Number(rawReceipt.delivery_version ?? 1) === deliveryVersion
            ? rawReceipt
            : undefined
        const entity = await resolveMessageLink(req, auth.ctx, message)
        return {
          id: message.id,
          delivery_version: deliveryVersion,
          title: message.title,
          description: message.description,
          message_type: message.message_type,
          cta_label: message.cta_label ?? null,
          createdAt: message.createdAt,
          seen: Boolean(receipt?.seen_at),
          dismissed: Boolean(receipt?.dismissed_at),
          entity,
        }
      })
    )
    return json({ docs })
  },
}

const messageReceiptEndpoint: Endpoint = {
  path: '/v1/portal-messages/:id/receipt',
  method: 'patch',
  handler: async req => {
    const auth = await orgUser(req)
    if (auth.response) return auth.response
    const messageId = String(req.routeParams?.id ?? '')
    const body = (await req.json!().catch(() => ({}))) as {
      status?: string
      delivery_version?: number
    }
    if (!messageId || !['seen', 'dismissed'].includes(body.status ?? ''))
      return json({ error: 'invalid_receipt' }, 400)
    const message = await req.payload
      .findByID({
        collection: 'portal-messages',
        id: messageId,
        overrideAccess: true,
        req,
        depth: 0,
      })
      .catch(() => null)
    if (
      !message ||
      !message.is_active ||
      (message.expires_at && new Date(message.expires_at).getTime() <= Date.now()) ||
      !messageTargetsUser(
        message as never,
        auth.ctx.organizationId!,
        auth.ctx.role,
        auth.ctx.userId
      )
    ) {
      return json({ error: 'message_not_found' }, 404)
    }
    const deliveryVersion = Math.max(1, Number(message.delivery_version ?? 1))
    const requestedVersion = body.delivery_version ?? deliveryVersion
    if (!Number.isInteger(requestedVersion) || requestedVersion < 1) {
      return json({ error: 'invalid_receipt' }, 400)
    }
    if (requestedVersion !== deliveryVersion) return json({ ok: true, stale: true })
    const existing = await req.payload.find({
      collection: 'portal-message-receipts',
      where: { and: [{ message: { equals: messageId } }, { user: { equals: auth.ctx.userId } }] },
      overrideAccess: true,
      req,
      depth: 0,
      limit: 1,
    })
    const timestamp = new Date().toISOString()
    const sameVersion =
      existing.docs[0] && Number(existing.docs[0].delivery_version ?? 1) === deliveryVersion
    const data =
      body.status === 'dismissed'
        ? { delivery_version: deliveryVersion, seen_at: timestamp, dismissed_at: timestamp }
        : {
            delivery_version: deliveryVersion,
            seen_at: timestamp,
            ...(!sameVersion ? { dismissed_at: null } : {}),
          }
    if (existing.docs[0]) {
      await req.payload.update({
        collection: 'portal-message-receipts',
        id: existing.docs[0].id,
        data,
        overrideAccess: true,
        req,
      })
    } else {
      try {
        await req.payload.create({
          collection: 'portal-message-receipts',
          data: { message: messageId, user: auth.ctx.userId, ...data },
          overrideAccess: true,
          req,
        })
      } catch {
        // The unique (message, user) index can win a concurrent first-read request.
        const raced = await req.payload.find({
          collection: 'portal-message-receipts',
          where: {
            and: [{ message: { equals: messageId } }, { user: { equals: auth.ctx.userId } }],
          },
          overrideAccess: true,
          req,
          depth: 0,
          limit: 1,
        })
        if (!raced.docs[0]) throw new Error('receipt_write_failed')
        await req.payload.update({
          collection: 'portal-message-receipts',
          id: raced.docs[0].id,
          data,
          overrideAccess: true,
          req,
        })
      }
    }
    return json({ ok: true })
  },
}

const resolvePortalMessageLinkEndpoint: Endpoint = {
  path: '/v1/portal-messages/:id/resolve-link',
  method: 'get',
  handler: async req => {
    const auth = await orgUser(req)
    if (auth.response) return auth.response
    const messageId = String(req.routeParams?.id ?? '')
    const message = await req.payload
      .findByID({
        collection: 'portal-messages',
        id: messageId,
        overrideAccess: true,
        req,
        depth: 0,
      })
      .catch(() => null)
    if (
      !message ||
      !message.is_active ||
      (message.expires_at && new Date(message.expires_at).getTime() <= Date.now()) ||
      !messageTargetsUser(
        message as never,
        auth.ctx.organizationId!,
        auth.ctx.role,
        auth.ctx.userId
      )
    ) {
      return json({ error: 'message_not_found' }, 404)
    }

    const link = await resolveMessageLink(req, auth.ctx, message)
    const url = link?.access === 'allowed' ? (link.href ?? null) : null
    return json({ url })
  },
}

const messageEntityOptionsEndpoint: Endpoint = {
  path: '/v1/platform-admin/portal-message-entities',
  method: 'get',
  handler: async req => {
    const auth = await platformAdmin(req)
    if (auth.response) return auth.response
    const params = new URL(req.url ?? 'http://localhost').searchParams
    const scope = params.get('scope') === 'global' ? 'global' : 'organizations'
    const requestedOrgIds = params
      .getAll('organization_id')
      .flatMap(value => value.split(','))
      .filter(Boolean)
    const type = params.get('type') ?? ''
    if (!type || (type !== 'tasks' && !TASK_REFERENCE_COLLECTIONS.includes(type as never))) {
      return json({ error: 'invalid_entity_scope' }, 400)
    }
    let organizationIds = requestedOrgIds
    if (scope === 'global') {
      const organizations = await req.payload.find({
        collection: 'organizations',
        where: { is_active: { equals: true } },
        overrideAccess: true,
        req,
        depth: 0,
        pagination: false,
      })
      organizationIds = organizations.docs.map(organization => String(organization.id))
    }
    // Cada entidad concreta pertenece a una sola organización. Sólo se ofrecen opciones
    // cuando todas las organizaciones destinatarias apuntan a la misma entidad.
    if (organizationIds.length !== 1) return json({ docs: [] })
    const organizationId = organizationIds[0]
    if (type === 'tasks') {
      const found = await req.payload.find({
        collection: 'tasks',
        where: {
          and: [
            { organization: { equals: organizationId } },
            { archived_at: { exists: false } },
            { status: { not_equals: 'cancelled' } },
          ],
        },
        overrideAccess: true,
        req,
        depth: 0,
        sort: 'title',
        limit: ENTITY_OPTIONS_LIMIT,
      })
      return json({
        docs: found.docs.map(doc => ({
          relationTo: 'tasks',
          value: String(doc.id),
          label: doc.title,
        })),
      })
    }
    const collection = type as (typeof TASK_REFERENCE_COLLECTIONS)[number]
    // Se acota en la query a la organización destinataria (scan-reports sólo conoce su oficina)
    // en lugar de traer toda la colección y descartar después.
    let where: Where
    if (collection === 'scan-reports') {
      const offices = await req.payload.find({
        collection: 'offices',
        where: { organization: { equals: organizationId } },
        overrideAccess: true,
        req,
        depth: 0,
        pagination: false,
      })
      where = { office: { in: offices.docs.map(office => String(office.id)) } }
    } else {
      where = { organization: { equals: organizationId } }
    }
    const found = await req.payload.find({
      collection,
      where,
      overrideAccess: true,
      req,
      depth: 0,
      limit: ENTITY_OPTIONS_LIMIT,
      sort: '-updatedAt',
    })
    const docs = await Promise.all(
      found.docs.map(async doc => {
        try {
          const reference = await resolveTaskReference(req, {
            relationTo: collection,
            value: String(doc.id),
          })
          if (reference.unavailable) return null
          return { relationTo: type, value: String(doc.id), label: reference.label }
        } catch {
          return null
        }
      })
    )
    return json({ docs: docs.filter(Boolean) })
  },
}

export const portalMessageEndpoints: Endpoint[] = [
  adminMessagesEndpoint,
  createMessageEndpoint,
  updateMessageEndpoint,
  replayMessageEndpoint,
  myMessagesEndpoint,
  messageReceiptEndpoint,
  resolvePortalMessageLinkEndpoint,
  messageEntityOptionsEndpoint,
]
