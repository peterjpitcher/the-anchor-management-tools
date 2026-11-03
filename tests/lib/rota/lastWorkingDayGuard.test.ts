// Someone on notice cannot be given a shift after their last working day. The last working day
// itself is fine, and a read that fails refuses rather than letting the shift through.

import { describe, expect, it, vi } from 'vitest'
import { shiftAfterLastWorkingDayRefusal } from '@/lib/rota/last-working-day-guard'

type Row = Record<string, unknown>

function adminWith(rows: Row[] | null, error: { code?: string; message: string } | null = null) {
  const eq = vi.fn().mockResolvedValue({ data: rows, error })
  const inFn = vi.fn().mockReturnValue({ eq })
  const select = vi.fn().mockReturnValue({ in: inFn })
  const from = vi.fn().mockReturnValue({ select })
  return { admin: { from } as never, from, select, inFn, eq }
}

const SAM = {
  employee_id: 'sam',
  first_name: 'Samantha',
  last_name: 'Taylor',
  preferred_name: 'Sam',
  status: 'Started Separation',
  employment_end_date: '2026-11-07',
}

describe('shiftAfterLastWorkingDayRefusal', () => {
  it('allows a shift on the last working day itself', async () => {
    const { admin } = adminWith([SAM])
    await expect(shiftAfterLastWorkingDayRefusal(admin, [{ employeeId: 'sam', shiftDate: '2026-11-07' }])).resolves.toBeNull()
  })

  it('refuses a shift the day after, naming the person and their last working day', async () => {
    const { admin, from, inFn, eq } = adminWith([SAM])

    const refusal = await shiftAfterLastWorkingDayRefusal(admin, [{ employeeId: 'sam', shiftDate: '2026-11-08' }])

    expect(refusal).toBe('Sam is leaving, with 7 November 2026 as their last working day, so they cannot be given a shift after it.')
    expect(from).toHaveBeenCalledWith('employees')
    expect(inFn).toHaveBeenCalledWith('employee_id', ['sam'])
    // Only people on notice have a last working day to be past.
    expect(eq).toHaveBeenCalledWith('status', 'Started Separation')
  })

  it('names each person once, however many of their shifts are refused', async () => {
    const { admin } = adminWith([SAM])
    const refusal = await shiftAfterLastWorkingDayRefusal(admin, [
      { employeeId: 'sam', shiftDate: '2026-11-08' },
      { employeeId: 'sam', shiftDate: '2026-11-09' },
      { employeeId: 'sam', shiftDate: '2026-11-06' },
    ])
    expect(refusal?.match(/Sam is leaving/g)).toHaveLength(1)
  })

  it('allows anyone the query does not return as on notice', async () => {
    const { admin } = adminWith([])
    await expect(shiftAfterLastWorkingDayRefusal(admin, [{ employeeId: 'ada', shiftDate: '2099-01-01' }])).resolves.toBeNull()
  })

  it('does not read anything for open shifts or rows without a date', async () => {
    const { admin, from } = adminWith([SAM])
    const refusal = await shiftAfterLastWorkingDayRefusal(admin, [
      { employeeId: null, shiftDate: '2026-11-08' },
      { employeeId: 'sam', shiftDate: null },
    ])
    expect(refusal).toBeNull()
    expect(from).not.toHaveBeenCalled()
  })

  it('refuses when the employees cannot be read', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { admin } = adminWith(null, { code: '57014', message: 'timeout' })
    await expect(shiftAfterLastWorkingDayRefusal(admin, [{ employeeId: 'sam', shiftDate: '2026-11-07' }])).resolves.toBe(
      'Could not check whether anyone on this shift is leaving, so nothing was saved. Please try again.',
    )
  })
})
