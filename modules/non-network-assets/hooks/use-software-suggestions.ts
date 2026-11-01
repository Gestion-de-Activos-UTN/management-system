'use client'

import { useQuery } from '@tanstack/react-query'
import { getSoftwareSuggestions } from '../service'

// useQuery directo y no useListQuery por el `enabled`: el form se abre para cualquier categoría,
// pero solo las de CATEGORY_HAS_SOFTWARE necesitan sugerencias — sin esta guarda, cargar una
// impresora dispararía igual el find de hasta 5000 filas del endpoint.
// staleTime heredado de lib/query-client.ts (30s): esa es la ventana en la que un proveedor
// cargado por otra persona en otro navegador todavía no aparece acá. Se cierra sola al volver a
// la pestaña o reabrir el form (refetchOnWindowFocus/refetchOnMount, ambos por defecto), y la
// invalidación en use-save-non-network-asset.ts cubre a quien acaba de guardar.
// Sin officeId en la key: el endpoint es org-scoped a propósito.
export function useSoftwareSuggestions(params: { asOrganization?: string; enabled: boolean }) {
  return useQuery({
    queryKey: ['software-suggestions', params.asOrganization],
    queryFn: () => getSoftwareSuggestions(params.asOrganization),
    enabled: params.enabled,
  })
}
