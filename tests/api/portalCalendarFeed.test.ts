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

  describe('someone on notice (today is 1 June 2026)', () => {
    /** Every table answers with the given row for the employee and nothing else. */
    function adminFor(employee: Record<string, unknown>) {
      const tables: string[] = []
      const chain = (result: { data: unknown; error: null }): Record<string, unknown> => {
        const query: Record<string, unknown> = {}
        for (const method of ['select', 'eq', 'gte', 'lte', 'or', 'order']) query[method] = () => query
        query.maybeSingle = async () => result
        query.then = (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve)
        return query
      }
      createAdminClientMock.mockReturnValue({
        from: vi.fn((table: string) => {
          tables.push(table)
          return table === 'employees' ? chain({ data: employee, error: null }) : chain({ data: [], error: null })
        }),
      })
      return tables
    }

    it('still serves the calendar on their last working day', async () => {
      const tables = adminFor({ first_name: 'Sam', last_name: 'Taylor', status: 'Started Separation', employment_end_date: '2026-06-01' })

      const response = await GET(new NextRequest('http://localhost/api/portal/calendar-feed?employee_id=employee-1&token=valid'))

      expect(response.status).toBe(200)
      expect(tables).toContain('rota_published_shifts')
    })

    it('refuses the calendar once their last working day has passed, as for a former employee', async () => {
      const tables = adminFor({ first_name: 'Sam', last_name: 'Taylor', status: 'Started Separation', employment_end_date: '2026-05-31' })

      const response = await GET(new NextRequest('http://localhost/api/portal/calendar-feed?employee_id=employee-1&token=valid'))

      expect(response.status).toBe(403)
      expect(tables).toEqual(['employees'])
    })
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
