import { expect, it } from 'vitest'
import { ValidationError } from 'payload'
import { validateCategoryGroups } from './validateCategoryGroups'

const call = (data: Record<string, unknown>, originalDoc?: Record<string, unknown>) =>
  validateCategoryGroups({ data, originalDoc, collection: { slug: 'non-network-assets' } } as never)

it('reports all required product fields as Payload field errors', async () => {
  try {
    await call({ asset_category: 'software_license' })
    throw new Error('Expected category validation to reject the write')
  } catch (error) {
    expect(error).toBeInstanceOf(ValidationError)
    expect((error as ValidationError).data).toMatchObject({
      collection: 'non-network-assets',
      errors: [
        { path: 'product_details.software_vendor', message: 'Escribe el proveedor.' },
        { path: 'product_details.software_product', message: 'Escribe el producto.' },
      ],
    })
  }
})

it('applies the cleanup after the incoming data so obsolete values cannot overwrite nulls', async () => {
  const result = await call({
    asset_category: 'computer',
    alias: 'Equipo de oficina',
    product_details: { software_vendor: 'Obsoleto', software_product: 'Obsoleto' },
  })
  expect(result).toEqual({
    asset_category: 'computer',
    alias: 'Equipo de oficina',
    product_details: { software_vendor: null, software_product: null, software_version: null },
  })
})

it('preserves a valid partial update without copying the whole stored document into the patch', async () => {
  const data = { notes: 'Nota actualizada', product_details: { software_version: null } }
  const original = {
    asset_category: 'software_license',
    alias: 'Licencia existente',
    product_details: {
      software_vendor: 'Proveedor',
      software_product: 'Producto',
      software_version: '1.2',
    },
  }
  expect(await call(data, original)).toEqual(data)
  expect(original.product_details.software_version).toBe('1.2')
})

it('keeps the selected group while removing fields belonging to the previous category', async () => {
  const data = {
    asset_category: 'information_repository',
    repository_details: { kind: 'secrets_vault' },
  }
  expect(
    await call(data, {
      asset_category: 'cloud_asset',
      cloud_details: { kind: 'domain_dns', vendor: 'Proveedor' },
    })
  ).toEqual({ ...data, cloud_details: { kind: null, vendor: null } })
})
