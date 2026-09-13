/**
 * The fallback-rate alert has to be able to fire.
 *
 * `final_status = 'fallback_sent'` is written when the replacement text goes out, and for the
 * delayed fallback that is hours after the delivery row was created. The numerator was
 * windowed on `created_at`, so a row created just over a day ago and fallen back this morning
 * counted nowhere: not in the numerator, and not in the denominator either. The `failed`
 * counter beside it already windows on `updated_at`; this one was left behind.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const createAdminClient = vi.hoisted(() => vi.fn())
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient }))
vi.mock('@/lib/email/emailService', () => ({ sendEmail: vi.fn().mockResolvedValue({ success: true }) }))
vi.mock('@/lib/messaging/flags', () => ({ isMessagingFlagOn: vi.fn().mockResolvedValue(false) }))
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }))

type Filter = { column: string; op: string; value: unknown }

/**
 * Records the filters each count applied, and answers with whatever the test says a query
 * shaped like that should return.
 */
function buildClient(answer: (table: string, filters: Filter[]) => number) {
  const seen: Array<{ table: string; filters: Filter[] }> = []

  createAdminClient.mockReturnValue({
    from: (table: string) => ({
      select: () => {
        const filters: Filter[] = []
        const node: any = {
          eq(column: string, value: unknown) {
            filters.push({ column, op: 'eq', value })
            return node
          },
          gte(column: string, value: unknown) {
            filters.push({ column, op: 'gte', value })
            return node
          },
          in(column: string, value: unknown) {
            filters.push({ column, op: 'in', value })
            return node
          },
          then(resolve: (value: { count: number; error: null }) => unknown) {
            seen.push({ table, filters })
            return Promise.resolve({ count: answer(table, filters), error: null }).then(resolve)
          },
        }
        return node
      },
    }),
  })

  return seen
}

function hasFilter(filters: Filter[], column: string, op: string, value?: unknown): boolean {
  return filters.some(
    (filter) =>
      filter.column === column && filter.op === op && (value === undefined || filter.value === value)
  )
}

describe('communications fallback-rate alert', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    process.env = { ...originalEnv }
    process.env.COMMS_ALERT_EMAIL = 'alerts@example.com'
  })

  it('counts fallbacks by when they happened, not by when the delivery was created', async () => {
    const seen = buildClient(() => 0)

    const { runCommunicationsHealthCheck } = await import('@/lib/communications/monitoring')
    await runCommunicationsHealthCheck()

    const fallbackQuery = seen.find(
      (entry) =>
        entry.table === 'notification_deliveries' &&
        hasFilter(entry.filters, 'final_status', 'eq', 'fallback_sent')
    )

    expect(fallbackQuery).toBeDefined()
    expect(hasFilter(fallbackQuery!.filters, 'updated_at', 'gte')).toBe(true)
    expect(hasFilter(fallbackQuery!.filters, 'created_at', 'gte')).toBe(false)
  })

  it('leaves the denominator on when the delivery was attempted', async () => {
    const seen = buildClient(() => 0)

    const { runCommunicationsHealthCheck } = await import('@/lib/communications/monitoring')
    await runCommunicationsHealthCheck()

    const denominator = seen.find(
      (entry) =>
        entry.table === 'notification_deliveries' &&
        entry.filters.length === 1 &&
        hasFilter(entry.filters, 'created_at', 'gte')
    )

    expect(denominator).toBeDefined()
  })

  it('fires when the rate is over the threshold', async () => {
    process.env.COMMS_FALLBACK_RATE_THRESHOLD_PERCENT = '25'
    process.env.COMMS_FALLBACK_MINIMUM_DELIVERIES = '5'

    buildClient((table, filters) => {
      if (table !== 'notification_deliveries') return 0
      if (hasFilter(filters, 'final_status', 'eq', 'fallback_sent')) return 4
      if (hasFilter(filters, 'final_status', 'eq', 'failed')) return 0
      return 10
    })

    const { runCommunicationsHealthCheck } = await import('@/lib/communications/monitoring')
    const report = await runCommunicationsHealthCheck()

    expect(report.metrics.fallbackSent24h).toBe(4)
    expect(report.metrics.fallbackRate).toBe(40)
    expect(report.issues.map((issue) => issue.key)).toContain('fallback_rate')
  })

  it('stays quiet below the minimum number of deliveries', async () => {
    process.env.COMMS_FALLBACK_RATE_THRESHOLD_PERCENT = '25'
    process.env.COMMS_FALLBACK_MINIMUM_DELIVERIES = '5'

    buildClient((table, filters) => {
      if (table !== 'notification_deliveries') return 0
      if (hasFilter(filters, 'final_status', 'eq', 'fallback_sent')) return 2
      if (hasFilter(filters, 'final_status', 'eq', 'failed')) return 0
      return 3
    })

    const { runCommunicationsHealthCheck } = await import('@/lib/communications/monitoring')
    const report = await runCommunicationsHealthCheck()

    expect(report.issues.map((issue) => issue.key)).not.toContain('fallback_rate')
  })
})
