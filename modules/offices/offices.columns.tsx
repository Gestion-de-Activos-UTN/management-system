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
    { accessorKey: 'name', header: 'Nombre' },
    {
      id: 'organization',
      header: 'Organización',
      cell: ({ row }) => organizationLabel(row.original),
    },
    {
      accessorKey: 'county_fips',
      header: 'Código FIPS del condado',
      size: 150,
      cell: ({ row }) =>
        row.original.county_fips && <TechnicalText>{row.original.county_fips}</TechnicalText>,
    },
    activeStatusColumn<Office>(office => Boolean(office.is_active)),
    {
      id: 'scanner',
      header: 'Escáner',
      size: 150,
      meta: { align: 'center' },
      cell: ({ row }) => {
        const summary = summaryByOffice.get(String(row.original.id))
        const status = getOfficeScannerStatus(summary)
        if (status === 'not_installed') {
          return (
            <Tooltip label="No se aprovisionó ningún escáner">
              <Badge color="gray" variant="light">
                No instalado
              </Badge>
            </Tooltip>
          )
        }
        if (!summary) return null
        if (status === 'inactive') {
          return (
            <Tooltip label={`${summary.total} agente(s) aprovisionado(s), todos inactivos`}>
              <Badge color="gray" variant="filled">
                Inactivo
              </Badge>
            </Tooltip>
          )
        }
        if (status === 'pending') {
          return (
            <Tooltip label="Escáner aprovisionado; esperando su primera señal">
              <Badge color="blue" variant="filled">
                Pendiente
              </Badge>
            </Tooltip>
          )
        }
        if (status === 'online') {
          return (
            <Tooltip label={`${summary.online} de ${summary.active} agente(s) activo(s) en línea`}>
              <Badge color="green" variant="filled">
                En línea
              </Badge>
            </Tooltip>
          )
        }
        return (
          <Tooltip label={`${summary.active} agente(s) activo(s), ninguno en línea`}>
            <Badge color="yellow" variant="filled">
              Sin conexión
            </Badge>
          </Tooltip>
        )
      },
    },
    {
      id: 'actions',
      header: 'Acciones',
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
            aria-label={`${hasAgents ? 'Administrar escáneres' : 'Instalar escáner'} para ${row.original.name}`}
            onClick={() => onProvision(row.original)}
          >
            {hasAgents ? 'Administrar' : 'Instalar'}
          </Button>
        )
      },
    },
  ]
}
