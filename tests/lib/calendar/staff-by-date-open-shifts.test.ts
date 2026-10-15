import { describe, expect, it, vi, afterEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { readStaffByDate } from '@/lib/calendar/datasets'
import { createFakeSupabase } from '../../helpers/fakeSupabase'

/**
 * Open shifts on the rota have no employee. The calendar's "who is working" read turned
 * each one into the text "null" and asked for `employee_id=in.(...,null,...)`; Postgres
 * answered 400 (invalid input syntax for type uuid: "null") and every name vanished from
 * the events calendar. Seen in production on 7 and 9 October 2026.
 *
 * The fake is told employee_id is a uuid column, so it refuses a non-uuid the way
 * Postgres does. Without that it matches anything and this fault cannot show.
 */
const SAM = '5723ebbd-12f8-42f2-9a75-7adfde211e61'
const ALEX = '1db973b0-99d9-47d3-8a39-56c1ec4e3a32'

function client() {
  return createFakeSupabase(
    {
      rota_shifts: [
        { id: 'a', employee_id: SAM, shift_date: '2026-10-07', start_time: '09:00:00' },
        { id: 'b', employee_id: null, shift_date: '2026-10-07', start_time: '12:00:00' },
        { id: 'c', employee_id: ALEX, shift_date: '2026-10-08', start_time: '17:00:00' },
        { id: 'd', employee_id: null, shift_date: '2026-10-09', start_time: '17:00:00' },
      ],
      employees: [
        { employee_id: SAM, first_name: 'Sam', last_name: 'Jones', preferred_name: null },
        { employee_id: ALEX, first_name: 'Alex', last_name: 'Smith', preferred_name: null },
      ],
    },
    { uuidColumns: { employees: ['employee_id'], rota_shifts: ['employee_id'] } },
  )
}

describe('readStaffByDate with open shifts', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('the strict fake refuses a null in a uuid list, as Postgres does', async () => {
    const fake = client()
    const { data, error } = await fake.from('employees').select('employee_id').in('employee_id', [SAM, 'null'])
    expect(data).toBeNull()
    expect(error).toEqual({ code: '22P02', message: 'invalid input syntax for type uuid: "null"' })
  })

  it('still names the staff on days that also have an open shift', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    const result = await readStaffByDate(
      client() as unknown as SupabaseClient,
      '2026-10-01',
      '2026-10-31',
    )

    expect(consoleError).not.toHaveBeenCalled()
    expect(result.status).toBe('ok')
    const byDate = Object.fromEntries(result.data.map((day) => [day.date, day.staff]))
    expect(byDate).toEqual({
      '2026-10-07': ['Sam'],
      '2026-10-08': ['Alex'],
    })
  })
})
