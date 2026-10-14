'use client'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { listResource } from '@/lib/list-resource'
import { httpClient } from '@/lib/http-client'
import { useUiStore } from '@/lib/ui-store'
import type { InventoryIncident } from '@/app/types/payload-types'
import { invalidateSecurityReview } from '@/modules/assessments/invalidate-security-review'

export function useInventoryIncidents(asOrganization?: string, assetId?: string) {
  const officeId = useUiStore(state => state.selectedOfficeId)
  const client = useQueryClient()
  const query = useQuery({
    queryKey: ['inventory-incidents', asOrganization, officeId, assetId],
    queryFn: () =>
      listResource<InventoryIncident>('/api/inventory-incidents', {
        depth: '1',
        asOrganization,
        'where[status][equals]': 'pending',
        'where[office][equals]': assetId ? undefined : (officeId ?? undefined),
        'where[asset][equals]': assetId,
      }),
  })
  const resolution = useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: 'move' | 'keep' | 'reviewed' }) =>
      httpClient.post(
        `/api/v1/inventory-incidents/${id}/resolve${asOrganization ? `?asOrganization=${encodeURIComponent(asOrganization)}` : ''}`,
        { decision }
      ),
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ['inventory-incidents'] }),
        client.invalidateQueries({ queryKey: ['assets'] }),
        client.invalidateQueries({ queryKey: ['tasks'] }),
        invalidateSecurityReview(client),
      ])
    },
  })
  return { ...query, resolution }
}
