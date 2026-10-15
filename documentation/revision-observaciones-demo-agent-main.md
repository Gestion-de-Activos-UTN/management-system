# Revisión técnica de observaciones de demo-agent-main

**Fecha:** 15/10/2026  
**Alcance:** revisión estática del código de `management-system` y contraste con las capturas incluidas en el reporte. No se midió el rendimiento ejecutando el stack ni se reprodujeron las rutas en un navegador.

## Resumen

Se revisaron **21 observaciones**: los 19 puntos numerados y los 2 comentarios generales. El código confirma varios problemas de navegación y presenta las estructuras visuales descritas. Las preferencias estéticas se consideran propuestas de diseño, no defectos funcionales. Los hallazgos que requieren medición o reproducción quedan marcados como parciales/no corroborados.

| Estado | Cantidad | Interpretación |
|---|---:|---|
| Corroborada | 10 | El código muestra directamente el comportamiento o estructura descritos. |
| Parcial / visual | 10 | La captura y el código son coherentes; el impacto depende de reproducción o decisión de diseño. |
| No corroborada | 1 | No se encontró una causa reproducible en el código inspeccionado. |

> **Corrección posterior (15/10/2026):** los puntos 3, 11 y 19 pasan a corroborados y se corrige el diagnóstico del 10. Ver las notas en cada punto y `plan-correcciones-observaciones-demo.md`.

## Revisión punto por punto

### 1. Lentitud al iniciar contenedores y cargas extensas — **Parcial; requiere medición**

`docker-compose.yml` ejecuta, cada vez que inicia `app`, `pnpm seed:navigation`, `pnpm seed:demo` y después `pnpm run dev`. Ambas semillas inicializan Payload y consultan/actualizan datos antes de arrancar Next. La app también monta el repositorio completo como bind mount (`.:/app`) y ejecuta `next dev --turbopack` dentro de Docker. Estos pasos añaden trabajo de arranque y el bind mount puede penalizar lecturas de muchos archivos, especialmente con Docker Desktop; el código por sí solo no demuestra que expliquen la lentitud percibida.

**Recomendación:** medir por separado tiempo de salud de Postgres, semillas, compilación inicial y petición de cada pantalla; usar logs con timestamps y perfil de React Query/API. Hacer que las semillas no-op cuando los datos ya existen o separarlas del arranque normal. Si la medición apunta al bind mount, probar delegación/caché de filesystem o un entorno dev nativo. Prioridad alta por impacto transversal.

**Evidencia:** `docker-compose.yml`, `localdev.dockerfile`, `scripts/seed-navigation.ts`, `scripts/seed-demo.ts`, `package.json` (`dev` usa `next dev --turbopack`).

### 2. Error de login inline y éxito mediante toast — **Corroborada; convención por definir**

El formulario representa el fallo dentro de un `Alert` junto a los campos (`app/(dashboard)/login/page.tsx`); `useLogin` muestra un toast cuando el inicio de sesión sale bien (`modules/auth/hooks/use-login.ts`). Son respuestas distintas a eventos distintos, por lo que no hay inconsistencia funcional obligatoria.

**Recomendación:** mantener el error inline, visible junto al formulario y persistente hasta corregir/reintentar. Mantener el éxito como toast breve porque es confirmación transitoria y enseguida ocurre la navegación. Aplicar esta regla de forma uniforme: errores que el usuario debe resolver junto a la acción; confirmaciones de éxito no bloqueantes como toast. El error debe seguir siendo genérico para no revelar si existe la cuenta.

### StaffPortal

### 3. No poder abrir configuración de usuario desde Mensajes — **Corroborada** (corregido)

> **Causa:** `SidebarProfile` decidía con `pathname.startsWith('/portal')`, y `'/portal-messages'` también cumple esa condición. Desde Mensajes, el admin de plataforma iba a `/portal/account` sin `asOrganization` y el layout del portal lo redirigía a `/`. El análisis original de abajo queda como registro.

El perfil lateral calcula `/account` para rutas fuera de `/portal` (`components/layout/SidebarProfile.tsx`). La ruta existe bajo el layout protegido de plataforma (`app/(dashboard)/(protected)/account/page.tsx`) y su sesión esperada es de administrador. En el código inspeccionado no aparece un redirect desde `/portal-messages` o `/account` al inicio.

**Recomendación:** reproducir con la misma cuenta y anotar URL final y consola/red. Si el problema se confirma, verificar que el menú perfil se monta dentro del layout de plataforma y que el link conserve cualquier contexto de navegación relevante. La captura sola no permite identificar la causa.

### 4. Los mensajes no cargan al visitar una organización — **Corroborada como defecto probable de integración**

Al visitar una organización, el administrador de plataforma entra a las páginas `/portal/*` con `?asOrganization=...`. `PortalMessagesRuntime` deshabilita correctamente la consulta para una sesión `admins`, pero el dashboard monta `usePortalMessages()` sin deshabilitarla (`app/portal/(protected)/dashboard/page.tsx`). Ese hook consulta `/api/v1/portal-messages`, endpoint de mensajes del usuario final, no la lista administrativa. La tarjeta muestra “No se pudieron cargar los mensajes” al fallar la consulta (`PortalMessagesList.tsx`).

**Recomendación:** en modo visita, no renderizar la lista personal de mensajes ni consultar el endpoint de usuario; mostrar un estado explícito de que la bandeja corresponde a miembros de la organización. Alternativamente, decidir un modo de vista administrativa con endpoint y permisos adecuados. No reutilizar el endpoint personal bajo identidad de administrador.

**Evidencia:** `app/portal/(protected)/layout.tsx`, `app/portal/(protected)/dashboard/page.tsx`, `modules/portal-messages/components/PortalMessagesRuntime.tsx`, `modules/portal-messages/components/PortalMessagesList.tsx`, `modules/portal-messages/hooks/use-portal-messages.ts`.

### 5. No acceder a configuración desde la vista de una organización — **Corroborada**

> **Alcance mayor al reportado:** otros links también perdían `asOrganization` (columna "Dónde" de riesgo, alertas de riesgo, "Ver detalles" del inventario y "Mensajes" del sidebar de plataforma). Se resolvió con un helper único, `lib/portal-href.ts`.

`SidebarProfile` enlaza a `/portal/account` por estar en una ruta `/portal`, pero no conserva `?asOrganization=...`. El layout portal redirige a `/` si la sesión es de plataforma y falta ese parámetro (`app/portal/(protected)/layout.tsx`). Aunque la página de cuenta tiene un mensaje para administradores que visitan una organización, el guard del layout los redirige antes de llegar a esa página.

**Recomendación:** preservar `asOrganization` al construir el href de cuenta. Además, permitir explícitamente la ruta de cuenta del administrador visitante o dirigirla a `/account` de plataforma. Elegir una única ruta coherente con el mensaje y evitar el redirect al inicio.

**Evidencia:** `components/layout/SidebarProfile.tsx`, `app/portal/(protected)/layout.tsx`, `app/portal/(protected)/account/page.tsx`.

### OrgPortal

### 6. Breadcrumb y título de sección redundantes — **Corroborada**

El shell genera breadcrumb con la sección activa; en el inicio de organización omite el crumb repetido del inicio, pero `PageHeader` vuelve a mostrar “Panel general”. En rutas como Revisión de seguridad, el breadcrumb incluye “Revisión de seguridad” y el encabezado repite el mismo título. Esto es visible en las capturas 1 y 2 y se desprende de `DashboardShell`, `Breadcrumbs` y `PageHeader`.

**Recomendación:** mantener el breadcrumb como ubicación/navegación y evitar que repita el título actual. En páginas de sección, mostrar sólo antecesores en breadcrumb; en la portada, ocultar el breadcrumb o usarlo como raíz no duplicada. Aplicar una regla central en `buildBreadcrumbs`.

### 7. Insuficiente diferenciación de badges y botones en modo oscuro — **Parcial; visual**

La app define variantes semánticas de estado (`StatusBadge`) y usa colores semánticos directos de Mantine en distintos componentes; los tokens de fondo de `globals.css` están adaptados a dark mode. Las capturas 3 y 4 muestran pérdida de contraste en badges/acciones, pero no se tomó una medición de contraste ni se inspeccionaron todos los estados interactivos.

**Recomendación:** revisar cada tono semántico en tema claro y oscuro, midiendo contraste de texto, borde y fondo en los estados normal/hover/disabled. Ajustar los tokens del tema o variantes de `StatusBadge` y botones de acción; no corregir cada pantalla con colores aislados. Validar también con estados de foco y accesibilidad.

### 8. Ubicación y estilo de “Identificar dispositivos” en exposición no determinada — **Parcial; visual**

`RiskAlerts` coloca una lista de dispositivos y la acción al final de un `Alert` naranja, con botón pequeño `size="xs"` y ancho ajustado al contenido (`modules/risk/components/RiskAlerts.tsx`). La estructura coincide con la captura 5.

**Recomendación:** convertir el bloque en una sección de acción con encabezado, cantidad de equipos y botón principal alineado al encabezado o al pie; en móvil, botón de ancho completo. Si hay muchos equipos, limitar la lista inicial y enlazar al inventario filtrado. La acción debe conservar el contexto de organización/oficina de la página.

### 9. Distinguir hallazgos manuales/automáticos y elegir tamaño de página — **Parcial; propuesta**

La tabla “Qué necesita atención” usa `riskContributionsColumns` y pagina de forma remota con estado local, pero el control sólo permite avanzar/retroceder, no elegir tamaño. La columna “Dónde” muestra nombre del activo, sin indicador de origen manual frente a escáner. En otra parte del portal sí se etiqueta explícitamente “Manual”, pero no en esta tabla.

**Recomendación:** incluir origen por fila como etiqueta textual (“Activo manual” / “Detectado por escáner”), derivado del tipo real de activo en la respuesta; no inferirlo sólo del nombre. Agregar selector con opciones acotadas, por ejemplo 10 (predeterminado), 25 y 50, y pasar el límite al endpoint. Mantener el tamaño en URL o estado de consulta si se espera compartir/volver a la vista. Revisar el coste del endpoint antes de ofrecer lotes grandes.

**Evidencia:** `app/portal/(protected)/risk-score/page.tsx`, `modules/risk/risk.columns.tsx`, `modules/risk/hooks/use-latest-risk.ts`, `endpoints/risk.ts`.

### 10. Revisiones de dispositivos: dropdown, cierre tras contestar y término “cycle” — **Corroborada en código y captura**

> **Diagnóstico corregido:** la sección no se cerraba por la invalidación de queries (un re-render no cierra un `<details>`). Se cerraba porque el formulario vive en otra ruta y, al volver, la lista se monta de nuevo con la sección cerrada. Además, la interfaz ya usa "ciclo", así que la traducción correcta de "cycle" es "ciclo", no "versión".

`SecurityReviewOverview` agrupa revisiones en un `<details>` desplegable; al completar o guardar, las mutaciones invalidan queries y la vista vuelve a renderizarse. El término se genera literalmente como `cycle/cycles`. El historial se presenta como badges con fechas completas (hasta dos visibles) debajo de cada activo. La captura 6 refleja esos elementos.

**Recomendación:** reemplazar la expansión nativa por una lista de filas compactas con activo, estado, tipo de origen (manual/escáner), versión vigente y acción; abrir el historial a demanda en una fila expandible controlada o panel lateral. Traducir “cycle” a “versión” en interfaz. Controlar la expansión por clave estable para que revalidar datos no cierre la sección tras guardar/completar.

### 11. Volver atrás al pie de un assessment o desplazar arriba al guardar — **Corroborada** (corregido)

> Al completar, la página sigue en el mismo assessment en modo lectura, sin redirigir ni hacer scroll: el usuario queda al pie.

`AssessmentForm` muestra acciones de guardar/completar al final del formulario y no incorpora un botón para volver a la lista. Los hooks notifican y revalidan consultas, pero no controlan el scroll. La página padre define la navegación superior.

**Recomendación:** añadir una acción secundaria “Volver a revisiones” en el pie del assessment y, tras guardar/completar con éxito, llevar el foco/scroll al encabezado con un mensaje de éxito accesible. No desplazar arriba ante errores. Confirmar si el flujo mantiene el mismo assessment o redirige a lista antes de decidir el comportamiento final.

### 12. “Responder varias” en página completa en vez de modal — **Corroborada como limitación de espacio; decisión UX**

El flujo completo de tres pasos, selección de hasta 100 revisiones y cuestionario está dentro de un `Modal` tamaño `xl`; la lista usa scroll interno de 360 px. En el paso final aparece `AssessmentForm` dentro del modal. La captura y el código respaldan la limitación de espacio.

**Recomendación:** trasladar el flujo a una ruta dedicada bajo Revisión de seguridad, con paso y selección en la URL/estado de navegación recuperable. Mantener las validaciones, la restricción de 100 y la protección contra pérdida de respuestas; modal sólo para confirmaciones breves. La ruta debe conservar `asOrganization` y parámetros de oficina.

### 13. Detalle de tareas con exceso de cards — **Parcial; preferencia visual**

`TaskDetail` usa una card para cambios vinculados, otra para descripción/metadatos/referencia y otra para actividad. El contenido es correcto, pero la composición forma varias superficies anidadas, como en las capturas 7 y 8.

**Recomendación:** mantener los datos y reducir contenedores: encabezado con estado, sección de descripción y una grilla compacta de prioridad/fechas; referencia como fila enlazada y actividad como timeline o lista con separadores. Reservar cards para grupos que necesiten separación real. Conservar acciones condicionadas por `available_actions`.

### 14. Activos del escáner mostrados como tablas/cards — **Parcial; propuesta de diseño**

La lista de inventario usa `DataTable` para activos de red y manuales. El detalle de activo usa bloques tipo card para identidad, posición de red, observaciones y revisión, además de una tabla para servicios/puertos (`AssetDetailView`). Una tabla es adecuada para filas comparables y valores repetitivos; la captura 9 muestra paneles con información de detalle.

**Recomendación:** conservar tabla en listados comparables y evaluar vista compacta/lista de filas en pantallas estrechas. En el detalle, agrupar atributos en secciones de definición con pares etiqueta/valor; reservar una tabla para puertos/servicios, donde sí hay columnas repetidas. Priorizar lectura y comparación, no cambiar el componente sólo por variedad.

### 15. Badge junto al botón en el detalle de escaneo — **Corroborada visualmente**

El `PageHeader` de escaneo recibe un `Group` con `CreateRelatedTaskButton` y `StatusBadge` en la misma sección derecha (`app/portal/(protected)/inventory/scan-reports/[id]/page.tsx`). El orden y el ajuste responsive pueden producir la composición vista en captura 11.

**Recomendación:** poner el estado junto al título como metadato y dejar las acciones juntas en el extremo derecho; en móvil, apilar estado bajo el título y acciones en una fila propia. No asociar visualmente el estado al botón de crear tarea.

### 16. Resultados técnicos del escaneo difíciles de entender — **Parcial; cobertura de explicación insuficiente**

La lista y detalle traducen estados del informe (`Recibido`, `Procesado`, `Con error`) y fases (`completa`, `parcial`, `fallida`, etc.). El detalle muestra además el CIDR, contadores, resultados aceptados/rechazados y la cobertura de ejecución; no se explica en pantalla qué implica cada combinación para el usuario. `SCAN_RUN_LABEL` aporta etiquetas, no descripciones.

**Recomendación:** explicar en la lista o en una ayuda contextual el significado de ejecución y cobertura, con ejemplos de “completa”, “parcial”, “fallida” y “no intentada”, e indicar si afecta la actualización del inventario. Mantener los valores técnicos disponibles en detalle para diagnóstico. Confirmar definiciones contra el contrato del escáner.

### 17. Redundancia en el título del detalle de instantánea y cambio de nombre — **Parcial; nombre editable contradice inmutabilidad actual**

El encabezado ya muestra fecha/hora en `Instantánea — <fecha>` y una descripción explica que es inmutable. La colección está configurada sólo para creación y rechaza update/delete; es intencional para conservar evidencia. La captura 12 muestra redundancia visual de fecha, no una duplicación de datos almacenados.

**Recomendación:** simplificar el título a “Instantánea” y dejar la fecha/hora como metadato secundario. No editar `taken_at`. Si se requiere un nombre elegido por usuario, modelarlo como etiqueta mutable separada del registro de evidencia, con acceso/autoría y auditoría definidos; agregar la fecha original debajo del nombre. No habilitar update de la instantánea completa.

### 18. Redundancia en el detalle del escaneo y posibilidad de cambiar título — **Parcial; no hay título editable**

El título contiene la fecha de inicio; la descripción contiene el agente y la hora de finalización. La fecha de inicio se vuelve a mostrar en los datos/resumen asociados, como en la captura 13. `ScanReports` es de sólo lectura desde la colección y no tiene campo de título; por tanto, permitir renombrar requiere un cambio de modelo, no sólo de encabezado.

**Recomendación:** usar un título simple “Informe de escaneo” y un renglón de metadatos con fecha de inicio, agente y finalización. Si se necesita nombre editable, añadir un alias de presentación separado de los datos firmados/recibidos del agente, con autorización y auditoría; no mutar la evidencia original.

### 19. Cards de estadísticas de snapshot con estilo antiguo — **Corroborada** (corregido)

> Administración > Usuarios usa `MetricsStrip` y el detalle de snapshot usa `StatCard`: dos componentes para el mismo patrón. Se unificó en `MetricsStrip`.

El detalle de snapshot usa `StatCard`, el mismo componente compartido que usa el detalle del informe de escaneo. El dashboard, en cambio, usa deliberadamente `MetricsStrip`, que es una franja compacta distinta para cifras secundarias. El código no muestra que snapshot use un componente obsoleto frente a Administración; la percepción puede deberse a que se compara una grilla de métricas principales con una franja compacta.

**Recomendación:** definir qué nivel de importancia tienen las métricas históricas y escoger el patrón común correspondiente. Si deben ser prominentes, conservar `StatCard`; si son contexto secundario, usar `MetricsStrip`. Evitar duplicar un tercer componente. Comparar directamente la página de Administración indicada antes de decidir.

## Observaciones generales

### 20. Botones para volver atrás en la parte inferior — **Parcial; depende del flujo**

La pantalla de assessment tiene acciones al final del formulario y no tiene navegación de retorno al pie; los detalles de snapshot y escaneo sí incluyen `BackButton` superior. La app ya dispone de `components/ui/BackButton`.

**Recomendación:** añadir retorno inferior sólo en formularios largos o flujos de varios pasos, como assessments. Para detalles cortos, el botón superior basta. Si una operación guarda y luego cambia de pantalla, asegurar scroll al inicio y foco en el encabezado de destino.

### 21. Buscar otro estilo de toggles — **No corroborada como fallo funcional; propuesta visual**

Los toggles observados usan `Switch` de Mantine, por ejemplo “Incluir archivadas” en Tareas. No se identificó un error funcional en su manejo; la objeción es visual.

**Recomendación:** definir un único tratamiento visual para preferencias binarias (Switch con etiqueta/descripción, alineación y tamaño consistentes) y aplicarlo mediante tema/estilos Mantine compartidos. Mantener `Switch` para cambios inmediatos de estado; usar checkbox si la opción es parte de un formulario que se confirma con “Guardar”. Revisar dark mode y foco de teclado.

## Orden recomendado de trabajo

1. **Corregir navegación y consulta de mensajes:** puntos 4 y 5; son defectos funcionales con causa identificable.
2. **Resolver el acceso desde Mensajes:** reproducir punto 3 y corregirlo sólo si se confirma; registrar URL, usuario/rol y respuesta HTTP.
3. **Perfilar inicio y cargas:** punto 1; optimizar en función de tiempos medidos, empezando por semillas ejecutadas en cada arranque.
4. **Agrupar cambios de UX de evaluaciones:** puntos 10–12 y 20, porque afectan el mismo flujo de revisión.
5. **Unificar jerarquía visual y tema:** puntos 6–8, 13–15, 19 y 21.
6. **Mejorar explicación y datos de riesgo/escaneo:** puntos 9 y 16; validar procedencia de activos y semántica del contrato antes de cambiar API/UI.
7. **Tratar nombres de evidencia como metadatos independientes:** puntos 17–18, preservando inmutabilidad de snapshots y reports.

## Límites de esta corroboración

- No se midió duración de build, inicio, consultas ni renderizado; el punto 1 requiere un perfil reproducible.
- No se ejecutó el sistema con las cuentas y rutas que originaron las capturas; el punto 3 no se pudo reproducir.
- Los puntos estéticos se contrastaron con JSX/CSS y las capturas aportadas, sin auditoría automatizada de contraste ni prueba responsive.
- Las recomendaciones de paginación, renombrado y rutas nuevas requieren confirmar contratos y decisiones de producto antes de implementarse.
