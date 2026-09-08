'use client'

import { useEffect, useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import {
  Accordion,
  Alert,
  Badge,
  Box,
  Button,
  Card,
  Divider,
  Group,
  Modal,
  Radio,
  Stack,
  Text,
  Textarea,
} from '@mantine/core'
import { Save } from 'lucide-react'
import type {
  AssessmentAnswer,
  AssessmentInstance,
  ComplianceResult,
} from '@/app/types/payload-types'
import {
  QUESTION_CATALOG,
  type AnswerValue,
  type QuestionDefinition,
} from '@/domain/assessments/catalog'
import type { SaveAssessmentDraft } from '../schema'
import type { EffectiveAnswer } from '@/domain/assessments/evaluateCompliance'
import {
  assessmentFieldKey,
  buildAssessmentDraft,
  type AssessmentAnswerFields,
} from '../assessment-form-state'

type FormState = { answers: Record<string, AssessmentAnswerFields> }

const practicalExample = (text: string) => {
  const value = text.replace(/^For example,\s*/i, '')
  return value.charAt(0).toLowerCase() + value.slice(1)
}

export function AssessmentForm(props: {
  assessment: AssessmentInstance
  savedAnswers: AssessmentAnswer[]
  previousAnswers?: AssessmentAnswer[]
  effectiveEvidence: Record<string, EffectiveAnswer>
  technicalObservations: ComplianceResult[]
  readOnly: boolean
  saving: boolean
  completing: boolean
  onSave: (data: SaveAssessmentDraft) => void
  onComplete: (data: SaveAssessmentDraft) => void
}) {
  const snapshot = Array.isArray(props.assessment.question_set_snapshot)
    ? props.assessment.question_set_snapshot
    : []
  const questions = snapshot.flatMap(item => {
    if (!item || typeof item !== 'object' || !('key' in item) || !('version' in item)) return []
    const found = QUESTION_CATALOG.find(q => q.key === item.key && q.version === item.version)
    return found ? [found as QuestionDefinition] : []
  })
  const fieldKeyByQuestion = new Map(
    questions.map(question => [question.key, assessmentFieldKey(questions, question.key)])
  )
  const savedAnswerByQuestion = new Map(
    [...(props.previousAnswers ?? []), ...props.savedAnswers].map(row => [row.question_key, row])
  )
  const defaults = Object.fromEntries(
    questions.flatMap((question, index) => {
      const row = savedAnswerByQuestion.get(question.key)
      return row
        ? [
            [
              String(index),
              {
                answer: row.answer,
                justification: row.justification ?? '',
                evidence_note: row.evidence_note ?? '',
              },
            ],
          ]
        : []
    })
  )
  const { control, handleSubmit, watch, reset } = useForm<FormState>({
    defaultValues: { answers: defaults },
  })
  useEffect(() => reset({ answers: defaults }), [props.savedAnswers, props.previousAnswers]) // eslint-disable-line react-hooks/exhaustive-deps
  const values = watch('answers') ?? {}
  const [completionCommand, setCompletionCommand] = useState<SaveAssessmentDraft | null>(null)
  useEffect(() => {
    if (props.assessment.status === 'completed') setCompletionCommand(null)
  }, [props.assessment.status])
  const visible = questions.filter(question =>
    (question.dependencies ?? []).every(
      dependency =>
        dependency.type !== 'requires_question_answer' ||
        dependency.answers.includes(
          values[fieldKeyByQuestion.get(dependency.question_key) ?? '']?.answer as AnswerValue
        )
    )
  )
  const command = (data: FormState): SaveAssessmentDraft =>
    buildAssessmentDraft(questions, visible, data.answers)
  const inheritedAnswer = (questionKey: string) => {
    const evidence = props.effectiveEvidence[questionKey]
    return evidence?.state === 'current' && evidence.candidate.source === 'inherited'
      ? evidence.candidate
      : null
  }
  const answerLabel = (answer: AnswerValue) =>
    answer === 'yes'
      ? 'Yes'
      : answer === 'no'
        ? 'No'
        : answer === 'unknown'
          ? "I don't know"
          : "Doesn't apply"
  const isExpired = (questionKey: string) => {
    const evidence = props.effectiveEvidence[questionKey]
    return evidence?.state === 'not_evaluable' && evidence.reason_code === 'answer_expired'
  }
  const completionCounts = completionCommand
    ? {
        unknown: completionCommand.answers.filter(answer => answer.answer === 'unknown').length,
        notApplicable: completionCommand.answers.filter(
          answer => answer.answer === 'not_applicable'
        ).length,
        unanswered: visible.length - completionCommand.answers.length,
      }
    : null

  return (
    <Stack gap="lg">
      <Card withBorder radius="lg" p={{ base: 'md', sm: 'xl' }}>
        <Stack gap={0}>
          {visible.map((question, index) => (
            <Box key={question.key} py={index === 0 ? 0 : 'xl'}>
              {index > 0 && <Divider mb="xl" />}
              <Stack gap="md">
                <Text size="xs" fw={700} c="pine.7">
                  QUESTION {index + 1} OF {visible.length}
                </Text>
                <div>
                  <Text fw={700} fz="lg">
                    {question.prompt}
                  </Text>
                </div>
                {inheritedAnswer(question.key) && (
                  <Alert color="blue" variant="light">
                    Inherited from the company review:{' '}
                    <Text span fw={700}>
                      {answerLabel(inheritedAnswer(question.key)!.answer)}
                    </Text>
                    . You can answer here only if this office or device works differently.
                  </Alert>
                )}
                {isExpired(question.key) && (
                  <Alert color="gray" variant="light">
                    The previous answer expired. It is now not evaluable and only reduces review
                    coverage; it does not add risk.
                  </Alert>
                )}
                <Controller
                  name={('answers.' + fieldKeyByQuestion.get(question.key) + '.answer') as never}
                  control={control}
                  defaultValue={
                    defaults[fieldKeyByQuestion.get(question.key) ?? '']?.answer as never
                  }
                  render={({ field }) => (
                    <Radio.Group {...field} value={field.value ?? ''}>
                      <Group mt="xs">
                        <Radio value="yes" label="Yes" disabled={props.readOnly} />
                        <Radio value="no" label="No" disabled={props.readOnly} />
                        <Radio value="unknown" label="I don't know" disabled={props.readOnly} />
                        <Radio
                          value="not_applicable"
                          label="Doesn't apply"
                          disabled={props.readOnly}
                        />
                      </Group>
                    </Radio.Group>
                  )}
                />
                {values[fieldKeyByQuestion.get(question.key) ?? '']?.answer ===
                  'not_applicable' && (
                  <Controller
                    name={
                      ('answers.' +
                        fieldKeyByQuestion.get(question.key) +
                        '.justification') as never
                    }
                    control={control}
                    render={({ field }) => (
                      <Textarea
                        {...field}
                        value={field.value ?? ''}
                        label="Why doesn't this apply?"
                        placeholder="A short everyday explanation is enough."
                        required
                        disabled={props.readOnly}
                      />
                    )}
                  />
                )}
                {question.evidence_note_required_for?.includes(
                  values[fieldKeyByQuestion.get(question.key) ?? '']?.answer as 'yes' | 'no'
                ) && (
                  <Controller
                    name={
                      ('answers.' +
                        fieldKeyByQuestion.get(question.key) +
                        '.evidence_note') as never
                    }
                    control={control}
                    render={({ field }) => (
                      <Textarea
                        {...field}
                        value={field.value ?? ''}
                        label="What did you check?"
                        placeholder="For example: recovered last month's price list."
                        required
                        disabled={props.readOnly}
                      />
                    )}
                  />
                )}
                <Text size="sm" c="dimmed" maw={760}>
                  <Text span fw={650} c="gray.7">
                    Why it matters:{' '}
                  </Text>
                  {question.why_it_matters}{' '}
                  <Text span fs="italic">
                    For example, {practicalExample(question.help_text)}
                  </Text>
                </Text>
              </Stack>
            </Box>
          ))}
        </Stack>
      </Card>
      {props.technicalObservations.length > 0 && (
        <Card withBorder radius="lg" p="lg">
          <Text fw={700}>Technical observations</Text>
          <Text size="sm" c="dimmed" mb="md">
            Generated automatically. You do not need to explain ports or network services.
          </Text>
          <Stack gap="sm">
            {props.technicalObservations.map(result => (
              <Alert
                key={result.id}
                color={
                  result.status === 'non_compliant'
                    ? 'red'
                    : result.status === 'compliant'
                      ? 'green'
                      : 'gray'
                }
                title={
                  result.status === 'non_compliant'
                    ? 'Requires attention'
                    : result.status === 'compliant'
                      ? 'Protected'
                      : 'Security could not be verified'
                }
              >
                {result.explanation}
                <Accordion mt="xs">
                  <Accordion.Item value={String(result.id)}>
                    <Accordion.Control>Technical details</Accordion.Control>
                    <Accordion.Panel>{result.service_key}</Accordion.Panel>
                  </Accordion.Item>
                </Accordion>
              </Alert>
            ))}
          </Stack>
        </Card>
      )}
      {!props.readOnly && (
        <Group justify="flex-end">
          <Button
            variant="default"
            leftSection={<Save size={16} />}
            loading={props.saving}
            onClick={handleSubmit(data => props.onSave(command(data)))}
          >
            Save draft
          </Button>
          <Button
            color="pine"
            loading={props.completing}
            onClick={handleSubmit(data => setCompletionCommand(command(data)))}
          >
            Complete review
          </Button>
        </Group>
      )}
      <Modal
        opened={completionCommand !== null}
        onClose={() => setCompletionCommand(null)}
        title="Complete this review?"
        centered
      >
        <Stack gap="md">
          <Group gap="xs">
            <Badge color={completionCounts?.unanswered ? 'orange' : 'green'} variant="light">
              {completionCounts?.unanswered ?? 0} unanswered
            </Badge>
            <Badge color="gray" variant="light">
              {completionCounts?.unknown ?? 0} I don&apos;t know
            </Badge>
            <Badge color="gray" variant="light">
              {completionCounts?.notApplicable ?? 0} doesn&apos;t apply
            </Badge>
          </Group>
          <Text size="sm" c="dimmed">
            Unknown and not-applicable answers reduce coverage but do not add risk.
            {completionCounts?.unanswered
              ? ' Answer every visible question before completing this review.'
              : ''}
          </Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setCompletionCommand(null)}>
              Keep reviewing
            </Button>
            <Button
              color="pine"
              loading={props.completing}
              disabled={Boolean(completionCounts?.unanswered)}
              onClick={() => {
                if (completionCommand) props.onComplete(completionCommand)
              }}
            >
              Complete review
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  )
}
