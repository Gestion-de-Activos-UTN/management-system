import Link from 'next/link'
import { Button, type ButtonProps } from '@mantine/core'
import { ArrowLeft } from 'lucide-react'

// Mismo estilo que "Back to Platform Portal" en app/portal/(protected)/layout.tsx — un <Link>
// explícito a la lista padre, no router.back(): un detail page puede llegar de una URL directa
// (notificación, favorito) sin historial previo, donde back() no tendría a dónde volver.
export function BackButton({
  href,
  label = 'Volver',
  variant = 'subtle',
  color,
  size = 'sm',
  fullWidth = true,
}: {
  href: string
  label?: string
  variant?: ButtonProps['variant']
  color?: ButtonProps['color']
  size?: ButtonProps['size']
  fullWidth?: boolean | 'always'
}) {
  return (
    <Button
      component={Link}
      href={href}
      variant={variant}
      color={color}
      size={size}
      leftSection={<ArrowLeft size={16} strokeWidth={1.5} />}
      w={fullWidth === 'always' ? '100%' : fullWidth ? { base: '100%', sm: 'auto' } : 'fit-content'}
      style={fullWidth ? undefined : { alignSelf: 'center' }}
    >
      {label}
    </Button>
  )
}
