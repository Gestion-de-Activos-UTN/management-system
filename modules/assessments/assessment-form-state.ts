import type { SaveAssessmentDraft } from './schema'
import { SaveAssessmentDraftSchema } from './schema'
import type { FieldErrors, Resolver } from 'react-hook-form'

export type AssessmentAnswerFields = {
  option_key?: string
  justification?: string
  evidence_note?: string
}

type QuestionIdentity = { key: string; version: number }
export type AssessmentFormState = { answers: Record<string, AssessmentAnswerFields> }

/** Map the shared wire schema's answer indices back to the form's question indices. */
export function assessmentFormResolver(questions: readonly QuestionIdentity[]): Resolver<AssessmentFormState> {
  return values => {
    const draft = buildAssessmentDraft(questions, questions, values.answers)
    const result = SaveAssessmentDraftSchema.safeParse(draft)
    if (result.success) return { values, errors: {} }
    const errors: FieldErrors<AssessmentFormState> = { answers: {} }
    for (const issue of result.error.issues) {
      const index = issue.path[1]
      const field = issue.path[2]
      if (typeof index !== 'number' || typeof field !== 'string' || !draft.answers[index]) continue
      const key = assessmentFieldKey(questions, draft.answers[index].question_key)
      const fields = errors.answers as Record<string, Record<string, { type: string; message: string }>>
      fields[key] ??= {}
      fields[key][field] = { type: 'validate', message: issue.message }
    }
    return { values: {}, errors }
  }
}

export const assessmentFieldKey = (
  questions: readonly QuestionIdentity[],
  questionKey: string
): string => String(questions.findIndex(question => question.key === questionKey))

export function buildAssessmentDraft(
  questions: readonly QuestionIdentity[],
  visibleQuestions: readonly QuestionIdentity[],
  answers: Record<string, AssessmentAnswerFields>
): SaveAssessmentDraft {
  return {
    answers: visibleQuestions.flatMap(question => {
      const fields = answers[assessmentFieldKey(questions, question.key)]
      return fields?.option_key
        ? [
            {
              question_key: question.key,
              question_version: question.version,
              option_key: fields.option_key,
              justification: fields.justification,
              evidence_note: fields.evidence_note,
            },
          ]
        : []
    }),
  }
}
