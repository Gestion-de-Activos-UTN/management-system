import { expect, it } from 'vitest'
import { validateComplianceResult } from './validateComplianceResult'

function request(category: string, organization = 'org', office = 'office') {
  return {
    payload: {
      findByID: async ({ collection }: { collection: string }) =>
        collection === 'offices'
          ? { id: 'office', organization: 'org' }
          : { id: 'asset', organization, office, asset_category: category },
    },
  }
}
const data = { organization: 'org', office: 'office', manual_asset: 'asset' }
it.each(['computer', 'software_license', 'cloud_asset', 'information_repository'])(
  'accepts review results for supported category %s',
  async category => {
    await expect(
      validateComplianceResult({ data, req: request(category) } as never)
    ).resolves.toEqual(data)
  }
)
it.each(['printer', 'mobile_device', 'provider_service', 'backup'])(
  'keeps unsupported category %s rejected',
  async category => {
    await expect(
      validateComplianceResult({ data, req: request(category) } as never)
    ).rejects.toThrow('La categoría de este activo manual no admite revisiones de seguridad.')
  }
)
it.each([
  ['other-org', 'office'],
  ['org', 'other-office'],
])('still rejects a cloud asset outside its result scope: %s / %s', async (org, office) => {
  await expect(
    validateComplianceResult({ data, req: request('cloud_asset', org, office) } as never)
  ).rejects.toThrow('no pertenece a su organización y oficina')
})
