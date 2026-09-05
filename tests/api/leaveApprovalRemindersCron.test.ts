import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({ db: vi.fn(), queue: vi.fn(), send: vi.fn(), auth: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.db }))
vi.mock('@/lib/manager-report/queue', () => ({ queueManagerReportEmail: mocks.queue }))
vi.mock('@/lib/email/emailService', () => ({ sendEmail: mocks.send }))
vi.mock('@/lib/cron-auth', () => ({ authorizeCronRequest: mocks.auth }))
vi.mock('@/app/actions/rota-settings', () => ({ getRotaSettings: async () => ({ managerEmail: 'rota-manager@example.com' }) }))
import { GET } from '@/app/api/cron/leave-approval-reminders/route'

const request = () => new NextRequest('https://example.test/api/cron/leave-approval-reminders')

describe('holiday approval report source', () => {
  const insert = vi.fn()
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-05T10:00:00Z'))
    mocks.auth.mockReturnValue({ authorized: true })
    mocks.queue.mockResolvedValue({ success: true, queued: true })
    mocks.db.mockReturnValue({ from: (table: string) => {
      if (table === 'leave_requests') return { select: () => ({ eq: async () => ({ data: [{
        id: 'leave-1', employee_id: 'employee-1', start_date: '2026-10-20', end_date: '2026-10-22',
        created_at: '2026-09-01T10:00:00Z', status: 'pending',
      }], error: null }) }) }
      if (table === 'leave_reminder_log') return { select: async () => ({ data: [], error: null }), insert }
      if (table === 'employees') return { select: () => ({ in: async () => ({ data: [{ employee_id: 'employee-1', first_name: 'Alex', last_name: 'Rowe' }], error: null }) }) }
      throw new Error(`Unexpected table ${table}`)
    } })
  })
  afterEach(() => vi.useRealTimers())

  it('queues a stable reminder and writes no delivery ledger before the Friday send', async () => {
    const result = await (await GET(request())).json()
    expect(result).toMatchObject({ sent: 0, queued: 1, errors: [] })
    expect(mocks.queue).toHaveBeenCalledWith(expect.objectContaining({
      section: 'holiday_reminders', key: 'leave-1:waiting', to: 'rota-manager@example.com',
      metadata: expect.objectContaining({ leave_request_id: 'leave-1', leave_reminder_kind: 'waiting' }),
    }))
    expect(insert).not.toHaveBeenCalled()
    expect(mocks.send).not.toHaveBeenCalled()
  })

  it('retries queue failure on the next run without consuming the reminder', async () => {
    mocks.queue.mockResolvedValueOnce({ success: false, error: 'queue unavailable' })
    const first = await (await GET(request())).json()
    const second = await (await GET(request())).json()
    expect(first).toMatchObject({ sent: 0, queued: 0, errors: ['Queue failed for leave-1: queue unavailable'] })
    expect(second).toMatchObject({ sent: 0, queued: 1, errors: [] })
    expect(mocks.queue.mock.calls.map(([input]) => input.key)).toEqual(['leave-1:waiting', 'leave-1:waiting'])
    expect(insert).not.toHaveBeenCalled()
    expect(mocks.send).not.toHaveBeenCalled()
  })
})
