import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Closing a forgotten session changes pay, so the cron clears the payroll approval covering its
// work date. When that clear (or the pay period lookup that names it) fails, the run still
// succeeds, the summary names the work dates and the owner is emailed through the cron alert.

const authorizeCronRequestMock = vi.fn()
const createAdminClientMock = vi.fn()
const reportCronFailureMock = vi.fn()

vi.mock('@/lib/cron/alerting', () => ({
  reportCronFailure: (...args: unknown[]) => reportCronFailureMock(...args),
}))
vi.mock('@/lib/cron-auth', () => ({
  authorizeCronRequest: (request: unknown) => authorizeCronRequestMock(request),
}))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => createAdminClientMock(),
}))

import { GET } from '@/app/api/cron/rota-auto-close/route'

const DB_REFUSAL = { message: 'permission denied for table', code: '42501' }

type Options = { periodsError?: boolean; approvalDeleteError?: boolean }

function makeAdmin(options: Options = {}) {
  const sessionUpdates: Array<Record<string, unknown>> = []
  const approvalDeletes: Array<{ year: number; month: number }> = []

  const from = vi.fn((table: string) => {
    if (table === 'timeclock_sessions') {
      return {
        select: vi.fn(() => ({
          is: vi.fn().mockResolvedValue({
            data: [
              { id: 'sess-1', employee_id: 'emp-1', work_date: '2026-07-06', linked_shift_id: null, rota_shifts: null },
              { id: 'sess-2', employee_id: 'emp-2', work_date: '2026-07-06', linked_shift_id: null, rota_shifts: null },
            ],
            error: null,
          }),
        })),
        update: vi.fn((payload: Record<string, unknown>) => {
          sessionUpdates.push(payload)
          return { eq: vi.fn().mockResolvedValue({ error: null }) }
        }),
      }
    }
    if (table === 'payroll_periods') {
      const lookup = options.periodsError
        ? { data: null, error: DB_REFUSAL }
        : { data: [{ year: 2026, month: 7 }], error: null }
      return {
        select: vi.fn(() => ({ lte: vi.fn(() => ({ gte: vi.fn().mockResolvedValue(lookup) })) })),
      }
    }
    if (table === 'payroll_month_approvals') {
      return {
        delete: vi.fn(() => ({
          eq: vi.fn((_yearColumn: string, year: number) => ({
            eq: vi.fn((_monthColumn: string, month: number) => {
              approvalDeletes.push({ year, month })
              return Promise.resolve({ error: options.approvalDeleteError ? DB_REFUSAL : null })
            }),
          })),
        })),
      }
    }
    throw new Error(`Unexpected table: ${table}`)
  })

  createAdminClientMock.mockReturnValue({ from })
  return { sessionUpdates, approvalDeletes }
}

async function runCron(): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await GET(new Request('https://example.test/api/cron/rota-auto-close'))
  return { status: response.status, body: (await response.json()) as Record<string, unknown> }
}

describe('/api/cron/rota-auto-close payroll approval clearing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authorizeCronRequestMock.mockReturnValue({ authorized: true })
    // 05:30 London (BST), inside the cron's 04:00 to 06:00 window.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-07-07T04:30:00Z'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('closes the sessions, names the work date and alerts the owner when the approval delete is refused', async () => {
    const admin = makeAdmin({ approvalDeleteError: true })

    const { status, body } = await runCron()

    expect(status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.closed).toBe(2)
    expect(admin.sessionUpdates).toHaveLength(2)
    expect(body.payrollApprovalsNotCleared).toEqual(['2026-07-06'])
    expect(reportCronFailureMock).toHaveBeenCalledTimes(1)
    const [cronName, error, context] = reportCronFailureMock.mock.calls[0]
    expect(cronName).toBe('rota-auto-close')
    expect((error as Error).message).toBe(
      'The payroll approval could not be cleared for 1 work date(s) after auto-closing sessions',
    )
    expect(context).toMatchObject({ work_dates: ['2026-07-06'] })
  })

  it('names the work date and alerts the owner when the pay period lookup fails', async () => {
    const admin = makeAdmin({ periodsError: true })

    const { status, body } = await runCron()

    expect(status).toBe(200)
    expect(body.closed).toBe(2)
    expect(admin.approvalDeletes).toHaveLength(0)
    expect(body.payrollApprovalsNotCleared).toEqual(['2026-07-06'])
    expect(reportCronFailureMock).toHaveBeenCalledTimes(1)
  })

  it('reports nothing extra when every approval is cleared', async () => {
    const admin = makeAdmin()

    const { status, body } = await runCron()

    expect(status).toBe(200)
    expect(body.closed).toBe(2)
    expect(admin.approvalDeletes).toEqual([
      { year: 2026, month: 7 },
      { year: 2026, month: 7 },
    ])
    expect(body).not.toHaveProperty('payrollApprovalsNotCleared')
    expect(reportCronFailureMock).not.toHaveBeenCalled()
  })
})
