import type { ReactNode } from 'react'
import { MantineProvider } from '@mantine/core'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { theme } from '@/lib/theme'
import type { DeficiencyItemDTO, PendingItemDTO, ReasonDTO } from '../service'
import { RiskItemList } from './RiskItemList'

const Wrapper = ({ children }: { children: ReactNode }) => (
  <MantineProvider theme={theme}>{children}</MantineProvider>
)

const reason = (overrides: Partial<ReasonDTO>): ReasonDTO => ({
  key: 'r',
  list: 'deficiency',
  class: 'deficiency',
  priority: 'medium',
  reason_code: 'answer_no',
  adjustments: [],
  ...overrides,
})

const organization = {
  kind: 'organization' as const,
  id: 'org',
  label: 'Acme',
  affected_assets: 21,
}

const deficiency: DeficiencyItemDTO = {
  key: 'organization|A.5.15',
  control_key: 'A.5.15',
  priority: 'high',
  subject: organization,
  compliance: 0,
  status: 'non_compliant',
  reasons: [
    reason({
      key: 'organization|A.5.15|A.5.15.access_revocation:no',
      priority: 'high',
      question_key: 'A.5.15.access_revocation',
      option_key: 'no',
    }),
    reason({
      key: 'organization|A.5.15|A.5.15.periodic_review:no',
      priority: 'low',
      class: 'improvement',
      question_key: 'A.5.15.periodic_review',
      option_key: 'no',
    }),
    reason({
      key: 'organization|A.5.15|A.5.15.individual_accounts:no',
      question_key: 'A.5.15.individual_accounts',
      option_key: 'no',
      subordinate_to: 'organization|A.5.15|A.5.15.access_revocation:no',
    }),
    reason({
      key: 'organization|A.5.15|answer_missing',
      list: 'pending',
      class: 'missing_information',
      priority: null,
      reason_code: 'answer_missing',
    }),
  ],
}

const pending = (
  key: string,
  group: PendingItemDTO['group'],
  control_key: string
): PendingItemDTO => ({
  key,
  group,
  control_key,
  importance: group === 'survey' ? null : 3,
  subject: {
    kind: 'asset',
    asset_key: `manual:${key}`,
    asset_label: `Equipo ${key}`,
    criticality: 'low',
  },
  reasons: [
    reason({
      key: `${key}|r`,
      list: 'pending',
      class: 'missing_information',
      priority: null,
      reason_code: 'criticality_assignment',
    }),
  ],
})

describe('RiskItemList', () => {
  it('shows one row per item and keeps low, subordinate and pending reasons inside its detail', async () => {
    render(<RiskItemList list="deficiencies" items={[deficiency]} asOrganization="org-9" />, {
      wrapper: Wrapper,
    })
    const control = screen.getByRole('button', { name: /Organización: Acme · alcanza 21 equipos/ })
    expect(screen.getAllByRole('button')).toHaveLength(1)
    await userEvent.click(control)
    expect(screen.getByText('Baja')).toBeTruthy()
    expect(screen.getByText(/^Consecuencia de: /)).toBeTruthy()
    expect(screen.getByText('Además falta información')).toBeTruthy()
    expect(screen.getByText('También figura en Pendientes.')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Ir a revisiones' }).getAttribute('href')).toBe(
      '/portal/security-review?asOrganization=org-9'
    )
  })

  it('puts each pending group in its own accordion under a real heading, repeated per page', () => {
    // A page that starts in the middle of the survey block still gets its heading.
    const items = [
      pending('a', 'survey', 'A.5.12'),
      pending('b', 'survey', 'A.5.9'),
      pending('c', 'control', 'A.8.13'),
    ]
    const { container } = render(<RiskItemList list="pending" items={items} />, {
      wrapper: Wrapper,
    })
    const headings = screen.getAllByRole('heading', { level: 3 }).map(item => item.textContent)
    expect(headings).toEqual(['Estado del relevamiento', 'Información de controles'])
    const accordions = container.querySelectorAll('[data-accordion]')
    expect(accordions).toHaveLength(2)
    // Headings sit outside the accordions, never between their items.
    for (const accordion of accordions)
      expect(within(accordion as HTMLElement).queryByRole('heading')).toBeNull()
    expect(within(accordions[0] as HTMLElement).getAllByRole('button')).toHaveLength(2)
  })

  it('never claims everything is protected when there are no deficiencies', () => {
    render(<RiskItemList list="deficiencies" items={[]} />, { wrapper: Wrapper })
    expect(screen.getByText(/Esto no significa que todo esté protegido/)).toBeTruthy()
  })
})
