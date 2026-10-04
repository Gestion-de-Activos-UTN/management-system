import { Text, Tooltip } from '@mantine/core'

/**
 * Texto secundario de una celda en una sola línea: trunca con tooltip en vez de hacer crecer la
 * fila a 3-4 líneas. Sin valor muestra "—" atenuado. La columna necesita un ancho acotado.
 */
export function OneLineText({ children }: { children: string | null | undefined }) {
  if (!children) {
    return (
      <Text size="sm" c="dimmed">
        —
      </Text>
    )
  }
  return (
    <Tooltip label={children} openDelay={400}>
      <Text size="sm" truncate>
        {children}
      </Text>
    </Tooltip>
  )
}
