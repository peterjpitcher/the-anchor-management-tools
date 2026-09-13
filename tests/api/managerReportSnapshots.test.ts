import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  auth: vi.fn(), db: vi.fn(), settings: vi.fn(), queue: vi.fn(), recipient: vi.fn(), unfilled: vi.fn(),
}))
vi.mock('@/lib/cron-auth', () => ({ authorizeCronRequest: mocks.auth }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.db }))
vi.mock('@/lib/checklists/settings', () => ({ getChecklistSettings: mocks.settings }))
vi.mock('@/lib/manager-report/queue', () => ({ queueManagerReportEmail: mocks.queue }))
vi.mock('@/lib/rota/manager-email', () => ({ resolveRotaManagerEmail: mocks.recipient }))
vi.mock('@/lib/rota/unfilled-shifts', async (original) => ({
  ...await original<typeof import('@/lib/rota/unfilled-shifts')>(), getUnfilledShifts: mocks.unfilled,
}))

import { GET as checklistSnapshot } from '@/app/api/cron/checklists-weekly-summary/route'
import { GET as rotaSnapshot } from '@/app/api/cron/rota-manager-alert/route'

function fakeDb(failedTable?: string) {
  const from = vi.fn((table: string) => {
    const result = { data: [], count: 0, error: table === failedTable ? { message: 'Database unavailable' } : null }
    const query: Record<string, unknown> = {
      then: (resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve),
    }
    for (const method of ['select', 'gte', 'lt', 'lte', 'not', 'eq', 'in', 'order']) {
      query[method] = vi.fn(() => query)
    }
    return query
  })
  return { from }
}

const request = () => new Request('https://management.orangejelly.co.uk/api/cron/test')

describe('Friday manager report snapshots', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-11T07:00:00Z'))
    mocks.auth.mockReturnValue({ authorized: true })
    mocks.db.mockReturnValue(fakeDb())
    mocks.settings.mockResolvedValue({ moduleEnabled: true, emailsEnabled: true })
    mocks.queue.mockResolvedValue({ success: true, queued: true })
    mocks.recipient.mockResolvedValue({ email: 'manager@the-anchor.pub' })
    mocks.unfilled.mockResolvedValue({ shifts: [], failures: [] })
  })
  afterEach(() => vi.useRealTimers())

  it.each([checklistSnapshot, rotaSnapshot])('rejects unauthorised access before reading data', async (route) => {
    mocks.auth.mockReturnValue({ authorized: false })
    expect((await route(request())).status).toBe(401)
    expect(mocks.db).not.toHaveBeenCalled()
    expect(mocks.queue).not.toHaveBeenCalled()
  })

  it.each(['2026-09-07T07:00:00Z', '2026-09-11T08:00:00Z'])('does not run at old Monday time or Friday send time: %s', async (time) => {
    vi.setSystemTime(new Date(time))
    await checklistSnapshot(request())
    await rotaSnapshot(request())
    expect(mocks.queue).not.toHaveBeenCalled()
    expect(mocks.db).not.toHaveBeenCalled()
  })

  it.each(['2026-03-27T08:00:00Z', '2026-04-03T07:00:00Z', '2026-10-30T08:00:00Z'])('prepares both snapshots at 08:00 London across DST: %s', async (time) => {
    vi.setSystemTime(new Date(time))
    expect((await checklistSnapshot(request())).status).toBe(200)
    expect((await rotaSnapshot(request())).status).toBe(200)
    expect(mocks.queue.mock.calls.map(([input]) => input.section)).toEqual(['checklist_summary', 'rota'])
    expect(mocks.queue.mock.calls.every(([input]) => input.to === 'manager@the-anchor.pub')).toBe(true)
  })

  it('does not turn missing checklist data into an all-clear summary', async () => {
    mocks.db.mockReturnValue(fakeDb('checklist_task_instances'))
    expect((await checklistSnapshot(request())).status).toBe(500)
    expect(mocks.queue).not.toHaveBeenCalled()
  })

  it('respects the checklist email switch', async () => {
    mocks.settings.mockResolvedValue({ moduleEnabled: true, emailsEnabled: false })
    await checklistSnapshot(request())
    expect(mocks.queue).not.toHaveBeenCalled()
  })

  it('reports queue failure rather than claiming either summary was sent', async () => {
    mocks.queue.mockResolvedValue({ success: false, error: 'Queue unavailable' })
    expect((await checklistSnapshot(request())).status).toBe(500)
    const rota = await rotaSnapshot(request())
    expect(rota.status).toBe(500)
    expect(await rota.json()).toMatchObject({ emailSent: false, queued: false, action: 'queue_failed' })
  })
})
