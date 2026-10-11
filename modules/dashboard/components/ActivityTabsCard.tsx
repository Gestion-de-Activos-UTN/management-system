import type { ReactNode } from 'react'
import { Card, ScrollArea, Tabs, Text } from '@mantine/core'
import { ListTodo, Megaphone } from 'lucide-react'

// Altura fija de las listas: el panel no crece con la cantidad de tareas o mensajes, se
// desplaza adentro.
const LIST_MAX_HEIGHT = 300

function Scrollable({ children }: { children: ReactNode }) {
  return (
    <ScrollArea.Autosize mah={LIST_MAX_HEIGHT} type="auto" offsetScrollbars>
      {children}
    </ScrollArea.Autosize>
  )
}

/**
 * Tareas y mensajes del usuario en una sola tarjeta. Sin `tasks` (la organización no tiene
 * tareas contratadas) muestra sólo los mensajes, sin tabs.
 */
export function ActivityTabsCard({
  tasksCount,
  messagesCount,
  tasks,
  messages,
}: {
  tasksCount?: number
  messagesCount?: number
  tasks?: ReactNode
  messages: ReactNode
}) {
  const label = (name: string, count?: number) =>
    count === undefined ? name : `${name} (${count})`
  if (!tasks) {
    return (
      <Card withBorder radius="lg" p="lg">
        <Text fw={700} mb="md">
          {label('Mensajes', messagesCount)}
        </Text>
        <Scrollable>{messages}</Scrollable>
      </Card>
    )
  }
  return (
    <Card withBorder radius="lg" p="lg">
      <Tabs defaultValue="tasks">
        <Tabs.List grow>
          <Tabs.Tab value="tasks" leftSection={<ListTodo size={16} strokeWidth={1.5} />}>
            {label('Mis tareas', tasksCount)}
          </Tabs.Tab>
          <Tabs.Tab value="messages" leftSection={<Megaphone size={16} strokeWidth={1.5} />}>
            {label('Mensajes', messagesCount)}
          </Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="tasks" pt="md">
          <Scrollable>{tasks}</Scrollable>
        </Tabs.Panel>
        <Tabs.Panel value="messages" pt="md">
          <Scrollable>{messages}</Scrollable>
        </Tabs.Panel>
      </Tabs>
    </Card>
  )
}
