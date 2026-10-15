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

export const OfficeStatusSchema = z.object({
  is_active: z.boolean(),
  /** Segundo paso tras el aviso: desactivar también a quienes quedan sin oficina. */
  confirm_member_deactivation: z.boolean().optional(),
})

export type OfficeInput = z.infer<typeof OfficeInputSchema>
