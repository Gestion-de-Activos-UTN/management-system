/** Another command of the same task is still running; the UI already shows it as pending. */
export class TaskCommandBusyError extends Error {
  readonly code = 'task_command_busy'
  constructor() {
    super('task_command_busy')
  }
}

/**
 * One command per task at a time. A repeated click shares the running promise; a different
 * command is rejected instead of borrowing that result. Every promise returned here is already
 * handled, so a caller that ignores it never produces an unhandled rejection.
 */
export function createTaskCommandGate<A extends string>() {
  let inFlight: { action: A; promise: Promise<unknown> } | null = null
  return function run<T>(action: A, start: () => Promise<T>): Promise<T> {
    if (inFlight) {
      if (inFlight.action === action) return inFlight.promise as Promise<T>
      const busy = Promise.reject(new TaskCommandBusyError())
      busy.catch(() => {})
      return busy
    }
    const pending = start()
    inFlight = { action, promise: pending }
    const release = () => {
      if (inFlight?.promise === pending) inFlight = null
    }
    void pending.then(release, release)
    return pending
  }
}
