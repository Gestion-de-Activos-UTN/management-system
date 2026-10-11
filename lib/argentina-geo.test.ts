import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  DEPARTMENTS,
  PROVINCES,
  departmentsOf,
  isDepartmentOf,
  locationLabel,
  provinceName,
} from './argentina-geo'

describe('argentina-geo', () => {
  it('trae las 24 jurisdicciones y todos los departamentos apuntan a una de ellas', () => {
    assert.equal(PROVINCES.length, 24)
    const ids = new Set(PROVINCES.map(province => province.id))
    assert.ok(DEPARTMENTS.length > 500)
    assert.ok(DEPARTMENTS.every(department => ids.has(department.province_id)))
  })

  it('CABA se divide en 15 comunas', () => {
    assert.equal(provinceName('02'), 'Ciudad Autónoma de Buenos Aires')
    assert.equal(departmentsOf('02').length, 15)
  })

  it('valida que el departamento pertenezca a la provincia', () => {
    const rosario = DEPARTMENTS.find(d => d.name === 'Rosario')!
    assert.equal(isDepartmentOf(rosario.id, rosario.province_id), true)
    assert.equal(isDepartmentOf(rosario.id, '02'), false)
    assert.equal(isDepartmentOf('99999', rosario.province_id), false)
  })

  it('arma la etiqueta de ubicación', () => {
    const rosario = DEPARTMENTS.find(d => d.name === 'Rosario')!
    assert.equal(locationLabel(rosario.province_id, rosario.id), 'Rosario, Santa Fe')
    assert.equal(locationLabel('82', null), 'Santa Fe')
    assert.equal(locationLabel(null, rosario.id), null)
  })
})
