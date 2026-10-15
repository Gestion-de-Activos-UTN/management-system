import { StatusBadge } from '@/components/ui/StatusBadge'
import type { Asset } from '@/app/types/payload-types'

export function IdentificationBadge({ status }: { status: Asset['identification_status'] }) {
  if (status === 'confirmed') return <StatusBadge tone="success" label="Identificado" />
  if (status === 'needs_review') return <StatusBadge tone="warning" label="A revisar" />
  return <StatusBadge tone="warning" label="No identificado" />
}
