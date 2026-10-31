import { notifications, type NotificationData } from '@mantine/notifications'

/** Toda notificación identifica el resultado; el detalle es opcional y no repite el título. */
export function notify({
  message,
  ...options
}: Omit<NotificationData, 'title' | 'message'> & {
  title: string
  message?: NotificationData['message']
}) {
  return notifications.show({ ...options, message: message ?? null })
}
