import { describe, expect, beforeEach, it, vi } from 'vitest'
import type { Mock } from 'vitest'

// Supabase never returns more than this from one request, and reports no error when it cuts a
// result short. The fake copies that exactly, so a read that forgets to page quietly gets the
// first 1,000 rows here just as it does in production.
const SERVER_ROW_CAP = 1000

// The win-back audience matched 997 rows at its 1-month setting on 15 September 2026, three
// short of the ceiling, and the customer base grows by about 380 a quarter. 1,153 is the
// customer count on the same day: enough to need a second page.
const SCORE_ROW_COUNT = 1153

type FakeRow = Record<string, unknown>
type Range = [number, number]
type QueryResult = { data: FakeRow[] | null; error: { message: string } | null }

type QueryState = {
  table: string
  range: Range | null
}

const readFailure: { message: string | null } = { message: null }
const scoreRanges: Range[] = []

/**
 * The real client exposes far more than this read uses, so the fake only answers the builder
 * methods the query actually chains. Every method returns `this`; the query resolves when it
 * is awaited.
 */
class FakeQuery implements PromiseLike<QueryResult> {
  private readonly state: QueryState

  constructor(table: string, private readonly run: (state: QueryState) => QueryResult) {
    this.state = { table, range: null }
  }

  select(_columns?: string): this {
    return this
  }

  or(_filter?: string): this {
    return this
  }

  order(_column?: string, _options?: unknown): this {
    return this
  }

  range(from: number, to: number): this {
    this.state.range = [from, to]
    return this
  }

  then<TFulfilled = QueryResult, TRejected = never>(
    onfulfilled?: ((value: QueryResult) => TFulfilled | PromiseLike<TFulfilled>) | null,
    onrejected?: ((reason: unknown) => TRejected | PromiseLike<TRejected>) | null,
  ): PromiseLike<TFulfilled | TRejected> {
    return Promise.resolve(this.run(this.state)).then(onfulfilled, onrejected)
  }
}

function customerId(index: number): string {
  return `cust-${String(index).padStart(5, '0')}`
}

/**
 * Every row is a customer who has never booked and passes every consent check, so the only
 * thing that can shrink the audience in this test is a read that stops at the cap.
 */
function buildScoreRows(): FakeRow[] {
  return Array.from({ length: SCORE_ROW_COUNT }, (_unused, index) => ({
    customer_id: customerId(index),
    last_booking_date: null,
    customer: {
      id: customerId(index),
      first_name: `Customer ${index}`,
      mobile_number: '07700900000',
      mobile_e164: '+447700900000',
      sms_opt_in: true,
      marketing_sms_opt_in: true,
      sms_status: 'active',
    },
  }))
}

const scoreRows = buildScoreRows()

function resolve(state: QueryState): QueryResult {
  if (state.table !== 'customer_scores') {
    throw new Error(`Unexpected table request: ${state.table}`)
  }

  if (state.range) scoreRanges.push(state.range)
  if (readFailure.message) {
    return { data: null, error: { message: readFailure.message } }
  }

  const from = state.range ? state.range[0] : 0
  const requested = state.range ? state.range[1] - state.range[0] + 1 : SERVER_ROW_CAP
  const size = Math.min(requested, SERVER_ROW_CAP)
  return { data: scoreRows.slice(from, from + size), error: null }
}

const mockAdminClient = {
  from: (table: string) => new FakeQuery(table, resolve),
}

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: { id: 'staff-user', email: 'staff@example.com' } },
        error: null,
      })),
    },
  })),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => mockAdminClient),
}))

vi.mock('@/app/actions/rbac', () => ({
  checkUserPermission: vi.fn(async () => true),
}))

vi.mock('@/app/actions/audit', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  logAuditEvent: vi.fn(async () => undefined),
}))

vi.mock('@/lib/sms/bulk', () => ({
  sendBulkSms: vi.fn(async () => ({ success: true, sent: 0, failed: 0 })),
  getSmartFirstName: vi.fn((name: string) => name),
}))

import { sendWinBackCampaign } from '@/app/actions/customers'
import { sendBulkSms } from '@/lib/sms/bulk'

const mockedSendBulkSms = sendBulkSms as unknown as Mock

const MESSAGE = 'We miss you at The Anchor. Pop in this week for a warm welcome.'

describe('sendWinBackCampaign audience paging', () => {
  beforeEach(() => {
    mockedSendBulkSms.mockClear()
    mockedSendBulkSms.mockResolvedValue({ success: true, sent: SCORE_ROW_COUNT, failed: 0 })
    scoreRanges.length = 0
    readFailure.message = null
  })

  it('counts every matching customer in the preview, not the first 1,000', async () => {
    const result = await sendWinBackCampaign({
      inactiveSinceMonths: 1,
      message: MESSAGE,
      dryRun: true,
    })

    expect(result.error).toBeUndefined()
    expect(result.count).toBe(SCORE_ROW_COUNT)
    expect(mockedSendBulkSms).not.toHaveBeenCalled()
  })

  it('sends to every matching customer, not the first 1,000', async () => {
    const result = await sendWinBackCampaign({
      inactiveSinceMonths: 1,
      message: MESSAGE,
    })

    expect(result.error).toBeUndefined()
    expect(result.count).toBe(SCORE_ROW_COUNT)
    expect(mockedSendBulkSms).toHaveBeenCalledTimes(1)

    const recipients = mockedSendBulkSms.mock.calls[0][0].customerIds as string[]
    expect(recipients).toHaveLength(SCORE_ROW_COUNT)
    expect(new Set(recipients).size).toBe(SCORE_ROW_COUNT)
  })

  it('asks for a second page whenever the first one comes back full', async () => {
    await sendWinBackCampaign({ inactiveSinceMonths: 1, message: MESSAGE, dryRun: true })

    expect(scoreRanges).toEqual([
      [0, 999],
      [1000, 1999],
    ])
  })

  it('reports a failed read instead of messaging a partial audience', async () => {
    readFailure.message = 'connection reset'

    const result = await sendWinBackCampaign({ inactiveSinceMonths: 1, message: MESSAGE })

    expect(result.error).toBe('Failed to fetch inactive customers')
    expect(result.count).toBeUndefined()
    expect(mockedSendBulkSms).not.toHaveBeenCalled()
  })
})
