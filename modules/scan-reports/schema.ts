import { z } from 'zod'
import { TEXT_RULES } from '@/lib/text-rules'

/** Nombre opcional de un informe de escaneo o instantánea; vacío vuelve al título por defecto. */
export const EVIDENCE_NAME_MAX = 80

export const EvidenceNameSchema = z.object({
  display_name: z
    .string()
    .trim()
    .max(EVIDENCE_NAME_MAX, `Máximo ${EVIDENCE_NAME_MAX} caracteres`)
    .regex(...TEXT_RULES.label)
    .nullable()
    .transform(value => value || null),
})

export type EvidenceNameInput = z.input<typeof EvidenceNameSchema>

/** Mensaje de error del nombre (o null si es válido), para validar antes de enviar. */
export const evidenceNameError = (value: string) => {
  const parsed = EvidenceNameSchema.safeParse({ display_name: value })
  return parsed.success ? null : (parsed.error.issues[0]?.message ?? 'Nombre inválido.')
}
