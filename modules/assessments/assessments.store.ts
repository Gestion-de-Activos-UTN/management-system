import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import type { BulkAssessmentSelector } from './schema'

// "Responder varias" vive en su propia ruta: el alcance elegido y la selección sobreviven a una
// recarga o a ir y volver con el navegador (sessionStorage = sólo esta pestaña). Las respuestas
// del cuestionario no se guardan: la página avisa antes de salir del paso final.
// La vista previa (servidor) nunca se copia acá — se vuelve a pedir con `selector` (ADR-007).
type BulkAssessmentState = {
  selector: BulkAssessmentSelector | null
  selected: string[]
  setSelector: (selector: BulkAssessmentSelector) => void
  setSelected: (selected: string[]) => void
  reset: () => void
}

export const useBulkAssessmentStore = create<BulkAssessmentState>()(
  persist(
    set => ({
      selector: null,
      selected: [],
      setSelector: selector => set({ selector }),
      setSelected: selected => set({ selected }),
      reset: () => set({ selector: null, selected: [] }),
    }),
    { name: 'siam.bulk-assessment', storage: createJSONStorage(() => sessionStorage) }
  )
)
