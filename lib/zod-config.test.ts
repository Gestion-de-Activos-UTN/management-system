import { test } from 'node:test'
import assert from 'node:assert/strict'
import { z } from 'zod'
import './zod-config'

const message = (schema: z.ZodType, value: unknown) =>
  schema.safeParse(value).error?.issues[0]?.message

test('zod-config: los errores sin mensaje propio salen en español y legibles', () => {
  assert.equal(message(z.string().min(3), 'ab'), 'Escribe al menos 3 caracteres.')
  assert.equal(message(z.string().min(1), ''), 'Completa este campo.')
  assert.equal(message(z.string().min(3), ''), 'Completa este campo.')
  assert.equal(message(z.string().trim().min(3), '   '), 'Completa este campo.')
  assert.equal(message(z.string().max(5), 'abcdefg'), 'Escribe como máximo 5 caracteres.')
  assert.equal(message(z.object({ name: z.string() }), {}), 'Completa este campo.')
  assert.equal(message(z.array(z.string()).min(1), []), 'Selecciona al menos una opción.')
  // El resto cae en el locale español de Zod, nunca en inglés.
  assert.doesNotMatch(String(message(z.email(), 'x')), /Invalid/)
})

test('zod-config: un mensaje escrito en el schema sigue teniendo prioridad', () => {
  assert.equal(message(z.string().min(3, 'Muy corto'), 'ab'), 'Muy corto')
})

test('zod-config: selectores sin mensajes propios no enumeran valores internos', () => {
  const schema = z.enum(['computer', 'mobile_device', 'network_device'])
  for (const empty of [undefined, null, ''])
    assert.equal(message(schema, empty), 'Selecciona una opción.')
  assert.equal(message(schema, 'invalid'), 'Selecciona una opción válida.')
  assert.equal(
    message(z.enum(['computer'], { error: 'Selecciona una categoría.' }), undefined),
    'Selecciona una categoría.'
  )
})
