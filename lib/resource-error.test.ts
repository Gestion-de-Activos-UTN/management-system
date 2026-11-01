import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resourceErrorMessage } from './resource-error'

test('404 never reveals resource existence or tenant details from the API message', () => {
  const missing = resourceErrorMessage({ status: 404, message: 'Not found' }, 'esta tarea')
  const outsideScope = resourceErrorMessage(
    { status: 404, message: 'Private organization and office details' },
    'esta tarea'
  )
  assert.deepEqual(outsideScope, missing)
  assert.equal(missing.retryable, false)
  assert.match(missing.description, /no tengas acceso/)
})

test('403 explains missing permission without exposing server details', () => {
  const message = resourceErrorMessage({ status: 403, message: 'Internal rule' }, 'este activo')
  assert.match(message.title, /No tienes permiso/)
  assert.equal(message.retryable, false)
  assert.doesNotMatch(JSON.stringify(message), /Internal rule/)
})

test('expired sessions require login, while network and server failures allow retry', () => {
  assert.equal(resourceErrorMessage({ status: 401 }, 'esta revisión').retryable, false)
  assert.match(resourceErrorMessage({ status: 401 }, 'esta revisión').description, /iniciar sesión/)
  for (const error of [new TypeError('Failed to fetch'), { status: 500 }, { status: 503 }]) {
    assert.equal(resourceErrorMessage(error, 'esta revisión').retryable, true)
  }
  assert.equal(resourceErrorMessage(null, 'esta revisión').retryable, false)
})
