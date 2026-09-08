import type { ColumnDef } from '@tanstack/react-table'
import type { Office } from '@/app/types/payload-types'
import { activeStatusColumn } from '@/components/ui/activeStatusColumn'
import { TechnicalText } from '@/components/ui/TechnicalText'
import { Badge, Button, Tooltip } from '@mantine/core'
import { Download, Settings2 } from 'lucide-react'
import { getOfficeScannerStatus, type OfficeAgentSummary } from '@/endpoints/officeAgentSummary'

function organizationLabel(office: Office) {
  return typeof office.organization === 'object'
    ? office.organization.name
    : String(office.organization)
}

export function getOfficesColumns(
  onProvision: (office: Office) => void,
  agentSummary: OfficeAgentSummary[] = []
): ColumnDef<Office, unknown>[] {
  const summaryByOffice = new Map(agentSummary.map(summary => [summary.office_id, summary]))

  return [
    { accessorKey: 'name', header: 'Name' },
    {
      id: 'organization',
      header: 'Organization',
      cell: ({ row }) => organizationLabel(row.original),
    },
    {
      accessorKey: 'county_fips',
      header: 'County FIPS',
      size: 150,
      cell: ({ row }) =>
        row.original.county_fips && <TechnicalText>{row.original.county_fips}</TechnicalText>,
    },
    activeStatusColumn<Office>(office => Boolean(office.is_active)),
    {
      id: 'scanner',
      header: 'Scanner',
      size: 150,
      meta: { align: 'center' },
      cell: ({ row }) => {
        const summary = summaryByOffice.get(String(row.original.id))
        const status = getOfficeScannerStatus(summary)
        if (status === 'not_installed') {
          return (
            <Tooltip label="No scanner has been provisioned">
              <Badge color="gray" variant="light">
                Not installed
              </Badge>
            </Tooltip>
          )
        }
        if (!summary) return null
        if (status === 'inactive') {
          return (
            <Tooltip label={`${summary.total} provisioned agent(s), all inactive`}>
              <Badge color="gray" variant="filled">
                Inactive
              </Badge>
            </Tooltip>
          )
        }
        if (status === 'pending') {
          return (
            <Tooltip label="Scanner provisioned, waiting for its first heartbeat">
              <Badge color="blue" variant="filled">
                Pending
              </Badge>
            </Tooltip>
          )
        }
        if (status === 'online') {
          return (
            <Tooltip label={`${summary.online} of ${summary.active} active agent(s) online`}>
              <Badge color="green" variant="filled">
                Online
              </Badge>
            </Tooltip>
          )
        }
        return (
          <Tooltip label={`${summary.active} active agent(s), none online`}>
            <Badge color="yellow" variant="filled">
              Offline
            </Badge>
          </Tooltip>
        )
      },
    },
    {
      id: 'actions',
      header: '',
      size: 120,
      meta: { align: 'center' },
      cell: ({ row }) => {
        const summary = summaryByOffice.get(String(row.original.id))
        const hasAgents = (summary?.total ?? 0) > 0
        return (
          <Button
            size="xs"
            variant="subtle"
            leftSection={
              hasAgents ? (
                <Settings2 size={15} strokeWidth={1.5} />
              ) : (
                <Download size={15} strokeWidth={1.5} />
              )
            }
            aria-label={`${hasAgents ? 'Manage scanners' : 'Install scanner'} for ${row.original.name}`}
            onClick={() => onProvision(row.original)}
          >
            {hasAgents ? 'Manage' : 'Install'}
          </Button>
        )
      },
    },
  ]
}
