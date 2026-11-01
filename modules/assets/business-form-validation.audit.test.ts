import { expect, it } from 'vitest'
import { zodResolver } from '@hookform/resolvers/zod'
import { createAssetBusinessFieldsSchema, type AssetBusinessFields } from './schema'

const original: AssetBusinessFields = {
  authorization_status: 'authorized',
  alias: 'Equipo de prueba',
  criticality: 'medium',
  owner: 'original-owner',
  location: null,
  status: 'active',
  assessment_scope: 'excluded',
  assessment_exclusion_reason: null,
  assessment_exclusion_note: null,
  assessment_excluded_until: '2099-01-01T00:00:00.000Z',
}

it('reports an untouched missing exclusion reason when submitting an owner change', async () => {
  const resolver = zodResolver(createAssetBusinessFieldsSchema(original))
  const result = await resolver({ ...original, owner: 'new-owner' }, undefined, {
    fields: {},
    shouldUseNativeValidation: false,
  })
  expect(result.values).toEqual({})
  expect(result.errors.assessment_exclusion_reason?.message).toBe(
    'Selecciona un motivo de exclusión.'
  )
})

it('accepts the owner change once the missing reason is completed', async () => {
  const resolver = zodResolver(createAssetBusinessFieldsSchema(original))
  const result = await resolver(
    { ...original, owner: 'new-owner', assessment_exclusion_reason: 'temporary_or_lab' },
    undefined,
    { fields: {}, shouldUseNativeValidation: false }
  )
  expect(result.errors).toEqual({})
  expect(result.values).toMatchObject({ owner: 'new-owner' })
})

it('allows ordinary business edits on an included asset without exclusion metadata', async () => {
  const resolver = zodResolver(createAssetBusinessFieldsSchema())
  const result = await resolver(
    {
      ...original,
      alias: 'Alias actualizado',
      assessment_scope: 'included',
      assessment_excluded_until: null,
    },
    undefined,
    { fields: {}, shouldUseNativeValidation: false }
  )
  expect(result.errors).toEqual({})
  expect(result.values).toMatchObject({ alias: 'Alias actualizado' })
})

it('exposes the seeded location error on an unrelated edit and accepts its correction', async () => {
  const resolver = zodResolver(createAssetBusinessFieldsSchema())
  const values: AssetBusinessFields = {
    ...original,
    owner: 'new-owner',
    assessment_scope: 'included',
    assessment_excluded_until: null,
    location: 'Finanzas — puesto 4',
  }
  const options = { fields: {}, shouldUseNativeValidation: false }
  const invalid = await resolver(values, undefined, options)
  expect(invalid.errors.location?.message).toBeTruthy()
  expect(invalid.values).toEqual({})

  const corrected = await resolver(
    { ...values, location: 'Finanzas - puesto 4' },
    undefined,
    options
  )
  expect(corrected.errors).toEqual({})
  expect(corrected.values).toMatchObject({ owner: 'new-owner', location: 'Finanzas - puesto 4' })
})
