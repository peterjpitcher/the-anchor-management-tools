import { columnsNamedBySelect, publicSchemaColumns, type ColumnReference } from './generatedSchema'

/**
 * A stand-in for one Supabase table that knows which columns the real table has, and refuses a
 * query naming any other the way PostgREST does:
 *
 * - a select or a filter on a missing column answers with code 42703
 *   ("column payments.customer_id does not exist");
 * - an update carrying a missing column answers with code PGRST204
 *   ("Could not find the 'updated_at' column of 'customers' in the schema cache") and changes
 *   nothing, because PostgREST rejects the whole request.
 *
 * tests/helpers/fakeSupabase.ts and a hand-rolled vi.fn() chain both answer any column, which is
 * how a query against a column that never existed passes its tests. Use this one when the point
 * of the test is that the query is one the database will accept.
 *
 * The columns come from src/types/database.generated.ts. Seed rows are checked too, so a test
 * cannot hand the code a field the table does not have.
 */

type Row = Record<string, unknown>

export interface SchemaCheckedError {
  code: string
  message: string
}

export interface SchemaCheckedResult {
  data: unknown
  error: SchemaCheckedError | null
}

export interface SchemaCheckedQueryLog {
  op: 'select' | 'update'
  payload: Row | null
  error: SchemaCheckedError | null
}

export interface SchemaCheckedQuery extends PromiseLike<SchemaCheckedResult> {
  select(columns?: string): SchemaCheckedQuery
  update(patch: Row): SchemaCheckedQuery
  eq(column: string, value: unknown): SchemaCheckedQuery
  is(column: string, value: null): SchemaCheckedQuery
  not(column: string, operator: 'is', value: null): SchemaCheckedQuery
  maybeSingle(): Promise<SchemaCheckedResult>
  single(): Promise<SchemaCheckedResult>
}

export interface SchemaCheckedOptions {
  /**
   * Refuse an update the schema would accept, for a failure the database raises on its own
   * account: a unique index, a permission. Return null to let the update through.
   */
  refuseUpdate?: (patch: Row) => SchemaCheckedError | null
}

export interface SchemaCheckedTable {
  /** What `client.from('<table>')` should return: a fresh query each time. */
  query(): SchemaCheckedQuery
  /** The table's rows as they stand, so a test can assert what was really saved. */
  rows: Row[]
  /** Every query that ran, in order, with how it ended. */
  log: SchemaCheckedQueryLog[]
}

export function schemaCheckedTable(
  table: string,
  seed: Row[] = [],
  options: SchemaCheckedOptions = {},
): SchemaCheckedTable {
  const schema = publicSchemaColumns()
  const columns = schema.get(table)
  if (!columns) {
    throw new Error(`"${table}" is not a table or view in src/types/database.generated.ts`)
  }
  for (const row of seed) {
    for (const key of Object.keys(row)) {
      if (!columns.has(key)) {
        throw new Error(`Seed row for "${table}" has "${key}", which is not a column of that table`)
      }
    }
  }

  const state: SchemaCheckedTable = {
    rows: seed.map((row) => ({ ...row })),
    log: [],
    query() {
      const named: ColumnReference[] = []
      const filters: Array<(row: Row) => boolean> = []
      let op: 'select' | 'update' = 'select'
      let payload: Row | null = null
      let returning = false

      const run = (mode: 'many' | 'maybe' | 'one'): SchemaCheckedResult => {
        const entry: SchemaCheckedQueryLog = { op, payload, error: null }
        state.log.push(entry)

        const missing = named.find(({ table: owner, column }) => !schema.get(owner)?.has(column))
        if (missing) {
          entry.error =
            payload && missing.column in payload
              ? {
                  code: 'PGRST204',
                  message: `Could not find the '${missing.column}' column of '${missing.table}' in the schema cache`,
                }
              : { code: '42703', message: `column ${missing.table}.${missing.column} does not exist` }
          return { data: null, error: entry.error }
        }

        const refused = payload ? options.refuseUpdate?.(payload) ?? null : null
        if (refused) {
          entry.error = refused
          return { data: null, error: refused }
        }

        const matched = state.rows.filter((row) => filters.every((matches) => matches(row)))
        if (payload) {
          for (const row of matched) Object.assign(row, payload)
          if (!returning) return { data: null, error: null }
        }

        const data = matched.map((row) => ({ ...row }))
        if (mode === 'many') return { data, error: null }
        if (mode === 'maybe') return { data: data[0] ?? null, error: null }
        return data.length === 1
          ? { data: data[0], error: null }
          : { data: null, error: { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' } }
      }

      const builder: SchemaCheckedQuery = {
        select(selected = '*') {
          named.push(...columnsNamedBySelect(table, selected, schema))
          if (op === 'update') returning = true
          return builder
        },
        update(patch) {
          op = 'update'
          payload = patch
          named.push(...Object.keys(patch).map((column) => ({ table, column })))
          return builder
        },
        eq(column, value) {
          named.push({ table, column })
          filters.push((row) => row[column] === value)
          return builder
        },
        is(column, value) {
          named.push({ table, column })
          filters.push((row) => (row[column] ?? null) === value)
          return builder
        },
        not(column, operator, value) {
          if (operator !== 'is' || value !== null) {
            throw new Error(`schemaCheckedTable only knows not(column, 'is', null), got not(${column}, ${operator}, ${String(value)})`)
          }
          named.push({ table, column })
          filters.push((row) => (row[column] ?? null) !== null)
          return builder
        },
        maybeSingle: async () => run('maybe'),
        single: async () => run('one'),
        then(onFulfilled, onRejected) {
          return Promise.resolve(run('many')).then(onFulfilled, onRejected)
        },
      }
      return builder
    },
  }

  return state
}
