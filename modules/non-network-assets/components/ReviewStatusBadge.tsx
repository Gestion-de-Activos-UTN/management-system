import { StatusBadge } from '@/components/ui/StatusBadge';

// RF-53b: "Revisión Pendiente" cuando el campo virtual review_status (afterRead, ver
// collections/NonNetworkAssets/index.ts) viene 'overdue' — sin job, se computa al leer.
export function ReviewStatusBadge({ reviewStatus }: { reviewStatus: string | null | undefined }) {
  if (reviewStatus === 'overdue') {
    return <StatusBadge tone="danger" label="Review Overdue" />;
  }
  return <StatusBadge tone="success" label="Up to date" />;
}
