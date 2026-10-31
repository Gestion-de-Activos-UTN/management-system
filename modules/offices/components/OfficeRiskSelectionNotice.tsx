import { Alert } from '@mantine/core'

export function OfficeRiskSelectionNotice() {
  return (
    <Alert color="pine" title="Selecciona una oficina para ver el riesgo">
      Selecciona una oficina en el filtro superior para consultar su puntaje y cobertura. Los
      listados siguen mostrando todas tus oficinas asignadas.
    </Alert>
  )
}
