// Marking an employee as Former around midnight, in both test zones.
//
// finalizeEmployeeSeparation defaulted "today" to the UTC date. The cron passes a London date,
// but revoking access by hand does not, so from 00:00 to 00:59 British Summer Time a last working
// day of today was refused as being in the future, and a leaver with no end date was recorded as
// leaving yesterday. The default is now the London date.
//
// Instants are written in UTC so the file reads the same in both test zones: 23:30 UTC on
// 17 September 2026 is 00:30 BST on Friday 18 September in London, but still Thursday in UTC.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/app/actions/audit', () => ({ logAuditEvent: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))

import { finalizeEmployeeSeparation } from '@/lib/employees/separation'
import type { createAdminClient } from '@/lib/supabase/admin'

type AdminClient = ReturnType<typeof createAdminClient>
type QueryCall = { table: string; method: string; args: unknown[] }

// 00:30 BST on Friday 18 September 2026 in London; Thursday 17 September in UTC.
const JUST_AFTER_MIDNIGHT_BST = '2026-09-17T23:30:00Z'
// 23:30 BST on Thursday 17 September 2026: the same day in London and in UTC.
const JUST_BEFORE_MIDNIGHT_BST = '2026-09-17T22:30:00Z'
// Winter control: 00:30 GMT on Thursday 15 January 2026, the same day in both zones.
const JUST_AFTER_MIDNIGHT_GMT = '2026-01-15T00:30:00Z'

const EMPLOYEE_ID = '00000000-0000-4000-8000-000000000001'

/**
 * An admin client whose every query chain records its calls and resolves to an empty result,
 * except the employee lookup (the given row) and the status update (one updated row). No
 * blocking shifts, sessions or leave, so only the last-working-day rule can refuse.
 */
function adminClientFor(employeeRow: Record<string, unknown>) {
  const calls: QueryCall[] = []

  function query(table: string) {
    const methods: string[] = []
    const chain: object = new Proxy({}, {
      get(_target, property) {
        if (property === 'then') {
          const result =
            table === 'employees' && methods.includes('maybeSingle')
              ? { data: employeeRow, error: null }
              : table === 'employees' && methods.includes('update') && methods.includes('select')
                ? { data: [{ employee_id: EMPLOYEE_ID }], error: null }
                : { data: [], error: null }
          return (resolve: (value: unknown) => unknown) => resolve(result)
        }
        return (...args: unknown[]) => {
          calls.push({ table, method: String(property), args })
          methods.push(String(property))
          return chain
        }
      },
    })
    return chain
  }

  const client = {
    from: vi.fn((table: string) => query(table)),
    auth: { admin: { deleteUser: vi.fn().mockResolvedValue({ error: null }) } },
  }
  return { client: client as unknown as AdminClient, calls }
}

function argsOf(calls: QueryCall[], table: string, method: string) {
  return calls.filter(call => call.table === table && call.method === method).map(call => call.args)
}

async function finalizeAt(isoInstant: string, employeeRow: Record<string, unknown>, todayIso?: string) {
  vi.setSystemTime(new Date(isoInstant))
  const { client, calls } = adminClientFor({ auth_user_id: null, email_address: 'alex@example.com', ...employeeRow })
  const result = await finalizeEmployeeSeparation(EMPLOYEE_ID, {
    adminClient: client,
    source: 'manual',
    blockShiftsOnOrAfterToday: false,
    ...(todayIso ? { todayIso } : {}),
  })
  return { result, calls }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ toFake: ['Date'] })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('finalizeEmployeeSeparation default today', () => {
  it('accepts a last working day of today in the first hour of the London day', async () => {
    const { result, calls } = await finalizeAt(JUST_AFTER_MIDNIGHT_BST, {
      status: 'Started Separation',
      employment_end_date: '2026-09-18',
    })

    expect(result).toEqual({ success: true, employmentEndDate: '2026-09-18', authUserDeleted: false })
    expect(argsOf(calls, 'rota_shifts', 'gt')).toEqual([['shift_date', '2026-09-18']])
    expect(argsOf(calls, 'leave_days', 'gt')).toEqual([['leave_date', '2026-09-18']])
  })

  it('records a leaver with no end date as leaving on the London date', async () => {
    const { result, calls } = await finalizeAt(JUST_AFTER_MIDNIGHT_BST, {
      status: 'Active',
      employment_end_date: null,
    })

    expect(result).toEqual({ success: true, employmentEndDate: '2026-09-18', authUserDeleted: false })
    const statusUpdate = argsOf(calls, 'employees', 'update').find(([values]) =>
      (values as Record<string, unknown>).status === 'Former')
    expect(statusUpdate?.[0]).toMatchObject({ status: 'Former', employment_end_date: '2026-09-18' })
  })

  it('still refuses a last working day of tomorrow before midnight', async () => {
    const { result } = await finalizeAt(JUST_BEFORE_MIDNIGHT_BST, {
      status: 'Started Separation',
      employment_end_date: '2026-09-18',
    })

    expect(result).toMatchObject({ success: false, code: 'last_working_day_in_future' })
  })

  it('agrees in both zones in winter', async () => {
    const today = await finalizeAt(JUST_AFTER_MIDNIGHT_GMT, {
      status: 'Started Separation',
      employment_end_date: '2026-01-15',
    })
    expect(today.result).toMatchObject({ success: true, employmentEndDate: '2026-01-15' })

    const tomorrow = await finalizeAt(JUST_AFTER_MIDNIGHT_GMT, {
      status: 'Started Separation',
      employment_end_date: '2026-01-16',
    })
    expect(tomorrow.result).toMatchObject({ success: false, code: 'last_working_day_in_future' })
  })

  it('still uses the date the cron passes in', async () => {
    const { result } = await finalizeAt(
      JUST_AFTER_MIDNIGHT_BST,
      { status: 'Started Separation', employment_end_date: '2026-09-18' },
      '2026-09-17',
    )

    expect(result).toMatchObject({ success: false, code: 'last_working_day_in_future' })
  })
})
