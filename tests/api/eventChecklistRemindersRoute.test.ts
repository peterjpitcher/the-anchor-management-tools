import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The event checklist reminder goes out only when a task is overdue (owner, 2 November 2026: "I
 * don't want to receive emails unless there's a problem"). Tasks due today are listed with it, but
 * never send it on their own.
 */

vi.mock('@/lib/email/emailService', () => ({ sendEmail: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/cron-auth', () => ({ authorizeCronRequest: vi.fn(() => ({ authorized: true })) }))
vi.mock('@/lib/api/idempotency', () => ({
  claimIdempotencyKey: vi.fn(async () => ({ state: 'claimed' })),
  computeIdempotencyRequestHash: vi.fn(() => 'request-hash'),
  persistIdempotencyResponse: vi.fn(),
  releaseIdempotencyClaim: vi.fn(),
}))

import { sendEmail } from '@/lib/email/emailService'
import { createAdminClient } from '@/lib/supabase/admin'
import { GET } from '@/app/api/cron/event-checklist-reminders/route'

type Row = Record<string, unknown>

function fixtureDb(tables: Record<string, Row[]>): ReturnType<typeof createAdminClient> {
  return {
    from(table: string) {
      const rows = tables[table] ?? []
      const builder: Record<string, unknown> = {
        then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
          Promise.resolve({ data: rows, error: null }).then(resolve, reject),
      }
      for (const method of ['select', 'gte', 'order', 'in', 'eq']) builder[method] = () => builder
      return builder
    },
  } as unknown as ReturnType<typeof createAdminClient>
}

function run(): Promise<Response> {
  return GET(new Request('http://cron.internal/api/cron/event-checklist-reminders'))
}

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
})

afterAll(() => {
  vi.useRealTimers()
})

beforeEach(() => {
  vi.clearAllMocks()
  // Thursday 1 October 2026, 11:00 London.
  vi.setSystemTime(new Date('2026-10-01T10:00:00.000Z'))
  vi.mocked(sendEmail).mockResolvedValue({ success: true, messageId: 'email-1' } as never)
})

describe('GET /api/cron/event-checklist-reminders', () => {
  it('sends nothing when tasks are only due today', async () => {
    // Launch tasks fall 56 days before the event, so all of them are due today and none is late.
    vi.mocked(createAdminClient).mockReturnValue(
      fixtureDb({ events: [{ id: 'event-1', name: 'Harvest Quiz Night', date: '2026-11-26' }], event_checklist_statuses: [] })
    )

    const response = await run()

    expect(await response.json()).toMatchObject({ success: true, message: 'Nothing overdue', dueToday: 7 })
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('sends when a task is overdue, listing the tasks due today with it', async () => {
    vi.mocked(createAdminClient).mockReturnValue(
      fixtureDb({
        events: [
          { id: 'event-1', name: 'Harvest Quiz Night', date: '2026-10-04' },
          { id: 'event-2', name: 'Bonfire Night', date: '2026-11-26' },
        ],
        event_checklist_statuses: [],
      })
    )

    const response = await run()

    expect(await response.json()).toMatchObject({ success: true, sent: true, overdue: 7, dueToday: 8 })
    expect(sendEmail).toHaveBeenCalledTimes(1)
    const [options] = vi.mocked(sendEmail).mock.calls[0] as unknown as [{ text: string }]
    expect(options.text).toContain('Bonfire Night')
    expect(options.text).toContain('[Due today]')
  })
})
