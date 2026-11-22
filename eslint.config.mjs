import { defineConfig } from 'eslint/config'
import nextVitals from 'eslint-config-next/core-web-vitals'
import nextTs from 'eslint-config-next/typescript'
import prettier from 'eslint-config-prettier/flat'

// eslint-config-next 16 ya exporta flat config: se importa directo, sin FlatCompat.
// (FlatCompat lo validaba como eslintrc y fallaba con "Converting circular structure to JSON".)
// Los errores previos a esta configuración están en eslint-suppressions.json (ver COMMANDS.md).
export default defineConfig([
  ...nextVitals,
  ...nextTs,
  prettier,
  {
    ignores: ['.next/**', 'node_modules/**', 'migrations/**'],
  },
  {
    // eslint-plugin-react 7.37 no soporta ESLint 10 al detectar la versión sola
    // (usa context.getFilename, que ESLint 10 eliminó). Mantener alineada con package.json.
    settings: { react: { version: '19.2' } },
  },
  {
    rules: { 'no-alert': 'error' },
  },
])
