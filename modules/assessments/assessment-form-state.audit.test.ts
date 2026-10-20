import { expect, it } from 'vitest'
import { assessmentFormResolver } from './assessment-form-state'

it('maps immediate shared-schema errors to the answered question, even when earlier fields are blank', async () => {
  const resolver = assessmentFormResolver([
    { key: 'q1', version: 2 },
    { key: 'q2', version: 2 },
  ])
  const result = await resolver(
    { answers: { '1': { option_key: 'not_applicable', justification: '' } } },
    undefined,
    {} as never
  )
  expect(result.errors).toMatchObject({
    answers: { '1': { justification: { message: 'Explica brevemente por qué no aplica.' } } },
  })
  const valid = await resolver(
    { answers: { '1': { option_key: 'not_applicable', justification: 'Es otro entorno.' } } },
    undefined,
    {} as never
  )
  expect(valid.errors).toEqual({})
})
