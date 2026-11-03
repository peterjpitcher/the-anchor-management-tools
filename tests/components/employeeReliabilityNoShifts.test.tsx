// Reliability for someone with no shifts, a failed read on the employee page, and the Include
// Former link.
//
// FF-51: with no events the formula gives 45 (full discipline and holiday credit, no acceptance),
// which the leaderboard showed as a red score. FF-46: the Reliability tab showed a failed read as an
// empty record. FF-58: the Include Former link dropped the chosen sort order.
import { render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  redirect: vi.fn(),
  notFound: vi.fn(),
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/employees/reliability',
}))
vi.mock('@/app/actions/rbac', () => ({ checkUserPermission: vi.fn().mockResolvedValue(true) }))
vi.mock('@/app/actions/audit', () => ({ logAuditEvent: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))

const leaderboardMock = vi.hoisted(() => vi.fn())
vi.mock('@/services/employee-reliability', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/services/employee-reliability')>()
  return { ...original, getTeamReliabilityLeaderboard: leaderboardMock }
})

import EmployeeReliabilityLeaderboardPage from '@/app/(authenticated)/employees/reliability/page'
import EmployeeReliabilityTab from '@/components/features/employees/EmployeeReliabilityTab'
import {
  calculateBusinessReliabilityScore,
  hasNoShiftSignals,
  type EmployeeReliabilityEvent,
} from '@/lib/employee-reliability-scoring'
import type { TeamReliabilityRow } from '@/services/employee-reliability'

function lateHoliday(): EmployeeReliabilityEvent {
  return {
    id: 'late-1', employee_id: 'e1', event_type: 'late_holiday', event_at: '2026-10-20T09:00:00Z', source: 'test',
    source_table: null, source_id: null, idempotency_key: 'late-1', shift_id: null, leave_request_id: null, week_id: null,
    shift_date: null, start_time: null, end_time: null, department: null, shift_name: null, leave_start_date: null,
    leave_end_date: null, leave_day_count: null, published_at: null, notice_days: 3, impacted_shift_count: 0,
    score_eligible: true, note: null, metadata: null, created_at: '2026-10-20T09:00:00Z',
  }
}

function row(employeeId: string, employeeName: string, events: EmployeeReliabilityEvent[], status = 'Active'): TeamReliabilityRow {
  return {
    employeeId, employeeName, email: `${employeeId}@example.com`, jobTitle: 'Bar Staff', status, rank: null,
    recent: calculateBusinessReliabilityScore(events),
  }
}

describe('hasNoShiftSignals', () => {
  it('is true with no shift events, even when a holiday event gives the formula a score', () => {
    expect(hasNoShiftSignals(calculateBusinessReliabilityScore([]))).toBe(true)
    expect(calculateBusinessReliabilityScore([]).score).toBe(45)
    expect(hasNoShiftSignals(calculateBusinessReliabilityScore([lateHoliday()]))).toBe(true)
    expect(hasNoShiftSignals(calculateBusinessReliabilityScore([{ ...lateHoliday(), event_type: 'shift_accepted' }]))).toBe(false)
  })
})

describe('the leaderboard for someone with no shifts (FF-51)', () => {
  it('shows a neutral "No shifts yet" rather than a red 45, and no Low sample flag', async () => {
    leaderboardMock.mockResolvedValue([row('e1', 'Sam R', []), row('e2', 'Jo R', [], 'Started Separation')])

    const { container } = render(await EmployeeReliabilityLeaderboardPage({ searchParams: Promise.resolve({}) }))

    expect(screen.getAllByText('No shifts yet').length).toBeGreaterThan(0)
    expect(screen.queryByText('45')).not.toBeInTheDocument()
    // The only "Low sample" left is the stat label above the list; no row carries the flag.
    expect(screen.getAllByText('Low sample')).toHaveLength(1)
    // The stats count them as no shifts, not as a low sample.
    const lowSampleStat = screen.getByText('Low sample').parentElement as HTMLElement
    expect(lowSampleStat).toHaveTextContent('0')
    // No danger badge anywhere for them.
    expect(container.innerHTML).not.toMatch(/danger/)
    // The badge under the On Notice tab says On Notice, not the stored status.
    expect(screen.getAllByText(/On Notice/).length).toBeGreaterThan(0)
    expect(screen.queryByText(/Started Separation/)).not.toBeInTheDocument()
  })
})

describe('the Include Former link (FF-58)', () => {
  it('keeps the sort order', async () => {
    leaderboardMock.mockResolvedValue([row('e1', 'Sam R', [])])

    render(await EmployeeReliabilityLeaderboardPage({ searchParams: Promise.resolve({ sort: 'couldnt_work' }) }))

    const link = screen.getAllByRole('link', { name: 'Include Former' })[0]
    expect(link).toHaveAttribute('href', '/employees/reliability?sort=couldnt_work&includeFormer=1')
  })

  it('keeps it when switching back to active only', async () => {
    leaderboardMock.mockResolvedValue([row('e1', 'Sam R', [])])

    render(await EmployeeReliabilityLeaderboardPage({ searchParams: Promise.resolve({ sort: 'late_holidays', includeFormer: '1' }) }))

    const link = screen.getAllByRole('link', { name: 'Active Only' })[0]
    expect(link).toHaveAttribute('href', '/employees/reliability?sort=late_holidays')
  })
})

describe('the Reliability tab on the employee page', () => {
  const empty = calculateBusinessReliabilityScore([])

  it('shows "No shifts yet" in place of a score when there are no shifts (FF-51)', () => {
    render(<EmployeeReliabilityTab reliability={{ employeeId: 'e1', recent: empty, allTime: empty, events: [], loadError: null }} />)

    expect(screen.getAllByText('No shifts yet')).toHaveLength(2)
    expect(screen.queryByText('45')).not.toBeInTheDocument()
    expect(screen.queryByText('Low sample')).not.toBeInTheDocument()
  })

  it('says a failed read failed, rather than showing an empty record (FF-46)', () => {
    render(
      <EmployeeReliabilityTab
        reliability={{ employeeId: 'e1', recent: empty, allTime: empty, events: [], loadError: 'Could not load the reliability events.' }}
      />,
    )

    const alert = screen.getByRole('alert')
    expect(within(alert).getByText('Could not load reliability')).toBeInTheDocument()
    expect(within(alert).getByText(/Could not load the reliability events/)).toBeInTheDocument()
    expect(screen.queryByText('No reliability events yet')).not.toBeInTheDocument()
    expect(screen.queryByText('Last 90 Days')).not.toBeInTheDocument()
  })
})
