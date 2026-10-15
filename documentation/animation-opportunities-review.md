# Revisión de oportunidades de animación en la interfaz

**Fecha:** 15/10/2026  
**Aplicación:** `management-system` (Next.js, React, Mantine)  
**Objetivo:** ofrecer un punto de partida concreto para que Claude evalúe y, posteriormente, implemente mejoras de movimiento en componentes existentes. Este documento contiene recomendaciones; no describe cambios ya aplicados.

## Resumen ejecutivo

La aplicación ya utiliza animación en algunos lugares: transiciones CSS globales para controles y tarjetas, `Collapse` de Mantine en navegación y formularios, transiciones de Mantine en el modal de mensajes y la animación nativa de los toasts. Por eso, antes de incorporar una librería adicional conviene normalizar los casos existentes y comprobar si cada movimiento ayuda a entender el estado o una acción.

La recomendación inicial es:

1. **Mantener CSS/Mantine para interacciones sencillas** como hover, apertura de campos opcionales, colapso de navegación y modales.
2. **Auditar las reglas globales actuales** para que las tarjetas estáticas no parezcan botones y para considerar `prefers-reduced-motion`.
3. **No animar todas las filas de tablas ni cada carga de página.** Usar movimiento sólo para cambios puntuales que necesiten explicación visual.
4. **Agregar Motion for React sólo si aparece una necesidad que Mantine/CSS no resuelve bien**, por ejemplo, reordenamiento animado de listas o transiciones de layout entre componentes.

Una animación no acelera una consulta ni reduce el tiempo de carga. Puede aclarar una transición de estado, pero debe conservar respuesta inmediata y no competir con el contenido.

## Estado actual encontrado en el código

| Área | Implementación observada | Implicación |
|---|---|---|
| Transiciones globales | `app/globals.css` aplica 150 ms a `Button`, `ActionIcon`, `NavLink`, perfil lateral y `Card`; las cards con borde se elevan 1 px en hover. | Ya existe un lenguaje de movimiento global. Ampliarlo sin revisar su alcance puede dar apariencia interactiva a superficies informativas. |
| Navegación lateral | `components/layout/Sidebar.tsx` usa `Collapse` de Mantine para subsecciones. | Es un patrón existente adecuado para contenido que se muestra u oculta. |
| Vista previa opcional | `modules/portal-messages/components/PortalMessageForm.tsx` usa `Collapse` durante 320 ms y rota el chevron al abrir/cerrar. | Es un ejemplo concreto que puede servir para evaluar campos condicionales y paneles secundarios. |
| Mensajes y modales | `PortalMessageDialog.tsx` configura una transición `pop` de 280 ms y anima el contenido al cambiar de mensaje en la cola. | Hay una transición específica y un comentario que previene animar dos veces la apertura del modal. Preservar esta separación. |
| Otros modales | Formularios de oficinas, usuarios, tareas e inventario usan componentes `Modal` de Mantine. | Revisar primero las transiciones predeterminadas/compartidas de Mantine; no envolver cada modal en una animación adicional. |
| Toasts | `lib/providers.tsx` monta `<Notifications />`; hooks muestran notificaciones con Mantine. | Mantine ya presenta y retira los toasts. La mejora principal es consistencia de duración y contenido, no una animación por toast. |
| Tablas | `components/ui/DataTable.tsx` es la envoltura genérica común de TanStack Table y Mantine Table. | Si una mejora realmente requiere fila animada, el cambio debe integrarse con este límite compartido, no duplicar el comportamiento en cada pantalla. |
| Respeto a movimiento reducido | No se encontró una regla `prefers-reduced-motion` para las transiciones personalizadas de `app/globals.css`. | Verificar el soporte configurado para Mantine y cubrir también los estilos CSS propios. |
| Librería dedicada | `package.json` no declara `motion`, `framer-motion`, AutoAnimate ni React Spring. | No hace falta añadir una dependencia para las oportunidades simples identificadas. |

## Recomendaciones por componente

### 1. Tarjetas y superficies

**Situación:** la regla `.mantine-Card-root[data-with-border]:hover` eleva cualquier tarjeta con borde y agrega sombra. Esto afecta tanto a posibles elementos accionables como a tarjetas de resumen o contenido que podrían ser sólo informativas.

**Propuesta:**

- Reservar elevación/transformación para tarjetas con interacción real (enlace, botón o acción claramente disponible).
- Para tarjetas informativas, limitarse a una transición de sombra/borde si el hover realmente aporta feedback, o quitar el hover.
- Si la tarjeta contiene acciones, animar el estado de hover/focus de forma breve y sutil, sin competir con los controles internos.
- Mantener el mismo tratamiento de foco por teclado; no depender únicamente de `:hover`.

**Dónde revisar:** `app/globals.css`, `components/ui/StatCard.tsx`, `components/ui/MetricsStrip.tsx`, tarjetas de `modules/dashboard/` y vistas de detalle en `modules/tasks/` y `modules/assets/`.

**Prioridad:** alta. Cambia la percepción general de interactividad y define el lenguaje visual para el resto de las animaciones.

### 2. Campos opcionales o dependientes de una selección

**Situación:** hay formularios donde se muestran opciones adicionales según una elección, y `PortalMessageForm` ya incluye una vista previa colapsable. Los campos de formulario no deben saltar de forma abrupta si el contexto de la selección los hace aparecer.

**Propuesta:**

- Usar `Collapse` de Mantine cuando un campo o grupo se monta/desmonta por una selección explícita.
- Añadir `aria-expanded` y `aria-controls` al control que activa el bloque cuando corresponda; ocultar el contenido de forma semántica cuando esté cerrado.
- Animar el contenedor, no cada input en cascada. La duración debe ser corta para no ralentizar la captura de datos.
- Conservar valores si el usuario cierra y vuelve a abrir un bloque, salvo que las reglas del formulario indiquen que deben limpiarse; la animación no debe cambiar reglas de validación.
- Mantener visibles errores relacionados o llevar el foco al primer campo recién revelado si el usuario lo necesita para continuar.

**Dónde revisar:** `modules/portal-messages/components/PortalMessageForm.tsx`, formularios condicionales de tareas (`modules/tasks/components/TaskForm.tsx`) y ajustes de organización (`app/portal/(protected)/administration/settings/page.tsx`).

**Prioridad:** alta en campos que actualmente aparecen/desaparecen abruptamente; baja si los campos siempre están visibles.

### 3. Tablas y listas de resultados

**Situación:** las tablas usan una envoltura genérica y pueden contener decenas o más filas. Animar la entrada de todas las filas en cada búsqueda, paginación u ordenamiento multiplicaría el trabajo visual y haría que la tabla parezca lenta.

**Propuesta:**

- No aplicar animación escalonada por fila como comportamiento predeterminado.
- Para una acción que modifica un registro, evaluar un resaltado transitorio de esa fila (fondo/borde con transición), con el estado visual accesible y sin ocultar cambios de datos.
- No animar de manera distinta la misma actualización en varias capas (fila, toast, tabla completa).
- Si se implementa un efecto de fila reutilizable, hacerlo opcional y genérico en `DataTable`, activado por una clave/acción explícita; no incluir lógica de negocio en `components/ui/`.
- No retrasar la tabla detrás de una animación de carga. El skeleton/loader debe comunicar espera real y desaparecer apenas llegan los datos.

**Dónde revisar:** `components/ui/DataTable.tsx`; llamadas en `app/portal/(protected)/tasks/page.tsx`, `risk-score/page.tsx`, inventario, informes de escaneo e instantáneas.

**Prioridad:** baja. Implementar sólo si hay una interacción concreta donde se pierde el rastro de la fila afectada.

### 4. Modales, drawers y paneles flotantes

**Situación:** la app usa varios `Modal` de Mantine; el diálogo de mensajes define una animación `pop` propia. El drawer móvil de navegación y los componentes Mantine ya gestionan transiciones de apertura/cierre.

**Propuesta:**

- Mantener un comportamiento consistente y dejar que Mantine controle overlay, foco, cierre y presencia.
- Auditar transiciones explícitas por pantalla y elegir una única capa de animación para cada apertura.
- Conservar la animación del contenido entre mensajes sólo cuando cambia el mensaje dentro del modal ya abierto; no volver a ejecutar la animación del modal en cada cambio de cola.
- Evitar traslados largos o rebotes en diálogos de confirmación, formularios de edición y errores.
- Probar que durante la salida no se pueda activar contenido que visualmente todavía parece abierto.

**Dónde revisar:** `modules/portal-messages/components/PortalMessageDialog.tsx`, `components/layout/DashboardShell.tsx`, `modules/tasks/components/TaskDetail.tsx` y modales de `modules/offices/components/`.

**Prioridad:** media. Consolidar cualquier divergencia evidente; no hace falta rehacer modales que ya se sienten consistentes.

### 5. Notificaciones toast

**Situación:** `Notifications` se monta en `lib/providers.tsx`. Las operaciones exitosas y algunos errores muestran `notifications.show`; `lib/notify-error.ts` ya distingue errores de validación de errores de servidor para definir color y autocierre.

**Propuesta:**

- Mantener la animación y el ciclo de vida del componente de notificaciones de Mantine.
- Evitar una animación custom adicional en cada llamada a `notifications.show`.
- Asegurar que toasts consecutivos no encadenen delays que escondan el resultado de una operación.
- Priorizar consistencia de contenido, duración, color e icono. Errores que requieran corrección deben ser persistentes o inline según su contexto; no hacer que un toast animado desaparezca antes de leerse.
- No usar un toast para cambios de estado que requieran atención prolongada o para resultados que deban permanecer junto al formulario.

**Dónde revisar:** `lib/providers.tsx`, `lib/notify-error.ts` y hooks de mutación en `modules/*/hooks/`.

**Prioridad:** baja para movimiento; media para coherencia de la política de mensajes.

### 6. Alertas, vacíos y estados de carga

**Situación:** páginas muestran `Alert`, loaders y skeletons según la respuesta de queries. Los estados pueden cambiar al resolver una petición o al invalidar una consulta después de una mutación.

**Propuesta:**

- Para una alerta contextual que aparece/desaparece, considerar un `Collapse` o fade breve si evita un salto brusco de layout.
- No animar texto de error carácter por carácter ni hacer pulsar o rebotar señales de riesgo.
- No animar una alerta cada vez que la misma consulta se revalida; prevenir flashes por actualizaciones de fondo.
- Evitar que los skeletons aparenten actividad cuando no hay carga; no usar una animación de entrada para retrasar contenido ya disponible.
- Mantener estados vacíos y de error legibles con movimiento reducido.

**Dónde revisar:** `app/portal/(protected)/risk-score/page.tsx`, `modules/risk/components/RiskAlerts.tsx`, `app/portal/(protected)/dashboard/page.tsx`.

**Prioridad:** media, principalmente cuando un cambio actual provoca saltos visibles.

### 7. Navegación, tabs y secciones expandibles

**Situación:** el Sidebar ya usa `Collapse`; tabs de Mantine muestran paneles de inventario, tareas, escaneos e instantáneas. La sección de revisiones de seguridad usa un elemento `<details>` controlado en `SecurityReviewOverview`.

**Propuesta:**

- Conservar `Collapse` para submenús y secciones expandibles. No añadir Motion sobre el mismo contenido.
- Evaluar transiciones cortas del indicador activo de tab o de opacidad del panel sólo si no afectan scroll, foco o selección.
- En revisión de dispositivos, conservar la expansión abierta tras guardar/completar y revalidar datos; la continuidad de estado importa más que animar el cierre.
- Evitar transiciones de página completas mientras el portal utiliza navegación de Next.js y formularios largos, salvo que exista una necesidad de UX definida.

**Dónde revisar:** `components/layout/Sidebar.tsx`, `modules/assessments/components/SecurityReviewOverview.tsx`, `app/portal/(protected)/inventory/page.tsx` y páginas de detalle.

**Prioridad:** media para el estado de revisión de dispositivos; baja para las tabs.

## Política técnica recomendada

### Herramientas

- **CSS existente:** colores, bordes, sombra, foco y pequeños cambios de `transform`/`opacity` asociados a estados hover/focus.
- **Mantine:** presencia/ausencia y tamaño de bloques mediante `Collapse` y `Transition`; modales y controles deben conservar los mecanismos propios de Mantine.
- **Motion for React:** considerar la dependencia `motion` sólo si se aprueban casos como reordenamiento de listas, animaciones de layout entre estados o gestos complejos que no se resuelven con Mantine/CSS.
- **No agregar varias librerías para el mismo propósito.** No introducir una dependencia sólo para animar botones, alertas o toasts.

### Accesibilidad

- Respetar `prefers-reduced-motion` en transiciones custom de CSS y efectos coordinados por JavaScript.
- Asegurar que la animación nunca sea el único modo de comunicar éxito, error, selección o riesgo.
- No ocultar foco, feedback de validación ni cambios de estado al animar entrada/salida.
- Asegurar que controles de expansión expongan su estado y que el contenido oculto no pueda recibir foco.

### Rendimiento

- Preferir `opacity` y `transform` para movimiento visual; medir efectos que animan alto, ancho, sombra extensa o filtros.
- Mantener duraciones cortas en interacciones de interfaz y no secuenciar animaciones de manera que bloquee el siguiente clic.
- No disparar animaciones masivas por cada refetch de React Query, cambio de filtro o actualización de página.
- Revisar dispositivos móviles y tablas grandes.
- Tener presente que una animación no resuelve latencia de API, consultas lentas ni compilación en Docker.

## Orden sugerido de evaluación

1. **Auditar el hover global de Card** y distinguir superficies accionables de resúmenes estáticos.
2. **Revisar movimiento reducido**, especialmente la regla global de `app/globals.css`.
3. **Uniformar campos condicionales** usando el ejemplo existente de `Collapse` y mantener estado/validación.
4. **Revisar modales y estados de revisión**, evitando doble animación y cierres no intencionales.
5. **Considerar feedback puntual de tabla** sólo si los usuarios pierden el rastro de un registro cambiado.
6. **Mantener los toasts de Mantine** y revisar su política semántica/temporal, sin construir animaciones propias por llamada.
7. **Evaluar Motion** únicamente si los puntos previos dejan una necesidad de animación compleja sin resolver.

## Criterios para aceptar una animación

Una propuesta debería cumplir todos estos criterios:

- Aclara una acción, relación espacial o cambio de estado identificable.
- No añade espera antes de que una acción pueda continuar.
- Funciona con mouse, teclado, pantalla táctil y movimiento reducido.
- No duplica un efecto que Mantine o `app/globals.css` ya aplican.
- No altera selección, formulario, query cache, foco ni navegación.
- Tiene duración y distancia discretas y es consistente con otras instancias del mismo patrón.
- En listas/tablas, su coste y legibilidad se mantienen con muchos registros.

## Prompt de inicio para Claude

```text
Analiza el código de esta aplicación Next.js/React con Mantine usando documentation/animation-opportunities-review.md como guía. Primero verifica en los componentes reales qué recomendaciones aplican y qué transiciones ya existen. Devuelve una propuesta priorizada con archivos/componentes, efecto y disparador. Respeta la arquitectura Mantine, el rendimiento, teclado y prefers-reduced-motion; no agregues dependencias ni modifiques archivos sin justificar qué necesidad no resuelve Mantine o CSS. No implementes cambios todavía.
```

## Alcance y limitaciones

Esta revisión es estática y se basa en el código fuente. No se midió rendimiento con perfiles, ni se probó cada efecto con teclado, táctil o tecnologías de asistencia. Las recomendaciones son hipótesis de diseño para validar visualmente en el producto; no todas deben convertirse en trabajo de implementación.
