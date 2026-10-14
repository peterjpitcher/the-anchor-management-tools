import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const createAdminClientMock = vi.fn()
const sendEmailMock = vi.fn()
const getUnfilledShiftsMock = vi.fn()
const resolveRotaManagerEmailMock = vi.fn()

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => createAdminClientMock(),
}))

vi.mock('@/lib/email/emailService', () => ({
  sendEmail: (...args: unknown[]) => sendEmailMock(...args),
}))

vi.mock('@/lib/cron-auth', () => ({
  authorizeCronRequest: () => ({ authorized: true }),
}))

vi.mock('@/lib/env', () => ({
  getAppUrl: () => 'https://management.example.test',
}))

vi.mock('@/lib/rota/manager-email', () => ({
  resolveRotaManagerEmail: (...args: unknown[]) => resolveRotaManagerEmailMock(...args),
}))

vi.mock('@/lib/rota/unfilled-shifts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/rota/unfilled-shifts')>()),
  getUnfilledShifts: (...args: unknown[]) => getUnfilledShiftsMock(...args),
}))

import { GET } from '@/app/api/cron/rota-unfilled-urgent/route'

describe('/api/cron/rota-unfilled-urgent log write', () => {
  let consoleError: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-13T06:00:00Z'))
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    getUnfilledShiftsMock.mockResolvedValue({
      shifts: [{
        id: 'shift-1', date: '2026-10-14', startTime: '12:00', endTime: '18:00', department: 'kitchen',
        templateName: 'Lunch', rejectedByName: null, rejectionNote: null,
      }],
      failures: [],
    })
    resolveRotaManagerEmailMock.mockResolvedValue({ email: 'manager@example.test' })
    sendEmailMock.mockResolvedValue({ success: true, messageId: 'email-1' })
  })

  afterEach(() => {
    consoleError.mockRestore()
    vi.useRealTimers()
  })

  // The exact failure from 18 August to 13 October 2026: the alert went out, the row was refused.
  it('reports a refused log row at error level and still reports the alert as sent', async () => {
    const insert = vi.fn().mockResolvedValue({
      error: { code: '23514', message: 'violates check constraint "rota_email_log_email_type_check"', details: null, hint: null },
    })
    createAdminClientMock.mockReturnValue({
      from: (table: string) => {
        if (table === 'rota_email_log') return { insert }
        throw new Error(`Unexpected table ${table}`)
      },
    })

    const response = await GET(new Request('https://example.test/api/cron/rota-unfilled-urgent'))
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload).toMatchObject({ ok: true, action: 'alert_sent', unfilled: 1 })
    expect(sendEmailMock).toHaveBeenCalledTimes(1)
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ email_type: 'unfilled_urgent', status: 'sent' }))
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining('[rota_email_log] Log write failed'),
      expect.objectContaining({ emailType: 'unfilled_urgent', entityId: 'shift-1', code: '23514' }),
    )
  })

  it('stays quiet when the log row is accepted', async () => {
    const insert = vi.fn().mockResolvedValue({ error: null })
    createAdminClientMock.mockReturnValue({ from: () => ({ insert }) })

    const response = await GET(new Request('https://example.test/api/cron/rota-unfilled-urgent'))

    expect(response.status).toBe(200)
    expect(insert).toHaveBeenCalledTimes(1)
    expect(consoleError).not.toHaveBeenCalled()
  })
})
