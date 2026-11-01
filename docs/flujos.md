# Flujos funcionales de SIAM

Referencia de los flujos de usuario del sistema, organizada por feature: quién ejecuta cada flujo, en qué condiciones, qué pasos sigue y qué resultado produce el sistema. Sirve como base para las futuras specs Playwright de `e2e/`. No describe contratos HTTP ni implementación; para eso están los documentos de feature de esta carpeta.

## Roles

- **PlatformAdmin:** cuenta de plataforma (colección de administradores, separada de los usuarios de organización). Opera en StaffPortal (`/`): crea y administra organizaciones, agrega OrgAdmins y gestiona los mensajes del portal. Puede visitar una organización (contexto `asOrganization`) y, dentro de ella, actuar como su OrgAdmin.
- **OrgAdmin:** administrador de una organización en el Portal de Organización (`/portal`). Cubre todas las oficinas y administra oficinas, personas, configuración, inventario, revisiones y tareas.
- **OfficeManager:** responsable de una o más oficinas. Gestiona inventario, tareas y revisiones dentro de sus oficinas y, desde Portal → Equipo, da de alta Viewers y gestiona el estado y las oficinas de los Viewers que están íntegramente dentro de su alcance.
- **Viewer:** lectura dentro de sus oficinas. Puede tomar, liberar y completar tareas, y responder las revisiones de los activos de los que es responsable.

### Límites por plan

| Plan    | Oficinas activas | Escáneres por oficina | OrgAdmin | OfficeManager | Viewer |
| ------- | ---------------: | --------------------: | -------: | ------------: | -----: |
| Basic   |                3 |                     1 |        1 |             2 |      4 |
| Premium |               10 |                     2 |        3 |            10 |     20 |

El plan se elige en el alta de la organización y no se puede cambiar después desde el producto. Las cuotas de personas cuentan solo cuentas activas por rol; la de oficinas, solo oficinas activas.

## Altas de organización y personas

### REQ-ORG-01 — Alta de organización desde StaffPortal

**Actor:** PlatformAdmin en StaffPortal, sin contexto de visita.

1. El PlatformAdmin abre Organizaciones → Crear organización. Se abre un asistente por pasos.
2. **Organización:** completa nombre y rubro/sector de un catálogo. Si elige «Otro», puede escribir una explicación opcional.
3. **Plan:** elige Basic o Premium.
4. **Primera oficina:** nombre, provincia y departamento/partido opcional.
5. **Primer usuario:** nombre completo, correo y contraseña inicial. El rol es siempre OrgAdmin y no se puede cambiar.
6. Revisa el resumen y confirma.

**Resultado esperado:** en una sola operación atómica se crean organización, settings (industria seleccionada, política Essential), suscripción con los límites del plan y features activas por defecto, oficina inicial activa, usuario, membresía OrgAdmin activa y ciclos iniciales requeridos. La contraseña permite iniciar sesión de inmediato; no hay invitación ni activación pendiente. Si cualquier paso falla, no queda una organización parcial ni una cuenta sin membresía. El usuario solo tiene nombre completo (`name`), correo y estado; no hay apellido, teléfono ni otros datos personales.

### REQ-USER-01 — Alta de usuario desde Administración → Usuarios o Portal → Equipo

**Actor:** OrgAdmin (Administración → Usuarios) u OfficeManager (Portal → Equipo).

**Precondiciones:** cupo disponible para el rol elegido; correo no asociado a otra cuenta.

| Actor         | Roles que puede crear           | Alcance de oficinas                                                                          |
| ------------- | ------------------------------- | -------------------------------------------------------------------------------------------- |
| OrgAdmin      | OrgAdmin, OfficeManager, Viewer | OrgAdmin cubre todas; los otros roles requieren una o más oficinas activas de la organización |
| OfficeManager | Viewer                          | Solo oficinas activas que el OfficeManager ya tiene asignadas                                |
| Viewer        | Ninguno                         | No administra usuarios                                                                       |
| PlatformAdmin en StaffPortal | OrgAdmin adicional (REQ-USER-02) | Rol fijo; cubre todas las oficinas                                             |

1. El actor abre Crear persona.
2. Completa nombre completo, correo, contraseña inicial, rol y, si el rol lo requiere, oficinas.
3. Confirma.

**Resultado esperado:** la cuenta y la membresía quedan activas y pueden iniciar sesión de inmediato. La API repite las reglas del formulario, aplica las cuotas bajo concurrencia y rechaza un correo existente sin crear duplicados.

**Gestión delegada del OfficeManager en Equipo:**

- Equipo reutiliza la vista, tabla, métricas, filtros y formulario de Usuarios. Sus contadores corresponden a las personas visibles de sus oficinas, no al consumo global del plan. Administración general no está disponible para el OfficeManager.
- Puede desactivar y reactivar únicamente Viewers con una o más oficinas asignadas, todas dentro de su alcance. No puede modificar roles; el rol se muestra como dato de solo lectura.
- Puede editar las oficinas de esos Viewers mientras estén activos, eligiendo solo oficinas activas propias y conservando al menos una.
- Al reactivar, solo puede elegir oficinas activas propias si hace falta corregir la asignación; nunca amplía su alcance.
- Se mantienen la confirmación por correo, las cuotas, la revocación de sesiones y las cascadas sobre activos y tareas. Equipo incluye los Viewers inactivos que puede gestionar y no muestra personas inactivas fuera de ese alcance.

### REQ-USER-02 — Alta de OrgAdmin adicional desde StaffPortal

**Actor:** PlatformAdmin en StaffPortal.

**Precondiciones:** organización activa con cupo de OrgAdmin en su plan.

1. El PlatformAdmin abre, sobre la organización, Más acciones → Añadir OrgAdmin.
2. Completa nombre, correo y contraseña inicial. El rol está fijado como OrgAdmin y no se piden oficinas.
3. Confirma.

**Resultado esperado:** se crea un OrgAdmin activo de esa organización. Sin cupo, la operación se rechaza. El OrgAdmin de la organización también puede crear OrgAdmins desde Administración → Usuarios cuando la cuota lo permite.

### REQ-USER-03 — Confirmación escrita al desactivar un usuario

**Actor:** OrgAdmin, u OfficeManager sobre Viewers de su alcance.

**Precondiciones:** no se puede desactivar la propia cuenta ni dejar una organización activa sin OrgAdmin.

1. El actor pulsa Desactivar sobre una persona.
2. El modal muestra nombre, correo e impacto: activos a cargo, tareas en curso y tareas asignadas. Explica que los activos no reasignados quedan sin responsable, las tareas reclamadas en curso vuelven a pendientes y las tareas abiertas asignadas no se reasignan automáticamente.
3. El actor escribe el correo de la persona y confirma.

**Resultado esperado:** la API valida el correo dentro de la operación; un correo incorrecto o cancelar no cambia datos. Al reactivar, el acceso vuelve con el rol anterior, pero activos y tareas no se restauran ni se reclaman automáticamente.

## Autenticación y contexto

### AUTH-01 — Login de cada portal

**Actor:** PlatformAdmin, OrgAdmin, OfficeManager, Viewer.

1. El PlatformAdmin inicia sesión en el login común.
2. El sistema abre StaffPortal (`/`) con Resumen, Organizaciones y Mensajes.
3. Cierra sesión. Un OrgAdmin, un OfficeManager y un Viewer inician sesión, uno por vez.
4. El sistema abre el Portal de Organización (`/portal`) con la navegación que corresponde a cada rol.

**Resultado esperado:** el login enruta según el tipo de cuenta; una sesión de PlatformAdmin no se confunde con la de un usuario de organización y no se conserva la sesión de la cuenta anterior.

### AUTH-02 — Credenciales inválidas y cuenta inactiva

**Actor:** cualquier usuario.

1. El usuario intenta iniciar sesión con contraseña incorrecta o con un correo inexistente.
2. Una cuenta desactivada intenta iniciar sesión con la contraseña correcta.
3. Una sesión abierta antes de la desactivación intenta seguir navegando.
4. Una cuenta acumula cinco intentos fallidos.

**Resultado esperado:** correo inexistente o contraseña incorrecta muestra «El correo o la contraseña no son correctos». La cuenta desactivada con contraseña correcta recibe el mensaje específico de cuenta desactivada. Una cuenta inactiva no obtiene contexto ni conserva sesiones válidas. Tras cinco intentos fallidos la cuenta se bloquea durante diez minutos y se libera sola.

### Reglas del sistema

- **AUTH-03 — Contexto de sesión:** `GET /api/v1/session` entrega `role`, `organizationId`, `officeIds`, `orgWide`, `permissions`, `features` y `limits`, que el frontend usa para mostrar la UI. Organización y oficinas corresponden a la membresía; el PlatformAdmin solo recibe alcance de organización mientras la visita.
- No hay recuperación ni cambio de contraseña desde el portal; la contraseña inicial da acceso inmediato.

## Permisos por rol

| Capacidad | PlatformAdmin en StaffPortal | PlatformAdmin visitando una org | OrgAdmin | OfficeManager | Viewer |
| --- | --- | --- | --- | --- | --- |
| Crear organización | Sí (REQ-ORG-01) | No | No | No | No |
| Alta de oficina | No | Como OrgAdmin | Sí | No | No |
| Alta de usuario | OrgAdmin adicional (REQ-USER-02) | Según REQ-USER-01 | Sí | Solo Viewer en sus oficinas | No |
| Leer inventario | Resumen de plataforma | Alcance de la org visitada | Sí | Solo sus oficinas | Solo lectura de su alcance |
| Editar negocio del activo de red | No | Como OrgAdmin | Sí | Sí, dentro de su oficina | No |
| Crear activo manual | No | Como OrgAdmin | Sí | Sí, dentro de su oficina | No |
| Administrar oficina/membresía/settings | No | Como OrgAdmin | Sí | Solo oficinas de Viewers activos íntegramente dentro de su alcance; no roles, settings ni estructura de oficinas | No |
| Desactivar/reactivar personas | No | Como OrgAdmin | Sí, con invariantes de baja | Solo Viewers con todas sus oficinas dentro de su alcance | No |
| Tareas | Leer | Todas las acciones de OrgAdmin | Todas | Crear, leer, editar, tomar/liberar, asignar/reasignar, completar, cancelar, archivar y eliminar dentro de su alcance | Leer, tomar/liberar/completar |
| Revisión de seguridad | Lectura/visita | Según alcance de OrgAdmin | Gestiona respuestas | Gestiona dentro de sus oficinas | Responde solo revisiones de activos propios; lectura del resto |

### PERM-M01 — PlatformAdmin en StaffPortal

**Actor:** PlatformAdmin.

1. El PlatformAdmin abre Organizaciones → Crear organización, recorre el asistente y cancela.
2. Visita una organización desde el listado y vuelve a StaffPortal.

**Resultado esperado:** cancelar no agrega una organización al listado. Durante la visita la interfaz identifica el contexto de la organización visitada, y la navegación distingue ambos contextos.

### PERM-M02 — PlatformAdmin visitando una organización

**Actor:** PlatformAdmin.

**Precondiciones:** al menos dos organizaciones activas con datos.

1. El PlatformAdmin visita una organización y abre inventario, oficinas, personas y configuración.
2. Cambia un dato de negocio permitido de un activo y guarda.
3. Vuelve a StaffPortal y visita otra organización.

**Resultado esperado:** las acciones administrativas de la organización están disponibles, la edición persiste tras recargar y cada pantalla muestra los datos del contexto seleccionado.

### PERM-M03 — OrgAdmin

**Actor:** OrgAdmin.

**Precondiciones:** organización con dos oficinas.

1. El OrgAdmin abre Administración y accede a oficinas, personas y configuración.
2. Selecciona Oficina 1 y Oficina 2 en el selector y revisa el inventario de cada una.
3. Cambia el nombre de una oficina y guarda.

**Resultado esperado:** ambas oficinas están disponibles y el cambio guardado se refleja en la interfaz tras recargar.

### PERM-M04 — OfficeManager

**Actor:** OfficeManager asignado solo a Oficina 1.

**Precondiciones:** Viewer con todas sus oficinas dentro del alcance del Manager.

1. El Manager entra y revisa el selector y el inventario. Oficina 2 no se ofrece como contexto.
2. Abre Portal → Equipo → Crear persona: solo se ofrece Viewer y sus oficinas. Cancela. Administración general no aparece.
3. Crea un activo manual en Oficina 1 y edita un dato de negocio de un activo de red identificado de esa oficina.
4. Crea una tarea en Oficina 1.
5. Sobre un Viewer de su alcance abre la desactivación, revisa los impactos, cancela, vuelve a abrir y confirma con el correo de la persona. Luego lo reactiva desde Equipo.

**Resultado esperado:** las operaciones permitidas persisten tras recargar. Los controles no ofrecen ampliar rol ni alcance. Desactivar/reactivar no se ofrecen sobre Managers, OrgAdmins ni Viewers con alguna oficina fuera de su alcance.

### PERM-M05 — Viewer

**Actor:** Viewer de Oficina 1.

**Precondiciones:** tarea elegible y un activo cuyo responsable es el Viewer, con revisión abierta.

1. El Viewer revisa inventario y detalle de Oficina 1.
2. Abre una tarea elegible, la toma, la libera, la vuelve a tomar y la completa.
3. Abre la revisión de su activo, guarda un borrador, la reabre y la completa.
4. Abre una revisión de un activo ajeno de su oficina.

**Resultado esperado:** inventario y detalle no ofrecen creación ni edición de activos, ni Administración ni gestión de Equipo. Los cambios en tareas y en su revisión persisten tras recargar. La revisión ajena es de solo lectura; las revisiones de organización no están disponibles.

## Onboarding de organización y usuarios

### ORG-01 — Alta Basic

**Actor:** PlatformAdmin en StaffPortal.

1. El PlatformAdmin abre Organizaciones → Crear organización.
2. Completa nombre, rubro, plan Basic, primera oficina con provincia/departamento válidos y primer administrador con nombre, correo único y contraseña inicial. El rol inicial es OrgAdmin y no se puede cambiar.
3. Revisa el resumen y confirma una vez.
4. El nuevo administrador inicia sesión y abre Oficinas y Usuarios.

**Resultado esperado:** el asistente se cierra y la organización aparece activa en la lista, también tras recargar. El nuevo administrador accede de inmediato a la organización correcta y ve la oficina y su propia cuenta con los datos guardados; los contadores de plan corresponden a Basic. La notificación de resultado tiene un título que identifica la acción y, opcionalmente, una descripción.

### ORG-02 — Alta Premium

**Actor:** PlatformAdmin en StaffPortal.

1. El PlatformAdmin repite el alta con otra organización y otro correo, eligiendo Premium.
2. El resumen muestra Premium antes de crear; confirma.
3. El administrador inicial inicia sesión.

**Resultado esperado:** la organización queda persistida con plan Premium; el administrador ve su oficina y su cuenta, y los contadores visibles de Usuarios/Oficinas corresponden a Premium.

### ORG-03 — Navegación, revisión, validación y cancelación del asistente

**Actor:** PlatformAdmin en StaffPortal.

1. El PlatformAdmin abre el asistente y recorre las pestañas en cualquier orden; escribe datos, cambia de pestaña y vuelve.
2. Va a Revisar sin completar todo y pulsa Crear.
3. Corrige los valores. Elige «Otro» con un detalle y luego cambia a un rubro del catálogo.
4. Elige provincia y departamento, y después cambia la provincia.
5. Modifica datos, vuelve a Revisar, cancela y reabre el asistente.

**Resultado esperado:**

- Los datos se conservan entre pestañas.
- Revisar muestra «Sin completar» y un aviso breve de datos pendientes. Al pulsar Crear, los errores aparecen debajo de sus campos, se marcan las pestañas afectadas y se abre la primera con errores. Cada error desaparece al corregir su campo.
- Al cambiar de «Otro» a un rubro del catálogo, el detalle anterior no se conserva. «Otro» sin detalle es válido.
- Al cambiar la provincia se limpia el departamento incompatible.
- El resumen coincide con los datos actuales. Cancelar no crea la organización y al reabrir el formulario está reiniciado.

### ORG-04 — Alta rechazada y recuperación

**Actor:** PlatformAdmin en StaffPortal.

**Precondiciones:** existe una cuenta con el correo que se va a usar.

1. El PlatformAdmin completa un alta con el correo de una cuenta existente y un nombre de organización nuevo.
2. Confirma.
3. Corrige el correo por uno único y vuelve a confirmar.
4. El nuevo administrador inicia sesión.

**Resultado esperado:** el rechazo muestra «Ese correo ya está asociado a una cuenta. Escribe otro correo.» debajo del campo de correo, conserva el resto del formulario y no informa éxito. Tras el reintento aparece una sola organización con ese nombre y el administrador puede entrar. El rechazo no deja registros parciales y el mismo alta puede reintentarse sin duplicados.

### USER-01 — OrgAdmin crea Manager y Viewer

**Actor:** OrgAdmin.

**Precondiciones:** cupo de OfficeManager y Viewer; oficinas activas.

1. El OrgAdmin abre Administración → Usuarios → Crear persona y crea un OfficeManager con correo único y una oficina activa.
2. Crea un Viewer con otro correo y una oficina activa.
3. Cada cuenta creada inicia sesión.

**Resultado esperado:** la tabla muestra ambas filas con rol, oficinas y estado activo, también tras recargar. Cada cuenta entra de inmediato con su identidad, navegación y oficina según la asignación.

### USER-02 — OfficeManager crea Viewer

**Actor:** OfficeManager asignado solo a Oficina 1.

1. El Manager abre Portal → Equipo → Crear persona.
2. El rol Viewer aparece como dato de solo lectura y el selector de oficinas ofrece solo las propias.
3. Completa datos válidos y crea.
4. El Viewer creado inicia sesión.

**Resultado esperado:** la fila aparece y persiste. Administración → Usuarios no está disponible para el Manager. El Viewer entra con su identidad y Oficina 1.

### USER-03 — OrgAdmin adicional desde StaffPortal

**Actor:** PlatformAdmin.

**Precondiciones:** una organización Premium con cupo de OrgAdmin y una organización Basic cuyo único cupo de OrgAdmin está ocupado.

1. En la organización Premium, el PlatformAdmin abre Más acciones → Añadir OrgAdmin. El rol es fijo y no se pide oficina.
2. Completa datos únicos y confirma.
3. La cuenta nueva inicia sesión.
4. En la organización Basic, intenta un alta adicional.

**Resultado esperado:** la cuenta nueva aparece en Usuarios de la organización y accede como su administrador. En Basic, el sistema explica el límite del plan y no informa éxito.

### USER-04 — Validaciones del formulario de persona

**Actor:** OrgAdmin.

1. El OrgAdmin abre Crear persona, selecciona Viewer e intenta crear sin nombre, correo, contraseña ni oficinas.
2. Escribe un correo mal formado y una contraseña de menos de ocho caracteres; luego corrige cada campo y selecciona una oficina.
3. Cancela.
4. Reabre, completa datos válidos y crea.

**Resultado esperado:** al enviar, todos los errores aparecen debajo de sus campos con instrucciones breves, sin alertas nativas ni listas de identificadores internos. Cada error se actualiza al corregir su campo sin borrar los otros datos. Cancelar no crea una persona. El alta válida crea una sola persona activa. Un correo ya usado muestra «Ese correo ya está asociado a una cuenta. Escribe otro correo.» debajo del correo y conserva el resto del formulario.

## Administración de oficinas

### OFFICE-01 — Crear, validar y editar

**Actor:** OrgAdmin.

**Precondiciones:** cupo de oficinas disponible.

1. El OrgAdmin abre Administración → Oficinas → **Nueva oficina** e intenta crear con nombre y provincia vacíos.
2. Escribe un nombre y elige provincia.
3. Elige comuna/partido/departamento y luego cambia de provincia.
4. Crea la oficina.
5. Abre **Editar**, cambia nombre y ubicación y guarda.
6. Abre **Editar**, modifica el nombre y pulsa **Cancelar**.

**Resultado esperado:**

- Con campos vacíos aparecen errores debajo de nombre y provincia y el modal sigue abierto; cada error desaparece al corregir su campo.
- Al cambiar de provincia se limpia la selección dependiente y solo se ofrecen opciones de la nueva provincia. El departamento es opcional.
- Al crear se cierra el modal y aparece la fila con nombre y ubicación legibles; se encuentra por nombre y persiste tras recargar.
- La edición guardada persiste al reabrir; la cancelada no, y se muestra el último nombre guardado.

### OFFICE-02 — Límite del plan

**Actor:** OrgAdmin.

**Precondiciones:** la organización está en el límite de oficinas activas de su plan (Basic: 3).

1. El OrgAdmin revisa el contador de oficinas activas y el máximo del plan.
2. Pasa el cursor por **Nueva oficina** y hace clic.
3. Tras desactivar una oficina (OFFICE-03), vuelve a Oficinas.

**Resultado esperado:** en el límite, **Nueva oficina** explica que se alcanzó el máximo y que desactivar una oficina libera cupo; el clic no abre el modal. Tras la baja, el contador disminuye y **Nueva oficina** vuelve a estar disponible.

### OFFICE-03 — Revisar el impacto, cancelar y desactivar

**Actor:** OrgAdmin.

**Precondiciones:** otra oficina activa disponible como destino; no se puede desactivar la última oficina activa.

1. El OrgAdmin pulsa **Desactivar** en la oficina. El modal resume escáneres, activos, personas afectadas, tareas y revisión abierta.
2. En la tabla de activos manuales elige **Mover** para uno (con oficina destino) y **Dar de baja** para otro. Puede corregir una decisión con **Volver a decidir** y aplicar acciones en bloque sobre filas seleccionadas con casillas.
3. Deja un activo sin decisión o escribe un nombre de oficina incorrecto.
4. Pulsa **Cancelar** y vuelve a abrir.
5. Elige nuevamente los destinos, escribe el nombre exacto de la oficina y confirma una vez.

**Resultado esperado:**

- Si el resumen no carga o muestra un error, no se puede confirmar.
- La acción en bloque afecta solo a las filas elegidas.
- Con un activo sin decisión o un nombre incorrecto, la confirmación permanece bloqueada.
- Cancelar no aplica cambios y descarta las decisiones tomadas.
- Al confirmar, el modal se cierra, aparece una notificación y la oficina figura inactiva (filtro **Todas / Inactivas**).
- El activo manual trasladado queda en la oficina destino, sin responsable ni ubicación anterior, conservando historial y tareas. El dado de baja figura retirado y sus tareas abiertas quedan canceladas.
- Los activos de red de la oficina se retiran, las tareas propias de la oficina se cancelan, la revisión de oficina se cierra, el escáner se revoca y la persona que queda sin oficinas activas se desactiva. Una persona que conserva otra oficina activa no se desactiva.
- Todas las decisiones se aplican juntas o no se aplica ninguna.

### OFFICE-05 — Reactivar sin restauraciones automáticas

**Actor:** OrgAdmin.

**Precondiciones:** oficina inactiva y cupo de oficinas disponible.

1. El OrgAdmin pulsa **Reactivar** sobre la oficina inactiva. El aviso indica que vuelve la oficina y se abre una nueva revisión, y que escáneres, personas y activos no se restauran automáticamente.
2. Pulsa **Cancelar**; luego vuelve a abrir y confirma **Reactivar oficina**.

**Resultado esperado:** cancelar mantiene la oficina inactiva. Al confirmar, la oficina aparece activa, el contador aumenta y vuelve a estar disponible en el selector de oficinas. Se abre una nueva revisión de seguridad y la anterior se conserva como historia. La persona desactivada sigue inactiva, el escáner sigue revocado, los activos retirados siguen retirados y el activo trasladado permanece en destino.

### Reglas del sistema

- **OFFICE-04 — Impacto obsoleto y destinos inválidos:** la desactivación se rechaza si las decisiones están incompletas u obsoletas respecto del impacto actual, o si un destino es la misma oficina, está inactivo o pertenece a otra organización. El rechazo no deja movimientos parciales.
- La reactivación respeta la cuota de oficinas activas y no duplica ciclos.

## Usuarios, permisos y ciclo de vida

### USER-05 — Editar acceso activo

**Actor:** OrgAdmin.

**Precondiciones:** Viewer activo; para el cambio de rol, cupo de OfficeManager.

1. El OrgAdmin abre **Editar acceso** (lápiz) de un Viewer en Usuarios.
2. Cambia sus oficinas y guarda.
3. Cambia el rol a OfficeManager, asigna una oficina activa y guarda.
4. Abre la edición, cambia datos y cancela.
5. Con un rol no administrador, quita todas las oficinas e intenta guardar.

**Resultado esperado:** las oficinas y el rol guardados persisten al recargar y reabrir. En la sesión de la persona afectada, tras recargar, el alcance es el nuevo, sin datos de las oficinas retiradas, y aparecen las acciones del nuevo rol. Cancelar conserva el último acceso guardado. Sin oficinas aparece «Selecciona al menos una oficina.» debajo del selector, se conserva el acceso anterior y el error desaparece al seleccionar una oficina. Al retirar una oficina, los activos de esa oficina quedan sin responsable y las tareas tomadas allí vuelven a pendientes; se conservan los de las oficinas restantes.

### USER-06 — Desactivar, cancelar y revisar efectos

**Actor:** OrgAdmin.

**Precondiciones:** persona activa con activos y, opcionalmente, tareas reclamadas o asignadas; no es la propia cuenta ni el último OrgAdmin.

1. El OrgAdmin abre **Desactivar** sobre la persona. El modal muestra el impacto.
2. Escribe un correo incorrecto.
3. Elige un nuevo responsable elegible para los activos o los deja explícitamente sin responsable.
4. Cancela, reabre, revisa el impacto y confirma con el correo correcto.

**Resultado esperado:** si el impacto no carga, no se permite confirmar y el mensaje ofrece reintentar. Con un correo incorrecto la confirmación queda bloqueada. Cancelar no cambia el estado ni las responsabilidades. Al confirmar, la persona aparece inactiva; los activos elegibles pasan al responsable elegido o quedan sin responsable; las tareas reclamadas en curso vuelven a pendientes y las asignadas no pasan automáticamente a otra persona. Una sesión previa de la persona pierde el acceso al navegar o recargar.

### USER-07 — Bloqueos y reactivación

**Actor:** OrgAdmin.

1. El OrgAdmin revisa las acciones disponibles sobre su propia cuenta.
2. Intenta reactivar una persona inactiva cuyo rol está en el límite del plan.
3. Con una persona inactiva y cupo disponible, abre la reactivación y cancela; luego la reabre y confirma.
4. Si la persona necesita oficinas, confirma la reactivación sin elegir oficina.

**Resultado esperado:** la UI no permite desactivar la propia cuenta. La reactivación sin cupo muestra «No se pudo reactivar a la persona» con la explicación del límite de personas activas de ese rol, y la persona sigue inactiva. Cancelar la mantiene inactiva; confirmar la deja activa con acceso al portal. Sin oficina elegida, «Reactivar» sigue disponible pero muestra «Selecciona al menos una oficina.» debajo del selector y no envía nada. Las responsabilidades anteriores no se restauran.

### USER-08 — Editar acceso de persona inactiva sin reactivarla

**Actor:** OrgAdmin.

**Precondiciones:** organización activa; persona inactiva.

1. El OrgAdmin localiza la persona inactiva; el lápiz **Editar acceso** está disponible.
2. Cambia solo las oficinas, mantiene el rol y guarda.
3. Cambia también el rol y guarda.
4. La persona intenta iniciar sesión.
5. El OrgAdmin intenta reactivarla.

**Resultado esperado:** tras recargar y reabrir se conservan exactamente las oficinas y el rol elegidos, y el estado sigue **Inactivo**. Editar no activa la cuenta ni consume cupo, aunque el rol nuevo esté en su límite. La persona sigue sin acceso. Si el rol nuevo está en el límite, la reactivación explica el límite y mantiene la cuenta inactiva; con cupo, la persona se reactiva y entra con el rol y las oficinas preparados, sin restaurar activos ni reclamar tareas. La edición delegada de oficinas del OfficeManager se limita a Viewers activos.

## Ajustes y perfil

### SETTINGS-01 — Configuración de inventario

**Actor:** OrgAdmin.

1. El OrgAdmin abre **Administración → Configuración**.
2. Con la casilla de instantánea desmarcada, elige **48 h** de umbral sin conexión y **3 días** de intervalo; pulsa **Guardar cambios**.
3. Marca **Tomar una instantánea antes de cada escaneo** y guarda.
4. Desmarca la casilla y guarda.
5. Pulsa **Restaurar valores predeterminados**.

**Resultado esperado:**

- Los valores guardados persisten al salir, volver y recargar.
- Con la casilla marcada, el intervalo queda bloqueado y la ayuda explica que se ignora mientras la opción está activa; al desmarcarla vuelve a ser editable.
- Solo el botón que inicia la operación (Guardar o Restaurar) muestra la animación de carga; mientras se guarda, ambos botones y los campos quedan bloqueados.
- **Restaurar valores predeterminados** guarda de inmediato umbral 72 h, intervalo 7 días y la casilla desmarcada; el intervalo vuelve a ser editable. Está disponible aunque los selectores ya estén en sus predeterminados si la casilla está marcada. Ante un fallo, el formulario no se presenta como restaurado.

### SETTINGS-02A — Política de revisión

**Actor:** OrgAdmin.

1. El OrgAdmin elige la política distinta de la actual (**Esencial** o **Reforzada**).
2. En el modal **¿Cambiar la política de revisión?** lee las consecuencias y pulsa **Cancelar**.
3. Vuelve a elegirla y pulsa **Confirmar cambio**.
4. Abre las revisiones de seguridad y luego Puntaje de riesgo.

**Resultado esperado:** cancelar no cambia la política. Al confirmar, el modal se cierra y la tarjeta elegida muestra **Política actual**, también tras recargar. La política nueva se refleja en los ciclos aplicables y las revisiones completadas siguen disponibles como historial. Si el riesgo se está recalculando, el aviso es coherente con la existencia o ausencia de una evaluación previa. Volver a la política original es otro cambio real, no deshace los ciclos anteriores.

### SETTINGS-02B — Perfil de la organización

**Actor:** OrgAdmin.

1. En **Perfil de la organización**, sin respuestas previas, el OrgAdmin pulsa **Guardar perfil**.
2. Elige **Sí** para persona a cargo de sistemas y **Sí, de forma regular** para presupuesto.
3. Guarda, sale de Configuración y vuelve.
4. Elige **No / No**.

**Resultado esperado:** sin respuestas, se indica debajo de cada pregunta la opción faltante. Con Sí / Sí, de forma regular se muestra **Nivel: Avanzado** antes de guardar; con No / No, **Nivel: Inicial**. Las respuestas y el nivel persisten y se muestra la fecha de última actualización. La explicación indica que el perfil orienta recomendaciones y no modifica por sí solo el puntaje de riesgo. El autor del cambio no se muestra en el formulario.

### SETTINGS-03 — Perfil personal de usuario y PlatformAdmin

**Actor:** usuario de organización; PlatformAdmin en StaffPortal.

1. El usuario abre **Cuenta**, borra el nombre e intenta guardar.
2. Escribe un nombre con un carácter inválido, por ejemplo `Nombre <prueba>`, y luego lo corrige.
3. Escribe un nombre válido y guarda.
4. Cambia el texto sin guardar, sale y vuelve.
5. El PlatformAdmin repite el recorrido desde su perfil en StaffPortal.

**Resultado esperado:** los errores aparecen debajo del campo y se actualizan al corregir; se conserva el nombre guardado. El nombre válido persiste tras recargar. El correo es visible y no editable. Los cambios sin guardar se descartan sin modal de descarte. Cada cuenta conserva su propio nombre. El perfil personal del PlatformAdmin sigue disponible aunque esté visitando una organización desactivada.

## Inventario y escáneres

### INV-01 — Inventario de red

**Actor:** OrgAdmin (también OfficeManager dentro de su oficina).

**Precondiciones:** un activo de red identificado y otro sin identificar; responsables elegibles.

1. El actor abre Inventario en una oficina con datos, busca un equipo y aplica filtros de estado/criticidad/oficina; luego los limpia.
2. Abre un activo identificado, cambia alias o ubicación y responsable por otra persona elegible, y guarda.
3. Revisa IP, MAC, sistema operativo y servicios.
4. Abre un activo sin identificar, pulsa **Identificar**, completa tipo, autorización y campos requeridos, y confirma.
5. En un activo identificado abre **Quitar identificación**, cancela, la vuelve a abrir y confirma; luego lo identifica de nuevo.

**Resultado esperado:**

- La búsqueda no distingue mayúsculas ni tildes (`portatil` y `portátil` encuentran los mismos activos) y se comporta igual en inventario de red y manual, tareas, personas, oficinas, organizaciones, revisiones, selección masiva y selectores buscables. Al limpiar filtros vuelven los registros.
- Los cambios de negocio persisten al recargar y reabrir.
- IP, MAC, sistema operativo y servicios son de solo lectura. La pestaña «Red y puertos» no muestra contador y da acceso al detalle de red.
- Identificar cambia su estado y habilita los datos de negocio.
- Cancelar **Quitar identificación** lo deja identificado; confirmar lo devuelve a no identificado conservando los datos de negocio, y al identificarlo de nuevo no se crea un equipo duplicado.

### INV-02 — Activos manuales

**Actor:** OrgAdmin u OfficeManager.

1. El actor abre **Crear activo** en el inventario manual e intenta guardar vacío.
2. Completa alias, categoría, criticidad, oficina, responsable y los campos que pida la categoría (producto, cloud, repositorio); guarda.
3. Edita el activo y cambia de oficina.
4. En «Alcance de la evaluación de seguridad» elige **Excluido** e intenta guardar sin motivo ni fecha. Luego elige motivo y una fecha futura dentro de 90 días (con nota si el motivo es «Otro») y guarda. Después vuelve a **Incluido**.
5. En un activo descartable, cambia Estado para darlo de baja y guarda.

**Resultado esperado:**

- Los errores aparecen debajo de los campos requeridos; sin categoría, el mensaje es «Selecciona una categoría.» y desaparece al elegirla. El formulario permite intentar guardar para mostrar todos los errores y no envía datos inválidos.
- Se crea una sola fila con los valores elegidos.
- Al cambiar de oficina, el selector de responsable ofrece personas compatibles; si el responsable perdió cobertura, debe reemplazarse. Oficina y responsable persisten.
- La exclusión exige motivo y fecha; queda guardada y el activo sigue visible en el inventario. Al volver a Incluido se actualiza el estado.
- El activo dado de baja figura retirado con su historial, encontrable con el filtro de estado y sin duplicados. Excluir de la evaluación no retira el activo.

### INV-03 — Incidentes de inventario

**Actor:** OrgAdmin u OfficeManager.

**Precondiciones:** incidentes pendientes de ubicación y de identidad generados por escaneos.

1. El actor abre el panel de incidentes desde Inventario o el detalle. En uno de ubicación revisa el equipo, la oficina actual y la propuesta; en uno de identidad, lo que debe revisarse.
2. En un incidente de ubicación elige **Confirmar traslado**.
3. En otro elige **Mantener ubicación**.
4. En uno de identidad, tras revisar el equipo, elige **Marcar como revisado**.

**Resultado esperado:** solo el botón pulsado del incidente correspondiente muestra carga; las demás acciones quedan bloqueadas durante la petición y un error se muestra solo en el aviso afectado. Confirmar traslado mueve el equipo a la oficina destino y conserva el responsable solo si cubre esa oficina. Mantener ubicación deja el equipo en su oficina. En los tres casos el incidente deja de figurar pendiente. Marcar como revisado no aplica automáticamente los datos contradictorios. En una organización desactivada visitada por PlatformAdmin no se pueden resolver incidentes.

### INV-04 — Revisión periódica de activo manual

**Actor:** OrgAdmin u OfficeManager.

1. El actor crea o edita un activo manual con una **Frecuencia de revisión** distinta de «Nunca» y guarda.
2. En un activo cuya revisión ya está habilitada pulsa **Marcar como revisado**.
3. En un activo cuya revisión todavía no está habilitada pasa el cursor por la acción.
4. Cambia la frecuencia a **Nunca** y guarda.

**Resultado esperado:** se muestran frecuencia, próxima revisión y estado. Marcar como revisado deja el activo al día con la próxima fecha actualizada, en una sola fila. Antes de la ventana de habilitación, la acción explica que se habilita cerca del vencimiento. Con «Nunca» no se exige próxima revisión periódica.

### AGENT-01 — Descargar y desactivar un escáner

**Actor:** OrgAdmin.

**Precondiciones:** oficina con cupo de escáneres.

1. El OrgAdmin abre **Administración → Oficinas** y pulsa **Instalar escáner / Administrar escáneres** en una oficina. Revisa nombre de oficina, cupos y opciones de sistema operativo.
2. Elige **Linux / macOS** y pulsa **Generar y descargar**.
3. En el escáner nuevo pulsa **Desactivar** y cancela; luego repite y confirma.

**Resultado esperado:** se descarga un ZIP con nombre de oficina y plataforma que contiene `start-agent.sh` (Windows: `start-agent.cmd`/`start-agent.ps1`). Cada descarga crea una credencial nueva y el escáner aparece en el resumen. Con la oficina en su límite, **Generar y descargar** está bloqueado y el resumen explica el cupo. Cancelar la desactivación lo deja vigente; confirmar lo muestra revocado/desactivado y actualiza los cupos. No se ofrece reactivar esa credencial.

### Reglas del sistema

- **AGENT-02 — Canal del escáner:** la ingesta de reportes es idempotente, rechaza JSON inválido, tokens inválidos o revocados e ID discordante, y procesa heartbeat y catálogo de vendors. Un análisis real de un escáner instalado aparece en Escaneos e Inventario y actualiza la conectividad.
- Un escáner revocado libera su cupo para un escáner nuevo.

## Escaneos e instantáneas

### SNAP-01 — Generar, renombrar y comprobar una instantánea

**Actor:** OrgAdmin (también PlatformAdmin visitando una organización activa).

**Precondiciones:** una oficina activa concreta seleccionada en la barra superior.

1. El actor va a **Inventario → Instantáneas** y pulsa **Generar instantánea**.
2. Abre la fila nueva y revisa fecha, oficina, cantidades, pestañas **Red / Activos manuales** y puntaje/cobertura de ese momento.
3. Desde el lápiz del título escribe `Inventario antes de la revisión` y guarda.
4. Abre el lápiz, escribe otro nombre y cancela con **X** o **Escape**. Escribe un carácter inválido (`<`) y lo corrige. Deja el nombre vacío y guarda.
5. Cambia el alias de un activo en el inventario actual y vuelve a abrir la misma instantánea.
6. En el historial filtra **Origen → Manual** y luego **Todos los orígenes**.

**Resultado esperado:** aparece una notificación de éxito y una fila nueva que persiste. Con «Todas las oficinas» la generación está bloqueada con una explicación: cada instantánea corresponde a una oficina. «No evaluable» es un resultado válido cuando faltan datos. El nombre guardado persiste sin cambiar fecha ni contenido; cancelar mantiene el anterior; el carácter inválido muestra el error debajo del campo; el nombre vacío vuelve al título predeterminado. La instantánea conserva el alias, las cantidades, la fecha y el riesgo del momento en que se tomó. La instantánea nueva figura con origen manual. Los nombres largos se muestran en una línea con elipsis y tooltip del texto completo al pasar el cursor o enfocar.

### SCAN-01 — Consultar, renombrar y entender un informe de escaneo

**Actor:** OrgAdmin; Viewer para la lectura restringida.

**Precondiciones:** oficina con informes de escaneo.

1. El OrgAdmin va a **Inventario → Informes de escaneo**, filtra por **Estado**, vuelve a **Todos los estados** y cambia de oficina con el selector superior.
2. Abre un informe y revisa fecha/ventana, oficina, estado, red, equipos detectados y la explicación de ejecución/cobertura.
3. Abre **Aceptados** y **Rechazados**.
4. Cambia el nombre con el lápiz y guarda; también cancela un cambio y corrige un carácter inválido.
5. Un Viewer abre un informe de su oficina.
6. El OrgAdmin abre un informe archivado por retención.

**Resultado esperado:** el listado acompaña la oficina seleccionada; no hay filtro de fecha. Un informe parcial explica sus limitaciones. Los rechazos muestran su motivo; sin rechazos aparece un estado vacío claro. El nombre persiste en listado y detalle sin modificar fecha, estado ni cantidades; un nombre vacío vuelve al título predeterminado. El Viewer lee el resumen permitido, sin renombrado ni contenido técnico restringido. Un informe archivado conserva fecha, red, resumen y cobertura y explica que la lista original ya no está disponible por retención.

### Reglas del sistema

- Las instantáneas solo se generan para una oficina activa. StaffPortal sin contexto de organización no puede generarlas; en organizaciones desactivadas solo se consulta la historia.
- La evidencia cruda de escaneo se retiene 30 días; luego se conserva el resumen.

## Revisión de seguridad y riesgo

### REVIEW-01 — Responder una revisión y comenzar un nuevo ciclo

**Actor:** OrgAdmin; Viewer responsable para revisiones de activos propios.

**Precondiciones:** revisión abierta de organización, oficina o activo. Las categorías manuales evaluables son computadora, licencia de software, activo de nube y repositorio de información.

1. El OrgAdmin abre **Revisión de seguridad** y elige una revisión abierta.
2. Responde algunas preguntas y pulsa **Guardar borrador**.
3. Pulsa **Completar revisión** con preguntas sin responder y vuelve con **Seguir revisando**.
4. Responde el resto con **Sí / No / No lo sé**; si elige **No aplica**, escribe la justificación.
5. Abre la confirmación, revisa los conteos, cancela, vuelve y confirma.
6. En el último ciclo completado pulsa **Iniciar nuevo ciclo de revisión**; usa **Ver historial** y **Volver a la última**.

**Resultado esperado:** el borrador persiste sin marcar el ciclo como completado. Con preguntas pendientes, el modal informa cuántas faltan y bloquea la confirmación. **No aplica** exige justificación, con el error debajo del campo. Cancelar la confirmación deja la revisión abierta; confirmar la deja completada con sus respuestas. El nuevo ciclo copia las respuestas compatibles sin sobrescribir el anterior, y el historial permite navegar entre ciclos. El Viewer responsable puede guardar y completar la revisión de su activo; las revisiones ajenas o de organización/oficina no le permiten responder.

### REVIEW-02 — Responder varias revisiones

**Actor:** OrgAdmin (OfficeManager y Viewer con los alcances que ofrece su UI).

**Precondiciones:** al menos dos revisiones pendientes compatibles.

1. El actor abre **Responder varias**, elige un tipo de activo y **Agrupar por** responsable, oficina o toda la organización.
2. Revisa la previsualización: candidatas compatibles, completadas que se conservan e incompatibles.
3. Selecciona solo las revisiones elegidas, usando la búsqueda si hace falta.
4. Pulsa **Responder cuestionario**; puede volver con **Cambiar alcance** para corregir la selección.
5. Responde, cancela una vez la confirmación, vuelve y confirma.

**Resultado esperado:** el contador de selección coincide con lo elegido y la búsqueda ignora tildes. Las revisiones seleccionadas quedan completadas con las respuestas aplicadas; las desmarcadas y los ciclos ya cerrados conservan su estado. Si la selección quedó obsoleta, el lote se rechaza sin aplicarse parcialmente.

### REVIEW-03 — Evidencia heredada y exclusiones

**Actor:** OrgAdmin.

1. El OrgAdmin abre una revisión con evidencia heredada.
2. Abre una revisión con evidencia vencida.
3. Abre el cuestionario de una computadora excluida de la evaluación.
4. Vuelve a incluirla desde el formulario del activo y guarda.

**Resultado esperado:** la evidencia heredada indica su origen o respuesta anterior y permite responder localmente; un cambio local persiste sin editar la revisión de origen. La evidencia vencida se presenta como vencida o sin información vigente, no como respuesta conforme. El activo excluido sigue en Inventario y su cuestionario explica o impide la respuesta según la exclusión. Al reincluirlo, el estado de revisión se actualiza.

### RISK-01 — Leer el riesgo y observar cambios

**Actor:** OrgAdmin; OfficeManager con dos oficinas asignadas; Viewer.

1. El OrgAdmin abre **Puntaje de riesgo** con «Todas las oficinas» y luego selecciona una oficina.
2. El OfficeManager elige «Todas las oficinas» y revisa Puntaje de riesgo, Panel general y Revisiones.
3. El actor revisa puntaje, cobertura, confiabilidad y avisos.
4. Completa una revisión y vuelve al riesgo.
5. Usa paginación y ordenamiento de las filas.
6. Pulsa un activo en las alertas.

**Resultado esperado:**

- OrgAdmin con «Todas las oficinas» ve la evaluación global persistida de la organización, con la aclaración de que es un cálculo conjunto sobre activos y controles, no un promedio de porcentajes de oficinas. Al elegir una oficina cambia el alcance.
- OfficeManager con «Todas las oficinas» ve un consolidado de sus oficinas activas asignadas, sin que se le exija elegir una oficina, con la misma explicación en Puntaje de riesgo, Panel general y Revisiones. El consolidado es de solo lectura y no crea una evaluación histórica. Viewer consulta el riesgo por oficina concreta.
- La cobertura indica cuánta evidencia hay. Sin datos suficientes se muestra ausencia o resultado preliminar, nunca 0 % como si todo estuviera controlado.
- Mientras el riesgo se recalcula aparece un único aviso «Actualizando riesgo» que distingue sin evaluación, cálculo en espera/en curso y cálculo fallido, y no menciona un puntaje anterior si no existe. OfficeManager comparte el estado de recálculo de la organización con el OrgAdmin; al terminar, su consolidado se recalcula.
- Para el OfficeManager, paginar u ordenar responde sin demoras porque el consolidado se reutiliza mientras la evidencia no cambie.
- Si el riesgo no puede obtenerse, se informa el error sin mostrar contadores en 0.
- El cálculo incluye controles evaluables no conformes o parcialmente efectivos según su peso y eficacia; «No lo sé» o información no evaluable no equivale a cumplimiento ni añade riesgo por sí sola.
- Pulsar un activo en las alertas abre Revisión de seguridad → Dispositivos filtrada por ese activo (incluidos los manuales), conservando la organización visitada; «Ver todos los dispositivos» quita el filtro. En Dispositivos, el nombre de cada dispositivo enlaza a su detalle de inventario.

### Reglas del sistema

- **REVIEW-04 — Procesos programados:** tareas programadas internas aplican aging, retención de evidencia y expiración de revisiones y exclusiones de forma idempotente. Al vencer una exclusión el activo vuelve a incluirse automáticamente.
- La vigencia de la evidencia depende de la política de revisión (plazos de 365 y 180 días); el cuestionario y el motor de riesgo tratan igual la evidencia vencida.

## Tareas

### TASK-01 — Crear, asignar, ejecutar y cerrar

#### A. Crear y encontrar tareas

**Actor:** OrgAdmin.

1. El OrgAdmin abre **Tareas → Nueva tarea** y crea una tarea para una oficina con asignación **Pool abierto**, título y prioridad.
2. Crea otra para esa oficina con asignación **Rol** y otra con **Persona**. Crea una para **Toda la organización** y otra para dos oficinas.
3. Crea una con inicio futuro y vencimiento posterior.
4. Busca los títulos en **Todas**, aplica filtros de estado y prioridad, cambia la oficina superior y limpia los filtros.

**Resultado esperado:**

- Los valores persisten al reabrir. Las fechas se presentan como DD-MM-AAAA, con calendario en español y semana desde lunes.
- Elegir varias oficinas genera una tarea independiente por oficina, no una tarea global.
- El selector de destinatarios ofrece solo personas o roles con cobertura sobre la oficina; explica carga, falta de alcance y ausencia de candidatos, y ante un error de consulta ofrece Reintentar.
- La tarea con inicio futuro figura como **Planificada** y no se ofrece para ejecución inmediata.
- Las tareas de **Toda la organización** se incluyen al filtrar por cualquier oficina autorizada.
- Si la consulta del listado falla, se muestra un error con Reintentar en lugar de una lista vacía.
- El detalle muestra alcance («Global» / «Por oficina»), oficina, tipo de asignación, rol o persona destinataria y, si corresponde, quién la reclamó.

#### B. Reclamar, liberar y completar

**Actor:** Viewer de la oficina; personas destinatarias por rol o directamente.

1. El Viewer abre **Pool disponible** y encuentra la tarea abierta (filtro **Ahora** si corresponde).
2. Pulsa **Reclamar** y la revisa en **Mis tareas**.
3. Pulsa **Liberar tarea**; la vuelve a reclamar y la completa desde la ficha.
4. La busca con estado **Completada** y abre **Actividad**.
5. Una persona del rol destinatario reclama la tarea asignada a ese rol; la persona destinataria revisa la asignada directamente.

**Resultado esperado:** al reclamar, la tarea queda **En progreso** y la ficha identifica quién la tomó; al liberar, vuelve a estar disponible. Los filtros iniciales de Mis tareas excluyen las completadas. Actividad distingue reclamo, liberación y cierre con sus actores. El Viewer no ve botones administrativos. Las tareas globales asignadas a una persona aparecen en su Mis tareas con su oficina seleccionada.

#### C. Administrar tareas

**Actor:** OrgAdmin; OfficeManager dentro de su oficina.

1. El actor abre una tarea pendiente, edita título y prioridad y guarda. La edición también está disponible como «Editar tarea» en la tabla, con el mismo formulario.
2. La reasigna a otra persona elegible desde el diálogo de reasignación.
3. Cancela otra tarea indicando un motivo; antes, abre y cierra el diálogo sin confirmar.
4. Archiva una tarea completada o cancelada.
5. Elimina una tarea desde el listado o el detalle: cancela el modal y luego confirma sobre otra tarea.
6. Sobre una tarea reclamada por otra persona, el OrgAdmin usa **Completar como administrador** e indica un motivo.

**Resultado esperado:**

- Los cambios persisten tras recargar.
- El diálogo de reasignación se abre con el tipo y destinatario actuales; al reabrirlo descarta los cambios locales y solo se cierra tras guardar. Durante el envío bloquea cambios y cierre; ante error conserva la selección para reintentar. Las ayudas de los campos van debajo del input.
- La persona destinataria encuentra la tarea reasignada en Mis tareas. Si la tarea estaba reclamada, Actividad muestra un único paso «Reasignada» con la nota «Se liberó el reclamo anterior.»; una reasignación de tarea pendiente no muestra esa nota.
- Cerrar el diálogo de una acción sin confirmar no modifica la tarea. La cancelada muestra estado y motivo en Actividad.
- La archivada sale de **Sin archivar** y reaparece al incluir archivadas, con su estado final y su actividad.
- Eliminar usa un modal propio de la aplicación, no un diálogo nativo, con el nombre de la tarea, la consecuencia y los botones «Cancelar»/«Eliminar tarea». Cancelar conserva la tarea; confirmar la elimina. Desde el detalle vuelve al listado conservando el contexto de organización visitada.
- **Completar como administrador** cierra la tarea y registra el motivo en Actividad. OfficeManager no tiene cierre forzado administrativo.

### TASK-02 — Validaciones y referencias

#### A. Errores de formulario

**Actor:** OrgAdmin u OfficeManager.

1. El actor intenta crear una tarea con título vacío, solo espacios y luego con menos de tres caracteres.
2. Elige un vencimiento anterior al inicio e intenta guardar.
3. Elige asignación **Persona** o **Rol** sin destinatario, o un tipo de entidad relacionada sin entidad, e intenta guardar.
4. Corrige todo y guarda.

**Resultado esperado:** título vacío o con solo espacios muestra «Escribe un título.»; con uno o dos caracteres, «Escribe al menos 3 caracteres.». Los errores aparecen debajo de su campo y se actualizan al corregir, sin cerrar el formulario ni perder valores. La tarea corregida se crea una sola vez con sus valores.

#### B. Entidades relacionadas

**Actor:** OrgAdmin u OfficeManager.

1. Desde un activo usa **Crear tarea** (en activos de red vigentes, «Crear tarea relacionada»); crea la tarea, abre su ficha y sigue el enlace de la entidad.
2. Repite desde una revisión, una instantánea o un escaneo, y con una referencia a una oficina.
3. Abre tareas con referencias antiguas: activo retirado, ciclo reemplazado o evaluación histórica.

**Resultado esperado:** la entidad queda identificada y fija en el formulario, y el alcance se deriva de ella. El enlace abre la entidad correcta. Las referencias se muestran con nombres legibles, sin UUID: las instantáneas e informes usan su nombre o, si no tienen, la fecha, con el sufijo de la oficina. En el selector general, la opción se llama «Evaluación de riesgo», con la ayuda «Vincula la tarea al resultado guardado que motivó su creación»; «Resultado de un control» no se ofrece, aunque las tareas existentes con esa referencia conservan su etiqueta y enlace. En el consolidado de oficinas asignadas, quien puede crear tareas ve la indicación de seleccionar una oficina para vincularla a su evaluación; una evaluación guardada ofrece Crear tarea.

### Reglas del sistema

- Cada formulario de creación de tareas envía una clave de operación que repite en sus reintentos: si la respuesta se pierde, el reintento devuelve las tareas ya creadas sin duplicarlas. La misma clave con otros datos o de otra persona se rechaza sin escribir.
- Los comandos repetidos sobre una tarea (reclamar, completar, etc.) se rechazan sin repetir efectos.
- Al desactivar una persona o retirarle una oficina, sus tareas reclamadas allí vuelven a pendientes.

## Mensajes de StaffPortal

### MSG-01 — Crear y entregar mensajes

#### A. Crear y previsualizar

**Actor:** PlatformAdmin.

1. El PlatformAdmin abre **Mensajes del portal → Nuevo mensaje**, elige tipo **Aviso**, escribe título y descripción y abre **Vista previa**.
2. En **Audiencia** elige **Organizaciones específicas**, una organización y todas sus personas. En **Enlace y vigencia** deja **Mensaje activo** apagado y pulsa **Crear mensaje**.
3. Reabre el mensaje.
4. Intenta guardar con título vacío y lo corrige. Aplica una plantilla sobre contenido ya modificado.

**Resultado esperado:** el mensaje conserva contenido, audiencia y fecha, y figura **Inactivo** en el listado. El título vacío muestra «Escribe un título.» junto al campo y conserva los demás valores. Aplicar una plantilla sobre contenido modificado pide confirmación antes de reemplazarlo. No hay un paso «Publicar»: **Mensaje activo** y la vigencia determinan la entrega.

#### B. Destinatarios y entrega

**Actor:** PlatformAdmin; miembros de organización.

1. El PlatformAdmin activa el aviso.
2. Un miembro de la organización destinataria abre el Panel general y su bandeja de mensajes.
3. El PlatformAdmin crea un aviso para **Personas con roles específicos** (por ejemplo, Viewer), otro para **Personas específicas** y otro para **Todas las organizaciones**.

**Resultado esperado:** el aviso aparece en el Panel general y en la bandeja del miembro destinatario y no llega a cuentas de otras organizaciones. Cada audiencia llega solo a los roles, personas u organizaciones elegidos. La visita de un PlatformAdmin a una organización no equivale a la bandeja personal de un miembro.

#### C. Leer, posponer y navegar

**Actor:** miembro de organización destinatario.

1. En un aviso, pulsa **Entendido**.
2. Recibe un mensaje **Accionable** con texto de acción y una **Sección del portal** accesible, y pulsa la acción.
3. En otro accionable elige **Recordarme más tarde** o cierra con X.
4. En otro elige **No gracias**.
5. Sigue el enlace de un mensaje vinculado a una entidad accesible.

**Resultado esperado:** tras **Entendido**, el aviso no vuelve a abrirse automáticamente, aun si se pulsa enseguida de abrirlo y se recarga, y figura **Leído** en la bandeja. La acción del accionable abre su destino. **Recordarme más tarde** o X cierran sin registrar una negativa y el mensaje sigue en la bandeja, sin volver a abrirse en la misma sesión. **No gracias** lo deja respondido y deja de abrirse automáticamente. Con varios mensajes, la cola avanza sin repetir el actual y los contadores son coherentes. El enlace a entidad abre esa entidad. La bandeja identifica los no leídos con un punto y el título destacado, y muestra un contador textual. Abrir desde la bandeja un mensaje ya visto no lo presenta como nuevo.

#### D. Editar, volver a mostrar y desactivar

**Actor:** PlatformAdmin.

1. El PlatformAdmin busca y filtra en el listado de mensajes.
2. Edita un aviso y guarda.
3. En un mensaje vigente ya respondido pulsa **Volver a mostrar a todos**, cancela la confirmación y luego confirma.
4. Desactiva el mensaje.
5. Abre un mensaje vencido.

**Resultado esperado:**

- El listado ocupa el ancho completo sin desplazamiento horizontal y agrupa contenido, audiencia y vigencia. La búsqueda por título/descripción ignora mayúsculas y tildes y se combina con selección múltiple de tipo y estado; muestra cantidad visible/total y ofrece Limpiar filtros. Sin coincidencias explica la causa. Se puede ordenar por antigüedad, título y vencimiento.
- La vista previa y la bandeja reflejan el texto editado.
- Cancelar el reenvío no provoca una nueva entrega; confirmarlo permite que los destinatarios lo reciban de nuevo aunque hubieran respondido la versión anterior.
- El mensaje desactivado deja de entregarse y de ofrecerse entre los vigentes.
- En un mensaje vencido, el reenvío no está disponible y se explica por qué.
- OrgAdmin, OfficeManager y Viewer no tienen administración de mensajes.

### Reglas del sistema

- El vencimiento de un mensaje es al final del día local de la fecha elegida.
- Los mensajes leídos se retienen 30 días.

## StaffPortal, dashboard y organización desactivada

### PLATFORM-01 — Resumen, organizaciones y visita

**Actor:** PlatformAdmin; OrgAdmin.

1. El PlatformAdmin abre el panel de StaffPortal: organizaciones totales/activas, oficinas activas, escáneres activos/conectados e incidentes pendientes.
2. Abre **Organizaciones**, busca una organización, filtra por estado y limpia los filtros.
3. Usa **Abrir portal de la organización**, revisa el contexto y vuelve con **Volver al portal de la plataforma**; visita otra organización.
4. Un OrgAdmin entra a su portal.

**Resultado esperado:** las métricas distinguen total de activas y conectado de instalado. La organización se encuentra sin perder acceso a sus acciones. La visita muestra el nombre, las oficinas y la administración de la organización visitada. El OrgAdmin no tiene administración global ni métricas de StaffPortal.

### PLATFORM-02 — Editar una organización

**Actor:** PlatformAdmin en StaffPortal, sin visitar la organización.

**Precondiciones:** organización activa.

1. En **Organizaciones**, el PlatformAdmin abre **Editar organización** sobre una organización activa.
2. Cambia el nombre, el rubro y, si el rubro es «Otro», su explicación opcional.
3. Guarda, recarga y vuelve a abrir la edición.
4. Cambia el rubro de «Otro» a uno del catálogo y guarda.

**Resultado esperado:** los datos se guardan juntos y se ven al recargar. Cancelar no guarda cambios. Pasar de «Otro» a un rubro del catálogo limpia la explicación. La operación no cambia el plan. «Añadir OrgAdmin» está en «Más acciones». No se puede editar desde el contexto de visita ni como usuario de la organización.

### ORG-STATUS-01 — Desactivar y reactivar una organización

**Actor:** PlatformAdmin; miembro de la organización con sesión abierta.

**Precondiciones:** organización activa con oficinas, personas y, opcionalmente, escáneres, activos, una tarea abierta y una revisión abierta.

#### A. Impacto y cancelación

1. El PlatformAdmin abre **Desactivar organización** desde Organizaciones. Revisa los conteos de oficinas, personas, escáneres, activos y tareas, y la explicación del cierre de revisiones.
2. Escribe un nombre incorrecto o lo deja vacío.
3. Pulsa **Cancelar**.

**Resultado esperado:** con nombre incorrecto o vacío la confirmación queda bloqueada. Cancelar deja la organización activa y sin cambios.

#### B. Confirmar y comprobar el acceso

1. El PlatformAdmin reabre el impacto, escribe el nombre exacto y confirma.
2. El miembro con sesión abierta recarga o navega a una pantalla protegida, y luego intenta iniciar sesión.
3. El PlatformAdmin visita la organización inactiva.

**Resultado esperado:** la organización queda **Inactiva** en StaffPortal. El miembro pierde el acceso y no puede volver a iniciar sesión mientras siga inactiva. En la visita, el PlatformAdmin ve oficinas y personas inactivas, escáneres revocados, activos retirados, tareas canceladas y revisiones cerradas o reemplazadas (puede ser necesario incluir estados inactivos o terminales en los filtros). La baja no borra históricos ni cancela las funcionalidades del plan. Durante la visita, la organización desactivada admite lecturas históricas pero rechaza escrituras.

#### C. Reactivar

1. El PlatformAdmin abre **Reactivar organización**. El aviso indica la persona administradora y la oficina que se reactivarán, elegidas por el sistema.
2. Confirma.
3. El administrador indicado inicia sesión.
4. El PlatformAdmin vuelve al panel de StaffPortal.

**Resultado esperado:** la organización vuelve a estar activa y cuenta como activa en el panel. El administrador indicado entra y accede a la oficina reactivada; se generan las revisiones nuevas que correspondan. Las demás personas y oficinas siguen inactivas, los escáneres revocados, los activos retirados y las tareas canceladas no se restauran, y las sesiones invalidadas no se recuperan. Tras reactivar, la organización vuelve a admitir edición.

## Aislamiento entre organizaciones y oficinas

### Reglas del sistema

- Toda lectura y mutación se acota a la organización y las oficinas del actor, aunque el rol permita la acción en abstracto. Sustituir IDs en URL, query o body devuelve vacío, 404 o 403 según el endpoint, sin revelar datos ni modificar nada.
- Al abrir un enlace de tarea, revisión o activo fuera del alcance: un 404 explica que el enlace puede no estar disponible o que no se tiene acceso, sin confirmar la existencia ni revelar organización u oficina; un 403 indica que no se tiene permiso. Ambos ofrecen volver al listado.
- Ante fallos de conexión o del servidor, la vista ofrece «Reintentar» y se recupera cuando la consulta vuelve a funcionar.

## Errores generales y recuperación

### ERROR-01 — Evitar envíos repetidos

**Actor:** cualquier usuario con permiso para crear o editar tareas.

1. El usuario abre «Nueva tarea» (o «Editar tarea» desde la tabla o el detalle) y completa los campos.
2. Hace doble clic rápido en «Crear tarea» y sigue haciendo clic después del aviso de éxito.
3. Vuelve al listado y recarga.

**Resultado esperado:** el botón indica la operación en curso y no admite nuevos envíos; el bloqueo se mantiene tras el éxito, incluida la animación de cierre del modal, y solo un fallo permite reintentar desde ese formulario con los valores conservados. Se crea o guarda una sola vez, con un solo aviso de éxito. Aplica a creación global, por oficinas y desde una entidad relacionada.

### ERROR-02 — Pérdida de conexión y recuperación

**Actor:** cualquier usuario.

1. El usuario completa el formulario de una tarea.
2. Se pierde la conexión e intenta guardar.
3. Se restaura la conexión y vuelve a guardar.
4. Sin conexión, recarga el Panel general y Revisión de seguridad.

**Resultado esperado:** sin conexión se informa el fallo, se conservan los campos y el botón deja de mostrar carga; no se informa éxito. Al reconectar se guarda sin volver a escribir los datos. En Panel general y Revisión de seguridad, la tarjeta de riesgo muestra «No se pudo cargar el riesgo. Intenta de nuevo en unos minutos.», sin mostrar «0 controles requieren atención», «0 equipos sin identificar» ni cobertura de 0 %. Al restaurar la conexión, los datos vuelven solos en la siguiente consulta automática.

### ERROR-03 — Datos modificados por otra persona

**Actor:** dos personas autorizadas sobre la misma tarea; OrgAdmin y responsable de oficina para la variante administrativa.

1. Ambas abren la misma tarea disponible en contextos independientes.
2. La primera la reclama.
3. La segunda intenta reclamarla.

**Resultado esperado:** si la segunda vista ya se actualizó, no ofrece reclamar; si quedó desactualizada, explica el rechazo y permite actualizar. Ambas terminan mostrando la misma persona como responsable del reclamo.

**Variante — finalización administrativa:**

1. Una tarea reclamada por un responsable de oficina está abierta en dos contextos.
2. El OrgAdmin la completa como administrador, indicando un motivo.
3. Desde su vista anterior, el responsable intenta completarla o liberarla, incluso con clics repetidos.

**Resultado esperado:** hay un solo envío en curso y un solo aviso: «La tarea ya fue completada por un administrador». Tras el rechazo, detalle y listado se actualizan y desaparecen las acciones que ya no corresponden. Este conflicto se distingue del de una tarea en curso reclamada por otra persona. Con una cancelación administrativa se informa el estado real. Una persona ajena a la oficina recibe 404 sin conocer el estado de la tarea.

### ERROR-04 — Sesión cerrada o acceso revocado

**Actor:** cualquier usuario.

1. El usuario abre el portal en dos pestañas del mismo navegador.
2. Cierra sesión en una; desde la otra navega a una pantalla protegida o intenta guardar un cambio.
3. Vuelve a iniciar sesión.

**Resultado esperado:** se solicita iniciar sesión y no se informa un guardado exitoso; la aplicación no queda cargando indefinidamente. Tras el nuevo login se puede continuar. Una vista ya renderizada no tiene por qué desaparecer sin interacción. Los casos de cuenta desactivada y organización inactiva siguen las mismas reglas (USER-06, ORG-STATUS-01).

### Reglas del sistema

- Los errores de datos se muestran debajo del campo correspondiente, sin duplicarse en alertas generales. Al enviar se marcan todos los campos inválidos y cada mensaje se actualiza al corregirlo. Las notificaciones generales quedan para errores sin campo asociado (red, permisos, cuotas).
- Los mensajes de campo son instrucciones breves con punto final: «Escribe un alias.», «Escribe un título.», «Selecciona un responsable.», «Selecciona una oficina.»; sin mensaje específico, «Completa este campo.».
- Las notificaciones tienen un título que identifica la acción y, opcionalmente, una descripción con la causa o el siguiente paso, sin claves internas.
- En los modales, los campos de una misma fila se alinean, las ayudas quedan debajo del input, todo campo obligatorio muestra asterisco (también si aparece condicionalmente) y el pie de acciones permanece visible mientras se desplaza el contenido.
- No se usan diálogos nativos del navegador (`alert`, `confirm`, `prompt`); las confirmaciones son modales de la aplicación.
- Las operaciones compuestas son atómicas: un rechazo o fallo no deja estado parcialmente aplicado y el cliente puede reintentar después de corregir el problema.
