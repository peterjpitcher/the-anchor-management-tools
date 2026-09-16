import { describe, expect, it } from 'vitest'
import {
  getFirstVisitReviewEligibleCandidateKeys,
  reviewVisitCandidateKey,
  type ReviewVisitCandidate,
} from '@/lib/sms/review-once'

// Supabase never returns more than this from one request, and reports no error when it cuts a
// result short. The fake copies that exactly, so a read that forgets to page quietly gets the
// first 1,000 rows here just as it does in production.
const SERVER_ROW_CAP = 1000

// A review run carries at most 50 customers, and their event-booking history is the read that
// grows: 658 rows on 15 September 2026 and climbing every week. 1,200 rows puts the repeat
// visitor's earlier booking on the second page, exactly where the cap used to hide it.
const CANDIDATE_COUNT = 50
const EVENT_BOOKING_COUNT = 1200
const PRIOR_VISIT_INDEX = 1100

const CANDIDATE_VISIT_AT = '2026-01-10T19:00:00Z'
const LATER_VISIT_AT = '2026-06-01T19:00:00Z'
const EARLIER_VISIT_AT = '2025-12-20T19:00:00Z'

type FakeRow = Record<string, unknown>
type Range = [number, number]
type HistoryTable = 'bookings' | 'table_bookings' | 'private_bookings' | 'parking_bookings'
type QueryResult = { data: FakeRow[] | null; error: { message: string } | null }

type QueryState = {
  table: string
  range: Range | null
}

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

  in(_column?: string, _values?: unknown[]): this {
    return this
  }

  not(_column?: string, _operator?: string, _value?: unknown): this {
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
  return `cust-${String(index).padStart(3, '0')}`
}

function tableBookingId(index: number): string {
  return `table-${String(index).padStart(3, '0')}`
}

/** One live table booking per customer: the visit each review candidate is about. */
function buildTableBookingRows(): FakeRow[] {
  return Array.from({ length: CANDIDATE_COUNT }, (_unused, index) => ({
    id: tableBookingId(index),
    customer_id: customerId(index),
    status: 'confirmed',
    start_datetime: CANDIDATE_VISIT_AT,
    booking_date: CANDIDATE_VISIT_AT.slice(0, 10),
    booking_time: '19:00',
    created_at: '2026-01-02T09:00:00Z',
  }))
}

/**
 * Event bookings for the same 50 customers. All of them fall after the visit under review, so
 * none suppresses it, except the one at PRIOR_VISIT_INDEX: that customer came in before, so
 * this visit is not their first and they must not be asked for a review.
 */
function buildEventBookingRows(): FakeRow[] {
  return Array.from({ length: EVENT_BOOKING_COUNT }, (_unused, index) => {
    const isPriorVisit = index === PRIOR_VISIT_INDEX
    return {
      id: `event-${String(index).padStart(4, '0')}`,
      customer_id: customerId(index % CANDIDATE_COUNT),
      status: 'confirmed',
      is_reminder_only: false,
      created_at: isPriorVisit ? '2025-12-01T09:00:00Z' : '2026-01-05T09:00:00Z',
      event: {
        start_datetime: isPriorVisit ? EARLIER_VISIT_AT : LATER_VISIT_AT,
        event_status: 'scheduled',
      },
    }
  })
}

type HistoryClientOptions = {
  /** Fail one page of one table, to prove a read error is not swallowed into a first visit. */
  failOn?: { table: HistoryTable; page: number; message: string }
}

type HistoryClient = {
  db: Parameters<typeof getFirstVisitReviewEligibleCandidateKeys>[1]
  /** Ranges the table was asked for, in request order. Empty when a read never paged. */
  rangesFor(table: HistoryTable): Range[]
}

function makeHistoryClient(options: HistoryClientOptions = {}): HistoryClient {
  const rows: Record<HistoryTable, FakeRow[]> = {
    bookings: buildEventBookingRows(),
    table_bookings: buildTableBookingRows(),
    private_bookings: [],
    parking_bookings: [],
  }

  const ranges: Record<HistoryTable, Range[]> = {
    bookings: [],
    table_bookings: [],
    private_bookings: [],
    parking_bookings: [],
  }

  const requestCounts: Record<HistoryTable, number> = {
    bookings: 0,
    table_bookings: 0,
    private_bookings: 0,
    parking_bookings: 0,
  }

  function readPage(table: HistoryTable, range: Range | null): QueryResult {
    const pageIndex = requestCounts[table]
    requestCounts[table] += 1
    if (range) ranges[table].push(range)

    const failure = options.failOn
    if (failure && failure.table === table && failure.page === pageIndex) {
      return { data: null, error: { message: failure.message } }
    }

    const from = range ? range[0] : 0
    const requested = range ? range[1] - range[0] + 1 : SERVER_ROW_CAP
    const size = Math.min(requested, SERVER_ROW_CAP)
    return { data: rows[table].slice(from, from + size), error: null }
  }

  function resolve(state: QueryState): QueryResult {
    if (state.table in rows) {
      return readPage(state.table as HistoryTable, state.range)
    }
    return { data: [], error: null }
  }

  const client = {
    from: (table: string) => new FakeQuery(table, resolve),
  }

  return {
    // The production signature takes the real admin client, which has far more on it than the
    // four reads under test touch, so the fake is cast rather than implemented.
    db: client as unknown as HistoryClient['db'],
    rangesFor: (table: HistoryTable) => ranges[table],
  }
}

function candidateFor(index: number): ReviewVisitCandidate {
  return {
    channel: 'table',
    bookingId: tableBookingId(index),
    customerId: customerId(index),
    visitAt: CANDIDATE_VISIT_AT,
  }
}

describe('getFirstVisitReviewEligibleCandidateKeys paging', () => {
  it('treats a customer whose earlier booking is past the first page as a repeat visitor', async () => {
    const client = makeHistoryClient()
    const candidates = Array.from({ length: CANDIDATE_COUNT }, (_unused, index) => candidateFor(index))

    const eligible = await getFirstVisitReviewEligibleCandidateKeys(candidates, client.db)

    const repeatVisitor = candidateFor(PRIOR_VISIT_INDEX % CANDIDATE_COUNT)
    expect(eligible.has(reviewVisitCandidateKey(repeatVisitor))).toBe(false)
  })

  it('still allows a genuine first visit', async () => {
    const client = makeHistoryClient()
    const candidates = Array.from({ length: CANDIDATE_COUNT }, (_unused, index) => candidateFor(index))

    const eligible = await getFirstVisitReviewEligibleCandidateKeys(candidates, client.db)

    const firstTimer = candidateFor(1)
    expect(eligible.has(reviewVisitCandidateKey(firstTimer))).toBe(true)
    expect(eligible.size).toBe(CANDIDATE_COUNT - 1)
  })

  it('asks for a second page whenever the first one comes back full', async () => {
    const client = makeHistoryClient()
    const candidates = Array.from({ length: CANDIDATE_COUNT }, (_unused, index) => candidateFor(index))

    await getFirstVisitReviewEligibleCandidateKeys(candidates, client.db)

    expect(client.rangesFor('bookings')).toEqual([
      [0, 999],
      [1000, 1999],
    ])
    // A short first page is the whole set, so these stop after one request.
    expect(client.rangesFor('table_bookings')).toEqual([[0, 999]])
    expect(client.rangesFor('private_bookings')).toEqual([[0, 999]])
    expect(client.rangesFor('parking_bookings')).toEqual([[0, 999]])
  })

  it('throws when a later page fails rather than calling a regular a first-timer', async () => {
    const client = makeHistoryClient({
      failOn: { table: 'bookings', page: 1, message: 'connection reset' },
    })
    const candidates = Array.from({ length: CANDIDATE_COUNT }, (_unused, index) => candidateFor(index))

    await expect(getFirstVisitReviewEligibleCandidateKeys(candidates, client.db)).rejects.toThrow(
      /Failed to load first-visit review history: .*connection reset/,
    )
  })
})
