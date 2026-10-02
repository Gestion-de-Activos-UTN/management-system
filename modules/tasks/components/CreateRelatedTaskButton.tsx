'use client'

import { useState } from 'react'
import { ActionIcon, Button, Modal, Tooltip } from '@mantine/core'
import { ListPlus } from 'lucide-react'
import type { TaskReferenceInput } from '../schema'
import { TaskForm } from './TaskForm'
import { useTenantContext } from '@/modules/auth/hooks/use-tenant-context'

export function CreateRelatedTaskButton({
  reference,
  asOrganization,
  compact = false,
}: {
  reference: TaskReferenceInput
  asOrganization?: string
  compact?: boolean
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
            <ListPlus size={16} />
          </ActionIcon>
        </Tooltip>
      ) : (
        <Button
          variant="light"
          leftSection={<ListPlus size={16} />}
          onClick={() => setOpened(true)}
        >
          Crear tarea
        </Button>
      )}
      <Modal
        opened={opened}
        onClose={() => setOpened(false)}
        title="Crear tarea relacionada"
        size="xl"
      >
        <TaskForm
          asOrganization={asOrganization}
          initialReference={reference}
          onSaved={() => setOpened(false)}
        />
      </Modal>
    </>
  )
}
