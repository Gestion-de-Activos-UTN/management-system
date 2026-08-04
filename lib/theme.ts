import {
  Button,
  createTheme,
  defaultVariantColorsResolver,
  parseThemeColor,
  rgba,
  type MantineColorsTuple,
  type VariantColorsResolver,
} from '@mantine/core';

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
];

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
];

// Mantine's default "light"/"subtle" hover alpha (0.12) reads as almost no
// feedback on the bone/pine palette — bump it up. "subtle" also gets a
// visible border so it doesn't look identical to plain text until hovered.
const variantColorResolver: VariantColorsResolver = (input) => {
  const base = defaultVariantColorsResolver(input);
  const parsed = parseThemeColor({ color: input.color, theme: input.theme });

  if (input.variant === 'light') {
    const shade =
      parsed.shade ?? (input.theme.primaryShade as { light: number }).light;
    const shadeColor = input.theme.colors[parsed.color]?.[shade];
    return shadeColor ? { ...base, hover: rgba(shadeColor, 0.22) } : base;
  }

  if (input.variant === 'subtle') {
    return { ...base, border: `1px solid var(--mantine-color-default-border)` };
  }

  return base;
};

export const theme = createTheme({
  colors: { bone, pine },
  primaryColor: 'pine',
  primaryShade: { light: 6, dark: 4 },
  defaultRadius: 'md',
  autoContrast: true,
  variantColorResolver,
  // System font stack — every browser already ships one of these, no
  // webfont to load/flash.
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, Roboto, Arial, sans-serif',
  fontFamilyMonospace:
    'ui-monospace, "SFMono-Regular", Consolas, "Liberation Mono", monospace',
  headings: {
    fontWeight: '600',
  },
  white: bone[0],
  black: bone[9],
  components: {
    Badge: {
      defaultProps: { radius: 'sm', variant: 'filled' },
    },
    Button: Button.extend({
      styles: (_theme, props) =>
        props.variant === 'subtle'
          ? { root: { borderColor: 'var(--mantine-color-default-border)' } }
          : {},
    }),
  },
});
