'use client'

import Link from 'next/link'
import { ActionIcon, Group, Menu, Tooltip } from '@mantine/core'
import { Archive, Check, Ellipsis, ExternalLink, Eye, Hand, RotateCcw, Trash2 } from 'lucide-react'
import type { TaskDTO } from '../service'
import { getTaskReferenceHref } from '../task-reference-link'
import { useTaskCommand } from '../hooks/use-task-actions'

// Componente aparte (no una cell inline) porque necesita su propio hook de mutación.
// Acciones de un clic. Editar, reasignar y cancelar piden datos extra: viven en el detalle.
export function RowActions({ task, asOrganization }: { task: TaskDTO; asOrganization?: string }) {
  const command = useTaskCommand(task.id)
  const has = (action: TaskDTO['available_actions'][number]) =>
    task.available_actions.includes(action)
  const suffix = asOrganization ? `?asOrganization=${asOrganization}` : ''
  const referenceHref = task.related_entity_info
    ? getTaskReferenceHref(task.related_entity_info, asOrganization)
    : null
  const hasMenu = referenceHref || has('release') || has('archive') || has('delete')

  return (
    <Group gap={6} wrap="wrap" justify="center">
      {has('claim') && (
        <Tooltip label="Reclamar">
          <ActionIcon
            variant="light"
            size="md"
            aria-label="Reclamar"
            loading={command.isPending}
            onClick={() => command.mutate({ action: 'claim' })}
          >
            <Hand size={16} strokeWidth={1.5} />
          </ActionIcon>
        </Tooltip>
      )}
      {has('complete') && (
        <Tooltip label="Completar">
          <ActionIcon
            variant="light"
            size="md"
            color="green"
            aria-label="Completar"
            loading={command.isPending}
            onClick={() => command.mutate({ action: 'complete' })}
          >
            <Check size={16} strokeWidth={1.5} />
          </ActionIcon>
        </Tooltip>
      )}
      <Tooltip label="Ver tarea">
        <ActionIcon
          component={Link}
          href={`/portal/tasks/${task.id}${suffix}`}
          variant="light"
          size="md"
          aria-label="Ver tarea"
        >
          <Eye size={16} strokeWidth={1.5} />
        </ActionIcon>
      </Tooltip>
      {hasMenu && (
        <Menu position="bottom-end" withinPortal>
          <Menu.Target>
            <ActionIcon variant="subtle" color="gray" size="md" aria-label="Más acciones">
              <Ellipsis size={16} strokeWidth={1.5} />
            </ActionIcon>
          </Menu.Target>
          <Menu.Dropdown>
            {referenceHref && (
              <Menu.Item
                component={Link}
                href={referenceHref}
                leftSection={<ExternalLink size={14} strokeWidth={1.5} />}
              >
                Abrir entidad relacionada
              </Menu.Item>
            )}
            {has('release') && (
              <Menu.Item
                leftSection={<RotateCcw size={14} strokeWidth={1.5} />}
                onClick={() => command.mutate({ action: 'release' })}
              >
                Liberar tarea
              </Menu.Item>
            )}
            {has('archive') && (
              <Menu.Item
                leftSection={<Archive size={14} strokeWidth={1.5} />}
                onClick={() => command.mutate({ action: 'archive' })}
              >
                Archivar
              </Menu.Item>
            )}
            {has('delete') && (
              <Menu.Item
                color="red"
                leftSection={<Trash2 size={14} strokeWidth={1.5} />}
                onClick={() =>
                  window.confirm('¿Eliminar esta tarea pendiente?') &&
                  command.mutate({ action: 'delete' })
                }
              >
                Eliminar
              </Menu.Item>
            )}
          </Menu.Dropdown>
        </Menu>
      )}
    </Group>
  )
}
