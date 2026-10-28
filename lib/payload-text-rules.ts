import type { TextFieldSingleValidation } from 'payload'
import { text } from 'payload/shared'
import { TEXT_RULES } from './text-rules'

/**
 * Las mismas reglas de los schemas Zod, aplicadas en la colección: cubren las escrituras que no
 * pasan por un endpoint /api/v1 (el REST genérico de Payload, el seed, la Local API).
 */
export const textRule =
  (rule: keyof typeof TEXT_RULES): TextFieldSingleValidation =>
  (value, args) =>
    value && !TEXT_RULES[rule][0].test(value) ? TEXT_RULES[rule][1] : text(value, args)