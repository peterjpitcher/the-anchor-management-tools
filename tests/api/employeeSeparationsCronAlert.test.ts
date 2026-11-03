// The nightly separations job raises an alert for every leaver it cannot finalise (FF-48).
//
// A leaver it could not mark as Former was only listed in the JSON response, which nobody reads,
// so they were skipped again every night unnoticed. Every skip and every follow-up now raises a
// cron alert carrying a link to the record and the reason, but not the person's name.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const authorizeCronRequestMock = vi.fn()
const createAdminClientMock = vi.fn()
const finalizeEmployeeSeparationMock = vi.fn()
const reportCronFailureMock = vi.fn()

vi.mock('@/lib/cron-auth', () => ({
  authorizeCronRequest: (request: unknown) => authorizeCronRequestMock(request),
}))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => createAdminClientMock(),
}))
vi.mock('@/lib/employees/separation', () => ({
  finalizeEmployeeSeparation: (...args: unknown[]) => finalizeEmployeeSeparationMock(...args),
}))
vi.mock('@/lib/cron/alerting', () => ({
  reportCronFailure: (...args: unknown[]) => reportCronFailureMock(...args),
}))
vi.mock('@/lib/env', () => ({ getAppUrl: () => 'https://management.example.test' }))

import type { NextRequest } from 'next/server'
import { GET } from '@/app/api/cron/employee-separations/route'

function adminReturning(rows: unknown[] | null, error: { code: string; message: string } | null = null) {
  const order = vi.fn().mockResolvedValue({ data: rows, error })
  const lt = vi.fn().mockReturnValue({ order })
  const not = vi.fn().mockReturnValue({ lt })
  const eq = vi.fn().mockReturnValue({ not })
  const select = vi.fn().mockReturnValue({ eq })
  createAdminClientMock.mockReturnValue({ from: vi.fn().mockReturnValue({ select }) })
}

const LEAVERS = [
  { employee_id: 'employee-1', first_name: 'Alex', last_name: 'Rowe', preferred_name: null, employment_end_date: '2026-10-30' },
  { employee_id: 'employee-2', first_name: 'Sam', last_name: 'Hale', preferred_name: null, employment_end_date: '2026-10-31' },
]

function request(): NextRequest {
  return new Request('http://localhost/api/cron/employee-separations') as unknown as NextRequest
}

beforeEach(() => {
  vi.clearAllMocks()
  authorizeCronRequestMock.mockReturnValue({ authorized: true })
  reportCronFailureMock.mockResolvedValue(undefined)
})

describe('/api/cron/employee-separations alerts', () => {
  it('alerts with a record link and the reason for each leaver it could not finalise', async () => {
    adminReturning(LEAVERS)
    finalizeEmployeeSeparationMock
      .mockResolvedValueOnce({ success: true, employmentEndDate: '2026-10-30', authUserDeleted: true })
      .mockResolvedValueOnce({
        success: false,
        error: 'This employee still has rota shifts on 5 November 2026. Reassign or cancel those shifts before marking them as Former.',
        code: 'future_rota_shifts',
      })

    const response = await GET(request())
    const body = await response.json()

    expect(body.finalized).toBe(1)
    expect(body.skipped).toBe(1)
    expect(reportCronFailureMock).toHaveBeenCalledOnce()
    const [cronName, error, context] = reportCronFailureMock.mock.calls[0]
    expect(cronName).toBe('employee-separations')
    expect((error as Error).message).toBe('1 leaver(s) could not be marked as Former')
    expect(context).toEqual(expect.objectContaining({
      not_finalised: [{
        record: 'https://management.example.test/employees/employee-2',
        reason: 'This employee still has rota shifts on 5 November 2026. Reassign or cancel those shifts before marking them as Former.',
      }],
      needs_follow_up: [],
      // The words the app uses for the stored Started Separation status.
      outcome: 'Each person not finalised stays on notice and is tried again tomorrow. Clear what is named, or mark them as Former from their record.',
    }))
    expect(JSON.stringify(context)).not.toContain('Started Separation')
    // A link to the record, never the person's name.
    expect(JSON.stringify(context)).not.toContain('Sam')
    expect(JSON.stringify(context)).not.toContain('Hale')
  })

  it('alerts when a leaver was finalised but their login could not be deleted', async () => {
    adminReturning([LEAVERS[0]])
    finalizeEmployeeSeparationMock.mockResolvedValue({
      success: true,
      employmentEndDate: '2026-10-30',
      authUserDeleted: false,
      warning: 'They are now Former and their permissions are removed, but their login could not be deleted. Ask an administrator to delete it.',
    })

    await GET(request())

    expect(reportCronFailureMock).toHaveBeenCalledOnce()
    const [, error, context] = reportCronFailureMock.mock.calls[0]
    expect((error as Error).message).toBe('1 leaver(s) were marked as Former but need a follow-up')
    expect(context).toEqual(expect.objectContaining({
      not_finalised: [],
      needs_follow_up: [expect.objectContaining({ record: 'https://management.example.test/employees/employee-1' })],
    }))
  })

  it('raises no alert when every leaver is finalised cleanly', async () => {
    adminReturning(LEAVERS)
    finalizeEmployeeSeparationMock.mockResolvedValue({ success: true, employmentEndDate: '2026-10-30', authUserDeleted: true })

    await GET(request())

    expect(reportCronFailureMock).not.toHaveBeenCalled()
  })

  it('alerts when the leavers cannot be loaded', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    adminReturning(null, { code: '57014', message: 'timeout' })

    const response = await GET(request())

    expect(response.status).toBe(500)
    expect(reportCronFailureMock).toHaveBeenCalledWith(
      'employee-separations',
      expect.any(Error),
      expect.objectContaining({ code: '57014' }),
    )
  })
})
