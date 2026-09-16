// Supabase returns at most 1,000 rows per request and gives no error when it
// cuts a result short, so every "read them all" path pages through the set and
// fails loudly rather than quietly handing back a partial answer.
const MAX_ROWS_PER_REQUEST = 1000

export type PagedReadResult<T> = { data: T[] | null; error: { message: string } | null }

export type PagedReadOptions = {
  /** Rows per request. Clamped to 1,000, the server's own ceiling. */
  pageSize?: number
  /** Safety cap. Reaching it throws, because a silent stop is the bug we are fixing. */
  maxRows?: number
  /** Included in thrown errors so logs name the caller. */
  label?: string
}

export async function fetchAllRows<T>(
  runPage: (from: number, to: number) => PromiseLike<PagedReadResult<T>>,
  options: PagedReadOptions = {},
): Promise<T[]> {
  const label = options.label ?? 'paged read'
  const pageSize = Math.min(Math.max(Math.floor(options.pageSize ?? MAX_ROWS_PER_REQUEST), 1), MAX_ROWS_PER_REQUEST)
  const maxRows = Math.max(Math.floor(options.maxRows ?? 100_000), pageSize)
  const rows: T[] = []

  for (let from = 0; from < maxRows; from += pageSize) {
    const { data, error } = await runPage(from, from + pageSize - 1)
    if (error) throw new Error(`${label} failed: ${error.message}`)
    const batch = data ?? []
    rows.push(...batch)
    if (batch.length < pageSize) return rows
  }

  throw new Error(`${label} stopped at the ${maxRows} row cap, so the result would have been incomplete`)
}
