import type { CollectionConfig } from 'payload'
import { orgScopedAccess } from '../../access/rbac/orgScopedAccess'
import { validateOwnerTenant } from './hooks/validateOwnerTenant'
import { rejectManualOfflineStatus } from './hooks/rejectManualOfflineStatus'
import { rejectBusinessEditsBeforeIdentified } from './hooks/rejectBusinessEditsBeforeIdentified'

const technicalFieldAccess = {
  // Bloque técnico: solo lo escribe el upsert de ingesta (domain/inventories/ingestScanReport.ts), nunca un humano.
  update: () => false,
}

// Bloque de negocio (alias..status): edición manual habilitada (cierre del módulo de Inventario,
// access/rbac/permissions.ts — org_admin/office_manager ganan 'update' sobre 'assets'). `create`/
// `delete` de la colección siguen () => false: un Asset nunca se crea/borra a mano.
export const Assets: CollectionConfig = {
  slug: 'assets',
  admin: {
    useAsTitle: 'hostname',
  },
  access: {
    create: () => false,
    read: orgScopedAccess('assets', 'read'),
    update: orgScopedAccess('assets', 'update'),
    delete: () => false,
  },
  hooks: {
    beforeChange: [validateOwnerTenant, rejectManualOfflineStatus, rejectBusinessEditsBeforeIdentified],
  },
  fields: [
    {
      name: 'asset_id',
      type: 'text',
      required: true,
      unique: true,
    },
    {
      name: 'agent',
      type: 'relationship',
      relationTo: 'agents',
      required: true,
      index: true,
      access: technicalFieldAccess,
    },
    {
      // Derivados del agent autenticado — nunca del payload de ingesta.
      name: 'office',
      type: 'relationship',
      relationTo: 'offices',
      admin: { readOnly: true },
      access: technicalFieldAccess,
    },
    {
      name: 'organization',
      type: 'relationship',
      relationTo: 'organizations',
      admin: { readOnly: true },
      access: technicalFieldAccess,
    },
    // index: true en ip/mac — domain/inventories/ingestScanReport.ts::findExistingAsset busca
    // por estos dos campos (acotado a `agent`) en cada ingesta, ya no por `asset_id`.
    { name: 'ip', type: 'text', index: true, access: technicalFieldAccess },
    { name: 'last_seen', type: 'date', access: technicalFieldAccess },
    { name: 'gateway_ip', type: 'text', access: technicalFieldAccess },
    { name: 'gateway_mac', type: 'text', access: technicalFieldAccess },
    { name: 'mac', type: 'text', index: true, access: technicalFieldAccess },
    { name: 'vendor', type: 'text', access: technicalFieldAccess },
    { name: 'hostname', type: 'text', access: technicalFieldAccess },
    {
      name: 'os',
      type: 'group',
      access: technicalFieldAccess,
      fields: [
        { name: 'name', type: 'text' },
        { name: 'accuracy', type: 'number' },
        { name: 'cpe', type: 'text', hasMany: true },
        { name: 'osfamily', type: 'text' },
        { name: 'osgen', type: 'text' },
        { name: 'vendor', type: 'text' },
      ],
    },
    {
      // Hasta 3 candidatos de osmatch (scanner-prototype models.py::Asset.os_candidates), orden
      // descendente por accuracy — os_candidates[0] es el mismo dato que `os`. Campo raíz (no
      // anida en `os`), así que necesita su propio access: technicalFieldAccess explícito.
      name: 'os_candidates',
      type: 'array',
      access: technicalFieldAccess,
      fields: [
        { name: 'name', type: 'text' },
        { name: 'accuracy', type: 'number' },
        { name: 'cpe', type: 'text', hasMany: true },
        { name: 'osfamily', type: 'text' },
        { name: 'osgen', type: 'text' },
        { name: 'vendor', type: 'text' },
      ],
    },
    {
      // Regla de negocio de la plataforma (nunca del agente, ver domain/inventories/ingestScanReport.ts):
      // 'identified' si os_candidates[0].accuracy >= 85, si no 'indeterminate'.
      name: 'os_status',
      type: 'select',
      options: ['identified', 'indeterminate'],
      admin: { readOnly: true },
      access: technicalFieldAccess,
    },
    {
      // Motivo de host discovery de nmap (arp-response, echo-reply...), no solo el estado "up".
      name: 'state_reason',
      type: 'text',
      access: technicalFieldAccess,
    },
    {
      // Salida de scripts NSE a nivel host (ej. smb-os-discovery): id de script -> output crudo.
      name: 'host_scripts',
      type: 'json',
      access: technicalFieldAccess,
    },
    {
      name: 'services',
      type: 'array',
      access: technicalFieldAccess,
      fields: [
        { name: 'port', type: 'number' },
        { name: 'protocol', type: 'text' },
        { name: 'state', type: 'text' },
        { name: 'name', type: 'text' },
        { name: 'product', type: 'text' },
        { name: 'version', type: 'text' },
        { name: 'extra_info', type: 'text' },
        { name: 'cpe', type: 'text' },
        { name: 'reason', type: 'text' },
        { name: 'detection_method', type: 'text' },
        { name: 'confidence', type: 'number', min: 0, max: 10 },
        { name: 'tunnel', type: 'text' },
        // Salida de scripts NSE (-sC) para este puerto: id de script -> output crudo.
        { name: 'scripts', type: 'json' },
      ],
    },
    // Bloque de negocio — nunca sobrescrito por el upsert de ingesta, solo en creación o edición manual.
    // maxLength es la única validación de longitud que realmente corre: el PATCH manual pega
    // directo al REST genérico de Payload (modules/assets/service.ts), nunca pasa por el Zod de
    // modules/assets/schema.ts (que solo se usa como tipo TS del lado del cliente) — sin esto,
    // cualquiera con permiso de update sobre `assets` podía mandar un string sin límite alguno.
    {
      // Confirmación humana de que el activo detectado es real. Mientras es false, alias/
      // location/criticality/owner quedan bloqueados server-side (rejectBusinessEditsBeforeIdentified.ts)
      // — no tiene sentido asignarle metadatos de negocio a algo que nadie confirmó todavía.
      // Acción directa y bidireccional para org_admin/office_manager este sprint (sin flujo de
      // aprobación) vía endpoints/assetIdentify.ts.
      name: 'identified',
      type: 'checkbox',
      defaultValue: false,
    },
    { name: 'alias', type: 'text', maxLength: 120 },
    {
      name: 'criticality',
      type: 'select',
      options: ['low', 'medium', 'high', 'critical'],
    },
    {
      name: 'owner',
      type: 'relationship',
      relationTo: 'users',
      // Pertenencia a la organización del Asset validada en hooks/validateOwnerTenant.ts —
      // el filtro de fila (RBAC) no alcanza para validar el *valor* de una FK a otra colección.
    },
    { name: 'location', type: 'text', maxLength: 200 },
    {
      name: 'status',
      type: 'select',
      options: ['active', 'retired', 'offline'],
      defaultValue: 'active',
    },
    {
      // "NEW" badge en la tabla de Inventario hasta que un usuario entra al detalle del asset
      // (markAssetViewed(), disparado desde AssetDetailView). `null` = nunca visto. Nunca se
      // incluye en el `data` de ingestScanReport.ts/agingSweep.ts (ver esos archivos) — un
      // upsert de Payload solo escribe los campos presentes en `data`, así que un re-scan de un
      // asset ya conocido jamás toca ni resetea esta marca, sin necesitar ningún hook extra.
      name: 'first_viewed_at',
      type: 'date',
      admin: { readOnly: true },
    },
    {
      // "CHANGED" badge en la tabla de Inventario — distinto de "New" (first_viewed_at): un
      // activo YA visto cuya última ingesta modificó su bloque técnico (ingestScanReport.ts,
      // hasTechnicalChanged). `null` = sin cambios pendientes de revisar. Se apaga al volver a
      // entrar al detalle (AssetDetailView), igual que first_viewed_at, pero acá SÍ se vuelve a
      // setear en cada re-scan que introduzca un cambio real (no es sticky).
      name: 'technical_changed_at',
      type: 'date',
      admin: { readOnly: true },
    },
  ],
}

export default Assets
