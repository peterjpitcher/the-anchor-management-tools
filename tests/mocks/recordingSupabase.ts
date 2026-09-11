import { vi } from 'vitest'

/**
 * A Supabase client stand-in that records every query builder call and answers from a
 * per-table handler once the query is awaited.
 *
 * The handler runs lazily, at `await`, so it can read everything the code chained onto the
 * query (`in`, `eq`, `insert` payloads, whether `maybeSingle` was called) and answer the way
 * the real database would for that query. Any table without a handler answers
 * `{ data: null, error: null }`.
 */

export type RecordedCall = { method: string; args: unknown[] }

export type RecordedQuery = {
  table: string
  calls: RecordedCall[]
}

export type TableHandler = (query: RecordedQuery) => unknown

export function createRecordingSupabase(options: {
  tables?: Record<string, TableHandler>
  /** Answer for any table without its own handler. Defaults to `{ data: null, error: null }`. */
  defaultAnswer?: TableHandler
  rpc?: (fn: string, args: Record<string, unknown>) => unknown
} = {}) {
  const queries: RecordedQuery[] = []

  const from = vi.fn((table: string) => {
    const query: RecordedQuery = { table, calls: [] }
    queries.push(query)

    const answer = (): unknown => {
      const handler = options.tables?.[table] ?? options.defaultAnswer
      return handler ? handler(query) : { data: null, error: null }
    }

    const builder: Record<string, unknown> = new Proxy(
      {},
      {
        get(_target, prop) {
          if (typeof prop === 'symbol') return undefined
          if (prop === 'then') {
            return (onFulfilled?: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) =>
              Promise.resolve().then(answer).then(onFulfilled, onRejected)
          }
          return (...args: unknown[]) => {
            query.calls.push({ method: String(prop), args })
            return builder
          }
        },
      }
    )

    return builder
  })

  const rpc = vi.fn(async (fn: string, args: Record<string, unknown>) =>
    options.rpc ? options.rpc(fn, args) : { data: null, error: null }
  )

  return { client: { from, rpc }, queries, from, rpc }
}

/** The arguments of every call to `method` on this query, in order. */
export function argsOf(query: RecordedQuery, method: string): unknown[][] {
  return query.calls.filter((call) => call.method === method).map((call) => call.args)
}

/** The first argument list of `method` on this query, or undefined. */
export function firstArgsOf(query: RecordedQuery, method: string): unknown[] | undefined {
  return argsOf(query, method)[0]
}

/** The values passed to `.in(column, values)` for this column, or an empty list. */
export function inValues(query: RecordedQuery, column: string): unknown[] {
  const match = argsOf(query, 'in').find((args) => args[0] === column)
  return Array.isArray(match?.[1]) ? (match?.[1] as unknown[]) : []
}

/** True when the query called `method`. */
export function called(query: RecordedQuery, method: string): boolean {
  return query.calls.some((call) => call.method === method)
}
