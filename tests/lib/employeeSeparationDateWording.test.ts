// The dates in marking someone as Former (FF-66 follow-up).
//
// The refusals padded the day ("05 November 2026") while the employee page's Leaving banner beside
// them says "5 November 2026", and the nightly job's note printed the stored dates as they are
// ("Automatically marked as Former on 2026-11-03 after last working day 2026-11-02"). All of them
// now read as the employee page does. Single-digit days, because the 15th looks the same either way.
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/app/actions/audit', () => ({ logAuditEvent: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))

import { finalizeEmployeeSeparation } from '@/lib/employees/separation'
import type { createAdminClient } from '@/lib/supabase/admin'

type AdminClient = ReturnType<typeof createAdminClient>
type QueryCall = { table: string; method: string; args: unknown[] }

const EMPLOYEE_ID = '00000000-0000-4000-8000-000000000001'

/**
 * An admin client whose query chains record their calls and resolve on await. The employee has no
 * login, is on notice with the given last working day, and every write succeeds.
 */
function adminClientFor(options: {
  employmentEndDate: string
  futureShifts?: Array<{ id: string; shift_date: string }>
}) {
  const calls: QueryCall[] = []

  function query(table: string) {
    const methods: string[] = []
    const chain: object = new Proxy({}, {
      get(_target, property) {
        if (property === 'then') {
          let result: unknown = { data: [], error: null }
          if (table === 'employees' && methods.includes('maybeSingle')) {
            result = {
              data: {
                auth_user_id: null,
                email_address: 'alex@example.com',
                status: 'Started Separation',
                employment_end_date: options.employmentEndDate,
              },
              error: null,
            }
          } else if (table === 'employees' && methods.includes('update') && methods.includes('select')) {
            result = { data: [{ employee_id: EMPLOYEE_ID }], error: null }
          } else if (table === 'rota_shifts') {
            result = { data: options.futureShifts ?? [], error: null }
          } else if (methods.includes('update') || methods.includes('delete') || methods.includes('insert')) {
            result = { data: null, error: null }
          }
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

beforeEach(() => {
  vi.clearAllMocks()
})

describe('finalizeEmployeeSeparation dates', () => {
  it('names a last working day still ahead as the Leaving banner does', async () => {
    const { client } = adminClientFor({ employmentEndDate: '2099-05-05' })

    const result = await finalizeEmployeeSeparation(EMPLOYEE_ID, { adminClient: client, todayIso: '2099-05-01' })

    expect(result).toEqual({
      success: false,
      error: 'Their last working day is 5 May 2099. They can be marked as Former from that day.',
      code: 'last_working_day_in_future',
    })
  })

  it('names the blocking shift dates without a leading zero', async () => {
    const { client } = adminClientFor({
      employmentEndDate: '2026-11-02',
      futureShifts: [
        { id: 'shift-1', shift_date: '2026-11-05' },
        { id: 'shift-2', shift_date: '2026-11-06' },
      ],
    })

    const result = await finalizeEmployeeSeparation(EMPLOYEE_ID, { adminClient: client, todayIso: '2026-11-02' })

    expect(result).toEqual(expect.objectContaining({
      success: false,
      error: 'This employee still has rota shifts on 5 November 2026, 6 November 2026. Reassign or cancel those shifts before marking them as Former.',
    }))
  })

  it('writes the nightly note with the dates as the employee page shows them', async () => {
    const { client, calls } = adminClientFor({ employmentEndDate: '2026-11-02' })

    const result = await finalizeEmployeeSeparation(EMPLOYEE_ID, {
      adminClient: client,
      todayIso: '2026-11-03',
      source: 'automatic',
      blockShiftsOnOrAfterToday: true,
    })

    expect(result).toEqual(expect.objectContaining({ success: true }))
    // The untaken holiday note is written too (tests/lib/employeeSeparationUntakenHoliday.test.ts).
    const automaticNotes = calls
      .filter((call) => call.table === 'employee_notes' && call.method === 'insert')
      .map((call) => call.args[0] as { employee_id: string; note_text: string })
      .filter((note) => note.note_text.startsWith('Automatically marked as Former'))
    expect(automaticNotes).toEqual([expect.objectContaining({
      employee_id: EMPLOYEE_ID,
      note_text: 'Automatically marked as Former on 3 November 2026 after last working day 2 November 2026.',
    })])
  })
})
