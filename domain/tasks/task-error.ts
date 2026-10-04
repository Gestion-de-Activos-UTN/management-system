export class TaskDomainError extends Error {
  constructor(
    public readonly code: string,
    public readonly status = 400,
    message = code
  ) {
    super(message)
  }
}

export function taskErrorResponse(error: unknown): Response {
  if (error instanceof TaskDomainError) {
    return Response.json({ error: error.code, message: error.message }, { status: error.status })
  }
  throw error
}
