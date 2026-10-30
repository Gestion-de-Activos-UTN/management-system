import {
  Autocomplete,
  Combobox,
  Menu,
  MultiSelect,
  Card,
  Collapse,
  Modal,
  Select,
  Switch,
  Tooltip,
  createTheme,
  defaultVariantColorsResolver,
  parseThemeColor,
  rgba,
  type MantineColorsTuple,
  type VariantColorsResolver,
} from '@mantine/core'
import dropdownStyles from './DropdownOptions.module.css'
import { searchOptionsFilter } from './search-options-filter'

/**
 * SIAM palette — warm neutral "bone" base + muted slate-teal "pine" accent.
 * Deliberately not blue-on-white SaaS default: fits a compliance/inventory
 * tool that should read as calm and document-like, not alarm-heavy.
 * Semantic colors (danger/warning/success) stay close to Mantine defaults —
 * criticality/status badges need universally-read meaning, not brand novelty.
 */

const bone: MantineColorsTuple = [
  '#faf8f4',
  '#f4f1ea',
  '#eae5da',
  '#ddd6c7',
  '#c9bfac',
  '#b2a78f',
  '#948871',
  '#766b57',
  '#5a5142',
  '#3a342a',
]

const pine: MantineColorsTuple = [
  '#eef3f1',
  '#dce7e3',
  '#b8cfc7',
  '#92b6ab',
  '#70a093',
  '#4f8b7c',
  '#3d7266',
  '#2f5b52',
  '#23443e',
  '#182f2b',
]

// Mantine's default "light"/"subtle" hover alpha (0.12) reads as almost no
// feedback on the bone/pine palette — bump it up. "subtle" also gets a
// visible border so it doesn't look identical to plain text until hovered.
const variantColorResolver: VariantColorsResolver = input => {
  const base = defaultVariantColorsResolver(input)
  const parsed = parseThemeColor({ color: input.color, theme: input.theme })

  if (input.variant === 'light') {
    const shade = parsed.shade ?? (input.theme.primaryShade as { light: number }).light
    const shadeColor = input.theme.colors[parsed.color]?.[shade]
    return shadeColor ? { ...base, hover: rgba(shadeColor, 0.22) } : base
  }

  if (input.variant === 'subtle') {
    // Mantine's own "subtle" border is always transparent — make it visible so
    // it doesn't look identical to plain text until hovered. A colored subtle
    // button (e.g. color="red" for a destructive action) must border in that
    // same color, so reuse `base.color` — it's already the exact CSS var
    // Mantine resolved for the text, which adapts to light/dark on its own.
    return input.color
      ? { ...base, border: `1px solid ${base.color}` }
      : { ...base, border: `1px solid var(--mantine-color-default-border)` }
  }

  return base
}

export const theme = createTheme({
  colors: { bone, pine },
  primaryColor: 'pine',
  primaryShade: { light: 6, dark: 6 },
  breakpoints: {
    xs: '30em',
    sm: '48em',
    md: '64em',
    lg: '75em',
    xl: '90em',
  },
  // One radius everywhere — cards, buttons, inputs, nav, badges. Two different
  // rounding amounts (a pill badge next to a barely-rounded button) read as a
  // mismatch, not a hierarchy, so there's a single consistent 'md' (8px).
  defaultRadius: 'md',
  autoContrast: true,
  // Mantine anima Modal, Collapse, Drawer, Menu y Notifications por JS; sin esto ignora el
  // "reducir movimiento" del sistema (viene en false). El CSS propio lo cubre globals.css.
  respectReducedMotion: true,
  variantColorResolver,
  // System font stack — every browser already ships one of these, no
  // webfont to load/flash.
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, Roboto, Arial, sans-serif',
  // Used deliberately, not decoratively — technical/identifying data (IPs,
  // hostnames, asset/org ids) renders in this face wherever it appears, the one
  // typographic signature tying the UI to an inventory/compliance tool's actual
  // subject matter. See components/ui/TechnicalText.tsx.
  fontFamilyMonospace: 'ui-monospace, "SFMono-Regular", Consolas, "Liberation Mono", monospace',
  headings: {
    fontWeight: '700',
  },
  white: bone[0],
  black: bone[9],
  components: {
    // One tooltip pattern for truncated labels, row actions and contextual help.
    Tooltip: Tooltip.extend({
      defaultProps: {
        withArrow: false,
        radius: 6,
        position: 'top',
        openDelay: 300,
        closeDelay: 0,
        multiline: true,
        maw: 400,
        events: { hover: true, focus: true, touch: false },
      },
    }),
    // Same absolute radius as everything else still reads as "more rounded" on a
    // ~22px-tall badge than on a ~36px button — the corner curve is a much
    // bigger proportion of a short element's height. Sized down to 'sm' so the
    // two actually look consistent, not just numerically equal.
    Badge: {
      defaultProps: { variant: 'filled', radius: 'sm' },
    },
    // Soft elevation by default — cards/modals/papers read as "raised" surfaces
    // instead of flat outlined boxes (hover lift, only for link cards, lives in globals.css).
    Card: Card.extend({ defaultProps: { shadow: 'sm' } }),
    Modal: Modal.extend({ defaultProps: { shadow: 'lg' } }),
    // Un solo ritmo para todo bloque que se muestra u oculta (submenús, campos que dependen de
    // una elección, avisos): corto para no frenar la carga de datos, con fundido.
    Collapse: Collapse.extend({
      defaultProps: {
        transitionDuration: 200,
        transitionTimingFunction: 'cubic-bezier(0.16, 1, 0.3, 1)',
        animateOpacity: true,
      },
    }),
    // Mantine deselecciona al volver a clickear la opción elegida: un campo obligatorio quedaba
    // vacío sin aviso (p. ej. la oficina preseleccionada de una tarea de inventario). Para
    // vaciar un campo opcional está `clearable`; los filtros tienen su opción "Todas/Todos".
    Select: Select.extend({
      defaultProps: { allowDeselect: false, filter: searchOptionsFilter },
      classNames: { option: dropdownStyles.separatedOption },
    }),
    MultiSelect: MultiSelect.extend({
      defaultProps: { filter: searchOptionsFilter },
      classNames: { option: dropdownStyles.separatedOption },
    }),
    Autocomplete: Autocomplete.extend({
      defaultProps: { filter: searchOptionsFilter },
      classNames: { option: dropdownStyles.separatedOption },
    }),
    Combobox: Combobox.extend({ classNames: { option: dropdownStyles.separatedOption } }),
    Menu: Menu.extend({ classNames: { item: dropdownStyles.separatedOption } }),
    // Toggle "bloque": pista y pulgar cuadrados (mismo radio que los badges) y un
    // deslizamiento lineal y corto. Sólo para encender/apagar una cosa; dos opciones con
    // nombre propio van con SegmentedControl (SYSTEM_PROMPT §3).
    Switch: Switch.extend({
      defaultProps: { radius: 'sm' },
      styles: { thumb: { transitionDuration: '120ms', transitionTimingFunction: 'linear' } },
    }),
  },
})

/** Alto del encabezado fijo del AppShell (DashboardShell); lo que flota debe dejarlo libre. */
export const APP_HEADER_HEIGHT = 72
