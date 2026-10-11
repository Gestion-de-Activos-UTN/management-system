import type { ReactNode } from 'react'
import { Card, Tabs } from '@mantine/core'
import { ListTodo, Megaphone } from 'lucide-react'

/** Tareas y mensajes del usuario en una sola tarjeta de la columna lateral. */
export function ActivityTabsCard({
  tasksCount,
  messagesCount,
  tasks,
  messages,
}: {
  tasksCount?: number
  messagesCount?: number
  tasks: ReactNode
  messages: ReactNode
}) {
  const label = (name: string, count?: number) =>
    count === undefined ? name : `${name} (${count})`
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
          {tasks}
        </Tabs.Panel>
        <Tabs.Panel value="messages" pt="md">
          {messages}
        </Tabs.Panel>
      </Tabs>
    </Card>
  )
}
