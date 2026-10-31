import { expect, it } from 'vitest'
import { matchesSearch, normalizeSearchText } from './search-text'

it.each([
  ['portátil', 'portatil'],
  ['portatil', 'portátil'],
  ['PORTÁTIL', ' portatil '],
  ['porta\u0301til', 'portátil'],
  ['Córdoba', 'cordoba'],
  ['Lucía Fernández', 'lucia fernandez'],
  ['Evaluación de seguridad', 'evaluacion'],
  ['Pingüino', 'pinguino'],
])('finds %s with query %s', (value, query) => {
  expect(matchesSearch([value], query)).toBe(true)
})
it('keeps substring matching across any of the searchable fields', () => {
  expect(matchesSearch([null, 'Sin alias', 'Portátil de recepción', undefined], 'recepcion')).toBe(
    true
  )
  expect(matchesSearch(['Portátil', 'Servidor'], 'impresora')).toBe(false)
})
it('handles empty searches and missing fields without throwing', () => {
  expect(matchesSearch([], '   ')).toBe(true)
  expect(matchesSearch([null, undefined], 'portatil')).toBe(false)
})
it('keeps punctuation and numbers meaningful for host names, IPs and email addresses', () => {
  expect(normalizeSearchText(' HOST-01.Test@SIAM.COM ')).toBe('host-01.test@siam.com')
  expect(matchesSearch(['192.168.10.20'], '168.10')).toBe(true)
  expect(matchesSearch(['192.168.10.20'], '192168')).toBe(false)
})
