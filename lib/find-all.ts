import type { CollectionSlug, Payload, PayloadRequest, Where } from 'payload'

/** Complete internal traversal in bounded queries. Do not use a single arbitrary fleet limit. */
export async function findAll<T>(payload: Payload, collection: CollectionSlug, where: Where, req?: PayloadRequest, sort = 'id', depth = 0): Promise<T[]> {
  const docs: T[] = []
  let lastId: unknown
  for (let page = 1; ; page += 1) {
    const result = await payload.find({ collection, where, req, sort, depth, overrideAccess: true, limit: 200, page })
    if (!result.docs.length) return docs
    const tail = result.docs[result.docs.length - 1].id
    if (page > 1 && tail === lastId) throw new Error(`Pagination did not advance for ${collection}`)
    lastId = tail
    docs.push(...result.docs as T[])
    if (!result.hasNextPage) return docs
  }
}
