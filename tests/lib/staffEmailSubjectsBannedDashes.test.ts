import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { assertCleanText } from '../mocks/emailRenderChecks'

/**
 * Subjects of the rota, holiday and payroll emails, set by the code that sends them rather than
 * by the templates. Each used to carry an en or em dash, which the house style bans. They are
 * rendered with fixture data through the real sender and captured at the transport, and the
 * subject written to rota_email_log is checked too, since it is copied from the same value.
 */

vi.mock('@/lib/email/emailService', () => ({ sendEmail: vi.fn() }))
vi.mock('@/app/actions/rbac', () => ({ checkUserPermission: vi.fn() }))
vi.mock('@/app/actions/audit', () => ({ logAuditEvent: vi.fn() }))
vi.mock('@/app/actions/rota-settings', () => ({ getRotaSettings: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))

// Reliability events are bookkeeping after the email, not part of it.
vi.mock('@/services/employee-reliability', () => ({
  recordHolidayAuditOnly: vi.fn(),
  recordHolidayReliabilityEvents: vi.fn(),
}))

// The payroll workbook is an attachment, not the email text.
vi.mock('@/lib/rota/excel-export', () => ({
  buildPayrollWorkbook: vi.fn(async () => Buffer.from('xlsx fixture')),
  getPayrollFilename: vi.fn(() => 'payroll-2026-08.xlsx'),
}))

vi.mock('@/lib/rota/payroll-period-store', () => ({
  ensurePayrollPeriodsAheadRecords: vi.fn(),
  getOrCreatePayrollPeriodForDateRecord: vi.fn(),
  getOrCreatePayrollPeriodRecord: vi.fn(async () => ({
    id: 'period-2026-08',
    year: 2026,
    month: 8,
    period_start: '2026-07-25',
    period_end: '2026-08-24',
  })),
}))

vi.mock('@/lib/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { sendEmail } from '@/lib/email/emailService'
import { checkUserPermission } from '@/app/actions/rbac'
import { getRotaSettings } from '@/app/actions/rota-settings'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { sendRotaWeekChangeEmails, sendRotaWeekEmails, type DiffShiftRow } from '@/lib/rota/send-rota-emails'
import { submitLeaveRequest } from '@/app/actions/leave'
import { sendPayrollEmail } from '@/app/actions/payroll'
import type { PayrollEmployeeSummary } from '@/lib/rota/email-templates'

type Db = ReturnType<typeof createAdminClient>
type Row = Record<string, unknown>
/** A table's fixture: its rows, or a function of the selected columns for a table read two ways. */
type Seed = Row | Row[] | null | ((columns: string) => Row | Row[] | null)

const CHAIN_METHODS = [
  'update', 'upsert', 'delete',
  'eq', 'neq', 'in', 'is', 'not', 'gt', 'gte', 'lt', 'lte', 'or', 'contains', 'order', 'limit',
]

/**
 * A Supabase stand-in. A list read of a table answers with its fixture rows, a single read with
 * the first of them, and every write succeeds. Filters are ignored: each case seeds only the rows
 * its sender reads. Inserts are recorded per table so the logged subject can be checked.
 */
function fixtureDb(tables: Record<string, Seed>, inserts: Record<string, Row[]> = {}): Db {
  return {
    auth: {
      getUser: async () => ({ data: { user: { id: 'user-1', email: 'manager@example.com' } }, error: null }),
    },
    from(table: string) {
      let columns = ''
      const rows = (): Row[] => {
        const seed = tables[table] ?? null
        const value = typeof seed === 'function' ? seed(columns) : seed
        return value === null ? [] : Array.isArray(value) ? value : [value]
      }
      const builder: Record<string, unknown> = {
        select: (selected?: string) => {
          columns = selected ?? ''
          return builder
        },
        insert: (values: Row | Row[]) => {
          ;(inserts[table] ??= []).push(...(Array.isArray(values) ? values : [values]))
          return builder
        },
        maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
        single: async () => ({ data: rows()[0] ?? null, error: null }),
        then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
          Promise.resolve({ data: rows(), error: null }).then(resolve, reject),
      }
      for (const method of CHAIN_METHODS) builder[method] = () => builder
      return builder
    },
  } as unknown as Db
}

function sentSubjects(): string[] {
  return vi.mocked(sendEmail).mock.calls.map(([options]) => (options as { subject: string }).subject)
}

function loggedSubjects(inserts: Record<string, Row[]>): unknown[] {
  return (inserts.rota_email_log ?? []).map((row) => row.subject)
}

const EMPLOYEE_ID = '33333333-3333-4333-8333-333333333333'
const EMPLOYEE: Row = {
  employee_id: EMPLOYEE_ID,
  first_name: 'Sam',
  last_name: 'Taylor',
  preferred_name: null,
  email_address: 'sam@example.com',
}

// Thursday 1 October 2026, 11am in London.
const NOW = new Date('2026-10-01T10:00:00.000Z')

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
})

afterAll(() => {
  vi.useRealTimers()
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.setSystemTime(NOW)
  vi.mocked(sendEmail).mockResolvedValue({ success: true, messageId: 'email-1' } as never)
  vi.mocked(checkUserPermission).mockResolvedValue(true)
  vi.mocked(getRotaSettings).mockResolvedValue({
    holidayYearStartMonth: 4,
    holidayYearStartDay: 6,
    accountantEmail: 'accounts@example.com',
    managerEmail: 'rota.manager@example.com',
  } as never)
})

describe('rota emails', () => {
  // The week of Monday 5 to Sunday 11 October 2026; Sam works Friday evening.
  const SHIFT: DiffShiftRow = {
    id: 'shift-1',
    employee_id: EMPLOYEE_ID,
    shift_date: '2026-10-09',
    start_time: '17:00',
    end_time: '23:00',
    department: 'bar',
    name: 'Evening bar',
    is_open_shift: false,
    status: 'scheduled',
  }

  it('weekly rota subject reads "to" between the dates', async () => {
    const inserts: Record<string, Row[]> = {}
    vi.mocked(createAdminClient).mockReturnValue(
      fixtureDb({ employees: EMPLOYEE, rota_published_shifts: SHIFT }, inserts)
    )

    const result = await sendRotaWeekEmails('week-1', '2026-10-05')

    expect(result).toEqual({ sent: 1, errors: 0 })
    expect(sentSubjects()).toEqual(['Your shifts: 5 Oct to 11 Oct 2026'])
    expect(loggedSubjects(inserts)).toEqual(['Your shifts: 5 Oct to 11 Oct 2026'])
    assertCleanText(sentSubjects()[0])
  })

  it('rota change subject reads "to" between the dates', async () => {
    const inserts: Record<string, Row[]> = {}
    vi.mocked(createAdminClient).mockReturnValue(fixtureDb({ employees: EMPLOYEE, rota_published_shifts: null }, inserts))

    const result = await sendRotaWeekChangeEmails('week-1', '2026-10-05', [SHIFT], [{ ...SHIFT, start_time: '18:00' }])

    expect(result).toEqual({ sent: 1, errors: 0 })
    expect(sentSubjects()).toEqual(['Your rota has been updated: 5 Oct to 11 Oct 2026'])
    expect(loggedSubjects(inserts)).toEqual(['Your rota has been updated: 5 Oct to 11 Oct 2026'])
    assertCleanText(sentSubjects()[0])
  })
})

describe('holiday request received email', () => {
  it('subject puts a colon before the dates', async () => {
    const inserts: Record<string, Row[]> = {}
    vi.mocked(createClient).mockResolvedValue(
      fixtureDb(
        {
          // The overlap check reads ids and finds none; the insert reads the new request back.
          leave_requests: (columns) =>
            columns === 'id'
              ? null
              : { id: 'leave-1', employee_id: EMPLOYEE_ID, start_date: '2026-11-02', end_date: '2026-11-06', status: 'pending' },
          employees: { email_address: 'sam@example.com', first_name: 'Sam', preferred_name: null },
        },
        inserts
      ) as never
    )

    const result = await submitLeaveRequest({ employeeId: EMPLOYEE_ID, startDate: '2026-11-02', endDate: '2026-11-06' })

    expect(result.success).toBe(true)
    expect(sentSubjects()).toEqual(['Holiday Request Received: 2026-11-02 to 2026-11-06'])
    expect(loggedSubjects(inserts)).toEqual(['Holiday Request Received: 2026-11-02 to 2026-11-06'])
    assertCleanText(sentSubjects()[0])
  })
})

describe('payroll emails', () => {
  function employee(name: string, totalPay: number): PayrollEmployeeSummary {
    return { name, plannedHours: 80, actualHours: 80, standardHours: 80, premiumHours: 0, hourlyRate: 13, totalPay }
  }

  async function sendAugustPayroll(employees: PayrollEmployeeSummary[], inserts: Record<string, Row[]>) {
    vi.mocked(createClient).mockResolvedValue(
      fixtureDb(
        {
          payroll_month_approvals: {
            id: 'approval-1',
            year: 2026,
            month: 8,
            approved_at: '2026-08-26T09:00:00.000Z',
            approved_by: 'user-1',
            snapshot: { rows: [], employees },
            email_sent_at: null,
            email_sent_by: null,
          },
          employees: null,
          profiles: { email: 'manager@example.com' },
        },
        inserts
      ) as never
    )
    return sendPayrollEmail(2026, 8)
  }

  it('payroll and single-employee earnings alert subjects use a colon and brackets', async () => {
    const inserts: Record<string, Row[]> = {}

    const result = await sendAugustPayroll([employee('Busy Bee', 1040), employee('Steady Eddie', 600)], inserts)

    expect(result).toEqual({ success: true })
    expect(sentSubjects()).toEqual([
      'Payroll: August 2026',
      'URGENT: Earnings alert (Busy Bee over £833 in August 2026)',
    ])
    expect(loggedSubjects(inserts)).toEqual(['Payroll: August 2026'])
    for (const subject of sentSubjects()) assertCleanText(subject)
  })

  it('earnings alert subject counts employees when more than one is over', async () => {
    const inserts: Record<string, Row[]> = {}

    await sendAugustPayroll([employee('Busy Bee', 1040), employee('Night Owl', 900)], inserts)

    expect(sentSubjects()[1]).toBe('URGENT: Earnings alert (2 employees over £833 in August 2026)')
    assertCleanText(sentSubjects()[1])
  })
})
