/**
 * Qué caracteres admite cada tipo de campo de texto. Se usan en los schemas Zod compartidos por
 * formularios y endpoints: `z.string().trim().max(120).regex(...TEXT_RULES.label)`.
 *
 * No es una defensa contra inyección (React escapa todo lo que muestra): evita nombres con
 * símbolos sueltos o sintaxis de Markdown ("## **Valeria**") que ensucian listados y reportes.
 * Los patrones aceptan cadena vacía; si el campo es obligatorio lo exige su `.min()`.
 */
export const TEXT_RULES = {
  /** Nombres de persona: letras (acentos, ñ), espacio, apóstrofo, guion y punto. */
  personName: [/^[\p{L}\p{M} .'’-]*$/u, 'Usa solo letras, espacios, apóstrofos, guiones o puntos.'],
  /** Nombres cortos de cosas: alias, ubicación, oficina, nombre de un escaneo. */
  label: [
    /^[\p{L}\p{M}\p{N} .,_'’()/#-]*$/u,
    "Usa solo letras, números, espacios y . , - _ ' ( ) / #",
  ],
  /** Títulos: lo de `label` más la puntuación de una frase. */
  title: [
    /^[\p{L}\p{M}\p{N} .,_'’()/#:;¿?¡!"“”%&-]*$/u,
    'Usa solo letras, números, espacios y puntuación común.',
  ],
  /** Texto libre: todo menos caracteres de control invisibles (sí saltos de línea y tabs). */
  free: [/^(?:[^\p{Cc}]|[\n\r\t])*$/u, 'El texto contiene caracteres no válidos.'],
} as const satisfies Record<string, readonly [RegExp, string]>

/**
 * Error de caracteres mientras se escribe (o null). Los formularios que validan el schema recién
 * al guardar lo usan para avisar en el momento, sin bloquear lo que se tipea o se pega.
 */
export const textRuleError = (value: string, rule: keyof typeof TEXT_RULES) =>
  TEXT_RULES[rule][0].test(value) ? null : TEXT_RULES[rule][1]
