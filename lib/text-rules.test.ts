import { test } from 'node:test'
import assert from 'node:assert/strict'
import { TEXT_RULES } from './text-rules'

const ok = (rule: keyof typeof TEXT_RULES, value: string) => TEXT_RULES[rule][0].test(value)

test('personName admite nombres reales y rechaza símbolos', () => {
  for (const name of ["Valeria D'Rossi", 'José Núñez-Peña', 'María J. López', ''])
    assert.ok(ok('personName', name), name)
  for (const name of ["## **Valeria D'Rossi**", 'Ana2', 'Juan <b>', 'a_b'])
    assert.ok(!ok('personName', name), name)
})

test('label admite alias y ubicaciones habituales', () => {
  for (const value of ['PC-FIN-04', 'Piso 2, Of. 3B', 'Rack #2 (sótano)', 'srv_backup/01'])
    assert.ok(ok('label', value), value)
  for (const value of ['**Impresora**', 'Equipo <x>', 'a|b', 'café ☕'])
    assert.ok(!ok('label', value), value)
})

test('title admite puntuación de frase', () => {
  assert.ok(ok('title', '¿Actualizar el firmware del router? ¡Urgente!: 100%'))
  assert.ok(!ok('title', '**Título**'))
  assert.ok(!ok('title', 'Ver `código`'))
})

test('free admite saltos de línea pero no caracteres de control', () => {
  assert.ok(ok('free', 'Línea 1\nLínea 2\t* con símbolos # <>'))
  assert.ok(!ok('free', 'texto\u0000oculto'))
  assert.ok(!ok('free', 'campana\u0007'))
})
