import { describe, it, expect, vi, beforeEach } from 'vitest'

/*
 * A data subject access request has to be answered in full. The export used to
 * read the audit history with .limit(1000), so any account with a longer
 * history was handed a silently incomplete file. Three staff accounts already
 * exceed that, the largest holding 3,083 rows, so these tests hold the read to
 * paging through every row in the newest-first order the export has always
 * used, and to failing loudly rather than returning a short export.
 */

type ReadResult = { data: unknown[] | null; error: { message: string } | null }
type RangeCall = { table: string; from: number; to: number }
type OrderCall = { table: string; column: string; ascending: boolean }

type AuditRow = {
  id: string
  user_id: string
  created_at: string
  operation_type: string
  resource_type: string
  operation_status: string
}

const TARGET_USER_ID = '11111111-1111-4111-8111-111111111111'
const AUDIT_ROW_COUNT = 3083
const PAGE_READ_ERROR = 'connection reset by peer'

const PROFILE = {
  id: TARGET_USER_ID,
  email: 'sam.doe@example.com',
  full_name: 'Sam Doe',
}

const state = vi.hoisted(() => ({ client: null as unknown }))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => state.client,
}))

import { GdprService } from '@/services/gdpr'

interface FakeQueryBuilder {
  select: (columns?: string) => FakeQueryBuilder
  eq: (column: string, value: unknown) => FakeQueryBuilder
  in: (column: string, values: unknown[]) => FakeQueryBuilder
  or: (filter: string) => FakeQueryBuilder
  not: (column: string, operator: string, value: unknown) => FakeQueryBuilder
  overlaps: (column: string, values: unknown[]) => FakeQueryBuilder
  order: (column: string, options?: { ascending?: boolean }) => FakeQueryBuilder
  limit: (count: number) => FakeQueryBuilder
  range: (from: number, to: number) => Promise<ReadResult>
  maybeSingle: () => Promise<{ data: unknown; error: null }>
  then: (
    onFulfilled: (value: ReadResult) => unknown,
    onRejected?: (reason: unknown) => unknown,
  ) => Promise<unknown>
}

interface FakeClientConfig {
  auditRows: AuditRow[]
  rangeCalls: RangeCall[]
  orderCalls: OrderCall[]
  /** Zero-based index of the audit page that should come back as a read error. */
  failAuditPageAt?: number
}

const EMPTY_RESULT: ReadResult = { data: [], error: null }

function createFakeAdminClient(config: FakeClientConfig) {
  let auditPage = 0

  return {
    from(table: string): FakeQueryBuilder {
      const builder: FakeQueryBuilder = {
        select: () => builder,
        eq: () => builder,
        in: () => builder,
        or: () => builder,
        not: () => builder,
        overlaps: () => builder,
        order: (column, options) => {
          config.orderCalls.push({ table, column, ascending: options?.ascending !== false })
          return builder
        },
        limit: (count) => {
          // Tripwire for the defect being fixed: a capped audit read cannot be complete.
          if (table === 'audit_logs') {
            throw new Error(`the audit history read must page, it called .limit(${count})`)
          }
          return builder
        },
        range: (from, to) => {
          config.rangeCalls.push({ table, from, to })
          if (table !== 'audit_logs') return Promise.resolve(EMPTY_RESULT)

          const pageIndex = auditPage
          auditPage += 1
          if (config.failAuditPageAt === pageIndex) {
            return Promise.resolve({ data: null, error: { message: PAGE_READ_ERROR } })
          }

          return Promise.resolve({ data: config.auditRows.slice(from, to + 1), error: null })
        },
        maybeSingle: () =>
          Promise.resolve({ data: table === 'profiles' ? PROFILE : null, error: null }),
        then: (onFulfilled, onRejected) => Promise.resolve(EMPTY_RESULT).then(onFulfilled, onRejected),
      }

      return builder
    },
  }
}

/**
 * Rows newest first, one minute apart, built from fixed UTC instants so the
 * fixture does not move with the host time zone.
 */
function buildAuditRows(count: number): AuditRow[] {
  const newest = Date.UTC(2026, 8, 15, 12, 0, 0)

  return Array.from({ length: count }, (_, index) => ({
    id: `audit-${String(index).padStart(4, '0')}`,
    user_id: TARGET_USER_ID,
    created_at: new Date(newest - index * 60_000).toISOString(),
    operation_type: 'update',
    resource_type: 'customer',
    operation_status: 'success',
  }))
}

function setUpExport(options: { rowCount?: number; failAuditPageAt?: number } = {}) {
  const auditRows = buildAuditRows(options.rowCount ?? AUDIT_ROW_COUNT)
  const rangeCalls: RangeCall[] = []
  const orderCalls: OrderCall[] = []

  state.client = createFakeAdminClient({
    auditRows,
    rangeCalls,
    orderCalls,
    failAuditPageAt: options.failAuditPageAt,
  })

  const auditRanges = () =>
    rangeCalls.filter((call) => call.table === 'audit_logs').map((call) => [call.from, call.to])
  const auditOrders = () => orderCalls.filter((call) => call.table === 'audit_logs')

  return { auditRows, auditRanges, auditOrders }
}

describe('GdprService.exportUserData audit history', () => {
  beforeEach(() => {
    state.client = null
  })

  it('exports every audit row for a history longer than one page, newest first', async () => {
    const { auditRows } = setUpExport()

    const result = await GdprService.exportUserData(TARGET_USER_ID)
    const parsed = JSON.parse(result.data) as { auditLogs: AuditRow[] }

    expect(parsed.auditLogs).toHaveLength(AUDIT_ROW_COUNT)
    expect(parsed.auditLogs.map((row) => row.id)).toEqual(auditRows.map((row) => row.id))
    expect(parsed.auditLogs[0].created_at).toBe(auditRows[0].created_at)
    expect(parsed.auditLogs[AUDIT_ROW_COUNT - 1].created_at).toBe(auditRows[AUDIT_ROW_COUNT - 1].created_at)
  })

  it('reads the history a page at a time, ordered so paging is stable', async () => {
    const { auditRanges, auditOrders } = setUpExport()

    await GdprService.exportUserData(TARGET_USER_ID)

    expect(auditRanges()).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
      [3000, 3999],
    ])
    // Each page rebuilds the query, so every one of the four must apply the same
    // sorts: created_at first for the newest-first order the export has always
    // had, then id to break ties and keep rows from moving between pages.
    const expectedOrders = Array.from({ length: 4 }).flatMap(() => [
      { table: 'audit_logs', column: 'created_at', ascending: false },
      { table: 'audit_logs', column: 'id', ascending: false },
    ])
    expect(auditOrders()).toEqual(expectedOrders)
  })

  it('surfaces a failed page instead of returning a short export', async () => {
    const { auditRanges } = setUpExport({ failAuditPageAt: 2 })

    await expect(GdprService.exportUserData(TARGET_USER_ID)).rejects.toThrow(
      `GDPR export audit history failed: ${PAGE_READ_ERROR}`,
    )
    expect(auditRanges()).toHaveLength(3)
  })

  it('leaves the shape of the export file unchanged', async () => {
    setUpExport({ rowCount: 5 })

    const result = await GdprService.exportUserData(TARGET_USER_ID, 'manager-user-id')
    const parsed = JSON.parse(result.data) as Record<string, unknown>

    expect(Object.keys(parsed)).toEqual([
      'profile',
      'customers',
      'bookings',
      'tableBookings',
      'privateBookings',
      'parkingBookings',
      'messages',
      'emailMessages',
      'customerConsents',
      'unmatchedCommunications',
      'webhookLogs',
      'storageAttachmentRefs',
      'employees',
      'auditLogs',
    ])
    expect(parsed.profile).toEqual(PROFILE)
    expect(result.mimeType).toBe('application/json')
    expect(result.fileName).toMatch(/^gdpr-export-.+-\d{4}-\d{2}-\d{2}\.json$/)
    expect(result.requestedBy).toBe('manager-user-id')
  })
})
