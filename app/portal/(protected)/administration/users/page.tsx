'use client'

import { useSearchParams } from 'next/navigation'
import { useState } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { Group, Stack, Text, TextInput } from '@mantine/core'
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

const ROLE_ICONS: Record<(typeof ORGANIZATION_ROLES)[number], LucideIcon> = {
  org_admin: ShieldCheck,
  office_manager: Wrench,
  org_viewer: Eye,
}

export default function AdminUsersPage() {
  const asOrganization = useSearchParams().get('asOrganization') ?? undefined
  const { data: members, isPending } = useOrgMembers(asOrganization, { includeInactive: true })
  const { data: tenantContext } = useTenantContext(asOrganization)
  const { data: offices } = useOfficesList(asOrganization)
  const [editing, setEditing] = useState<OrgMember | null>(null)
  const [toggling, setToggling] = useState<OrgMember | null>(null)
  const [search, setSearch] = useState('')
  const [role, setRole] = useState<string[]>([])
  const [status, setStatus] = useState<string[]>([])

  const officeOptions = (offices ?? []).map(office => ({
    value: String(office.id),
    label: office.name,
  }))
  const officeName = new Map(officeOptions.map(option => [option.value, option.label]))
  const isSelf = (member: OrgMember) => member.id === tenantContext?.userId
  const all = members ?? []
  const statuses = new Set(all.map(memberStatus))
  const term = search.trim().toLocaleLowerCase('es')
  const visible = all.filter(
    member =>
      (!role.length || role.includes(member.role)) &&
      (!status.length || status.includes(memberStatus(member))) &&
      (!term || `${member.name} ${member.email}`.toLocaleLowerCase('es').includes(term))
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
    {
      id: 'actions',
      header: 'Acciones',
      size: 110,
      enableSorting: false,
      meta: { align: 'center' },
      cell: ({ row }) => (
        <RowActions
          member={row.original}
          isSelf={isSelf(row.original)}
          onEditAccess={setEditing}
          onToggleActive={setToggling}
        />
      ),
    },
  ]

  return (
    <Stack gap="md">
      <PageHeader title="Usuarios" description="Miembros de tu organización." />
      {/* Uso del plan por rol: personas activas (incluye las que se están incorporando). */}
      <MetricsStrip
        isPending={isPending}
        metrics={ORGANIZATION_ROLES.map(slug => {
          const used = all.filter(member => member.is_active && member.role === slug).length
          const limit = tenantContext?.limits?.user_limits[slug] ?? null
          return {
            key: slug,
            icon: ROLE_ICONS[slug],
            value: (
              <Text span inherit c={limit !== null && used >= limit ? 'orange' : undefined}>
                {limit === null ? used : `${used} de ${limit}`}
              </Text>
            ),
            label: `${ROLE_PLURAL_LABELS[slug]}${limit !== null ? ' en tu plan' : ''}`,
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
      <MemberAccessModal
        member={editing}
        isSelf={Boolean(editing && isSelf(editing))}
        officeOptions={officeOptions}
        onClose={() => setEditing(null)}
        asOrganization={asOrganization}
      />
      <MemberStatusModal
        member={toggling}
        officeOptions={officeOptions}
        onClose={() => setToggling(null)}
        asOrganization={asOrganization}
      />
    </Stack>
  )
}
