/**
 * A small in-memory stand-in for the Supabase query builder, for tests that need to see rows
 * change rather than assert on mock calls. Supports the calls the messaging code makes: select,
 * insert, update, eq, neq, is, in, gte, lte, gt, lt, order, limit, range, maybeSingle and single, plus
 * a `alias:table(columns)` join on `<alias>_id`.
 *
 * `failures` lets a test make one table and operation return an error.
 */
type Row = Record<string, any>
type Op = 'select' | 'insert' | 'update' | 'delete'

export type FakeFailure = { table: string; op: Op; error: { code?: string; message: string } }

export type FakeSupabase = {
  tables: Record<string, Row[]>
  failures: FakeFailure[]
  from: (table: string) => any
}

let idCounter = 0

function matches(row: Row, filters: Array<(row: Row) => boolean>): boolean {
  return filters.every((filter) => filter(row))
}

export function createFakeSupabase(
  initial: Record<string, Row[]> = {},
  options: {
    /** Per table, the value that must be unique; an insert repeating it fails with 23505. */
    unique?: Record<string, (row: Row) => unknown>
  } = {}
): FakeSupabase {
  const tables: Record<string, Row[]> = {}
  for (const [name, rows] of Object.entries(initial)) {
    tables[name] = rows.map((row) => ({ ...row }))
  }
  const failures: FakeFailure[] = []

  function table(name: string): Row[] {
    if (!tables[name]) tables[name] = []
    return tables[name]
  }

  function builder(name: string) {
    let op: Op = 'select'
    let payload: Row | Row[] | null = null
    let selectColumns: string | null = null
    let returnRows = false
    let single: 'maybe' | 'one' | null = null
    let limit: number | null = null
    let range: { from: number; to: number } | null = null
    let order: { column: string; ascending: boolean } | null = null
    const filters: Array<(row: Row) => boolean> = []

    function applyJoins(row: Row): Row {
      if (!selectColumns) return row
      const out = { ...row }
      for (const match of selectColumns.matchAll(/(\w+):(\w+)(?:!\w+)?\(([^)]*)\)/g)) {
        const [, alias, joinTable] = match
        const foreignKey = `${alias}_id`
        const related = table(joinTable).find((candidate) => candidate.id === row[foreignKey]) ?? null
        out[alias] = related ? { ...related } : null
      }
      return out
    }

    function execute(): { data: any; error: any; count?: number } {
      const failure = failures.find((f) => f.table === name && f.op === op)
      if (failure) return { data: null, error: failure.error }

      if (op === 'insert') {
        const rows = (Array.isArray(payload) ? payload : [payload]).map((row) => {
          idCounter += 1
          return { id: `${name}-${idCounter}`, created_at: new Date().toISOString(), ...row }
        })
        const uniqueOf = options.unique?.[name]
        if (uniqueOf) {
          for (const row of rows) {
            const value = uniqueOf(row)
            if (value !== undefined && table(name).some((existing) => uniqueOf(existing) === value)) {
              return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } }
            }
          }
        }
        table(name).push(...rows)
        const data = returnRows ? (single ? rows[0] ?? null : rows) : null
        return { data, error: null }
      }

      let rows = table(name).filter((row) => matches(row, filters))

      if (op === 'update') {
        for (const row of rows) Object.assign(row, payload)
        const data = returnRows ? (single ? rows[0] ?? null : rows.map((row) => ({ ...row }))) : null
        return { data, error: null }
      }

      if (op === 'delete') {
        tables[name] = table(name).filter((row) => !rows.includes(row))
        return { data: null, error: null }
      }

      if (order) {
        const { column, ascending } = order
        rows = [...rows].sort((a, b) => {
          if (a[column] === b[column]) return 0
          return (a[column] > b[column] ? 1 : -1) * (ascending ? 1 : -1)
        })
      }
      const total = rows.length
      if (range) rows = rows.slice(range.from, range.to + 1)
      if (limit !== null) rows = rows.slice(0, limit)
      const shaped = rows.map((row) => applyJoins({ ...row }))

      if (single === 'one') {
        if (shaped.length !== 1) return { data: null, error: { code: 'PGRST116', message: 'not exactly one row' } }
        return { data: shaped[0], error: null }
      }
      if (single === 'maybe') return { data: shaped[0] ?? null, error: null }
      return { data: shaped, error: null, count: range ? total : shaped.length }
    }

    const api: any = {
      select(columns?: string) {
        if (op === 'select') selectColumns = columns ?? '*'
        else returnRows = true
        return api
      },
      insert(rows: Row | Row[]) {
        op = 'insert'
        payload = rows
        return api
      },
      update(patch: Row) {
        op = 'update'
        payload = patch
        return api
      },
      upsert(rows: Row | Row[], upsertOptions?: { onConflict?: string }) {
        const conflictColumn = upsertOptions?.onConflict ?? 'id'
        for (const row of Array.isArray(rows) ? rows : [rows]) {
          const existing = table(name).find((candidate) => candidate[conflictColumn] === row[conflictColumn])
          if (existing) {
            Object.assign(existing, row)
          } else {
            idCounter += 1
            table(name).push({ id: `${name}-${idCounter}`, ...row })
          }
        }
        return Promise.resolve({ data: null, error: null })
      },
      not(column: string, operator: string, value: unknown) {
        if (operator === 'is' && value === null) {
          filters.push((row) => row[column] !== null && row[column] !== undefined)
        } else {
          filters.push((row) => row[column] !== value)
        }
        return api
      },
      /** PostgREST `or` strings are not parsed: this filters nothing. Keep test data unambiguous. */
      or() {
        return api
      },
      contains(column: string, value: Record<string, unknown>) {
        filters.push((row) => {
          const target = row[column]
          if (!target || typeof target !== 'object') return false
          return Object.entries(value).every(([key, expected]) => (target as Row)[key] === expected)
        })
        return api
      },
      delete() {
        op = 'delete'
        return api
      },
      eq(column: string, value: unknown) {
        filters.push((row) => row[column] === value)
        return api
      },
      neq(column: string, value: unknown) {
        filters.push((row) => row[column] !== value)
        return api
      },
      is(column: string, value: unknown) {
        filters.push((row) => (value === null ? row[column] === null || row[column] === undefined : row[column] === value))
        return api
      },
      in(column: string, values: unknown[]) {
        filters.push((row) => values.includes(row[column]))
        return api
      },
      gte(column: string, value: any) {
        filters.push((row) => row[column] >= value)
        return api
      },
      lte(column: string, value: any) {
        filters.push((row) => row[column] <= value)
        return api
      },
      gt(column: string, value: any) {
        filters.push((row) => row[column] > value)
        return api
      },
      lt(column: string, value: any) {
        filters.push((row) => row[column] < value)
        return api
      },
      order(column: string, options?: { ascending?: boolean }) {
        order = { column, ascending: options?.ascending !== false }
        return api
      },
      limit(count: number) {
        limit = count
        return api
      },
      range(from: number, to: number) {
        range = { from, to }
        return api
      },
      maybeSingle() {
        single = 'maybe'
        return Promise.resolve(execute())
      },
      single() {
        single = 'one'
        return Promise.resolve(execute())
      },
      then(resolve: (value: any) => unknown, reject?: (reason: unknown) => unknown) {
        try {
          return Promise.resolve(execute()).then(resolve, reject)
        } catch (error) {
          return reject ? Promise.resolve(reject(error)) : Promise.reject(error)
        }
      },
    }
    return api
  }

  return {
    tables,
    failures,
    from: (name: string) => builder(name),
  }
}
