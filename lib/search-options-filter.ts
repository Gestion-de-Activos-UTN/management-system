import type { ComboboxParsedItem, OptionsFilter } from '@mantine/core'
import { normalizeSearchText } from './search-text'

/** Shared Select/MultiSelect/Autocomplete search, keeping labels, groups and limits intact. */
export const searchOptionsFilter: OptionsFilter = ({ options, search, limit }) => {
  const needle = normalizeSearchText(search)
  const result: ComboboxParsedItem[] = []
  let remaining = limit
  for (const option of options) {
    if (remaining <= 0) break
    if ('group' in option) {
      const items = option.items
        .filter(item => normalizeSearchText(item.label).includes(needle))
        .slice(0, remaining)
      if (items.length) result.push({ ...option, items })
      remaining -= items.length
    } else if (normalizeSearchText(option.label).includes(needle)) {
      result.push(option)
      remaining -= 1
    }
  }
  return result
}
