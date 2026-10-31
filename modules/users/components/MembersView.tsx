'use client'

import { matchesSearch } from '@/lib/search-text'

import { useSearchParams } from 'next/navigation'
import { useState } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { Button, Group, Stack, Text, TextInput } from '@mantine/core'
import { Eye, type LucideIcon, Search, ShieldCheck, Wrench } from 'lucide-react'
import { DataTable } from '@/components/ui/DataTable'
import { FilterBar } from '@/components/ui/FilterBar'
import { MultiFilterSelect } from '@/components/ui/MultiFilterSelect'
import { PageHeader } from '@/components/ui/PageHeader'
import { MetricsStrip } from '@/components/ui/MetricsStrip'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { roleSlugLabel, ROLE_LABELS } from '@/lib/role-labels'
import { useTenantContext } from '@/modules/auth/hooks/use-tenant-context'
import { useOfficesList } from '@/modules/offices/hooks/use-offices'
import { useOrgMembers } from '@/modules/users/hooks/use-org-members'
import type { OrgMember } from '@/modules/users/service'
import { ORGANIZATION_ROLES } from '@/modules/users/schema'
import {
  MEMBER_STATUS_LABELS,
  ROLE_PLURAL_LABELS,
  MEMBER_STATUS_TONES,
  memberStatus,
} from '@/modules/users/member-labels'
import { RowActions } from '@/modules/users/components/RowActions'
import { MemberAccessModal } from '@/modules/users/components/MemberAccessModal'
import { MemberStatusModal } from '@/modules/users/components/MemberStatusModal'
import { MemberCreateModal } from '@/modules/users/components/MemberCreateModal'
import { useCreateOrgMember } from '@/modules/users/hooks/use-org-members'

const ROLE_ICONS: Record<(typeof ORGANIZATION_ROLES)[number], LucideIcon> = {
  org_admin: ShieldCheck,
  office_manager: Wrench,
  org_viewer: Eye,
}

export function MembersView({ mode }: { mode: 'administration' | 'team' }) {
  const administration = mode === 'administration'
  const asOrganization = useSearchParams().get('asOrganization') ?? undefined
  const { data: members, isPending } = useOrgMembers(asOrganization, {
    includeInactive: true,
  })
  const { data: tenantContext } = useTenantContext(asOrganization)
  const { data: offices } = useOfficesList(asOrganization)
  const canManage = administration && Boolean(tenantContext?.permissions.organizationMembers.update)
  const canEditOffices = Boolean(tenantContext?.permissions.organizationMembers.editOffices)
  const canChangeStatus = Boolean(tenantContext?.permissions.organizationMembers.changeStatus)
  const canCreate = Boolean(tenantContext?.permissions.organizationMembers.create)
  const [editing, setEditing] = useState<OrgMember | null>(null)
  const [toggling, setToggling] = useState<OrgMember | null>(null)
  const [search, setSearch] = useState('')
  const [role, setRole] = useState<string[]>([])
  const [status, setStatus] = useState<string[]>([])
  const [creating, setCreating] = useState(false)
  const createMember = useCreateOrgMember(asOrganization)

  const officeOptions = (offices ?? []).map(office => ({
    value: String(office.id),
    label: office.name,
  }))
  const officeName = new Map(officeOptions.map(option => [option.value, option.label]))
  const isSelf = (member: OrgMember) => member.id === tenantContext?.userId
  const all = members ?? []
  const statuses = new Set(all.map(memberStatus))
  const term = search.trim()
  const visible = all.filter(
    member =>
      (!role.length || role.includes(member.role)) &&
      (!status.length || status.includes(memberStatus(member))) &&
      matchesSearch([`${member.name} ${member.email}`], term)
  )

  const columns: ColumnDef<OrgMember, unknown>[] = [
    {
      accessorKey: 'name',
      header: 'Persona',
      cell: ({ row }) => (
        <Stack gap={0}>
          <Group gap={6} wrap="nowrap">
            <Text size="sm" fw={600}>
              {row.original.name || row.original.email}
            </Text>
            {isSelf(row.original) && <StatusBadge size="xs" tone="neutral" label="Tú" />}
          </Group>
          {row.original.name && (
            <Text size="xs" c="dimmed">
              {row.original.email}
            </Text>
          )}
        </Stack>
      ),
    },
    {
      accessorKey: 'role',
      header: 'Rol',
      cell: ({ row }) => roleSlugLabel(row.original.role),
    },
    {
      id: 'offices',
      header: 'Oficinas',
      cell: ({ row }) => {
        const active = row.original.office_ids.filter(id => officeName.has(id))
        // Mismo texto para un administrador (las cubre por rol) que para quien tiene asignadas
        // todas las oficinas activas: el acceso efectivo es el mismo.
        if (
          row.original.role === 'org_admin' ||
          (active.length && active.length === officeName.size)
        )
          return `Todas (${officeName.size})`
        return (
          <Text size="sm" c={active.length ? undefined : 'dimmed'} lineClamp={2}>
            {active.length
              ? active.map(id => officeName.get(id)).join(', ')
              : 'Sin oficinas activas'}
          </Text>
        )
      },
    },
    {
      id: 'status',
      header: 'Estado',
      size: 140,
      meta: { align: 'center' },
      cell: ({ row }) => {
        const value = memberStatus(row.original)
        return <StatusBadge tone={MEMBER_STATUS_TONES[value]} label={MEMBER_STATUS_LABELS[value]} />
      },
    },
    ...(canChangeStatus || canEditOffices
      ? [
          {
            id: 'actions',
            header: 'Acciones',
            size: 110,
            enableSorting: false,
            meta: { align: 'center' },
            cell: ({ row }: { row: { original: OrgMember } }) => (
              <RowActions
                member={row.original}
                isSelf={isSelf(row.original)}
                onEditAccess={canManage || row.original.can_edit_offices ? setEditing : undefined}
                allowRoleChange={canManage}
                onToggleActive={setToggling}
                canToggleActive={Boolean(row.original.can_change_status)}
              />
            ),
          },
        ]
      : []),
  ]

  return (
    <Stack gap="md">
      <PageHeader
        title={administration ? 'Usuarios' : 'Equipo'}
        description={
          administration ? 'Miembros de tu organización.' : 'Personas con acceso a tus oficinas.'
        }
        rightSection={
          canCreate ? <Button onClick={() => setCreating(true)}>Crear persona</Button> : undefined
        }
      />
      {/* Uso del plan por rol: personas activas (incluye las que se están incorporando). */}
      <MetricsStrip
        isPending={isPending}
        metrics={ORGANIZATION_ROLES.map(slug => {
          const used = all.filter(member => member.is_active && member.role === slug).length
          const limit = administration ? (tenantContext?.limits?.user_limits[slug] ?? null) : null
          return {
            key: slug,
            icon: ROLE_ICONS[slug],
            value: (
              <Text span inherit c={limit !== null && used >= limit ? 'orange' : undefined}>
                {limit === null ? used : `${used} de ${limit}`}
              </Text>
            ),
            label: `${ROLE_PLURAL_LABELS[slug]}${limit !== null ? ' en tu plan' : administration ? '' : ' en tus oficinas'}`,
          }
        })}
      />
      <FilterBar>
        <TextInput
          placeholder="Buscar por nombre o correo"
          aria-label="Buscar personas"
          leftSection={<Search size={16} strokeWidth={1.5} />}
          value={search}
          onChange={event => setSearch(event.currentTarget.value)}
          w="100%"
        />
        <MultiFilterSelect
          ariaLabel="Rol"
          allLabel="Todos los roles"
          data={ORGANIZATION_ROLES.map(slug => ({ value: slug, label: ROLE_LABELS[slug] }))}
          value={role}
          onChange={setRole}
        />
        {/* Sólo cambia el resultado si hay personas en más de un estado. */}
        {statuses.size > 1 && (
          <MultiFilterSelect
            ariaLabel="Estado"
            allLabel="Todos los estados"
            data={(['active', 'onboarding', 'inactive'] as const)
              .filter(value => statuses.has(value))
              .map(value => ({ value, label: MEMBER_STATUS_LABELS[value] }))}
            value={status}
            onChange={setStatus}
          />
        )}
      </FilterBar>
      <DataTable
        columns={columns}
        data={visible}
        isLoading={isPending}
        emptyLabel={term ? 'Nadie coincide con la búsqueda' : 'No hay personas'}
        minWidth={820}
      />
      {canEditOffices && (
        <>
          <MemberAccessModal
            member={editing}
            isSelf={Boolean(editing && isSelf(editing))}
            officeOptions={officeOptions}
            onClose={() => setEditing(null)}
            asOrganization={asOrganization}
            allowRoleChange={canManage}
          />
        </>
      )}
      {canChangeStatus && (
        <MemberStatusModal
          member={toggling}
          officeOptions={officeOptions}
          onClose={() => setToggling(null)}
          asOrganization={asOrganization}
        />
      )}
      {canCreate && (
        <MemberCreateModal
          opened={creating}
          onClose={() => setCreating(false)}
          officeOptions={officeOptions}
          roles={administration ? ORGANIZATION_ROLES : ['org_viewer']}
          lockedRole={administration ? undefined : 'org_viewer'}
          onSubmit={input => createMember.mutateAsync(input)}
          isPending={createMember.isPending}
        />
      )}
    </Stack>
  )
}
