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
import { RISK_QUESTIONS_V2, type RiskQuestionV2 } from '@/domain/risk/catalog-v2'
import type { SaveAssessmentDraft } from '../schema'
import type { EffectiveAnswer } from '@/domain/assessments/evaluateCompliance'
import {
  assessmentFieldKey,
  buildAssessmentDraft,
  type AssessmentAnswerFields,
} from '../assessment-form-state'

type FormState = { answers: Record<string, AssessmentAnswerFields> }

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
    const found = RISK_QUESTIONS_V2.find(q => q.key === item.key && q.version === item.version)
    return found ? [found as RiskQuestionV2] : []
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
                option_key: row.option_key,
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
  const visible = questions
  const command = (data: FormState): SaveAssessmentDraft =>
    buildAssessmentDraft(questions, visible, data.answers)
  const inheritedAnswer = (questionKey: string) => {
    const evidence = props.effectiveEvidence[questionKey]
    return evidence?.state === 'current' && evidence.candidate.source === 'inherited'
      ? evidence.candidate
      : null
  }
  const answerLabel = (questionKey: string, answer: string) =>
    questions
      .find(question => question.key === questionKey)
      ?.options.find(option => option.key === answer)?.label ?? answer
  const isExpired = (questionKey: string) => {
    const evidence = props.effectiveEvidence[questionKey]
    return evidence?.state === 'not_evaluable' && evidence.reason_code === 'answer_expired'
  }
  const completionCounts = completionCommand
    ? {
        unknown: completionCommand.answers.filter(answer => answer.option_key === 'unknown').length,
        notApplicable: completionCommand.answers.filter(
          answer => answer.option_key === 'not_applicable'
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
                  PREGUNTA {index + 1} DE {visible.length}
                </Text>
                <div>
                  <Text fw={700} fz="lg">
                    {question.prompt}
                  </Text>
                </div>
                {inheritedAnswer(question.key) && (
                  <Alert color="blue" variant="light">
                    Heredado de la revisión de la empresa:{' '}
                    <Text span fw={700}>
                      {answerLabel(question.key, inheritedAnswer(question.key)!.option_key)}
                    </Text>
                    . Solo puedes responder aquí si esta oficina o dispositivo funciona de manera
                    diferente.
                  </Alert>
                )}
                {isExpired(question.key) && (
                  <Alert color="gray" variant="light">
                    La respuesta anterior venció. Ahora no es evaluable y solo reduce la cobertura
                    de la revisión; no agrega riesgo.
                  </Alert>
                )}
                <Controller
                  name={
                    ('answers.' + fieldKeyByQuestion.get(question.key) + '.option_key') as never
                  }
                  control={control}
                  defaultValue={
                    defaults[fieldKeyByQuestion.get(question.key) ?? '']?.option_key as never
                  }
                  render={({ field }) => (
                    <Radio.Group {...field} value={field.value ?? ''}>
                      <Stack mt="xs" gap="xs">
                        {question.options.map(option => (
                          <Radio
                            key={option.key}
                            value={option.key}
                            label={option.label}
                            disabled={props.readOnly}
                          />
                        ))}
                      </Stack>
                    </Radio.Group>
                  )}
                />
                {values[fieldKeyByQuestion.get(question.key) ?? '']?.option_key ===
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
                        label="¿Por qué no aplica?"
                        placeholder="Una breve explicación cotidiana es suficiente."
                        required
                        disabled={props.readOnly}
                      />
                    )}
                  />
                )}
                <Text size="sm" c="dimmed" maw={760}>
                  <Text span fw={650}>
                    Ayuda para responder:{' '}
                  </Text>
                  {question.help_text}
                </Text>
              </Stack>
            </Box>
          ))}
        </Stack>
      </Card>
      {props.technicalObservations.length > 0 && (
        <Card withBorder radius="lg" p="lg">
          <Text fw={700}>Observaciones técnicas</Text>
          <Text size="sm" c="dimmed" mb="md">
            Generado automáticamente. No necesitas explicar puertos ni servicios de red.
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
                    ? 'Requiere atención'
                    : result.status === 'compliant'
                      ? 'Protegido'
                      : 'No se pudo verificar la seguridad'
                }
              >
                {result.explanation}
                <Accordion mt="xs">
                  <Accordion.Item value={String(result.id)}>
                    <Accordion.Control>Detalles técnicos</Accordion.Control>
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
            Guardar borrador
          </Button>
          <Button
            color="pine"
            loading={props.completing}
            onClick={handleSubmit(data => setCompletionCommand(command(data)))}
          >
            Completar revisión
          </Button>
        </Group>
      )}
      <Modal
        opened={completionCommand !== null}
        onClose={() => setCompletionCommand(null)}
        title="¿Completar esta revisión?"
        centered
      >
        <Stack gap="md">
          <Group gap="xs">
            <Badge color={completionCounts?.unanswered ? 'orange' : 'green'} variant="light">
              {completionCounts?.unanswered ?? 0} sin responder
            </Badge>
            <Badge color="gray" variant="light">
              {completionCounts?.unknown ?? 0} No lo sé
            </Badge>
            <Badge color="gray" variant="light">
              {completionCounts?.notApplicable ?? 0} no aplica
            </Badge>
          </Group>
          <Text size="sm" c="dimmed">
            Las respuestas desconocidas y las que no aplican reducen la cobertura, pero no agregan
            riesgo.
            {completionCounts?.unanswered
              ? ' Responde todas las preguntas antes de completar la revisión.'
              : ''}
          </Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setCompletionCommand(null)}>
              Seguir revisando
            </Button>
            <Button
              color="pine"
              loading={props.completing}
              disabled={Boolean(completionCounts?.unanswered)}
              onClick={() => {
                if (completionCommand) props.onComplete(completionCommand)
              }}
            >
              Completar revisión
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  )
}
