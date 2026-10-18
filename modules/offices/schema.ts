import { z } from 'zod'
import { TEXT_RULES } from '@/lib/text-rules'
import { isDepartmentOf, provinceName } from '@/lib/argentina-geo'

// Mismo schema en el formulario y en endpoints/offices.ts.
export const OfficeInputSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, 'Escribe el nombre de la oficina.')
      .max(120)
      .regex(...TEXT_RULES.label),
    province_id: z.string().min(1, 'Selecciona la provincia.'),
    department_id: z.string().min(1).nullable().optional(),
  })
  .superRefine((value, ctx) => {
    if (!provinceName(value.province_id)) {
      ctx.addIssue({ code: 'custom', path: ['province_id'], message: 'Provincia inválida.' })
    } else if (value.department_id && !isDepartmentOf(value.department_id, value.province_id)) {
      ctx.addIssue({
        code: 'custom',
        path: ['department_id'],
        message: 'El departamento no pertenece a la provincia.',
      })
    }
  })

// Reactivar no pide nada más: no restaura escáneres, personas ni activos.
// Desactivar exige escribir el nombre de la oficina y elegir el destino de cada activo manual
// vigente; el servidor rechaza (409 impact_changed) si el conjunto no coincide con el actual.
export const OfficeStatusSchema = z.discriminatedUnion('is_active', [
  z.object({ is_active: z.literal(true) }),
  z.object({
    is_active: z.literal(false),
    confirm_name: z
      .string()
      .trim()
      .min(1, 'Escribe el nombre de la oficina para confirmar.')
      .max(120)
      // `free` y no `label`: se compara contra el nombre guardado, que puede venir del admin o
      // del seed con caracteres que `label` rechaza; si no, esa oficina no podría desactivarse.
      .regex(...TEXT_RULES.free),
    manual_asset_moves: z
      .array(z.object({ asset_id: z.uuid(), office_id: z.uuid() }))
      .max(5000)
      .default([]),
  }),
])

export type OfficeStatusInput = z.infer<typeof OfficeStatusSchema>
export type OfficeDeactivationInput = Extract<OfficeStatusInput, { is_active: false }>

export type OfficeInput = z.infer<typeof OfficeInputSchema>
