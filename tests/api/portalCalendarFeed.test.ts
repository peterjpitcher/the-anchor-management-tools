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
})
