'use client'

import { ModalLayout } from '@/components/ui/ModalLayout'
import { useState } from 'react'
import { ActionIcon, Button, Group, Modal, TextInput, Tooltip } from '@mantine/core'
import { Pencil } from 'lucide-react'

/**
 * Botón de lápiz para la columna Acciones: abre un modal para cambiar el nombre propio de un
 * registro. Mismas reglas que EditableTitle ('' vuelve al nombre por defecto `fallback`).
 */
export function RenameAction({
  value,
  fallback,
  maxLength,
  saving,
  validate,
  onSave,
}: {
  value: string
  fallback: string
  maxLength: number
  saving: boolean
  validate: (value: string) => string | null
  onSave: (value: string) => Promise<unknown>
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const error = draft === null ? null : validate(draft)
  const save = () => {
    if (draft === null || error) return
    onSave(draft).then(
      () => setDraft(null),
      () => undefined
    )
  }

  return (
    <>
      <Tooltip label="Cambiar nombre">
        <ActionIcon
          variant="light"
          size="md"
          aria-label="Cambiar nombre"
          onClick={() => setDraft(value)}
        >
          <Pencil size={16} strokeWidth={1.5} />
        </ActionIcon>
      </Tooltip>
      <Modal opened={draft !== null} onClose={() => setDraft(null)} title="Cambiar nombre" centered>
        <form
          onSubmit={event => {
            event.preventDefault()
            save()
          }}
        >
          <ModalLayout
            gap="md"
            footer={
              <Group justify="flex-end" gap="sm">
                <Button variant="default" onClick={() => setDraft(null)} disabled={saving}>
                  Cancelar
                </Button>
                <Button type="submit" loading={saving} disabled={Boolean(error)}>
                  Guardar
                </Button>
              </Group>
            }
          >
            <TextInput
              label="Nombre"
              placeholder={fallback}
              description="Déjalo vacío para volver al nombre por defecto."
              inputWrapperOrder={['label', 'input', 'description', 'error']}
              data-autofocus
              maxLength={maxLength}
              value={draft ?? ''}
              onChange={event => setDraft(event.currentTarget.value)}
              error={error}
              disabled={saving}
            />
          </ModalLayout>
        </form>
      </Modal>
    </>
  )
}
