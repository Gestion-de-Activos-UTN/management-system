'use client'

import { useState } from 'react'
import { ActionIcon, Group, TextInput, Title, Tooltip } from '@mantine/core'
import { Check, Pencil, X } from 'lucide-react'

/**
 * Título de página con renombrado en el lugar: lápiz → campo de texto (Enter guarda, Escape
 * cancela). `value` es el nombre propio actual ('' = sin nombre, se muestra `fallback`).
 */
export function EditableTitle({
  value,
  fallback,
  canEdit,
  saving,
  maxLength,
  validate,
  onSave,
}: {
  value: string
  fallback: string
  canEdit: boolean
  saving: boolean
  maxLength: number
  validate: (value: string) => string | null
  onSave: (value: string) => Promise<unknown>
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const title = (
    <Title order={2} style={{ lineHeight: 1.1 }}>
      {value || fallback}
    </Title>
  )

  if (!canEdit) return title
  if (draft === null) {
    return (
      <Group gap={6} wrap="nowrap">
        {title}
        <Tooltip label="Cambiar nombre">
          <ActionIcon
            variant="subtle"
            size="md"
            aria-label="Cambiar nombre"
            onClick={() => setDraft(value)}
          >
            <Pencil size={16} strokeWidth={1.5} />
          </ActionIcon>
        </Tooltip>
      </Group>
    )
  }

  const error = validate(draft)
  const save = () => {
    if (error) return
    onSave(draft).then(
      () => setDraft(null),
      () => undefined
    )
  }
  // La ayuda va debajo del campo: así el campo queda a la altura de las acciones del encabezado,
  // y los botones (size input-sm) miden lo mismo que él.
  return (
    <Group gap={6} wrap="nowrap" align="flex-start" style={{ flex: 1, maxWidth: 560 }}>
      <TextInput
        aria-label="Nombre"
        placeholder={fallback}
        description="Déjalo vacío para volver al nombre por defecto."
        inputWrapperOrder={['input', 'description', 'error']}
        error={error}
        autoFocus
        maxLength={maxLength}
        value={draft}
        onChange={event => setDraft(event.currentTarget.value)}
        onKeyDown={event => {
          if (event.key === 'Enter') void save()
          if (event.key === 'Escape') setDraft(null)
        }}
        disabled={saving}
        style={{ flex: 1 }}
      />
      <ActionIcon
        variant="light"
        size="input-sm"
        aria-label="Guardar nombre"
        loading={saving}
        disabled={Boolean(error)}
        onClick={() => void save()}
      >
        <Check size={16} strokeWidth={1.5} />
      </ActionIcon>
      <ActionIcon
        variant="subtle"
        color="gray"
        size="input-sm"
        aria-label="Cancelar"
        onClick={() => setDraft(null)}
        disabled={saving}
      >
        <X size={16} strokeWidth={1.5} />
      </ActionIcon>
    </Group>
  )
}
