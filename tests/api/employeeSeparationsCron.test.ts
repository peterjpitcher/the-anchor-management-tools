import { beforeEach, describe, expect, it, vi } from 'vitest'

const authorizeCronRequestMock = vi.fn()
const createAdminClientMock = vi.fn()
const finalizeEmployeeSeparationMock = vi.fn()

vi.mock('@/lib/cron-auth', () => ({
  authorizeCronRequest: (request: unknown) => authorizeCronRequestMock(request),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => createAdminClientMock(),
}))

vi.mock('@/lib/employees/separation', () => ({
  finalizeEmployeeSeparation: (...args: unknown[]) => finalizeEmployeeSeparationMock(...args),
}))

import { GET } from '@/app/api/cron/employee-separations/route'

describe('/api/cron/employee-separations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authorizeCronRequestMock.mockReturnValue({ authorized: true })
  })

  it('rejects unauthorized cron requests', async () => {
    authorizeCronRequestMock.mockReturnValue({ authorized: false, reason: 'missing' })

    const response = await GET(new Request('http://localhost/api/cron/employee-separations') as any)
    const body = await response.json()

    expect(response.status).toBe(401)
    expect(body.error).toBe('missing')
    expect(createAdminClientMock).not.toHaveBeenCalled()
  })

  it('finalizes employees whose last working day has passed', async () => {
    const adminClient = { from: vi.fn() }
    const order = vi.fn().mockResolvedValue({
      data: [
        {
          employee_id: 'employee-1',
          first_name: 'Alex',
          last_name: 'Rowe',
          employment_end_date: '2026-05-01',
        },
      ],
      error: null,
    })
    const lt = vi.fn().mockReturnValue({ order })
    const not = vi.fn().mockReturnValue({ lt })
    const eq = vi.fn().mockReturnValue({ not })
    const select = vi.fn().mockReturnValue({ eq })

    adminClient.from.mockReturnValue({ select })
    createAdminClientMock.mockReturnValue(adminClient)
    finalizeEmployeeSeparationMock.mockResolvedValue({
      success: true,
      employmentEndDate: '2026-05-01',
      authUserDeleted: true,
    })

    const response = await GET(new Request('http://localhost/api/cron/employee-separations') as any)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.finalized).toBe(1)
    expect(body.skipped).toBe(0)
    expect(eq).toHaveBeenCalledWith('status', 'Started Separation')
    expect(lt).toHaveBeenCalledWith('employment_end_date', expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/))
    expect(finalizeEmployeeSeparationMock).toHaveBeenCalledWith('employee-1', expect.objectContaining({
      adminClient,
      source: 'automatic',
      blockShiftsOnOrAfterToday: true,
    }))
  })
})
