'use client'

import { useState, type ReactNode } from 'react'
import Link from 'next/link'
import {
  Accordion,
  Anchor,
  Box,
  Center,
  Grid,
  Group,
  List,
  Loader,
  Stack,
  Text,
  Title,
} from '@mantine/core'
import { RISK_PAIR_STATUS_LABEL } from '@/lib/enum-labels'
import { portalHref } from '@/lib/portal-href'
import { PRIORITY_RANK } from '@/domain/risk/priority'
import { riskAssetPath } from '@/modules/assets/asset-path'
import {
  ADJUSTMENT_LABEL,
  REASON_CLASS_LABEL,
  controlTitle,
  itemAction,
  questionOfReasonKey,
  questionPrompt,
  reasonLabel,
} from '../risk-labels'
import type { DeficiencyItemDTO, PendingItemDTO, ReasonDTO, RiskList, Subject } from '../service'
import { PriorityBadge } from './PriorityBadge'

type Item = DeficiencyItemDTO | PendingItemDTO

const GROUP_TITLE: Record<PendingItemDTO['group'], string> = {
  survey: 'Estado del relevamiento',
  control: 'Información de controles',
}

const EMPTY: Record<RiskList, string> = {
  // Plan §6: an empty list never claims that everything is protected.
  deficiencies:
    'No hay deficiencias de prioridad media o mayor en lo evaluado. Esto no significa que todo esté protegido: revisa los pendientes y la información disponible.',
  pending: 'No hay información pendiente para lo evaluado.',
}

function subjectText(subject: Subject): string {
  if (subject.kind === 'asset') return subject.asset_label
  const kind = subject.kind === 'office' ? 'Oficina' : 'Organización'
  const reach =
    subject.affected_assets > 0
      ? ` · alcanza ${subject.affected_assets} ${subject.affected_assets === 1 ? 'equipo' : 'equipos'}`
      : ''
  return `${kind}: ${subject.label}${reach}`
}

function pendingSummary(reasons: ReasonDTO[]): string {
  if (reasons.length === 1) return reasonLabel(reasons[0]).title
  if (reasons.every(reason => reason.service_key)) return `${reasons.length} servicios por revisar`
  return `${reasons.length} datos por completar`
}

function ReasonText({ reason }: { reason: ReasonDTO }) {
  const { title, detail } = reasonLabel(reason)
  return (
    <Stack gap={0}>
      <Text size="sm">{title}</Text>
      {detail && (
        <Text size="xs" c="dimmed">
          {detail}
        </Text>
      )}
    </Stack>
  )
}

/**
 * One deficiency reason with its class and adjustments. A subordinate reason (force_zero, §5.6) is
 * context of its cause: no badge of its own and never presented as another deficiency.
 */
function DeficiencyReason({
  reason,
  subordinates,
  itemPriority,
}: {
  reason: ReasonDTO
  subordinates: ReasonDTO[]
  itemPriority: ReasonDTO['priority']
}) {
  return (
    <List.Item>
      <Stack gap={4}>
        {reason.subordinate_to ? (
          <Text size="xs" c="dimmed">
            Consecuencia de: {questionPrompt(questionOfReasonKey(reason.subordinate_to))}
          </Text>
        ) : (
          <Group gap={6} wrap="wrap">
            {/* The row already shows the item priority: repeat it only when it differs. */}
            {reason.priority && reason.priority !== itemPriority && (
              <PriorityBadge priority={reason.priority} size="xs" />
            )}
            <Text size="xs" c="dimmed">
              {REASON_CLASS_LABEL[reason.class]}
            </Text>
          </Group>
        )}
        <ReasonText reason={reason} />
        {reason.adjustments.map(adjustment => (
          <Text key={adjustment} size="xs" fs="italic">
            {ADJUSTMENT_LABEL[adjustment] ?? adjustment}
          </Text>
        ))}
        {subordinates.length > 0 && (
          <List spacing={4} listStyleType="none" withPadding>
            {subordinates.map(sub => (
              <DeficiencyReason
                key={sub.key}
                reason={sub}
                subordinates={[]}
                itemPriority={itemPriority}
              />
            ))}
          </List>
        )}
      </Stack>
    </List.Item>
  )
}

function DeficiencyDetail({ item }: { item: DeficiencyItemDTO }) {
  const deficiency = item.reasons.filter(reason => reason.list === 'deficiency')
  const pending = item.reasons.filter(reason => reason.list === 'pending')
  const keys = new Set(deficiency.map(reason => reason.key))
  // A subordinate reason shows under its cause; if the cause is missing it stays visible on its own.
  const main = deficiency
    .filter(reason => !reason.subordinate_to || !keys.has(reason.subordinate_to))
    .sort((a, b) => PRIORITY_RANK[b.priority ?? 'low'] - PRIORITY_RANK[a.priority ?? 'low'])
  return (
    <Stack gap="sm">
      <List spacing="sm" listStyleType="none">
        {main.map(reason => (
          <DeficiencyReason
            key={reason.key}
            reason={reason}
            subordinates={deficiency.filter(sub => sub.subordinate_to === reason.key)}
            itemPriority={item.priority}
          />
        ))}
      </List>
      {pending.length > 0 && (
        <Stack gap={4}>
          <Text size="sm" fw={600}>
            Además falta información
          </Text>
          <List spacing={4} size="sm">
            {pending.map(reason => (
              <List.Item key={reason.key}>
                <ReasonText reason={reason} />
              </List.Item>
            ))}
          </List>
          <Text size="xs" c="dimmed">
            También figura en Pendientes.
          </Text>
        </Stack>
      )}
    </Stack>
  )
}

/** A single pending reason without detail is already the row summary: nothing to expand. */
const expandable = (item: Item) =>
  'priority' in item || item.reasons.length > 1 || Boolean(reasonLabel(item.reasons[0]).detail)

function PendingDetail({ item }: { item: PendingItemDTO }) {
  return (
    <List spacing={4} size="sm">
      {item.reasons.map(reason => (
        <List.Item key={reason.key}>
          <ReasonText reason={reason} />
        </List.Item>
      ))}
    </List>
  )
}

function ItemLinks({
  item,
  asOrganization,
  mt = 'sm',
}: {
  item: Item
  asOrganization?: string
  mt?: string | number
}) {
  const action = itemAction(item, asOrganization)
  const assetPath = item.subject.kind === 'asset' ? riskAssetPath(item.subject.asset_key) : null
  const assetHref = assetPath ? portalHref(assetPath, asOrganization) : null
  if (!action && !assetHref) return null
  return (
    <Group gap="md" mt={mt}>
      {action && (
        <Anchor component={Link} href={action.href} size="sm" fw={600}>
          {action.label}
        </Anchor>
      )}
      {assetHref && assetHref !== action?.href && (
        <Anchor component={Link} href={assetHref} size="sm">
          Ver equipo
        </Anchor>
      )}
    </Group>
  )
}

function ItemSummary({ item, links }: { item: Item; links?: ReactNode }) {
  const deficiency = 'priority' in item ? item : null
  const status = deficiency
    ? `${RISK_PAIR_STATUS_LABEL[deficiency.status]}${
        deficiency.status === 'partially_effective' && deficiency.compliance !== null
          ? ` (${Math.round(deficiency.compliance * 100)} %)`
          : ''
      }`
    : pendingSummary(item.reasons)
  // Plain text only: an Accordion.Control is a button and must not contain links or tooltips.
  // Table-like row: the badge slot only exists in Deficiencias (every item there has one), so
  // Pendientes starts flush left. Columns from md, left-aligned; below md it stacks.
  return (
    <Group gap="md" wrap="nowrap" align="center" style={{ flex: 1 }}>
      {deficiency && (
        <Box w={88} style={{ flexShrink: 0 }}>
          <PriorityBadge priority={deficiency.priority} fullWidth />
        </Box>
      )}
      <Grid gutter={{ base: 2, md: 'lg' }} style={{ flex: 1, minWidth: 0 }} align="center">
        <Grid.Col span={{ base: 12, md: 4 }}>
          <Text size="sm" fw={600}>
            {controlTitle(item.control_key)}{' '}
            <Text span size="xs" c="dimmed" fw={400}>
              {item.control_key}
            </Text>
          </Text>
        </Grid.Col>
        <Grid.Col span={{ base: 12, md: 3 }}>
          <Text size="sm">{subjectText(item.subject)}</Text>
        </Grid.Col>
        <Grid.Col span={{ base: 12, md: 5 }}>
          <Text size="sm" c="dimmed">
            {status}
          </Text>
          {links}
        </Grid.Col>
      </Grid>
    </Group>
  )
}

/** Consecutive items of the page with the same group: each one is its own Accordion (keyboard). */
function sections(list: RiskList, items: Item[]): Array<{ title: string | null; items: Item[] }> {
  if (list === 'deficiencies') return [{ title: null, items }]
  const result: Array<{ title: string; group: string; items: Item[] }> = []
  for (const item of items as PendingItemDTO[]) {
    const last = result.at(-1)
    if (last?.group === item.group) last.items.push(item)
    else result.push({ title: GROUP_TITLE[item.group], group: item.group, items: [item] })
  }
  return result
}

/**
 * Deficiencias / Pendientes (plan §6, contracts §7) in the server order. Remount it (key) when the
 * page, list or scope changes so open items do not carry over.
 */
export function RiskItemList({
  list,
  items,
  isLoading,
  asOrganization,
}: {
  list: RiskList
  items: Item[]
  isLoading?: boolean
  asOrganization?: string
}) {
  const [opened, setOpened] = useState<string[]>([])
  const refreshing = Boolean(isLoading) && items.length > 0
  if (isLoading && !refreshing)
    return (
      <Center py="xl">
        <Loader color="pine" />
      </Center>
    )
  if (!items.length)
    return (
      <Text c="dimmed" ta="center" py="xl">
        {EMPTY[list]}
      </Text>
    )
  return (
    <Stack
      gap="md"
      aria-busy={refreshing}
      style={{ opacity: refreshing ? 0.55 : 1, transition: 'opacity 150ms ease' }}
    >
      {sections(list, items).map(section => (
        <Stack key={`${section.title}|${section.items[0].key}`} gap="xs">
          {section.title && (
            <Title order={3} size="h5">
              {section.title}
            </Title>
          )}
          <Accordion multiple variant="separated" value={opened} onChange={setOpened}>
            {section.items.map(item =>
              expandable(item) ? (
                <Accordion.Item key={item.key} value={item.key}>
                  <Accordion.Control>
                    <ItemSummary item={item} />
                  </Accordion.Control>
                  <Accordion.Panel>
                    {'priority' in item ? (
                      <DeficiencyDetail item={item} />
                    ) : (
                      <PendingDetail item={item} />
                    )}
                    <ItemLinks item={item} asOrganization={asOrganization} />
                  </Accordion.Panel>
                </Accordion.Item>
              ) : (
                // Nothing to expand: a plain row with the same look and column widths (the right
                // padding takes the place of the chevron), its link under the status.
                <Box
                  key={item.key}
                  px="md"
                  py="sm"
                  bg="light-dark(var(--mantine-color-gray-0), var(--mantine-color-dark-6))"
                  style={{
                    borderRadius: 'var(--mantine-radius-default)',
                    paddingRight: 'calc(var(--mantine-spacing-md) * 2 + 15px)',
                  }}
                >
                  <ItemSummary
                    item={item}
                    links={<ItemLinks item={item} asOrganization={asOrganization} mt={4} />}
                  />
                </Box>
              )
            )}
          </Accordion>
        </Stack>
      ))}
    </Stack>
  )
}
