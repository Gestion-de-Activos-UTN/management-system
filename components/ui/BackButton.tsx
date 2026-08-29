import Link from 'next/link';
import { Button } from '@mantine/core';
import { ArrowLeft } from 'lucide-react';

// Mismo estilo que "Back to Platform Portal" en app/portal/(protected)/layout.tsx — un <Link>
// explícito a la lista padre, no router.back(): un detail page puede llegar de una URL directa
// (notificación, favorito) sin historial previo, donde back() no tendría a dónde volver.
export function BackButton({ href, label = 'Back' }: { href: string; label?: string }) {
  return (
    <Button
      component={Link}
      href={href}
      variant="subtle"
      size="sm"
      leftSection={<ArrowLeft size={16} strokeWidth={1.5} />}
    >
      {label}
    </Button>
  );
}
