import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const createAdminClientMock = vi.fn()
const verifyCalendarTokenMock = vi.fn()

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => createAdminClientMock(),
}))

vi.mock('@/lib/portal/calendar-token', () => ({
  verifyCalendarToken: (...args: unknown[]) => verifyCalendarTokenMock(...args),
}))

vi.mock('@/lib/dateUtils', () => ({
  getTodayIsoDate: () => '2026-06-01',
}))

import { GET } from '@/app/api/portal/calendar-feed/route'

describe('/api/portal/calendar-feed', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    verifyCalendarTokenMock.mockReturnValue(true)
  })

  it('denies calendar feeds for employees without active portal status', async () => {
    const maybeSingle = vi.fn().mockResolvedValue({
      data: {
        first_name: 'Alex',
        last_name: 'Rowe',
        status: 'Former',
      },
      error: null,
    })
    const eq = vi.fn().mockReturnValue({ maybeSingle })
    const select = vi.fn().mockReturnValue({ eq })

    createAdminClientMock.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table !== 'employees') throw new Error(`Unexpected table: ${table}`)
        return { select }
      }),
    })

    const response = await GET(new NextRequest('http://localhost/api/portal/calendar-feed?employee_id=employee-1&token=valid'))

    expect(response.status).toBe(403)
    expect(verifyCalendarTokenMock).toHaveBeenCalledWith('employee-1', 'valid')
  })

  it('includes cancellation events for removed staff shifts', async () => {
    const makeOrderedResult = (data: unknown[]) => {
      const secondOrder = vi.fn().mockResolvedValue({ data, error: null })
      const firstOrder = vi.fn().mockReturnValue({ order: secondOrder })
      return { order: firstOrder }
    }

    const employeeMaybeSingle = vi.fn().mockResolvedValue({
      data: {
        first_name: 'Alex',
        last_name: 'Rowe',
        status: 'Active',
      },
      error: null,
    })

    createAdminClientMock.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'employees') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({ maybeSingle: employeeMaybeSingle }),
            }),
          }
        }

        if (table === 'rota_published_shifts') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                gte: vi.fn().mockReturnValue({
                  lte: vi.fn().mockReturnValue({
                    or: vi.fn().mockReturnValue(makeOrderedResult([])),
                  }),
                }),
              }),
            }),
          }
        }

        if (table === 'rota_shift_calendar_cancellations') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                gte: vi.fn().mockReturnValue({
                  lte: vi.fn().mockReturnValue(makeOrderedResult([
                    {
                      shift_id: 'shift-cancelled',
                      shift_date: '2026-06-10',
                      start_time: '09:00',
                      end_time: '17:00',
                      unpaid_break_minutes: 30,
                      department: 'bar',
                      notes: null,
                      is_overnight: false,
                      name: 'Bar',
                      cancelled_at: '2026-06-02T10:00:00Z',
                      reason: 'Rejected by staff',
                    },
                  ])),
                }),
              }),
            }),
          }
        }

        throw new Error(`Unexpected table: ${table}`)
      }),
    })

    const response = await GET(new NextRequest('http://localhost/api/portal/calendar-feed?employee_id=employee-1&token=valid'))
    const body = await response.text()

    expect(response.status).toBe(200)
    expect(body).toContain('UID:staff-shift-shift-cancelled@anchor-management')
    expect(body).toContain('STATUS:CANCELLED')
    expect(body).toContain('Reason: Rejected by staff')
  })
})
