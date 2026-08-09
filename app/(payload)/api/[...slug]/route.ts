import config from '@payload-config'
import {
  REST_DELETE,
  REST_GET,
  REST_OPTIONS,
  REST_PATCH,
  REST_POST,
  REST_PUT,
} from '@payloadcms/next/routes'

// Sin este archivo, Payload nunca recibe tráfico: el array `endpoints` de payload.config.ts
// (incluidos /v1/reports, /v1/heartbeat, /v1/vendor) solo se sirve a través de este catch-all
// de Next — Payload no levanta un servidor HTTP propio, delega el ruteo real a Next.
export const GET = REST_GET(config)
export const POST = REST_POST(config)
export const DELETE = REST_DELETE(config)
export const PATCH = REST_PATCH(config)
export const PUT = REST_PUT(config)
export const OPTIONS = REST_OPTIONS(config)
