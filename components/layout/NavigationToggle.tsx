import { ActionIcon } from '@mantine/core'
import { Menu, X } from 'lucide-react'
import classes from './NavigationToggle.module.css'

export function NavigationToggle({ opened, onToggle }: { opened: boolean; onToggle: () => void }) {
  return (
    <ActionIcon
      variant="default"
      size={36}
      hiddenFrom="sm"
      onClick={onToggle}
      aria-label={opened ? 'Cerrar navegación' : 'Abrir navegación'}
      aria-expanded={opened}
      aria-controls="main-navigation"
      className={opened ? classes.opened : undefined}
    >
      <Menu
        size={20}
        strokeWidth={1.5}
        aria-hidden="true"
        className={`${classes.icon} ${classes.menu}`}
      />
      <X
        size={20}
        strokeWidth={1.5}
        aria-hidden="true"
        className={`${classes.icon} ${classes.close}`}
      />
    </ActionIcon>
  )
}
