import assert from 'node:assert/strict'
import test from 'node:test'
import {
  AssetIdentificationSchema,
  normalizeAssetIdentificationForm,
  UNKNOWN_IDENTIFICATION_VALUE,
} from './schema'

test('permite identificar un activo autorizado sin conocer owner ni criticality', () => {
  const parsed = AssetIdentificationSchema.parse({
    confirmed_type: 'workstation',
    authorization_status: 'authorized',
    owner: null,
    criticality: null,
  })

  assert.equal(parsed.owner, null)
  assert.equal(parsed.criticality, null)
})

test('sigue rechazando valores centinela de la interfaz', () => {
  assert.throws(() =>
    AssetIdentificationSchema.parse({
      confirmed_type: 'workstation',
      authorization_status: 'authorized',
      owner: '__unknown__',
      criticality: '__unknown__',
    })
  )
})

test('normaliza las opciones desconocidas del formulario antes de enviarlas al endpoint', () => {
  const parsed = normalizeAssetIdentificationForm({
    confirmed_type: 'workstation',
    authorization_status: 'authorized',
    owner: UNKNOWN_IDENTIFICATION_VALUE,
    criticality: UNKNOWN_IDENTIFICATION_VALUE,
    alias: null,
    location: null,
  })

  assert.equal(parsed.owner, null)
  assert.equal(parsed.criticality, null)
})
