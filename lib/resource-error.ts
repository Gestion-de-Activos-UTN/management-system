export function resourceErrorMessage(error: unknown, resource: string) {
  const status = error && typeof error === 'object' && 'status' in error ? error.status : undefined

  if (status === 401) {
    return {
      title: 'Tu sesión ya no está disponible',
      description: 'Vuelve a iniciar sesión para continuar.',
      retryable: false,
    }
  }
  if (status === 403) {
    return {
      title: 'No tienes permiso para ver este contenido',
      description: 'Si necesitas acceso, consulta con quien administra tu organización.',
      retryable: false,
    }
  }
  // A scoped 404 must not disclose whether a resource exists outside the user's access.
  if (status === 404 || !error) {
    return {
      title: `No puedes acceder a ${resource}`,
      description: 'Puede que el enlace ya no esté disponible o que no tengas acceso.',
      retryable: false,
    }
  }
  return {
    title: `No se pudo cargar ${resource}`,
    description: 'Inténtalo de nuevo. Si el problema continúa, vuelve más tarde.',
    retryable: true,
  }
}
