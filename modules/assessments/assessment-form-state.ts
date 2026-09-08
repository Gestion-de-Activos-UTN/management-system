import type { AnswerValue } from '@/domain/assessments/catalog'
import type { SaveAssessmentDraft } from './schema'

export type AssessmentAnswerFields = {
  answer?: AnswerValue
  justification?: string
  evidence_note?: string
}

type QuestionIdentity = { key: string; version: number }

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
      return fields?.answer
        ? [
            {
              question_key: question.key,
              question_version: question.version,
              answer: fields.answer,
              justification: fields.justification,
              evidence_note: fields.evidence_note,
            },
          ]
        : []
    }),
  }
}
