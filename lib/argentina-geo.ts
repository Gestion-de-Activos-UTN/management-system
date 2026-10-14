import data from './argentina-geo.json'

// Provincias y departamentos de Argentina (códigos INDEC). Snapshot estático de Georef AR
// (apis.datos.gob.ar/georef, fuente oficial IGN/INDEC): la división política cambia muy rara vez
// y así no dependemos de un servicio externo en runtime.
// ponytail: snapshot manual; regenerarlo desde Georef si INDEC publica cambios.
export type Province = { id: string; name: string }
export type Department = { id: string; name: string; province_id: string }

export const PROVINCES: Province[] = data.provinces
export const DEPARTMENTS: Department[] = data.departments

const provinceById = new Map(PROVINCES.map(province => [province.id, province]))
const departmentById = new Map(DEPARTMENTS.map(department => [department.id, department]))

export function provinceName(id: string | null | undefined) {
  return id ? (provinceById.get(id)?.name ?? null) : null
}

export function departmentName(id: string | null | undefined) {
  return id ? (departmentById.get(id)?.name ?? null) : null
}

export function departmentsOf(provinceId: string | null | undefined) {
  return provinceId ? DEPARTMENTS.filter(department => department.province_id === provinceId) : []
}

/** El departamento existe y pertenece a la provincia indicada. */
export function isDepartmentOf(departmentId: string, provinceId: string) {
  return departmentById.get(departmentId)?.province_id === provinceId
}

/** "Rosario, Santa Fe" o sólo la provincia; null si la oficina no tiene ubicación. */
export function locationLabel(provinceId?: string | null, departmentId?: string | null) {
  const province = provinceName(provinceId)
  if (!province) return null
  const department = departmentName(departmentId)
  return department ? `${department}, ${province}` : province
}
