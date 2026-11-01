# Sesión, autenticación y control de acceso

Guía transversal: cómo se resuelve la identidad de cada request, cómo esa identidad se convierte en un contexto de organización (`TenantContext`) y cómo se decide qué puede hacer cada actor. Dirigida a quien mantiene o extiende cualquier endpoint, colección o pantalla del portal.

Verificado contra el código el 2026-10-31. Si algo de este documento contradice el código, gana el código: corregir el documento.

Los documentos por feature (`task-api.md`, `members-api.md`, `offices-api.md`, `organization-settings-api.md`, `organizations-platform-api.md`, `dashboard-api.md`, entre otros) citan este documento para todo lo que es común: 401, 403, `organization_context_required`, matriz de permisos y alcance.

## 1. Capas y archivos

| Capa | Archivo | Responsabilidad |
|---|---|---|
| Autenticación nativa | `collections/Users/index.ts`, `collections/Admins/index.ts` | Colecciones `auth` de Payload: cookie, JWT, sesiones, bloqueo por intentos. |
| Sesiones de cuenta | `access/auth/account-sessions.ts` | Hooks que serializan login, refresh, logout y actualización de una cuenta, y revocan sesiones al desactivarla. |
| | `access/auth/rejectInactiveLogin.ts` | Rechaza el login de una cuenta con `status` distinto de `active`. |
| | `patches/payload@3.86.0.patch`, `patches/@payloadcms__drizzle@3.86.0.patch` | Parches a Payload y a su adaptador (§3.5). |
| Identidad (capa 1) | `access/tenant/identityProvider.ts` | `payloadNativeIdentityProvider`: traduce `req.user` a `{ externalId, collection }`. |
| Contexto (capa 2) | `access/tenant/resolveTenantContext.ts` | `resolveTenantContext`, `getTenantContext`, `TenantContext`. |
| | `access/tenant/assertOrganizationMatches.ts`, `officeQueryError.ts`, `assertOwnerCoversOffice.ts` | Verificaciones de pertenencia compartidas. |
| RBAC | `access/rbac/permissions.ts` | Matriz estática, `canDo`, `hasOrgWideScope`. |
| | `access/rbac/orgScopedAccess.ts` | Filtro de fila por organización y oficina para el `access` de las colecciones. |
| | `access/rbac/member-status.ts` | Quién puede cambiar estado y oficinas de un miembro (regla de rango). |
| | `access/rbac/risk-scope.ts`, `technical-evidence.ts` | Alcance del consolidado de riesgo de un Manager y acceso a evidencia técnica. |
| Canal de agentes | `access/middleware/resolveAgentAuth.ts` | Identidad del scanner (token por agente). Es otro canal; no produce `TenantContext` (§3.6). |
| Endpoints | `endpoints/session.ts` | `GET /v1/session`. |
| | `endpoints/myProfile.ts` | `GET` y `PATCH /v1/me/profile`. |
| Gate de Next | `middleware.ts` | Redirige a `/login` si no existe la cookie `payload-token`. |
| Cliente | `lib/http-client.ts`, `lib/session.ts`, `lib/use-session.ts`, `lib/providers.tsx` | Transporte, refresco, almacén de sesión del cliente. |
| | `lib/organization-request-context.ts`, `lib/platform-origin.ts` | `asOrganization` en las requests; origen canónico. |
| | `modules/auth/service.ts`, `modules/auth/hooks/use-login.ts`, `use-tenant-context.ts` | Login y contexto de organización en el cliente. |
| | `lib/user-facing-error.ts`, `lib/notify-error.ts` | Traducción de errores a texto. |
| Layouts | `app/(dashboard)/(protected)/layout.tsx`, `app/portal/(protected)/layout.tsx`, `app/portal/(protected)/administration/layout.tsx` | Compuertas del lado del cliente (§9). |

## 2. Modo de autenticación

El código usa la **autenticación nativa de Payload** en todos los entornos, y es una solución **temporal**: Auth0 no se usará (la dependencia `@auth0/nextjs-auth0` está instalada pero ningún archivo la importa). No hay rama que distinga producción de desarrollo en la resolución de identidad. `SYSTEM_PROMPT.md` §7 y varios comentarios del código describen un esquema con Auth0 y un fallback solo para desarrollo que no corresponde a lo implementado ni a lo previsto. `identityProvider.ts` aísla el mecanismo: cuando se defina el reemplazo, `payloadNativeIdentityProvider` es la única pieza que se sustituye.

Lo único que depende de `NODE_ENV` es:
- `auth.cookies.secure` en `Users` y `Admins`: `true` solo si `NODE_ENV === 'production'`.
- `platformOrigin()` (`lib/platform-origin.ts`): en producción exige `NEXT_PUBLIC_SITE_URL` y que sea un origen HTTPS canónico (sin credenciales, ruta, query ni hash); en desarrollo acepta además HTTP sobre `localhost`, `127.0.0.1` o `[::1]`, y por defecto usa `http://localhost:3001`.

Fail-closed: `resolveTenantContext` devuelve `null` sin identidad, y todos los puntos de entrada tratan `null` o `isActive = false` como no autenticado. No hay un camino alternativo cuando falta la sesión. En `payload.config.ts` no hay `admin.autoLogin`, de modo que la estrategia JWT de Payload no inventa un usuario cuando falta el token.

## 3. Autenticación: cuentas, cookie y sesiones

### 3.1 Dos colecciones de cuenta

| Colección | Quién | Campos relevantes |
|---|---|---|
| `users` | Personas de una organización | `name` (requerido), `status` (`active` \| `inactive`, por defecto `active`), `organization_membership` (solo lo escribe el hook `linkMembershipToUser`). |
| `admins` | Administradores de plataforma | `name`, `role` (relación a `roles`, solo roles con `is_platform_role`), `status`. |

Ambas tienen `create`, `read`, `update` y `delete` en `() => false` y `unlock` en `() => false`. Eso **no** bloquea los endpoints de autenticación de Payload (`/api/<colección>/login`, `logout`, `refresh-token`, `me`): son operaciones aparte del CRUD. Las cuentas solo se crean por provisión (seed y endpoints propios con `overrideAccess`). Ambas colecciones reemplazan `POST /first-register` por una respuesta 403.

Las dos colecciones tienen la misma configuración de `auth`:

| Opción | Valor |
|---|---|
| `tokenExpiration` | 3600 s (1 hora) |
| `removeTokenFromResponses` | `true`: el cuerpo del login no trae `token`; solo viaja en la cookie |
| `cookies` | `secure` según `NODE_ENV`; `sameSite: 'Lax'`; la cookie es `httpOnly` por defecto de Payload |
| `maxLoginAttempts` / `lockTime` | 5 intentos / 10 minutos (600 000 ms) |
| `useSessions` | `true` |

El nombre de la cookie sale de `cookiePrefix` global (no se configura en `payload.config.ts`, rige el valor por defecto): `payload-token`. Es **una sola cookie** para `users` y `admins`. Iniciar sesión con una cuenta en el mismo navegador reemplaza la sesión de la otra; no pueden coexistir.

### 3.2 Login

No hay un login unificado: son dos endpoints (`POST /api/admins/login`, `POST /api/users/login`). `useLogin` (`modules/auth/hooks/use-login.ts`) prueba primero `admins` y, si falla, `users`:
- Un 403 de `admins` corta la secuencia (cuenta de administrador desactivada); no se prueba `users`, para no ocultarla detrás de "contraseña incorrecta".
- Cualquier otro error de `admins` (el 401 esperado de un usuario común) pasa a `users`.
- La colección que responde bien decide `session.collection`.

`loginErrorMessage` traduce por status porque Payload responde en inglés y sin código propio: 403 es "cuenta desactivada", un mensaje que contiene `locked` es "cuenta bloqueada por demasiados intentos", 401 es "correo o contraseña incorrectos", y cualquier otro caso es un mensaje genérico. El 403 solo llega con la contraseña correcta, así que no revela qué correos existen. El servidor registra el `AuthenticationError` con nivel `info` (`loggingLevels` en `payload.config.ts`) porque el 401 de `admins` en un login de usuario es parte del flujo.

En `onSuccess`, `useLogin` vacía el caché de TanStack Query (`queryClient.clear()`), reinicia el estado de sesión de los mensajes del portal (`resetPortalMessageSessionState`), guarda la sesión en el almacén del cliente (`setSession`) y muestra una bienvenida. La pantalla de login (`app/(dashboard)/login/page.tsx`) redirige a `/` si la colección es `admins` y a `/portal` si es `users`.

### 3.3 Qué pasa dentro de Payload en cada request

Para toda request REST, incluidos los endpoints propios, Payload ejecuta sus estrategias de autenticación antes del handler y rellena `req.user`. El orden de extracción del token es el predeterminado `JWT`, `Bearer`, `cookie`:
- Header `Authorization: JWT <token>`.
- Header `Authorization: Bearer <token>`.
- Cookie `payload-token`.

La cookie solo se acepta si pasa la verificación de origen (§3.4). Luego Payload verifica la firma con `PAYLOAD_SECRET`, carga el documento de la colección indicada en el token y, como `useSessions` está activo, exige que el `sid` del token exista en `user.sessions`. Si no existe, `req.user` queda `null`. El handler nunca parsea cabeceras: `endpoints/session.ts` lo aclara en un comentario y no debe agregarse lectura redundante.

### 3.4 Origen y CSRF

`payload.config.ts` fija `serverURL`, `csrf` y `cors` en `[platformOrigin()]`. Para una request autenticada **solo por cookie**, la lógica de Payload (`extractJWT`) es:
- Con cabecera `Origin`: la cookie vale solo si `Origin` está en la lista `csrf`; si no, la request se trata como anónima (`req.user = null`, y el endpoint responde 401).
- Sin `Origin`: se mira `Sec-Fetch-Site`; se acepta `same-origin`, `same-site` o `none`, y se rechaza cualquier otro valor o su ausencia (clientes que no son navegadores).

Una cookie rechazada por origen no produce un error específico: el efecto es el mismo que no tener sesión. Los tokens por cabecera (`Bearer`, `JWT`) no pasan por esta verificación.

### 3.5 Sesiones de cuenta (`access/auth/account-sessions.ts`)

Los hooks se registran en ambas colecciones: `beforeOperation: guardSessionOperation`, `beforeLogin: prepareAccountLogin`, `beforeChange: revokeInactiveSessions`, `afterLogout: lockLogout`.

- **`lockAccount`**: toma `SELECT ... FOR UPDATE` sobre la fila de la cuenta dentro de la transacción de la request y devuelve el estado confirmado. Falla con error si la operación no tiene transacción. Sirve para que login, refresh, logout y escrituras de la cuenta se serialicen entre sí y no resuciten sesiones de una cuenta recién desactivada.
- **`guardSessionOperation`**: en un `update` de `users` o `admins` por id toma el lock. En `refresh` exige que `req.user` pertenezca a esa colección, toma el lock y rechaza con `Forbidden` (403) si la cuenta no existe, no está `active` o su `sid` ya no está en `sessions`.
- **`prepareAccountLogin`**: toma el lock, relee la cuenta y aplica `rejectInactiveLogin` sobre el estado confirmado (403 si `status !== 'active'`). Devuelve el usuario con el estado confirmado y `_strategy: 'local-jwt'`.
- **`lockLogout`**: toma el lock tras el logout.
- **`revokeInactiveSessions`** (`beforeChange`): si el `status` resultante es `inactive`, devuelve los datos con `sessions: []`. Ocurre tanto al pasar a `inactive` como en cualquier actualización posterior de una cuenta ya inactiva. Reactivar (`status: 'active'`) no restaura sesiones: hace falta un login nuevo.

Los parches existen por dos motivos verificables en su contenido. `payload@3.86.0.patch` mueve el hook `beforeLogin` de la operación `login` para que corra **antes** de firmar el token y de agregar la sesión, de modo que `prepareAccountLogin` use estado confirmado. `@payloadcms__drizzle@3.86.0.patch` cambia `beginTransaction` y `commitTransaction` para que un rollback solicitado no se confunda con un error y para que un error de `COMMIT` conserve su causa original. Ambos parches se registran en `package.json` (`patchedDependencies`); al actualizar Payload hay que reaplicarlos o reevaluarlos.

Cascadas hacia las cuentas:
- Desactivar una membresía (`is_active` de `true` a `false`) dispara `cascadeDeactivationToUser` (`collections/OrganizationMemberships/hooks/userLifecycleCascade.ts`), que pone `users.status = 'inactive'`; a su vez `revokeInactiveSessions` vacía las sesiones. Reactivar la membresía **no** reactiva el usuario.
- La desactivación de un administrador (`admins.status = 'inactive'`) revoca sus sesiones por el mismo hook.

### 3.6 Bloqueo, desbloqueo y expiración

- Cinco intentos fallidos bloquean la cuenta 10 minutos (`maxLoginAttempts`, `lockTime`). El desbloqueo es automático al vencer `lockUntil`.
- `unlock` es `() => false`: no hay desbloqueo manual, ni siquiera con sesión activa.
- El token dura una hora. La expiración de la sesión del lado servidor se extiende con cada refresh (Payload actualiza `expiresAt` de la sesión). Una cuenta con sesión vencida o revocada recibe 401 en los endpoints propios.

Canal de agentes: el scanner no usa estas colecciones. `resolveAgentAuth` valida un token `Bearer` estático por agente (prefijo de 8 caracteres, hash `bcrypt`, bloqueo propio por intentos) y entrega `{ agentId, officeId, organizationId }`. No pasa por `getTenantContext`. Se documenta en `scanner-api.md`.

### 3.7 Refresh y logout del cliente

`lib/http-client.ts` implementa el refresco reactivo; no hay timer. Ante un 401 en cualquier request, si hay sesión en el cliente y no es un reintento:
1. `refreshSession()` llama `POST /api/<collection>/refresh-token` con `credentials: 'include'`. La promesa es **única y compartida**: si varias requests reciben 401 a la vez, solo se hace un refresh.
2. Si el refresh responde bien, la request original se repite una vez (`isRetry`).
3. Si falla, se ejecuta `clearSession()`: el almacén queda en "sin sesión" y los layouts protegidos redirigen a `/login`.

El logout (`components/layout/SidebarProfile.tsx`) llama `POST /api/<collection>/logout`, vacía el caché de queries, ejecuta `clearSession()` y redirige a `/login`. No reinicia `resetPortalMessageSessionState` directamente; lo hace `PortalMessagesRuntime` al observar `session === null` (§ de `portal-messages-api.md`).

## 4. De un request a `TenantContext`

### 4.1 Forma

```ts
interface TenantContext {
  userId: string
  role: 'platform_admin' | 'org_admin' | 'org_viewer' | 'office_manager' | null
  roleRank?: number | null   // 1 = máxima autoridad; ausente para administradores de plataforma
  organizationId: string | null
  officeIds: string[]
  selectedOfficeId: string | null
  isPlatformAdmin: boolean
  isActive: boolean
}
```

### 4.2 Resolución (`getTenantContext`)

`getTenantContext(req)` es el único punto de composición. Se memoiza en `req.context.tenantContext` **por request**, nunca entre requests, para no repetir la query de membresía en cada `access` que Payload dispara dentro de la misma request.

1. `payloadNativeIdentityProvider.resolveIdentity(req)` devuelve `null` si no hay `req.user`; si lo hay, `{ externalId: String(req.user.id), collection: 'users' | 'admins' }`.
2. Se lee `?asOrganization=` de la URL de la request (`extractRequestedOrganizationId`; una URL no parseable da `null`).
3. `resolveTenantContext(identity, deps, requestedOrganizationId)` con las dependencias reales (`createPayloadTenantResolverDeps`, todas con `overrideAccess: true`).

Rama `admins` (administrador de plataforma):
- Lee el administrador y, en paralelo, comprueba que la organización pedida exista. Si el administrador no existe, devuelve `null`.
- Sin `asOrganization`: `role = 'platform_admin'`, `organizationId = null`, `officeIds = []`, `selectedOfficeId = null`.
- Con `asOrganization`: si la organización no existe lanza `TenantResolutionError` (no es un `null`; se propaga como excepción de la request). Si existe, `organizationId` es esa organización, `officeIds` son **todas** las oficinas de esa organización (activas o no; la query no filtra por `is_active`), `selectedOfficeId = officeIds[0] ?? null` y `role = 'org_admin'`.
- En ambos casos `isPlatformAdmin = true` e `isActive` refleja `admin.status === 'active'`. Un administrador inactivo **no** devuelve `null`: devuelve un contexto con `isActive: false`, y cada punto de entrada debe comprobarlo.

Rama `users`:
- Busca la membresía con `user = id` e `is_active = true` (`limit: 1`, `depth: 1` para poblar `role.slug` y `role.rank`). Sin membresía activa devuelve `null`. La resolución se rehace en cada request: un JWT válido deja de resolver contexto apenas la membresía se desactiva.
- `role = membership.role.slug`, `roleRank = membership.role.rank`, `organizationId` y `officeIds` salen de la membresía, `selectedOfficeId = officeIds[0] ?? null`, `isPlatformAdmin = false`.
- `asOrganization` se ignora por completo. Un usuario no puede escalar con ese parámetro (cubierto por prueba).
- La resolución filtra por `is_active`, no por `membership.status` (`onboarding` \| `active`); ese estado se usa en otras pantallas (por ejemplo, destinatarios de mensajes).
- Hay una membresía por usuario: `OrganizationMemberships.user` es `unique`.

Resumen de lo que el contexto significa para un administrador de plataforma "visitando": el `role` que ven el servidor y la matriz es `org_admin`; lo que lo distingue es `isPlatformAdmin = true`. Un comentario de `use-tenant-context.ts` dice que el rol "permanece `platform_admin`"; en el código del servidor no es así.

### 4.3 Cómo lo consumen los endpoints

Patrón común: `getTenantContext`, y luego `!ctx || !ctx.isActive` devuelve 401 `unauthenticated`. Después cada endpoint aplica sus reglas de rol y organización (§7). `asOrganization` lo agrega el cliente a toda request a `/api/` si está en la URL del portal (`organizationRequestPath`), sin pisar uno explícito. Lo lee el servidor desde la URL de **esa** request, no desde la pestaña.

### 4.4 Verificaciones de pertenencia

- **`assertOrganizationMatches(rowOrg, actorOrg, unrestricted)`**: si `unrestricted` no se cumple y `actorOrg` es nulo o distinto de `rowOrg`, lanza `OrganizationMismatchError` (`APIError`, 403, pública). `unrestricted` es un parámetro que decide quien llama; el uso previsto es un administrador de plataforma sin organización seleccionada. Verifica la organización de la fila directamente, sin depender de que `ctx.officeIds` ya esté acotado.
- **`officeQueryError(ctx, officeId)`**: con `office_id`, devuelve `office_forbidden` si no está en `ctx.officeIds`; sin él, devuelve `office_required` para roles sin alcance organizacional y `null` para los demás. Los endpoints convierten esos códigos en su respuesta.
- **`assertOwnerCoversOffice`**: para el `owner` de un activo exige membresía activa en la organización (si no, `OwnerOutOfScopeError`, 400) y, si el rol no tiene alcance organizacional y el activo tiene oficina, que el owner tenga esa oficina.

## 5. RBAC: matriz y alcance

La decisión de acceso tiene **dos capas independientes** que nunca se sustituyen:
1. **RBAC** (`canDo`): ¿puede este rol hacer esta acción sobre esta colección? Es una matriz estática en código; no lee la base de datos.
2. **Alcance de fila**: ¿qué filas puede tocar? Lo resuelve `orgScopedAccess` en colecciones, o la verificación explícita en dominio y endpoints (`assertTaskScope`, `officeIds`, etc.).

### 5.1 `canDo(role, colección, acción, organizationId)`

- Sin rol: `false`.
- `platform_admin` sin `organizationId` y con acción distinta de `read`: `false`.
- `platform_admin` con `organizationId`: se evalúa como `org_admin`.
- En otro caso, consulta la matriz.
- El parámetro `organizationId` no participa de la decisión más allá de lo anterior: no hay overrides por organización guardados en base (decisión del código; la firma lo reserva).

En la práctica el contexto de un administrador visitando ya trae `role = 'org_admin'` (§4.2), así que la rama `platform_admin` con organización de `canDo` cubre llamadas directas con ese slug. Un administrador sin organización solo pasa `read`.

### 5.2 Matriz (`access/rbac/permissions.ts`, `MATRIX`)

Tipos de `CollectionSlug` incluidos: `organizations`, `offices`, `agents`, `assets`, `non-network-assets`, `scan-reports`, `roles`, `job-runs`, `inventory-snapshots`, `assessment-instances`, `assessment-answers`, `compliance-results`, `risk-evaluations`, `risk-contributions`, `tasks`, `organization-memberships`. Una colección o acción que no figura bajo un rol está denegada. `platform_admin` aquí es su fila sin organización (con organización se usa la columna de `org_admin`).

| Colección | `platform_admin` | `org_admin` | `org_viewer` | `office_manager` |
|---|---|---|---|---|
| `organizations` | `read` | `read` | `read` | `read` |
| `offices` | `read` | `create`, `read`, `update` | `read` | `read` |
| `organization-memberships` | — | `create`, `read`, `update`, `change_status`, `edit_offices` | — | `create`, `change_status`, `edit_offices` |
| `agents` | `create`, `read`, `update` | `create`, `read`, `update` | — | — |
| `assets` | `read` | `read`, `update`, `delete` | `read` | `read`, `update` |
| `non-network-assets` | `read` | `create`, `read`, `update`, `delete` | `read` | `create`, `read`, `update` |
| `scan-reports` | `read`, `read_technical` | `read`, `read_technical`, `update` | `read` | `read`, `read_technical`, `update` |
| `roles` | `read` | — | — | — |
| `job-runs` | `read` | — | — | — |
| `inventory-snapshots` | `create`, `read` | `create`, `read`, `update` | `read` | `read`, `update` |
| `assessment-instances` | `read` | `read` | `read` | `read` |
| `assessment-answers` | `read` | `read` | `read` | `read` |
| `compliance-results` | `read` | `read` | `read` | `read` |
| `risk-evaluations` | `read` | `read` | `read` | `read`, `read_assigned` |
| `risk-contributions` | `read` | `read` | `read` | `read` |
| `tasks` | `read` | `create`, `read`, `edit`, `claim`, `release`, `assign`, `reassign`, `complete`, `cancel`, `archive`, `delete` | `read`, `claim`, `release`, `complete` | las mismas once que `org_admin` |

Observaciones sobre la matriz:
- `scan-reports.update` significa solo **renombrar** (`display_name`, `endpoints/evidenceNames.ts`); las colecciones de evidencia siguen inmutables. `inventory-snapshots.update` cumple el mismo rol para instantáneas.
- `assets.create` y `assets.delete` hacia usuarios no son rutas de creación manual: un activo de red solo lo crea la ingesta con `overrideAccess`. `org_admin` tiene `delete` en `assets` en la matriz; el borrado efectivo lo gobiernan los endpoints del activo (`assets-api.md`).
- `organization-memberships` tiene las colecciones cerradas al CRUD directo (`access` en `false`); la matriz gobierna el flujo delegado de `endpoints/orgMembers.ts` y `domain/organizations/*` (`members-api.md`). `office_manager` no tiene `read` ni `update` sobre membresías.
- `read_technical` gobierna campos de evidencia técnica (`access/rbac/technical-evidence.ts`): `readTechnicalEvidence` exige contexto activo, organización y `canDo(..., 'scan-reports', 'read_technical')`; `redactSnapshotForViewer` oculta la evidencia anidada para quien no lo tiene, salvo `overrideAccess`.
- `read_assigned` (solo `office_manager`) habilita el consolidado de riesgo de sus oficinas (`canReadAssignedOfficeRisk`, §5.5).
- La acción `assign` de `tasks` no es un endpoint: es la marca de "gestor" (`task-api.md`).
- No hay en la matriz acciones de `portal-messages`: esos endpoints no usan `canDo`, comprueban el tipo de identidad (`portal-messages-api.md`).

### 5.3 Alcance de fila: `hasOrgWideScope`

`hasOrgWideScope(role)` es `true` para `platform_admin` y `org_admin`. Es la única definición de "alcance organizacional" del repo; endpoints, `access` y frontend (a través de `orgWide` en la sesión) la consultan ahí. Los roles `office_manager` y `org_viewer` quedan limitados a `ctx.officeIds`.

`orgScopedAccess(colección, acción, scope)` combina `canDo` con un filtro de fila (`scopeWhere`):

| `scope.kind` | Filtro |
|---|---|
| `organization` (por defecto, campo `organization`) | `field = ctx.organizationId` |
| `self` | `id = ctx.organizationId` |
| `offices` | `field in ctx.officeIds` |
| `org_offices` | organización; y, si el rol no es org-wide, además `field in ctx.officeIds` (esto excluye también las filas `office = null`) |

Reglas del helper: sin contexto o con `isActive = false`, `false`. Si `canDo` niega, `false`. Un administrador de plataforma **sin** organización recibe `true` (sin filtro) y, con `asOrganization`, queda filtrado como cualquier rol. Cualquier otro actor sin organización recibe `false`, salvo el `scope` `offices`, que solo mira `officeIds`. `canDoAccess` aplica solo `canDo` sin filtro de fila (para `create`, donde no hay fila, y catálogos globales como `roles`); `globalReadAccess` es un alias del mismo comportamiento. No usar `canDoAccess` para `read`, `update` o `delete` de colecciones con dueño.

Los filtros de fila no son autorización por sí solos para recursos con relaciones: `assertOwnerCoversOffice` y `assertOrganizationMatches` verifican valores escritos en claves foráneas, que el filtro de fila no cubre.

### 5.4 Regla de rango y permisos sobre miembros

Roles (`collections/Roles`): `rank` numérico, `1 = máxima autoridad`. Valores que carga `scripts/seed-navigation.ts`: `platform_admin` 1, `org_admin` 1, `office_manager` 5, `org_viewer` 10. Los valores viven en base de datos, no en código.

Dos usos del rango:
1. **Asignación de rol** (`blockRankEscalation`, `assertNoRankEscalation`): un actor no puede asignar un rol con rango **menor** (más autoridad) que el suyo. Sin actor (provisión o `overrideAccess` sin sesión) o con un administrador de plataforma, no hay restricción. El mensaje del error del servidor es `rank_escalation` en el catálogo del cliente.
2. **Gestión de miembros** (`member-status.ts`, `canManageMember`):
   - El actor debe estar activo, tener organización, que sea la del miembro, y el permiso `change_status` o `edit_offices` en la matriz.
   - Con alcance organizacional (`org_admin`, y `platform_admin` visitando), se permite sin más condiciones. **El alcance organizacional no está limitado por rango**: un `org_admin` administra a otros `org_admin`. La razón que deja el código es que la administración de toda la organización no se acota por rango y que el invariante de "última persona administradora" lo hace cumplir el dominio (`assertNotLastActiveOrgAdmin`, hooks `blockLastActiveOrgAdmin*`), no la regla de rango.
   - Sin alcance organizacional (`office_manager`), el miembro objetivo debe tener un rango **mayor** (menos autoridad) que `ctx.roleRank` (`hasLessAuthority`), debe tener al menos una oficina asignada y todas deben estar dentro de `ctx.officeIds`. Un rango desconocido o no finito niega (fail-closed). En la práctica un Manager solo gestiona Viewers cubiertos por sus oficinas.
   - `canEditMemberOffices` exige además que el miembro esté activo, o que el actor tenga `update` sobre membresías (solo `org_admin`), para preparar el acceso de un miembro inactivo.

El rango solo está presente en el contexto de un usuario con membresía (`roleRank`); para un administrador de plataforma no existe.

### 5.5 Alcances específicos

- **`canReadAssignedOfficeRisk(ctx)`**: contexto activo, con organización, **sin** alcance organizacional y con `read_assigned`. Un Manager puede consolidar sus oficinas; nunca una evaluación de toda la organización.
- **Features de plan**: `organizationFeatures(req, organizationId)` lee `subscriptions` y completa con `normalizeFeatures` las claves ausentes en `true` (`asset_inventory`, `security_assessments`, `risk_score`, `tasks`). Los endpoints de tareas, riesgo y revisiones responden 403 `feature_disabled` si la clave es `false`. Los mensajes del portal no consultan features.

## 6. `GET /v1/session`

Autenticación: la de §3. Un contexto nulo o con `isActive = false` responde 401 `{ error: 'unauthenticated' }`. No exige organización; un administrador sin organización recibe una respuesta válida.

Si hay `organizationId`, se lee la suscripción (`subscriptions`, `limit: 1`, `overrideAccess`).

Respuesta 200, en este orden de composición (`{ ...ctx, ... }`):

| Campo | Contenido |
|---|---|
| `userId`, `role`, `organizationId`, `officeIds`, `selectedOfficeId`, `isPlatformAdmin`, `isActive` | Los de `TenantContext` tal como se resolvieron. |
| `roleRank` | Solo para `users` (número); no se envía para administradores. El tipo del cliente (`modules/auth/hooks/use-tenant-context.ts`) no lo declara. |
| `orgWide` | `hasOrgWideScope(ctx.role)`. |
| `features` | `normalizeFeatures` de la suscripción; sin suscripción, todas `true`. |
| `limits` | `planLimits(subscription)` (`{ max_offices, user_limits }`, cada tope `number \| null`) o `null` si no hay organización o suscripción. Solo informativo: los endpoints los hacen cumplir. |
| `permissions` | Ver abajo. |

`permissions`:

| Campo | Cálculo |
|---|---|
| `assignedOfficeRisk` | `canReadAssignedOfficeRisk(ctx)` |
| `organizationMembers.editOffices` | `organizationId` presente y `canDo(role, 'organization-memberships', 'edit_offices', org)` |
| `organizationMembers.changeStatus` | idem con `change_status` |
| `organizationMembers.create` | idem con `create` |
| `organizationMembers.read` | idem con `read` |
| `organizationMembers.update` | idem con `update` |
| `technicalEvidence` | `organizationId` presente y `canDo(role, 'scan-reports', 'read_technical', org)` |
| `tasks` | Subconjunto de `create, read, edit, claim, release, assign, reassign, complete, cancel, archive, delete` que pasa `canDo(role, 'tasks', acción, organizationId)` |
| `renameEvidence` | `organizationId` presente y `canDo(role, 'scan-reports', 'update', org)` |
| `assets` | `['update']` si `canDo(role, 'assets', 'update', organizationId)`, si no `[]` |

Puntos a tener en cuenta:
- `editOffices` y `changeStatus` son capacidad **del rol**, no del miembro objetivo. Indican si la persona puede usar el flujo; la decisión por miembro (rango, cobertura de oficinas) la devuelve `GET /v1/org-members` en `can_change_status` y `can_edit_offices` calculadas con `member-status.ts` (`members-api.md`). El servidor repite siempre la verificación al ejecutar.
- Para un `office_manager`: `create`, `changeStatus` y `editOffices` son `true`; `read` y `update` son `false` (la matriz no se los da).
- Para un administrador de plataforma **sin** organización: `organizationMembers.*`, `technicalEvidence`, `renameEvidence` y `assets` salen vacíos o `false` por la guarda de `organizationId`, y `tasks` es `['read']` (`canDo` permite `read` sin organización). Con `asOrganization`, `role` es `org_admin` y los valores son los de ese rol.
- La respuesta incluye `roleRank` porque se esparce el contexto completo; es un efecto de `...ctx`, no un campo diseñado.

## 7. Qué significa 401, 403 y 404 en cada capa

| Código | Dónde | Significado |
|---|---|---|
| 401 `unauthenticated` | Endpoints propios | Sin `req.user` (sin cookie, cookie rechazada por origen, sesión revocada o vencida), sin membresía activa, administrador inactivo, o `isActive = false`. |
| 401 | `GET /v1/session` tras desactivar o revocar | Mismo origen. El cliente intenta refresh; el refresh falla con 403, y el cliente limpia la sesión. |
| 403 `forbidden` | `endpoints/myProfile.ts`, mensajes del portal, y los endpoints por feature | La identidad existe pero no es del tipo, rol o alcance requeridos. |
| 403 (Payload) | Login y refresh | `Forbidden` de Payload: cuenta inactiva, `refresh` sin sesión válida. |
| 403 `OrganizationMismatchError` | `assertOrganizationMatches` | Recurso de otra organización en una escritura sensible. |
| 400 `organization_context_required` | Endpoints de tareas, riesgo, revisiones | Administrador de plataforma sin `asOrganization`. Es un 400, no un 403: la identidad es válida pero falta el contexto. |
| 403 `feature_disabled` | Tareas, riesgo, revisiones | La clave de plan está en `false`. |
| 404 | Filas fuera de alcance | No se revela existencia: tareas (`task_not_found`), miembros (`member_not_found`), mensajes (`message_not_found`). |

Reglas de decisión entre 403 y 404:
- **403** cuando la existencia del recurso no es secreta o el problema es del actor: rol o acción no permitidos, `view=all` sin `assign`, `office_id` fuera de alcance en una query, función apagada.
- **404** cuando la identidad del recurso es lo que se protege: fila de otra organización, oficina fuera de alcance, entidad no legible o destinatario fuera de la audiencia.
- En colecciones Payload, `orgScopedAccess` devuelve un `Where`: `findByID` sobre una fila filtrada da 404 y las listas simplemente la omiten. Si el helper devuelve `false`, Payload responde 403.
- En el frontend el layout de administración (`app/portal/(protected)/administration/layout.tsx`) usa `notFound()` en lugar de redirigir, para no confirmar que la ruta existe.

## 8. Cliente: HTTP, errores y sesión

### 8.1 `lib/http-client.ts`

- `httpClient.get|post|patch|delete|download`. Cada request va con `credentials: 'include'` y `Content-Type: application/json`; no se envía `Authorization` (la sesión es la cookie `httpOnly`).
- Antes de enviar, `organizationRequestPath` agrega `?asOrganization=<id>` si está en la URL del navegador y la ruta empieza con `/api/`. No sobrescribe un `asOrganization` explícito en la ruta.
- **No hay timeout ni `AbortController`**: una request colgada espera indefinidamente.
- Refresco ante 401 (§3.7).
- Error normalizado `HttpError = { status, code, message }`:
  - `code`: `data.errors[0].name` (formato de error de Payload), si no `data.error` (formato de los endpoints propios), si no `'request_failed'`.
  - `message`: `data.errors[0].message`, si no `data.message`, si no `data.error`, si no `statusText`.
  - Si el cuerpo no es JSON, `data` es `null`.
- `download` (`requestBlob`) normaliza igual pero no pasa por el refresh de 401.

### 8.2 Almacén de sesión del cliente

`lib/session.ts` guarda `Session = { collection: 'admins' | 'users' } | null` en un módulo (no hay `localStorage` ni acceso al JWT, que es `httpOnly`). `hydrated` distingue "sin confirmar" de "confirmada vacía". `lib/providers.tsx` (`SessionBootstrap`) llama `GET /api/v1/session` una vez por carga de página: si responde, `setSession({ collection: ctx.isPlatformAdmin ? 'admins' : 'users' })`; si falla, `clearSession()`. `useSession()` (`lib/use-session.ts`) devuelve:
- `undefined`: aún no se confirmó. Los llamadores **no** deben redirigir.
- `null`: confirmado sin sesión.
- `{ collection }`: sesión.

`getSessionSnapshot` cambia también entre "sin confirmar" y "confirmada vacía"; sin eso, una cookie vieja (por ejemplo de un usuario desactivado) dejaría la pantalla cargando sin llegar a redirigir.

### 8.3 `modules/auth`

- `service.ts`: `loginAdmin`, `loginUser` (`POST /api/<colección>/login`), `getPlatformAdminProfile`, `updatePlatformAdminProfile` (`/api/v1/platform-admin-profile`).
- `useTenantContext(asOrganization?)` (`use-tenant-context.ts`): `useQuery(['tenant-context', asOrganization])`, `GET /api/v1/session` con `asOrganization` en `params`, habilitada solo si hay sesión, `staleTime` 60 s. El `asOrganization` entra en la clave para que cambiar de organización visitada refetchee.
- `isEffectiveOrgAdmin(ctx)`: `role === 'org_admin'` **o** `isPlatformAdmin` con `organizationId`. Se usa para la navegación (dado que el rol del contexto visitante ya es `org_admin`, la segunda condición cubre sobre todo contextos donde el rol no esté resuelto como tal).
- `roleLabel(ctx)`: rótulo de visualización; un administrador visitando se rotula como "Administrador de la organización".
- Los permisos finos de la UI deben leerse de `permissions` y `orgWide`, no comparar slugs de rol (comentario en `endpoints/session.ts`).

### 8.4 De un código de error a texto

`showApiError(error, fallback, title?)` (`lib/notify-error.ts`) construye un mensaje general por estado y luego intenta un texto específico:
1. Mensaje general: error de red (`TypeError` con `fetch|network|load failed`) → "No se pudo conectar…"; 401 → "Tu sesión venció…"; 403 → "No tienes permiso…"; 404 → "El elemento ya no está disponible…"; 429 → "Hay demasiados intentos…"; 5xx → "Ocurrió un problema en el servidor…"; otro caso → `fallback`.
2. `userFacingErrorMessage(error, mensajeGeneral)` (`lib/user-facing-error.ts`) usa `MESSAGES_BY_CODE[error.code]` si el código está en el mapa; si no, mira `error.message`: lo busca como clave del mapa, o pasa por `translateKnownMessage` (prefijos y expresiones de mensajes en español o en inglés conocidos); si nada coincide devuelve el mensaje general. **Un texto técnico del servidor no llega nunca a la UI** salvo que esté en esa lista de excepciones.
3. Aviso: color naranja y autocierre en 5 s para 4xx; rojo y sin autocierre para el resto. Si el texto coincide con el título, no se repite.

Un código nuevo del servidor solo tiene texto si se agrega a `MESSAGES_BY_CODE`. Hay códigos que muestran el mensaje general por estado en lugar de uno propio.

## 9. Compuertas del frontend

Las compuertas son de UX, no de seguridad: toda autorización se repite en el servidor.

Gate de Next (`middleware.ts`): para `/`, `/account`, `/organizations/*` y `/portal/*`, redirige a `/login` si **no existe** la cookie `payload-token`. No decodifica ni valida el token (no hay criptografía ni base de datos en el middleware). Las comprobaciones finas (colección, organización, `isActive`) ocurren en cada request real.

Layouts (todos `'use client'`, con `Suspense` por `useSearchParams`):
- **`app/(dashboard)/(protected)/layout.tsx`** (portal de plataforma; rutas `/`, `/organizations`, `/portal-messages`, `/account`). Mientras `useSession()` es `undefined` o el contexto está pendiente muestra un `Loader`. Si no hay sesión o la colección no es `admins`, `router.replace('/login')`. Mantiene `?asOrganization=` en los enlaces del menú y muestra un indicador de organización visitada.
- **`app/portal/(protected)/layout.tsx`** (portal de organización). Permite `users`, y `admins` solo si `?asOrganization=` está presente (`isAdminVisiting`). Un administrador sin `asOrganization` es redirigido a `/`; sin sesión, a `/login`. Si `useTenantContext` falla, muestra un error con "Reintentar" en lugar de seguir con datos vacíos. Arma el menú con `features` (`security_assessments`, `tasks`), `isEffectiveOrgAdmin` (Administración) y `permissions.organizationMembers.create` (Equipo, solo si no es org admin efectivo). Monta `ScanResultMonitor` y `PortalMessagesRuntime`.
- **`app/portal/(protected)/administration/layout.tsx`**: con el contexto resuelto, si no es org admin efectivo llama `notFound()`; con error muestra "Reintentar".

Comentarios obsoletos: los tres layouts conservan un comentario que dice que el JWT vive en `localStorage` y que no hay compuerta posible del lado servidor. El código actual usa cookie `httpOnly` y ya existe el gate de `middleware.ts` por presencia de cookie; la compuerta de rol sigue siendo solo del cliente.

## 10. Perfil propio: `endpoints/myProfile.ts`

Solo para personas de una organización. Autenticación: `getTenantContext`; sin contexto activo, 401 `unauthenticated`; si es administrador de plataforma o `req.user.collection !== 'users'`, 403 `forbidden`. El perfil de un administrador está en `endpoints/platformAdminProfile.ts` (`GET`/`PATCH /v1/platform-admin-profile`).

| Método y ruta | Entrada | Respuesta |
|---|---|---|
| `GET /v1/me/profile` | — | 200 `MyProfile` |
| `PATCH /v1/me/profile` | `ProfileUpdateSchema` (`modules/users/schema`) | 200 `MyProfile`; 400 `invalid_profile` con `issues` |

`MyProfile`: `{ name, email, role, organization: { id, name } | null, all_offices, offices: [{ id, name, location }] }`. `all_offices` es `ctx.role === 'org_admin'`; `offices` son las oficinas **activas** de `ctx.officeIds`, ordenadas por nombre, con `location` de `locationLabel(province_id, department_id)`. Solo se actualiza `name`, con `overrideAccess: true`. El punto de escritura lleva comentarios `AUDIT:` (sin implementación, ver `SYSTEM_PROMPT.md` §2). En el cliente, la query es `['my-profile']` (`useMyProfile`).

## 11. Catálogo de códigos transversales

Cuerpo habitual de error de endpoints propios: `{ error: <código>, message?: <texto>, issues?: [...] }`. Errores de Payload (login, `APIError`): `{ errors: [{ name, message }] }`; `http-client` los normaliza al mismo `HttpError`.

| Código | HTTP | Origen | Cuándo |
|---|---|---|---|
| `unauthenticated` | 401 | Endpoints propios | Sin identidad resoluble, membresía inactiva, administrador inactivo. Texto: "Tu sesión venció. Inicia sesión nuevamente." |
| `forbidden` | 403 | Endpoints propios | Rol, tipo de identidad, alcance o acción no permitidos. |
| `organization_context_required` | 400 | Tareas, riesgo, revisiones | Administrador de plataforma sin `asOrganization`. |
| `feature_disabled` | 403 | Tareas, riesgo, revisiones | Función apagada por el plan. |
| `invalid_profile` | 400 | `PATCH /v1/me/profile` | Cuerpo inválido (`issues`). Sin texto propio en `user-facing-error.ts`. |
| `office_forbidden`, `office_required` | — | `officeQueryError` | Devueltos por la función; cada endpoint decide cómo responder. |
| `rank_escalation` | — | Texto del cliente | "No puedes asignar un rol de mayor autoridad que el tuyo." |
| `last_active_org_admin` | — | Texto del cliente | "La organización debe conservar al menos un administrador activo." |
| `organization_inactive` | — | Revisiones, administración | La organización está inactiva. |
| `member_not_found` | 404 | Miembros | Miembro fuera de la organización o inexistente. |
| Mensaje de Payload `You are not allowed to perform this action` y similares | 403 | Payload | Un `access` devolvió `false`. |
| `OrganizationMismatchError` ("Este recurso pertenece a otra organización") | 403 | `assertOrganizationMatches` | Verificación explícita de organización de la fila. |
| `OwnerOutOfScopeError` | 400 | `assertOwnerCoversOffice` | Owner sin membresía activa o sin la oficina del activo. |
| `TenantResolutionError` | excepción | `resolveTenantContext` | `asOrganization` de una organización inexistente; no se convierte en respuesta controlada (§12). |

Los códigos específicos de cada feature están en el catálogo de su documento.

## 12. Comportamientos a tener presentes

Verificados en el código; no son necesariamente defectos.

1. **Referencias a Auth0 desactualizadas.** Auth0 no se usará. `SYSTEM_PROMPT.md` §7 y varios comentarios del código (`identityProvider.ts`, layouts, `resolveAgentAuth.ts`) mencionan Auth0 o un fallback solo para desarrollo. El único mecanismo es la autenticación nativa de Payload, igual en todos los entornos y de carácter temporal.
2. **`asOrganization` inexistente lanza excepción.** `resolveTenantContext` lanza `TenantResolutionError` en lugar de devolver `null`; `getTenantContext` no la captura, y en los endpoints propios se traduce según cómo cada uno maneja excepciones (sin código ni forma uniforme garantizada). Una organización existente pero inactiva sí se acepta.
3. **El administrador visitante tiene `role = 'org_admin'`.** El servidor, la matriz y `GET /v1/session` lo tratan como `org_admin` con `isPlatformAdmin = true`. El comentario de `isEffectiveOrgAdmin` dice que el rol sigue siendo `platform_admin`.
4. **Un administrador inactivo devuelve contexto, no `null`.** `findActiveAdminById` devuelve el administrador con `isActive: false`; las comprobaciones `!ctx.isActive` de cada punto de entrada son las que lo bloquean. Un endpoint nuevo que solo compruebe `!ctx` dejaría pasar a un administrador inactivo con sesión válida; en la práctica `revokeInactiveSessions` vacía sus sesiones al desactivarlo.
5. **El visitante recibe todas las oficinas.** Con `asOrganization`, `officeIds` incluye cada oficina de la organización, activas o no.
6. **`roleRank` sale en `/v1/session` pero el tipo del cliente no lo declara.**
7. **`editOffices` y `changeStatus` de la sesión no dependen del miembro.** Son capacidad del rol; la decisión por persona se calcula en el endpoint de miembros.
8. **Una sola cookie para ambas colecciones.** Un navegador no puede tener a la vez sesión de `users` y de `admins`; iniciar sesión con una cuenta invalida el uso de la otra en esa pestaña y navegador. `SessionBootstrap` deduce la colección de `isPlatformAdmin`.
9. **Sin timeout en el cliente HTTP.** `lib/http-client.ts` no define límite de tiempo ni cancelación.
10. **Una cookie rechazada por `Origin` equivale a no tener sesión.** No hay error propio; el síntoma es un 401 con credenciales válidas, por ejemplo al servir la app desde un origen distinto de `NEXT_PUBLIC_SITE_URL`.
11. **`middleware.ts` solo mira la existencia de la cookie.** Una cookie vencida o revocada pasa el middleware; el 401 posterior limpia la sesión del cliente y redirige.
12. **Reactivar no restaura acceso.** Reactivar un usuario o una membresía no revierte la cascada automáticamente: la membresía y el `users.status` se reactivan por separado, y las sesiones anteriores no se restauran (se necesita un login nuevo).
13. **Los layouts conservan comentarios sobre `localStorage`.** Ya no corresponden (§9).
14. **El logout no limpia el estado de mensajes del portal por sí mismo.** Lo hace `PortalMessagesRuntime` cuando `useSession()` pasa a `null`, y `useLogin` en el login siguiente.
15. **`office_manager` sin `read` de membresías.** Gestiona a Viewers por el flujo delegado, pero la sesión informa `organizationMembers.read = false` y `update = false` para ese rol.

## 13. Cobertura de pruebas

Sin pruebas de extremo a extremo por ahora.

| Prueba | Cubre |
|---|---|
| `access/tenant/resolveTenantContext.test.ts` | Sin identidad → `null`; admin sin match; admin con y sin `asOrganization`; oficinas del visitante; organización inexistente → excepción; usuario sin membresía activa; contexto completo; `asOrganization` ignorado en `users` |
| `access/tenant/assertOrganizationMatches.test.ts` | Coincidencia, bloqueo, actor sin organización, `unrestricted`, 403 |
| `access/tenant/officeQueryError.test.ts` | Roles org-wide frente a roles de oficina |
| `access/rbac/permissions.test.ts` | Matriz por colección: oficinas, activos, inventario, evaluaciones, tareas, membresías, riesgo, administrador con y sin organización |
| `access/rbac/orgScopedAccess.test.ts` | Filtro `org_offices`: org-wide, roles de oficina, sin organización |
| `access/rbac/member-status.audit.test.ts` | Regla de rango, cobertura de oficinas, polaridad de rango, rango desconocido, administración organizacional, edición de oficinas |
| `access/rbac/technical-evidence.audit.test.ts` | Permiso técnico y redacción de evidencia |
| `access/auth/account-sessions.audit.test.ts` | `revokeInactiveSessions` vacía sesiones y no las restaura al reactivar |
| `collections/Users/unlock.audit.test.ts` | `unlock` denegado y bloqueo nativo con expiración |
| `modules/auth/hooks/use-login.test.ts` | `loginErrorMessage` |
| `lib/http-client.audit.test.ts` | Normalización de errores de Payload, texto seguro en avisos, error de red |
| `lib/organization-request-context.audit.test.ts` | `asOrganization` en lecturas y escrituras, sin pisar uno explícito |
| `lib/user-facing-error.audit.test.ts` | Traducción de códigos y mensajes |
| `lib/platform-origin.audit.test.ts` | Validación del origen canónico |
| `endpoints/security-policy.audit.integration.test.ts` | SEC-42: desactivación revoca cookies, rechaza refresh y login, concurrencia de login, cascada de membresía y de administrador; permiso técnico de evidencia |
| `endpoints/audit-fixes.audit.integration.test.ts` | SEC-40: bloqueo tras cinco intentos, desbloqueo por expiración, `unlock` denegado |
| `endpoints/member-manager-status.audit.integration.test.ts` | Estado y oficinas de miembros por un Manager |
| `access/rbac/officeScoping.integration.test.ts` | Alcance por oficina en lecturas de colecciones |

No hay prueba específica de `endpoints/session.ts` (forma de la respuesta) ni de `endpoints/myProfile.ts`, ni del refresco reactivo de `lib/http-client.ts` (la prueba de ese archivo cubre errores).

Las pruebas de integración requieren una base PostgreSQL desechable; no se ejecutan como parte de este documento.
