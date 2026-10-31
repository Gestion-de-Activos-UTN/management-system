import { expect, it } from 'vitest'
import { searchOptionsFilter } from './search-options-filter'

it('filters options without changing their values or displayed labels', () => {
  const options = [
    { value: 'device-id', label: 'Portátil' },
    { value: 'other-id', label: 'Servidor' },
  ]
  expect(searchOptionsFilter({ options, search: 'portatil', limit: Infinity })).toEqual([
    options[0],
  ])
  expect(
    searchOptionsFilter({
      options: [{ value: 'plain', label: 'Portatil' }],
      search: 'portátil',
      limit: Infinity,
    })
  ).toEqual([{ value: 'plain', label: 'Portatil' }])
})
it('preserves group labels and disabled states, and omits empty groups', () => {
  const options = [
    {
      group: 'Oficinas',
      items: [
        { value: 'a', label: 'Córdoba', disabled: true },
        { value: 'b', label: 'Rosario' },
      ],
    },
    { group: 'Personas', items: [{ value: 'c', label: 'Lucía' }] },
  ]
  expect(searchOptionsFilter({ options, search: 'cordoba', limit: Infinity })).toEqual([
    { group: 'Oficinas', items: [{ value: 'a', label: 'Córdoba', disabled: true }] },
  ])
  expect(options[0].items).toHaveLength(2)
})
it('applies the option limit across groups and flat entries', () => {
  const options = [
    { group: 'Grupo 1', items: [{ value: 'a', label: 'Portátil A' }] },
    {
      group: 'Grupo 2',
      items: [
        { value: 'b', label: 'Portátil B' },
        { value: 'c', label: 'Portátil C' },
      ],
    },
    { value: 'd', label: 'Portátil D' },
  ]
  expect(searchOptionsFilter({ options, search: 'portatil', limit: 2 })).toEqual([
    options[0],
    { group: 'Grupo 2', items: [options[1].items![0]] },
  ])
  expect(searchOptionsFilter({ options, search: '', limit: 0 })).toEqual([])
})
