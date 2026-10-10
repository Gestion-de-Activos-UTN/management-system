import { httpClient } from './http-client'

export type ListResponse<T> = { docs: T[]; hasNextPage?: boolean }

export async function listResource<T>(path: string, params?: Record<string, string | undefined>) {
  const docs: T[] = []
  for (let page = 1; ; page += 1) {
    const result = await httpClient.get<ListResponse<T>>(path, {
      sort: 'id',
      ...params,
      limit: '100',
      page: String(page),
    })
    docs.push(...result.docs)
    if (!result.hasNextPage) return docs
    if (!result.docs.length)
      throw new Error('La lista no pudo completar su paginación. Actualiza la vista.')
  }
}
