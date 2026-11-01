'use client'

import { matchesSearch } from '@/lib/search-text'

import { useState } from 'react'
import { Box, Checkbox, Combobox, Group, InputBase, Text, useCombobox } from '@mantine/core'
import { Search } from 'lucide-react'
import { APP_HEADER_HEIGHT } from '@/lib/theme'

type Option = { value: string; label: string }
type OptionGroup = { group: string; items: readonly Option[] }

const ALL_VALUE = '__all__'
const MAX_DROPDOWN_HEIGHT = 360

// El desplegable nunca sale de la ventana: floating-ui elige el lado con más lugar (flip), lo
// corre si toca un borde (shift) y le pasa el alto libre (size) para que la lista se achique y
// tenga su propio scroll. Sigue al campo cuando la página se desplaza.
// El margen de arriba deja libre el encabezado fijo de la app.
const VIEWPORT_PADDING = { top: APP_HEADER_HEIGHT + 8, bottom: 8, left: 8, right: 8 }

const DROPDOWN_MIDDLEWARES = {
  flip: { padding: VIEWPORT_PADDING },
  shift: { padding: VIEWPORT_PADDING },
  size: {
    padding: VIEWPORT_PADDING,
    apply: ({
      availableHeight,
      elements,
    }: {
      availableHeight: number
      elements: { floating: HTMLElement }
    }) => {
      elements.floating.style.setProperty(
        '--mfs-max-height',
        `${Math.max(120, Math.min(availableHeight, MAX_DROPDOWN_HEIGHT))}px`
      )
    },
  },
}

/**
 * Filtro de listado con varias opciones a la vez (SYSTEM_PROMPT §3, "List filters"), con el mismo
 * alto y aspecto que un Select de FilterBar: el campo muestra un resumen en una línea (recortado
 * si no entra) y la lista tiene casillas. La primera opción, `allLabel` ("Todos los estados"),
 * equivale a no filtrar: queda marcada con la selección vacía y al elegirla la vacía. Elegir
 * todas las opciones también se trata como "todos".
 *
 * `searchable` agrega un campo para escribir arriba de la lista (listas largas); `data` acepta
 * grupos `{ group, items }` como el Select de Mantine.
 */
export function MultiFilterSelect({
  data,
  value,
  onChange,
  allLabel,
  ariaLabel,
  searchable = false,
}: {
  data: ReadonlyArray<Option | OptionGroup>
  value: string[]
  onChange: (value: string[]) => void
  allLabel: string
  ariaLabel: string
  searchable?: boolean
}) {
  const [search, setSearch] = useState('')
  const combobox = useCombobox({
    onDropdownClose: () => {
      combobox.resetSelectedOption()
      setSearch('')
    },
    onDropdownOpen: () => {
      if (searchable) combobox.focusSearchInput()
    },
  })
  const options = data.flatMap(entry => ('group' in entry ? entry.items : [entry]))
  const selected = options.filter(option => value.includes(option.value))
  const all = selected.length === 0 || selected.length === options.length
  const summary = all ? allLabel : selected.map(option => option.label).join(', ')

  const toggle = (optionValue: string) => {
    if (optionValue === ALL_VALUE) return onChange([])
    const next = value.includes(optionValue)
      ? value.filter(item => item !== optionValue)
      : [...value, optionValue]
    onChange(next.length === options.length ? [] : next)
  }

  const term = search.trim()
  const matches = (option: Option) => matchesSearch([option.label], term)
  const renderOption = (option: Option, checked: boolean) => (
    <Combobox.Option value={option.value} key={option.value} active={checked}>
      <Group gap="sm" wrap="nowrap">
        <Checkbox
          checked={checked}
          onChange={() => {}}
          aria-hidden
          tabIndex={-1}
          size="xs"
          style={{ pointerEvents: 'none' }}
          // Siempre visible (indica que se puede marcar más de una, también en táctil), pero el
          // vacío más tenue para que resalten las marcadas.
          styles={checked ? undefined : { input: { borderColor: 'var(--mantine-color-gray-3)' } }}
        />
        <span>{option.label}</span>
      </Group>
    </Combobox.Option>
  )
  const renderEntry = (entry: Option | OptionGroup) => {
    if (!('group' in entry)) {
      return matches(entry) ? renderOption(entry, !all && value.includes(entry.value)) : null
    }
    const items = entry.items.filter(matches)
    if (!items.length) return null
    return (
      <Combobox.Group label={entry.group} key={entry.group}>
        {items.map(option => renderOption(option, !all && value.includes(option.value)))}
      </Combobox.Group>
    )
  }
  const entries = data.map(renderEntry).filter(Boolean)

  return (
    <Combobox
      store={combobox}
      onOptionSubmit={toggle}
      withinPortal
      position="bottom-start"
      middlewares={DROPDOWN_MIDDLEWARES}
    >
      <Combobox.Target>
        <InputBase
          component="button"
          type="button"
          pointer
          aria-label={ariaLabel}
          title={all ? undefined : summary}
          rightSection={<Combobox.Chevron />}
          rightSectionPointerEvents="none"
          onClick={() => combobox.toggleDropdown()}
          w="100%"
        >
          {/* Una sola línea: el resumen se recorta en vez de agrandar el campo. */}
          <Text size="sm" truncate="end" component="span" display="block">
            {summary}
          </Text>
        </InputBase>
      </Combobox.Target>
      {/* Sin `display` en el Dropdown: Mantine lo oculta con display: none al cerrarse y un
          estilo propio lo dejaría siempre visible. El flex va en un contenedor interno, que
          toma el alto libre (--mfs-max-height) menos el padding y el borde del Dropdown. */}
      <Combobox.Dropdown>
        <Box
          style={{
            display: 'flex',
            flexDirection: 'column',
            maxHeight: `calc(var(--mfs-max-height, ${MAX_DROPDOWN_HEIGHT}px) - 2 * var(--combobox-padding, 4px) - 2px)`,
          }}
        >
          {searchable && (
            <Combobox.Search
              value={search}
              onChange={event => setSearch(event.currentTarget.value)}
              placeholder="Escribe para buscar"
              leftSection={<Search size={14} strokeWidth={1.5} />}
            />
          )}
          <Combobox.Options style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
            {!term && renderOption({ value: ALL_VALUE, label: allLabel }, all)}
            {entries.length ? entries : <Combobox.Empty>Sin coincidencias</Combobox.Empty>}
          </Combobox.Options>
        </Box>
      </Combobox.Dropdown>
    </Combobox>
  )
}
