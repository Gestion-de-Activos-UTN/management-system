'use client'

import { useState } from 'react'
import { ActionIcon, Button, Modal, Tooltip } from '@mantine/core'
import { ListPlus } from 'lucide-react'
import type { TaskReferenceInput } from '../schema'
import { TASK_REFERENCE_TYPE_LABELS } from '../task-labels'
import { TaskForm } from './TaskForm'
import { useTenantContext } from '@/modules/auth/hooks/use-tenant-context'

/**
 * Punto de entrada único para crear tareas desde otra pantalla. Con `editable`, el tipo queda
 * fijo pero la entidad se elige dentro del form (p. ej. inventario: oficina preseleccionada).
 */
export function CreateRelatedTaskButton({
  reference,
  asOrganization,
  compact = false,
  editable = false,
  label = 'Crear tarea',
}: {
  reference: { relationTo: TaskReferenceInput['relationTo']; value?: string | null }
  asOrganization?: string
  compact?: boolean
  editable?: boolean
  label?: string
}) {
  const [opened, setOpened] = useState(false)
  const tenant = useTenantContext(asOrganization)
  if (!tenant.data?.permissions.tasks.includes('create')) return null
  return (
    <>
      {compact ? (
        <Tooltip label="Crear tarea relacionada">
          <ActionIcon
            variant="light"
            onClick={() => setOpened(true)}
            aria-label="Crear tarea relacionada"
          >
            <ListPlus size={16} strokeWidth={1.5} />
          </ActionIcon>
        </Tooltip>
      ) : (
        <Button
          variant="light"
          leftSection={<ListPlus size={16} strokeWidth={1.5} />}
          onClick={() => setOpened(true)}
        >
          {label}
        </Button>
      )}
      <Modal
        opened={opened}
        onClose={() => setOpened(false)}
        title={`Nueva tarea · ${TASK_REFERENCE_TYPE_LABELS[reference.relationTo]}`}
        size="xl"
      >
        {/* Remonta el form al abrir para tomar la referencia vigente (p. ej. otra oficina). */}
        {opened && (
          <TaskForm
            asOrganization={asOrganization}
            initialReference={{
              relationTo: reference.relationTo,
              value: reference.value ?? undefined,
            }}
            referenceEditable={editable}
            onSaved={() => setOpened(false)}
          />
        )}
      </Modal>
    </>
  )
}
