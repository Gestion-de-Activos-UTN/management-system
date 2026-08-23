import { test } from 'node:test'
import assert from 'node:assert/strict'
import { inferDeviceCategory } from './inferDeviceCategory'

test('inferDeviceCategory: OS "Windows" con cero puertos confirmados (nmap fingerprint erróneo de un celular real, os_accuracy=100) clasifica mobile sin depender del modelo en el hostname', () => {
  const result = inferDeviceCategory({
    hostname: 'S25-Ultra-de-Andrea.fibertel.com.ar',
    os: { name: 'Microsoft Windows 10 - 11' },
    services: [],
  })
  assert.equal(result.category, 'mobile')
})

test('inferDeviceCategory: no hardcodea modelos de teléfono — un hostname con un modelo no listado (ej. "S26") sigue sin señal de marca, pero cero puertos + OS contradictorio igual lo inclina a mobile', () => {
  const result = inferDeviceCategory({ hostname: 'S26-Ultra-de-Bruno.fibertel.com.ar', os: { name: 'Microsoft Windows 10 - 11' }, services: [] })
  assert.equal(result.category, 'mobile')
})

test('inferDeviceCategory: OS "Windows" con servicios confirmados (SMB) SÍ es una PC real, no se penaliza', () => {
  const result = inferDeviceCategory({ os: { name: 'Microsoft Windows 10 - 11' }, services: [{ port: 445 }] })
  assert.equal(result.category, 'workstation')
  assert.equal(result.tier, 'likely')
})

test('inferDeviceCategory: marca de router en el hostname clasifica gateway aunque vendor esté vacío (bug reportado: Tenda)', () => {
  const result = inferDeviceCategory({ hostname: 'Tenda.fibertel.com.ar', vendor: null, os: { name: 'VxWorks' } })
  assert.equal(result.category, 'gateway')
})

test('inferDeviceCategory: hostname "Docsis-Gateway" clasifica gateway', () => {
  const result = inferDeviceCategory({ hostname: 'Docsis-Gateway.fibertel.com.ar' })
  assert.equal(result.category, 'gateway')
})

test('inferDeviceCategory: hostname genérico ISP-branded ("FlowBox") clasifica gateway', () => {
  const result = inferDeviceCategory({ hostname: 'FlowBox-Z4.fibertel.com.ar' })
  assert.equal(result.category, 'gateway')
})

test('inferDeviceCategory: hostname DESKTOP-* con OS Windows clasifica workstation', () => {
  const result = inferDeviceCategory({ hostname: 'DESKTOP-CEGN2N3.fibertel.com.ar', os: { name: 'Microsoft Windows 10 - 11' } })
  assert.equal(result.category, 'workstation')
})

test('inferDeviceCategory: puerto DHCP server (67/68) clasifica gateway aunque no haya otra señal', () => {
  const result = inferDeviceCategory({ services: [{ port: 67 }, { port: 68 }] })
  assert.equal(result.category, 'gateway')
})

test('inferDeviceCategory: nginx solo (sin DHCP) no alcanza para "likely server" — señal débil por diseño', () => {
  const result = inferDeviceCategory({ services: [{ port: 80, product: 'nginx 1.12.2' }] })
  assert.equal(result.tier, 'possible')
  assert.equal(result.category, 'server')
})

test('inferDeviceCategory: sin hostname/vendor/os/services es unknown, no adivina', () => {
  const result = inferDeviceCategory({})
  assert.equal(result.category, null)
  assert.equal(result.tier, 'unknown')
})

test('inferDeviceCategory: hostname corto/ambiguo ("gm") sin otra señal es unknown', () => {
  const result = inferDeviceCategory({ hostname: 'gm.fibertel.com.ar' })
  assert.equal(result.tier, 'unknown')
})

test('inferDeviceCategory: puerto de impresora clasifica printer con tier likely', () => {
  const result = inferDeviceCategory({ services: [{ port: 9100 }] })
  assert.equal(result.category, 'printer')
  assert.equal(result.tier, 'likely')
})
