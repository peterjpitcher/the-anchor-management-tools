import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/api/auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api/auth')>('@/lib/api/auth')
  return {
    ...actual,
    withApiAuth: vi.fn(
      async (
        handler: (request: Request, apiKey: unknown) => Promise<Response>,
        _requiredPermissions: string[],
        request?: Request
      ) => handler(request as Request, { id: 'test-key' }),
    ),
  }
})
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))

import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logger'
import { GET } from '@/app/api/table-bookings/periods/route'

// supabase-js hands back errors as plain objects. The live log on 19 October 2026 read only
// '[object Object]' (BK-152).
const PLAIN_ERROR = { code: '57014', message: 'canceling statement due to statement timeout', details: null, hint: null }

function dbWithPeriodReads(results: Array<{ data: unknown; error: unknown }>) {
  const periodReads = [...results]
  let periodCalls = 0
  const client = {
    from(table: string) {
      const query: Record<string, unknown> = {}
      for (const method of ['select', 'eq', 'is', 'lte', 'gte', 'order']) query[method] = () => query
      query.maybeSingle = async () => {
        if (table !== 'booking_periods') return { data: null, error: null }
        periodCalls += 1
        return periodReads.shift() ?? { data: null, error: null }
      }
      return query
    },
    rpc: async () => ({ data: null, error: null }),
  }
  vi.mocked(createAdminClient).mockReturnValue(client as never)
  return { calls: () => periodCalls }
}

function request(date = '2026-11-10') {
  return new Request(`http://localhost/api/table-bookings/periods?date=${date}`) as never
}

describe('GET /api/table-bookings/periods, failed reads (BK-152)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('retries the period read once and answers when the retry works', async () => {
    const db = dbWithPeriodReads([
      { data: null, error: PLAIN_ERROR },
      { data: null, error: null },
    ])

    const response = await GET(request())

    expect(response.status).toBe(200)
    expect(db.calls()).toBe(2)
    expect(logger.error).not.toHaveBeenCalled()
  })

  it('logs the error field by field when both reads fail', async () => {
    const db = dbWithPeriodReads([
      { data: null, error: PLAIN_ERROR },
      { data: null, error: PLAIN_ERROR },
    ])

    const response = await GET(request())

    expect(response.status).toBe(500)
    expect(db.calls()).toBe(2)
    const [message, context] = vi.mocked(logger.error).mock.calls[0]
    expect(message).toBe('Failed to load the seasonal booking period')
    expect(context?.metadata).toEqual(
      expect.objectContaining({
        date: '2026-11-10',
        code: '57014',
        message: 'canceling statement due to statement timeout',
      })
    )
    expect(context?.error?.message).toBe('canceling statement due to statement timeout')
    expect(JSON.stringify(context)).not.toContain('[object Object]')
  })
})
