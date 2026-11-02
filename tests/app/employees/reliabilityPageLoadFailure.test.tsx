// The reliability leaderboard when the database read fails.
//
// getTeamReliabilityLeaderboard used to return an empty list when either of its two reads failed,
// so /employees/reliability said "No employees found for this view" (or, when only the events
// read failed, scored every employee zero) while the database was down. The real service runs
// here over a mocked Supabase admin client, so the page and the service are tested together: a
// failed read must reach the page as a danger alert under the unchanged header, and a real empty
// result must still show the Empty state.
import { render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const adminFromMock = vi.hoisted(() => vi.fn())

vi.mock('next/navigation', () => ({
  redirect: vi.fn(),
  notFound: vi.fn(),
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/employees/reliability',
}))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ from: adminFromMock }) }))
vi.mock('@/app/actions/rbac', () => ({ checkUserPermission: vi.fn().mockResolvedValue(true) }))
vi.mock('@/app/actions/audit', () => ({ logAuditEvent: vi.fn() }))

import EmployeeReliabilityLeaderboardPage from '@/app/(authenticated)/employees/reliability/page'

type QueryResult = { data: unknown; error: { message: string } | null }

/**
 * A PostgREST-style builder: every filter returns the builder, and awaiting it gives the result.
 * The leaderboard chains select/in/order/range on employees and select/gte/order/range on events
 * (both are read in pages).
 */
function query(result: QueryResult) {
  const builder: Record<string, unknown> = {}
  for (const method of ['select', 'in', 'eq', 'gte', 'order', 'limit', 'range']) {
    builder[method] = vi.fn(() => builder)
  }
  builder.then = (resolve: (value: QueryResult) => unknown, reject?: (reason: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject)
  return builder
}

function tables(results: Record<string, QueryResult>) {
  adminFromMock.mockImplementation((table: string) => {
    const result = results[table]
    if (!result) throw new Error(`Unexpected table ${table}`)
    return query(result)
  })
}

const EMPLOYEE = {
  employee_id: '00000000-0000-4000-8000-000000000001',
  first_name: 'Sam',
  last_name: 'Rowe',
  preferred_name: 'Sam R',
  email_address: 'sam@example.com',
  job_title: 'Bar Staff',
  status: 'Active',
}

async function renderPage(): Promise<void> {
  render(await EmployeeReliabilityLeaderboardPage({ searchParams: Promise.resolve({}) }))
}

function expectFailureShown(): void {
  const alert = screen.getByRole('alert')
  expect(within(alert).getByText('Could not load the leaderboard')).toBeInTheDocument()
  expect(within(alert).getByText(/Could not load the reliability leaderboard/)).toBeInTheDocument()
  // The header and the Employees tab row stay, exactly as on a good load: the page is titled
  // with the sidebar entry that owns the row, and the subtitle names the tab.
  expect(screen.getAllByRole('heading', { level: 1, name: 'Employees' }).length).toBeGreaterThan(0)
  expect(screen.getAllByText('Reliability: shift reliability over the last 90 days').length).toBeGreaterThan(0)
  expect(screen.getAllByRole('tab', { name: 'Reliability' }).length).toBeGreaterThan(0)
  expect(screen.getAllByRole('link', { name: 'Include Former' }).length).toBeGreaterThan(0)
  // Never shown as an empty list, and never as a table of zero scores.
  expect(screen.queryByText('No employees match these filters')).not.toBeInTheDocument()
  expect(screen.queryByText('Ranked')).not.toBeInTheDocument()
  expect(screen.queryByText('Sam R')).not.toBeInTheDocument()
}

describe('/employees/reliability when the leaderboard cannot be read', () => {
  let consoleError: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    adminFromMock.mockReset()
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    consoleError.mockRestore()
  })

  it('shows a danger alert, not an empty leaderboard, when the employees read fails', async () => {
    tables({ employees: { data: null, error: { message: 'connection refused' } } })

    await renderPage()

    expectFailureShown()
    // Raised on our side too, with the database error.
    expect(consoleError).toHaveBeenCalledWith(
      '[employeeReliability] failed to fetch employees for leaderboard',
      expect.objectContaining({ message: expect.stringContaining('connection refused') }),
    )
  })

  it('shows the same alert, not a leaderboard of zero scores, when the events read fails', async () => {
    tables({
      employees: { data: [EMPLOYEE], error: null },
      employee_reliability_events: { data: null, error: { message: 'statement timeout' } },
    })

    await renderPage()

    expectFailureShown()
    expect(consoleError).toHaveBeenCalledWith(
      '[employeeReliability] failed to fetch events',
      expect.objectContaining({ message: expect.stringContaining('statement timeout') }),
    )
  })

  // A late holiday only counts for leave types that count in reliability, so the page needs
  // leave_types to score it. Without them it says it could not load, rather than showing a score
  // that may carry a penalty for days someone cannot work.
  it('shows the same alert, not a score without the leave rules, when leave_types cannot be read', async () => {
    tables({
      employees: { data: [EMPLOYEE], error: null },
      employee_reliability_events: {
        data: [{
          id: 'event-1',
          employee_id: EMPLOYEE.employee_id,
          event_type: 'late_holiday',
          event_at: new Date().toISOString(),
          source: 'holiday_approval',
          idempotency_key: 'late_holiday:leave-1',
          leave_request_id: '10000000-0000-4000-8000-000000000002',
          impacted_shift_count: 0,
          score_eligible: true,
          created_at: new Date().toISOString(),
        }],
        error: null,
      },
      leave_types: { data: null, error: { message: 'permission denied for table leave_types' } },
    })

    await renderPage()

    expectFailureShown()
    expect(consoleError).toHaveBeenCalledWith(
      '[employeeReliability] failed to read leave types for scoring',
      expect.objectContaining({ message: expect.stringContaining('leave_types') }),
    )
  })

  it('still shows Empty when the read works and there really is nobody', async () => {
    tables({ employees: { data: [], error: null } })

    await renderPage()

    expect(screen.getByText('No employees match these filters')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('still lists employees when both reads work', async () => {
    tables({
      employees: { data: [EMPLOYEE], error: null },
      employee_reliability_events: { data: [], error: null },
    })

    await renderPage()

    expect(screen.getAllByRole('link', { name: 'Sam R' }).length).toBeGreaterThan(0)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
