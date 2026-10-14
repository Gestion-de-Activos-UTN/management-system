'use client'

import { ActionIcon, Group, Tooltip } from '@mantine/core'
import { Download, Pencil, Power, PowerOff, Settings2 } from 'lucide-react'
import type { Office } from '@/app/types/payload-types'

export function RowActions({
  office,
  hasAgents,
  onScanner,
  onEdit,
  onToggleActive,
}: {
  office: Office
  hasAgents: boolean
  onScanner: (office: Office) => void
  onEdit: (office: Office) => void
  onToggleActive: (office: Office) => void
}) {
  const active = office.is_active !== false
  const scannerLabel = hasAgents ? 'Administrar escáneres' : 'Instalar escáner'
  return (
    <Group gap={6} wrap="wrap" justify="center">
      <Tooltip label={active ? scannerLabel : 'Reactiva la oficina para instalar un escáner'}>
        <ActionIcon
          variant="light"
          size="md"
          aria-label={`${scannerLabel} para ${office.name}`}
          // data-disabled: un botón deshabilitado no dispara el Tooltip que explica por qué.
          data-disabled={(!active && !hasAgents) || undefined}
          onClick={active || hasAgents ? () => onScanner(office) : undefined}
        >
          {hasAgents ? (
            <Settings2 size={16} strokeWidth={1.5} />
          ) : (
            <Download size={16} strokeWidth={1.5} />
          )}
        </ActionIcon>
      </Tooltip>
      <Tooltip label="Editar">
        <ActionIcon
          variant="light"
          size="md"
          aria-label={`Editar ${office.name}`}
          onClick={() => onEdit(office)}
        >
          <Pencil size={16} strokeWidth={1.5} />
        </ActionIcon>
      </Tooltip>
      <Tooltip label={active ? 'Desactivar' : 'Reactivar'}>
        <ActionIcon
          variant="light"
          size="md"
          color={active ? 'red' : undefined}
          aria-label={`${active ? 'Desactivar' : 'Reactivar'} ${office.name}`}
          onClick={() => onToggleActive(office)}
        >
          {active ? (
            <PowerOff size={16} strokeWidth={1.5} />
          ) : (
            <Power size={16} strokeWidth={1.5} />
          )}
        </ActionIcon>
      </Tooltip>
    </Group>
  )
}
