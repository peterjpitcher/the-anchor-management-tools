import type { SupabaseClient } from '@supabase/supabase-js'

// Supabase never returns more than this in one request, and says nothing when it cuts a
// result short. The fake copies that behaviour exactly, so a read that forgets to page
// silently gets the first 1,000 rows here just as it does in production.
const SERVER_ROW_CAP = 1000

// A fixed point in the past so every generated timestamp is deterministic and host-local
// dates never leak into the fixtures.
const CREATED_AT_BASE_MS = Date.UTC(2025, 0, 1, 12, 0, 0)
const ONE_HOUR_MS = 60 * 60 * 1000

export type PagedTable = 'customers' | 'bookings' | 'table_bookings' | 'private_bookings' | 'waitlist_entries'

export type PagingClientOptions = {
  customers: number
  bookings: number
  table_bookings: number
  private_bookings: number
  waitlist_entries: number
  /** Fail one page of one table, to prove a read error is not swallowed into a partial run. */
  failOn?: { table: PagedTable; page: number; message: string }
}

export type ScoreRow = {
  customer_id: string
  total_score: number
  last_booking_date: string | null
  bookings_last_30: number
  bookings_last_90: number
  bookings_last_365: number
  booking_breakdown: Record<string, number>
}

type FakeRow = Record<string, unknown>

type QueryResult = { data: FakeRow[] | null; error: { message: string } | null }

type QueryState = {
  table: string
  operation: 'select' | 'insert' | 'upsert' | 'delete'
  payload: FakeRow[]
  range: [number, number] | null
}

// The job's Supabase reads are typed against the real client, so the fake only has to answer
// the handful of builder methods it actually chains. Every method returns `this`; the query
// resolves when it is awaited.
class FakeQuery implements PromiseLike<QueryResult> {
  private readonly state: QueryState

  constructor(table: string, private readonly run: (state: QueryState) => QueryResult) {
    this.state = { table, operation: 'select', payload: [], range: null }
  }

  select(_columns?: string): this {
    return this
  }

  insert(rows: FakeRow[]): this {
    this.state.operation = 'insert'
    this.state.payload = rows
    return this
  }

  upsert(rows: FakeRow[], _options?: unknown): this {
    this.state.operation = 'upsert'
    this.state.payload = rows
    return this
  }

  delete(): this {
    this.state.operation = 'delete'
    return this
  }

  not(_column?: string, _operator?: string, _value?: unknown): this {
    return this
  }

  is(_column?: string, _value?: unknown): this {
    return this
  }

  eq(_column?: string, _value?: unknown): this {
    return this
  }

  in(_column?: string, _values?: unknown[]): this {
    return this
  }

  contains(_column?: string, _value?: unknown): this {
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
  return `customer-${String(index).padStart(5, '0')}`
}

function createdAt(index: number): string {
  return new Date(CREATED_AT_BASE_MS - index * ONE_HOUR_MS).toISOString()
}

function buildRows(table: PagedTable, count: number, customerCount: number): FakeRow[] {
  const owner = (index: number) => customerId(customerCount > 0 ? index % customerCount : 0)

  return Array.from({ length: count }, (_unused, index) => {
    switch (table) {
      case 'customers':
        return { id: customerId(index) }
      case 'bookings':
        return { customer_id: owner(index), created_at: createdAt(index) }
      case 'table_bookings':
        return { customer_id: owner(index), created_at: createdAt(index) }
      case 'private_bookings':
        return { customer_id: owner(index), created_at: createdAt(index), status: 'confirmed' }
      case 'waitlist_entries':
        return { customer_id: owner(index) }
    }
  })
}

/**
 * The real client exposes far more than the job uses, so the fake is cast rather than
 * implemented. `any` in the generics mirrors the production signature of
 * `recalculateEngagementScoresAndLabels`.
 */
export type PagingClient = SupabaseClient<any, 'public', any> & {
  /** Ranges the table was asked for, in request order. Empty when a read never paged. */
  rangesFor(table: PagedTable): Array<[number, number]>
  /** Rows the job upserted into `customer_scores`. */
  scoreRows(): ScoreRow[]
  /** Rows the job upserted into `customer_label_assignments`. */
  labelAssignments(): FakeRow[]
}

export function makePagingClient(options: PagingClientOptions): PagingClient {
  const counts: Record<PagedTable, number> = {
    customers: options.customers,
    bookings: options.bookings,
    table_bookings: options.table_bookings,
    private_bookings: options.private_bookings,
    waitlist_entries: options.waitlist_entries,
  }

  const rows: Record<PagedTable, FakeRow[]> = {
    customers: buildRows('customers', counts.customers, counts.customers),
    bookings: buildRows('bookings', counts.bookings, counts.customers),
    table_bookings: buildRows('table_bookings', counts.table_bookings, counts.customers),
    private_bookings: buildRows('private_bookings', counts.private_bookings, counts.customers),
    waitlist_entries: buildRows('waitlist_entries', counts.waitlist_entries, counts.customers),
  }

  const ranges: Record<PagedTable, Array<[number, number]>> = {
    customers: [],
    bookings: [],
    table_bookings: [],
    private_bookings: [],
    waitlist_entries: [],
  }
  const requestCounts: Record<PagedTable, number> = {
    customers: 0,
    bookings: 0,
    table_bookings: 0,
    private_bookings: 0,
    waitlist_entries: 0,
  }

  const labels = new Map<string, string>()
  const scores: ScoreRow[] = []
  const assignments: FakeRow[] = []

  function readPage(table: PagedTable, range: [number, number] | null): QueryResult {
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
    switch (state.table) {
      case 'customers':
      case 'bookings':
      case 'table_bookings':
      case 'private_bookings':
      case 'waitlist_entries':
        return readPage(state.table, state.range)

      case 'customer_scores':
        if (state.operation === 'upsert') {
          scores.push(...(state.payload as unknown as ScoreRow[]))
        }
        return { data: null, error: null }

      case 'customer_labels': {
        if (state.operation === 'insert') {
          const inserted = state.payload.map((row) => {
            const name = String(row.name)
            const id = labels.get(name) ?? `label-${labels.size + 1}`
            labels.set(name, id)
            return { id, name }
          })
          return { data: inserted, error: null }
        }
        return {
          data: Array.from(labels.entries()).map(([name, id]) => ({ id, name })),
          error: null,
        }
      }

      case 'customer_label_assignments':
        if (state.operation === 'upsert') {
          assignments.push(...state.payload)
        }
        return { data: null, error: null }

      default:
        return { data: [], error: null }
    }
  }

  const client = {
    from: (table: string) => new FakeQuery(table, resolve),
    rangesFor: (table: PagedTable) => ranges[table],
    scoreRows: () => scores,
    labelAssignments: () => assignments,
  }

  return client as unknown as PagingClient
}
