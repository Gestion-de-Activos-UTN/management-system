import { categoryGroupOf, type CategoryGroup } from './categoryGroups'

// Subcampos de cada grupo: se usan para limpiar (poner todo en null) y para saber si un grupo
// "tiene contenido".
export const GROUP_FIELDS: Record<CategoryGroup, readonly string[]> = {
  product_details: ['software_vendor', 'software_product', 'software_version'],
  cloud_details: ['kind', 'vendor'],
  repository_details: ['kind'],
}

// Obligatorios cuando la categoría efectiva corresponde al grupo.
const REQUIRED_FIELDS: Record<CategoryGroup, readonly string[]> = {
  product_details: ['software_vendor', 'software_product'],
  cloud_details: ['kind'],
  repository_details: ['kind'],
}

const FIELD_LABEL: Record<string, string> = {
  software_vendor: 'El proveedor',
  software_product: 'El producto',
  software_version: 'La versión',
  kind: 'El tipo',
}

type Doc = Record<string, unknown> | null | undefined
type GroupValue = Record<string, unknown>

export type FieldError = { path: string; message: string }

const isBlank = (value: unknown) =>
  value == null || (typeof value === 'string' && value.trim() === '')

// Estado efectivo del grupo tras el write: lo enviado gana clave a clave (null incluido);
// lo ausente cae al originalDoc. `group: null` limpia el grupo entero.
function effectiveGroup(group: CategoryGroup, data: Doc, originalDoc: Doc): GroupValue {
  const sent = data && group in data ? (data[group] as GroupValue | null) : undefined
  if (sent === null) return {}
  const base = (originalDoc?.[group] as GroupValue | null | undefined) ?? {}
  return { ...base, ...(sent ?? {}) }
}

export function resolveCategoryGroups(data: Doc, originalDoc: Doc) {
  const category =
    data && 'asset_category' in data ? data.asset_category : originalDoc?.asset_category
  const active = categoryGroupOf(typeof category === 'string' ? category : null)

  const errors: FieldError[] = []
  const clean: Partial<Record<CategoryGroup, Record<string, null>>> = {}

  for (const group of Object.keys(GROUP_FIELDS) as CategoryGroup[]) {
    const effective = effectiveGroup(group, data, originalDoc)

    if (group === active) {
      for (const field of REQUIRED_FIELDS[group]) {
        if (isBlank(effective[field])) {
          errors.push({
            path: `${group}.${field}`,
            message: `${FIELD_LABEL[field]} es obligatorio para esta categoría`,
          })
        }
      }
    } else if (GROUP_FIELDS[group].some((field) => !isBlank(effective[field]))) {
      // Solo si hay algo que limpiar: null y no undefined, porque omitir la clave no borra la
      // columna en un update.
      clean[group] = Object.fromEntries(GROUP_FIELDS[group].map((field) => [field, null]))
    }
  }

  return { errors, clean }
}