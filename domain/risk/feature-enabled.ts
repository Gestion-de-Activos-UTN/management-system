import type { PayloadRequest } from 'payload'

export async function riskFeatureEnabled(req: PayloadRequest, organizationId: string) {
  const result = await req.payload.find({
    collection: 'subscriptions',
    where: { organization: { equals: organizationId } },
    overrideAccess: true,
    req,
    depth: 0,
    limit: 1,
  })
  const features = result.docs[0]?.features
  return Boolean(
    features &&
    typeof features === 'object' &&
    !Array.isArray(features) &&
    features.risk_score === true
  )
}
