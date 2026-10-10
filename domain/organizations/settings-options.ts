export const OFFLINE_AFTER_HOURS_VALUES = [24, 48, 72, 96, 168] as const
export const SNAPSHOT_INTERVAL_DAYS_VALUES = [1, 3, 7, 14, 30] as const
export const OFFLINE_AFTER_HOURS_OPTIONS = OFFLINE_AFTER_HOURS_VALUES.map(value => ({ value: String(value), label: `${value} h${value === 72 ? ' — predeterminado' : ''}` }))
export const SNAPSHOT_INTERVAL_DAYS_OPTIONS = SNAPSHOT_INTERVAL_DAYS_VALUES.map(value => ({ value: String(value), label: `${value} días${value === 7 ? ' — predeterminado' : ''}` }))
