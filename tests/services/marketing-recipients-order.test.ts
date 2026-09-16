import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Paging by offset needs a total order, or pages repeat and skip people.
 *
 * Marketing recipients are written by one `insert ... select`, so every recipient of a campaign
 * shares a single `created_at`: on 15 September 2026 all eleven campaigns with recipients had
 * exactly one distinct timestamp across their rows, 253 recipients on the largest. Ordering by a
 * column every row ties on leaves the database free to return those rows in any order it likes,
 * per request, so an offset-paged list can show a staff member the same person twice and never
 * show them somebody else.
 *
 * The fake below models that worst case rather than hoping for it: it rotates the matching rows
 * by a different amount on every request before sorting. The sort is stable, so tied rows keep
 * that rotated order while any column that genuinely distinguishes the rows still sorts
 * correctly. A read with a total order is therefore unaffected; a read ordered only by a tied
 * column, or by nothing at all, comes back in a different order each time, which is exactly what
 * Postgres is entitled to do. The rotation is deterministic, so the test is too.
 */

type Row = Record<string, unknown>

interface OrderSpec {
  column: string
  ascending: boolean
}

interface QueryResult {
  data: unknown
  error: { message: string } | null
  count?: number
}

interface RecordedRead {
  table: string
  orderedBy: string[]
}

const state = vi.hoisted(() => ({
  client: null as unknown,
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => state.client,
}))

// The click attribution reads are a separate concern with their own tables; stub the two that
// touch the database so this test is about paging order and nothing else.
vi.mock('@/lib/email/marketing/attribution', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/email/marketing/attribution')>()),
  fetchCampaignLinks: vi.fn(async () => []),
  fetchClicksForLinks: vi.fn(async () => []),
}))

function compare(left: unknown, right: unknown): number {
  if (left === right) return 0
  if (left == null) return -1
  if (right == null) return 1
  if (typeof left === 'number' && typeof right === 'number') return left < right ? -1 : 1
  return String(left) < String(right) ? -1 : 1
}

/** A different starting point on every request, so no two reads agree about tied rows. */
function rotate(rows: Row[], requestCount: number): Row[] {
  if (rows.length === 0) return rows
  const offset = (requestCount * 137) % rows.length
  return [...rows.slice(offset), ...rows.slice(0, offset)]
}

function sortRows(rows: Row[], orders: OrderSpec[]): Row[] {
  if (orders.length === 0) return rows

  // Array.prototype.sort is stable, so rows equal on every ordered column keep the order they
  // arrived in, which is the rotation applied above.
  return [...rows].sort((a, b) => {
    for (const { column, ascending } of orders) {
      const result = compare(a[column], b[column])
      if (result !== 0) return ascending ? result : -result
    }
    return 0
  })
}

function createFakeDb(tables: Record<string, Row[]>) {
  const reads: RecordedRead[] = []
  let requestCount = 0

  function from(table: string) {
    const filters: Array<(row: Row) => boolean> = []
    const orders: OrderSpec[] = []
    let range: { from: number; to: number } | null = null
    let wantsOneRow = false

    function execute(): QueryResult {
      requestCount += 1
      reads.push({ table, orderedBy: orders.map((order) => order.column) })

      const matched = (tables[table] ?? []).filter((row) => filters.every((filter) => filter(row)))
      const ordered = sortRows(rotate(matched, requestCount), orders)
      const total = ordered.length
      const paged = range ? ordered.slice(range.from, range.to + 1) : ordered

      if (wantsOneRow) return { data: paged[0] ?? null, error: null }
      return { data: paged, error: null, count: total }
    }

    const builder = {
      select(_columns?: string, _options?: { count?: 'exact' }) {
        return builder
      },
      eq(column: string, value: unknown) {
        filters.push((row) => row[column] === value)
        return builder
      },
      in(column: string, values: unknown[]) {
        filters.push((row) => values.includes(row[column]))
        return builder
      },
      order(column: string, options?: { ascending?: boolean }) {
        orders.push({ column, ascending: options?.ascending !== false })
        return builder
      },
      range(fromIndex: number, toIndex: number) {
        range = { from: fromIndex, to: toIndex }
        return builder
      },
      maybeSingle() {
        wantsOneRow = true
        return builder
      },
      then<TFulfilled = QueryResult, TRejected = never>(
        onfulfilled?: ((value: QueryResult) => TFulfilled | PromiseLike<TFulfilled>) | null,
        onrejected?: ((reason: unknown) => TRejected | PromiseLike<TRejected>) | null,
      ): PromiseLike<TFulfilled | TRejected> {
        return Promise.resolve(execute()).then(onfulfilled, onrejected)
      },
    }

    return builder
  }

  return { from, reads }
}

const CAMPAIGN_ID = 'campaign-1'
/** One `insert ... select`, so one timestamp for the lot. */
const SHARED_CREATED_AT = '2026-09-15T09:00:00.000Z'

function campaignRow(id: string): Row {
  return {
    id,
    name: 'September round-up',
    subject: 'What is on this month',
    preheader: 'A quick look at September',
    content: { blocks: [] },
    content_schema_version: 1,
    renderer_version: 1,
    audience_type: 'business',
    audience: { include_tags: [], exclude_tags: [] },
    audience_version: 1,
    status: 'sent',
    scheduled_for: null,
    created_at: SHARED_CREATED_AT,
    updated_at: SHARED_CREATED_AT,
  }
}

function recipientRows(count: number, statusAt: (index: number) => string): Row[] {
  return Array.from({ length: count }, (_unused, index) => ({
    // Zero padded so the string sort the fake uses matches the numeric order a uuid-free test
    // reader expects.
    id: `recipient-${String(index).padStart(4, '0')}`,
    campaign_id: CAMPAIGN_ID,
    contact_id: `contact-${index}`,
    email: `person${index}@example.com`,
    status: statusAt(index),
    email_message_id: null,
    created_at: SHARED_CREATED_AT,
    updated_at: SHARED_CREATED_AT,
  }))
}

describe('marketing recipient paging order', () => {
  let db: ReturnType<typeof createFakeDb>

  function useDb(tables: Record<string, Row[]>): void {
    db = createFakeDb(tables)
    state.client = db
  }

  beforeEach(() => {
    vi.resetModules()
  })

  it('returns every recipient once when all 253 share one created_at', async () => {
    useDb({
      marketing_campaigns: [campaignRow(CAMPAIGN_ID)],
      marketing_campaign_recipients: recipientRows(253, () => 'sent'),
    })

    const { listRecipients } = await import('@/services/marketing-campaigns')

    const seen: string[] = []
    let total = 0

    for (let page = 1; page <= 6; page += 1) {
      const result = await listRecipients(CAMPAIGN_ID, { page, pageSize: 50 })
      total = result.total
      for (const recipient of result.recipients) seen.push(recipient.id)
    }

    expect(total).toBe(253)
    expect(seen).toHaveLength(253)
    expect(new Set(seen).size).toBe(253)
  })

  it('orders the recipient list by id as well as created_at', async () => {
    useDb({
      marketing_campaigns: [campaignRow(CAMPAIGN_ID)],
      marketing_campaign_recipients: recipientRows(60, () => 'sent'),
    })

    const { listRecipients } = await import('@/services/marketing-campaigns')
    await listRecipients(CAMPAIGN_ID, { page: 1, pageSize: 50 })

    const read = db.reads.find((entry) => entry.table === 'marketing_campaign_recipients')
    expect(read?.orderedBy).toEqual(['created_at', 'id'])
  })

  it('counts the same rows once when the summaries read pages past 1,000', async () => {
    // Ordered by id, the first 1,000 are sent and the last 300 failed, so a page that overlaps or
    // skips rows cannot land on the right split by accident.
    useDb({
      marketing_campaigns: [campaignRow(CAMPAIGN_ID)],
      marketing_campaign_recipients: recipientRows(1_300, (index) => (index < 1_000 ? 'sent' : 'failed')),
    })

    const { listCampaigns } = await import('@/services/marketing-campaigns')
    const { campaigns } = await listCampaigns({ page: 1, pageSize: 25 })

    expect(campaigns).toHaveLength(1)
    expect(campaigns[0].summary.recipients).toBe(1_300)
    expect(campaigns[0].summary.sent).toBe(1_000)
    expect(campaigns[0].summary.failed).toBe(300)

    const summaryReads = db.reads.filter((entry) => entry.table === 'marketing_campaign_recipients')
    expect(summaryReads.length).toBeGreaterThan(1)
    for (const read of summaryReads) expect(read.orderedBy).toContain('id')
  })
})
