import { z } from 'zod'

// Zod responde en inglés cuando un schema no trae mensaje propio ("Too small: expected string to
// have >=3 characters"). Se configura una sola vez, en el cliente (lib/providers.tsx) y en el
// servidor (payload.config.ts): los casos comunes con un texto amable, el resto con el locale
// en español de Zod. Un mensaje escrito en el schema sigue teniendo prioridad.
const friendly: z.core.$ZodErrorMap = issue => {
  if (issue.code === 'invalid_type' && issue.input === undefined)
    return 'Este campo es obligatorio.'
  if (issue.code === 'too_small' && issue.origin === 'string')
    return Number(issue.minimum) <= 1
      ? 'Este campo es obligatorio.'
      : `Escribe al menos ${issue.minimum} caracteres.`
  if (issue.code === 'too_big' && issue.origin === 'string')
    return `Escribe como máximo ${issue.maximum} caracteres.`
  if (issue.code === 'too_small' && issue.origin === 'array')
    return Number(issue.minimum) <= 1
      ? 'Elige al menos una opción.'
      : `Elige al menos ${issue.minimum}.`
  if (issue.code === 'too_big' && issue.origin === 'array')
    return `Elige como máximo ${issue.maximum}.`
  return undefined
}

z.config({ ...z.locales.es(), customError: friendly })
