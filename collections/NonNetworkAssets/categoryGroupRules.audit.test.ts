import { expect, it } from 'vitest'
import { resolveCategoryGroups } from './categoryGroupRules'

// Independent business examples: do not derive expectations from GROUP_FIELDS/CATEGORY_GROUP.
const product = {
  software_vendor: 'Proveedor de prueba',
  software_product: 'Aplicación',
  software_version: '1.2',
}
const cloud = { kind: 'infrastructure', vendor: 'Proveedor cloud' }
const repository = { kind: 'database' }
const emptyProduct = { software_vendor: null, software_product: null, software_version: null }
const emptyCloud = { kind: null, vendor: null }
const emptyRepository = { kind: null }

it.each([
  { category: 'antivirus_edr', details: { product_details: product } },
  { category: 'software_license', details: { product_details: product } },
  { category: 'cloud_asset', details: { cloud_details: cloud } },
  { category: 'information_repository', details: { repository_details: repository } },
])('$category accepts its complete category group', ({ category, details }) => {
  expect(resolveCategoryGroups({ asset_category: category, ...details }, null)).toEqual({
    errors: [],
    clean: {},
  })
})

it.each([
  {
    category: 'antivirus_edr',
    expected: [
      { path: 'product_details.software_vendor', message: 'Escribe el proveedor.' },
      { path: 'product_details.software_product', message: 'Escribe el producto.' },
    ],
  },
  {
    category: 'software_license',
    expected: [
      { path: 'product_details.software_vendor', message: 'Escribe el proveedor.' },
      { path: 'product_details.software_product', message: 'Escribe el producto.' },
    ],
  },
  {
    category: 'cloud_asset',
    expected: [{ path: 'cloud_details.kind', message: 'Selecciona un tipo.' }],
  },
  {
    category: 'information_repository',
    expected: [{ path: 'repository_details.kind', message: 'Selecciona un tipo.' }],
  },
])(
  '$category reports all missing required fields at their exact paths',
  ({ category, expected }) => {
    expect(resolveCategoryGroups({ asset_category: category }, null)).toEqual({
      errors: expected,
      clean: {},
    })
  }
)

for (const blank of [undefined, null, '', ' \t\n']) {
  it.each([
    {
      category: 'software_license',
      group: 'product_details',
      field: 'software_vendor',
      message: 'Escribe el proveedor.',
      details: product,
    },
    {
      category: 'software_license',
      group: 'product_details',
      field: 'software_product',
      message: 'Escribe el producto.',
      details: product,
    },
    {
      category: 'cloud_asset',
      group: 'cloud_details',
      field: 'kind',
      message: 'Selecciona un tipo.',
      details: cloud,
    },
    {
      category: 'information_repository',
      group: 'repository_details',
      field: 'kind',
      message: 'Selecciona un tipo.',
      details: repository,
    },
  ])(
    `$category treats ${JSON.stringify(blank)} as an empty $field`,
    ({ category, group, field, message, details }) => {
      expect(
        resolveCategoryGroups(
          { asset_category: category, [group]: { ...details, [field]: blank } },
          null
        )
      ).toEqual({ errors: [{ path: `${group}.${field}`, message }], clean: {} })
    }
  )
}

it.each([
  'computer',
  'mobile_device',
  'server',
  'network_device',
  'printer',
  'iot',
  'removable_media',
  'other_equipment',
  'provider_service',
  'backup',
  'physical_record',
  'other',
])('%s does not require a product, cloud or repository group', asset_category => {
  expect(resolveCategoryGroups({ asset_category }, null)).toEqual({ errors: [], clean: {} })
})

it.each([
  {
    category: 'software_license',
    details: { product_details: { software_vendor: 'Proveedor', software_product: 'Producto' } },
  },
  {
    category: 'antivirus_edr',
    details: {
      product_details: {
        software_vendor: 'Proveedor',
        software_product: 'Producto',
        software_version: null,
      },
    },
  },
  { category: 'cloud_asset', details: { cloud_details: { kind: 'domain_dns', vendor: null } } },
])('$category allows optional version/vendor fields to remain unknown', ({ category, details }) => {
  expect(resolveCategoryGroups({ asset_category: category, ...details }, null)).toEqual({
    errors: [],
    clean: {},
  })
})

it('an unrelated edit inherits both category and all existing required fields', () => {
  expect(
    resolveCategoryGroups(
      { notes: 'Nota actualizada' },
      { asset_category: 'software_license', product_details: product }
    )
  ).toEqual({ errors: [], clean: {} })
})

it('a partial product update retains the other required fields from the stored document', () => {
  expect(
    resolveCategoryGroups(
      { product_details: { software_vendor: 'Otro proveedor' } },
      { asset_category: 'software_license', product_details: product }
    )
  ).toEqual({ errors: [], clean: {} })
})

it('an explicitly null field does not resurrect the old required value', () => {
  expect(
    resolveCategoryGroups(
      { product_details: { software_vendor: null } },
      { asset_category: 'software_license', product_details: product }
    )
  ).toEqual({
    errors: [{ path: 'product_details.software_vendor', message: 'Escribe el proveedor.' }],
    clean: {},
  })
})

it('clearing the complete active group does not fall back to the stored fields', () => {
  expect(
    resolveCategoryGroups(
      { product_details: null },
      { asset_category: 'software_license', product_details: product }
    )
  ).toEqual({
    errors: [
      { path: 'product_details.software_vendor', message: 'Escribe el proveedor.' },
      { path: 'product_details.software_product', message: 'Escribe el producto.' },
    ],
    clean: {},
  })
})

it('an omitted group differs from explicitly clearing its required subtype', () => {
  const original = { asset_category: 'cloud_asset', cloud_details: cloud }
  expect(resolveCategoryGroups({}, original).errors).toEqual([])
  expect(resolveCategoryGroups({ cloud_details: { kind: null } }, original).errors).toEqual([
    { path: 'cloud_details.kind', message: 'Selecciona un tipo.' },
  ])
})

it('switching between antivirus and software licenses preserves the shared product group', () => {
  expect(
    resolveCategoryGroups(
      { asset_category: 'antivirus_edr' },
      { asset_category: 'software_license', product_details: product }
    )
  ).toEqual({ errors: [], clean: {} })
})

it.each([
  {
    from: 'software_license',
    details: { product_details: product },
    category: 'computer',
    clean: { product_details: emptyProduct },
  },
  {
    from: 'cloud_asset',
    details: { cloud_details: cloud },
    category: 'backup',
    clean: { cloud_details: emptyCloud },
  },
  {
    from: 'information_repository',
    details: { repository_details: repository },
    category: 'physical_record',
    clean: { repository_details: emptyRepository },
  },
])(
  '$from → $category clears every obsolete field with explicit nulls',
  ({ from, details, category, clean }) => {
    expect(
      resolveCategoryGroups({ asset_category: category }, { asset_category: from, ...details })
    ).toEqual({ errors: [], clean })
  }
)

it.each([
  {
    from: 'software_license',
    original: { product_details: product },
    to: 'cloud_asset',
    incoming: { cloud_details: cloud },
    clean: { product_details: emptyProduct },
  },
  {
    from: 'software_license',
    original: { product_details: product },
    to: 'information_repository',
    incoming: { repository_details: repository },
    clean: { product_details: emptyProduct },
  },
  {
    from: 'cloud_asset',
    original: { cloud_details: cloud },
    to: 'software_license',
    incoming: { product_details: product },
    clean: { cloud_details: emptyCloud },
  },
  {
    from: 'cloud_asset',
    original: { cloud_details: cloud },
    to: 'information_repository',
    incoming: { repository_details: repository },
    clean: { cloud_details: emptyCloud },
  },
  {
    from: 'information_repository',
    original: { repository_details: repository },
    to: 'software_license',
    incoming: { product_details: product },
    clean: { repository_details: emptyRepository },
  },
  {
    from: 'information_repository',
    original: { repository_details: repository },
    to: 'cloud_asset',
    incoming: { cloud_details: cloud },
    clean: { repository_details: emptyRepository },
  },
])(
  '$from → $to validates the new group and clears the previous one',
  ({ from, original, to, incoming, clean }) => {
    expect(
      resolveCategoryGroups(
        { asset_category: to, ...incoming },
        { asset_category: from, ...original }
      )
    ).toEqual({ errors: [], clean })
  }
)

it('changing category cannot reuse a required subtype from a different group', () => {
  expect(
    resolveCategoryGroups(
      { asset_category: 'information_repository' },
      { asset_category: 'cloud_asset', cloud_details: cloud }
    )
  ).toEqual({
    errors: [{ path: 'repository_details.kind', message: 'Selecciona un tipo.' }],
    clean: { cloud_details: emptyCloud },
  })
})

it('inactive content is cleaned even when it arrives in the same update', () => {
  expect(
    resolveCategoryGroups(
      {
        asset_category: 'cloud_asset',
        cloud_details: cloud,
        product_details: product,
        repository_details: repository,
      },
      null
    )
  ).toEqual({
    errors: [],
    clean: { product_details: emptyProduct, repository_details: emptyRepository },
  })
})

it('even one obsolete optional field produces a complete clearing patch', () => {
  expect(
    resolveCategoryGroups(
      { asset_category: 'computer', product_details: { software_version: '1.2' } },
      null
    )
  ).toEqual({ errors: [], clean: { product_details: emptyProduct } })
})

it('empty inactive groups do not produce unnecessary clearing patches', () => {
  expect(
    resolveCategoryGroups(
      {
        asset_category: 'computer',
        product_details: { software_vendor: null, software_product: '', software_version: ' \t' },
        cloud_details: null,
        repository_details: {},
      },
      null
    )
  ).toEqual({ errors: [], clean: {} })
})

it('omitting an inactive stored group cleans it, while an explicit null already clears it', () => {
  const original = { asset_category: 'cloud_asset', cloud_details: cloud }
  expect(resolveCategoryGroups({ asset_category: 'computer' }, original)).toEqual({
    errors: [],
    clean: { cloud_details: emptyCloud },
  })
  expect(
    resolveCategoryGroups({ asset_category: 'computer', cloud_details: null }, original)
  ).toEqual({ errors: [], clean: {} })
})

it('does not mutate the incoming or stored document', () => {
  const data = Object.freeze({
    asset_category: 'cloud_asset',
    cloud_details: Object.freeze({ ...cloud }),
  })
  const original = Object.freeze({
    asset_category: 'software_license',
    product_details: Object.freeze({ ...product }),
  })
  const before = structuredClone({ data, original })
  const result = resolveCategoryGroups(data, original)
  expect(result).toEqual({ errors: [], clean: { product_details: emptyProduct } })
  expect({ data, original }).toEqual(before)
})
