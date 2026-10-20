import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loginErrorMessage } from './use-login'

const error = (status: number, message: string) => ({ status, code: 'request_failed', message })

test('loginErrorMessage: traduce los errores de Payload al iniciar sesión', () => {
  assert.match(
    loginErrorMessage(error(403, 'You are not allowed to perform this action.')),
    /desactivada/
  )
  assert.equal(
    loginErrorMessage(error(401, 'The email or password provided is incorrect.')),
    'El correo o la contraseña no son correctos.'
  )
  assert.match(
    loginErrorMessage(
      error(401, 'This user is locked due to having too many failed login attempts.')
    ),
    /bloqueada/
  )
  assert.equal(loginErrorMessage(error(500, 'boom')), 'No se pudo iniciar sesión. Prueba de nuevo.')
})
