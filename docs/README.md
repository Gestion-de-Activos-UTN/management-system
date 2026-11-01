# Documentación técnica de SIAM

Documentación interna para quienes desarrollan y mantienen `management-system`. Describe cómo funciona cada feature y cómo se conecta el backend con el frontend, tal como está implementado.

**Fuente de verdad: el código.** Cada documento se verificó contra el código el 2026-10-31. Si algo contradice al código, corregir el documento.

Esta carpeta es la documentación oficial del sistema.

## Índice

### Transversal
| Documento | Contenido |
|---|---|
| [session-and-access.md](session-and-access.md) | Autenticación, sesión, resolución del contexto de cada request, matriz de permisos, alcance por organización y oficina, regla de rango, traducción de errores en el cliente. |

### Flujos
| Documento | Contenido |
|---|---|
| [flujos.md](flujos.md) | Flujos de usuario por feature: actor, precondiciones, pasos y resultado esperado. Base para las futuras specs de Playwright. |

### Features
| Documento | Contenido |
|---|---|
| [task-api.md](task-api.md) | Tareas: estados y flujos, asignación y elegibilidad, comandos, lock por tarea, efectos del sistema. |
| [risk-api.md](risk-api.md) | Riesgo: motor, evaluaciones persistidas, consolidado del OfficeManager, recálculo en segundo plano, enmascarado por confianza. |
| [assessments-api.md](assessments-api.md) | Revisiones de seguridad: ciclo de vida, política, evidencia heredada, cierre masivo. |
| [assets-api.md](assets-api.md) | Activos de red y manuales: identificación, edición de negocio, responsables, incidentes, baja lógica. |
| [scanner-api.md](scanner-api.md) | Escáner y evidencia técnica: aprovisionamiento, heartbeat, ingesta de reportes, idempotencia, instantáneas, retención. |
| [members-api.md](members-api.md) | Personas de la organización: alta, edición, desactivación y reactivación, delegación del Manager, cuotas por rol. |
| [offices-api.md](offices-api.md) | Oficinas: ciclo de vida, impacto de desactivar, límites del plan, selector de oficina. |
| [organization-settings-api.md](organization-settings-api.md) | Ajustes de la organización: inventario, madurez y política de revisión. |
| [organizations-platform-api.md](organizations-platform-api.md) | StaffPortal: alta, edición y estado de organizaciones, suscripciones y cuotas, visita con `?asOrganization=`. |
| [dashboard-api.md](dashboard-api.md) | Panel general: métricas, composición de datos de otros features y comportamiento ante fallos. |
| [portal-messages-api.md](portal-messages-api.md) | Mensajes del portal: audiencia, entrega, cola y recibos en el cliente. |

## Estructura común de los documentos de feature

1. Capas y archivos.
2. Modelo y estados, con los flujos explicados en prosa.
3. Permisos y alcance.
4. Contrato HTTP: endpoints, parámetros, validaciones y forma exacta de las respuestas.
5. Reglas por operación.
6. Catálogo de errores.
7. Concurrencia, atomicidad y efectos del sistema.
8. Frontend: páginas, componentes, hooks, claves de TanStack Query e invalidaciones.
9. Cómo extender el feature, cuando aplica.
10. Comportamientos a tener presentes.
11. Cobertura de pruebas automáticas.

## Criterios al escribir o actualizar un documento

- Técnico y preciso, orientado a desarrolladores.
- Sin diagramas: cada flujo se explica en prosa. La sección 2.2.1 de `task-api.md` es el ejemplo.
- Citar archivos y funciones por nombre, sin números de línea, que se desactualizan.
- Todo lo afirmado debe poder comprobarse en el código. Lo ambiguo se declara como tal.
- "Comportamientos a tener presentes" recoge solo lo verificado, en tono neutral. No es una lista de defectos.
- Los contratos de entrada viven en los schemas Zod (`modules/<dominio>/schema.ts`, `contracts/`); los documentos enlazan a ellos y no los copian.

## Pendiente

- **Pruebas de extremo a extremo:** no existen aún. Cuando se implemente Playwright, sus specs partirán de `flujos.md` y cada documento de feature incorporará su sección.
- **AuditLog y Notification Bell:** no están implementados. Los puntos de enganche están marcados en el código con comentarios `// AUDIT:` y `// NOTIFY:`.
