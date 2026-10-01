/**
 * A small in-memory stand-in for the Supabase client, for tests that need to run real service
 * code against rows and then look at what was written.
 *
 * It covers the query shapes the receipts services use: select with eq, in, is, gt, order, range
 * and limit; update and delete with filters; insert; `maybeSingle` and `single`. An update
 * bumps `updated_at`, as the database triggers do, so optimistic "still as I read it" writes
 * behave as they do for real.
 *
 * It is not a Postgres. Anything that depends on a lock, a constraint or a function body is
 * tested against a real database in tests/sql.
 */

type Row = Record<string, unknown>
type QueryResult = { data: unknown; error: { message: string } | null; count?: number | null }

type Failure = {
  table: string
  operation: 'select' | 'update' | 'insert' | 'delete'
  message: string
  /** Fail only this many times, then behave. Omit to fail every time. */
  times?: number
}

export type FakeDb = {
  client: {
    from: (table: string) => FakeTable
    rpc: (name: string, args?: Row) => Promise<QueryResult>
  }
  rows: (table: string) => Row[]
  /** Every write, in order, for assertions about what was and was not touched. */
  writes: Array<{ table: string; operation: 'update' | 'insert' | 'delete'; payload?: Row; ids: unknown[] }>
  failNext: (failure: Failure) => void
  /** Runs just before an update is applied, to model another writer getting in first. */
  beforeUpdate: (hook: (table: string, matched: Row[]) => void) => void
  onRpc: (handler: (name: string, args: Row) => QueryResult | Promise<QueryResult>) => void
}

type FakeTable = {
  select: (columns?: string, options?: { count?: string; head?: boolean }) => FakeQuery
  update: (payload: Row) => FakeQuery
  insert: (payload: Row | Row[]) => FakeQuery
  /** Insert, or update the row that matches on the `onConflict` columns. */
  upsert: (payload: Row | Row[], options?: { onConflict?: string }) => PromiseLike<QueryResult>
  delete: () => FakeQuery
}

let clock = 0
function nextTimestamp(): string {
  clock += 1
  return new Date(Date.UTC(2026, 9, 1, 12, 0, 0, clock)).toISOString()
}

function likeMatcher(pattern: string): (value: unknown) => boolean {
  const source = pattern
    .split('%')
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*')
  const expression = new RegExp(`^${source}$`, 'i')
  return (value) => typeof value === 'string' && expression.test(value)
}

/** Splits on commas that are not inside the brackets of an `in.(...)` list. */
function splitOrTerms(expression: string): string[] {
  const terms: string[] = []
  let depth = 0
  let current = ''
  for (const char of expression) {
    if (char === '(') depth += 1
    if (char === ')') depth -= 1
    if (char === ',' && depth === 0) {
      terms.push(current)
      current = ''
    } else {
      current += char
    }
  }
  if (current) terms.push(current)
  return terms
}

function parseOrTerm(term: string): (row: Row) => boolean {
  const [column, operator, ...rest] = term.split('.')
  const value = rest.join('.')
  if (operator === 'is' && value === 'null') return (row) => (row[column] ?? null) === null
  if (operator === 'eq') return (row) => String(row[column]) === value
  if (operator === 'in') {
    const values = value
      .replace(/^\(|\)$/g, '')
      .split(',')
      .map((entry) => entry.replace(/^"|"$/g, ''))
    return (row) => values.includes(String(row[column]))
  }
  throw new Error(`fakeSupabaseDb: unsupported or() term ${term}`)
}

class FakeQuery implements PromiseLike<QueryResult> {
  private filters: Array<(row: Row) => boolean> = []
  private orders: Array<{ column: string; ascending: boolean }> = []
  private window: [number, number] | null = null
  private returning = false

  constructor(
    private db: InternalDb,
    private table: string,
    private operation: 'select' | 'update' | 'insert' | 'delete',
    private payload?: Row | Row[]
  ) {
    this.returning = operation === 'select'
  }

  eq(column: string, value: unknown) {
    this.filters.push((row) => (row[column] ?? null) === (value ?? null))
    return this
  }

  in(column: string, values: unknown[]) {
    this.filters.push((row) => values.includes(row[column]))
    return this
  }

  is(column: string, value: unknown) {
    this.filters.push((row) => (row[column] ?? null) === value)
    return this
  }

  gt(column: string, value: string | number) {
    this.filters.push((row) => (row[column] as string | number) > value)
    return this
  }

  lt(column: string, value: string | number) {
    this.filters.push((row) => (row[column] as string | number) < value)
    return this
  }

  ilike(column: string, pattern: string) {
    const matches = likeMatcher(pattern)
    this.filters.push((row) => matches(row[column]))
    return this
  }

  /** Supports the two forms the services use: `not(col, 'is', null)` and `not(col, 'ilike', pattern)`. */
  not(column: string, operator: string, value: unknown) {
    if (operator === 'is') {
      this.filters.push((row) => (row[column] ?? null) !== value)
    } else if (operator === 'ilike') {
      const matches = likeMatcher(String(value))
      this.filters.push((row) => !matches(row[column]))
    } else {
      throw new Error(`fakeSupabaseDb: unsupported not(${operator})`)
    }
    return this
  }

  /** Supports `col.is.null`, `col.eq.value` and `col.in.(a,b)` terms joined by commas. */
  or(expression: string) {
    const terms = splitOrTerms(expression).map(parseOrTerm)
    this.filters.push((row) => terms.some((term) => term(row)))
    return this
  }

  order(column: string, config?: { ascending?: boolean }) {
    this.orders.push({ column, ascending: config?.ascending !== false })
    return this
  }

  range(from: number, to: number) {
    this.window = [from, to]
    return this
  }

  limit(count: number) {
    this.window = [0, count - 1]
    return this
  }

  select() {
    this.returning = true
    return this
  }

  async maybeSingle(): Promise<QueryResult> {
    const result = await this.execute()
    if (result.error) return { data: null, error: result.error }
    const rows = (result.data as Row[] | null) ?? []
    return { data: rows[0] ?? null, error: null }
  }

  async single(): Promise<QueryResult> {
    const result = await this.execute()
    if (result.error) return { data: null, error: result.error }
    const rows = (result.data as Row[] | null) ?? []
    if (rows.length !== 1) return { data: null, error: { message: 'Expected exactly one row' } }
    return { data: rows[0], error: null }
  }

  then<TResult1 = QueryResult, TResult2 = never>(
    onfulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): PromiseLike<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected)
  }

  private async execute(): Promise<QueryResult> {
    const failure = this.db.takeFailure(this.table, this.operation)
    if (failure) return { data: null, error: { message: failure } }

    const table = this.db.table(this.table)

    if (this.operation === 'insert') {
      const incoming = (Array.isArray(this.payload) ? this.payload : [this.payload ?? {}]).map((row) => ({
        id: `fake-${this.table}-${table.length + 1}-${Math.random().toString(16).slice(2, 8)}`,
        ...row,
      }))
      table.push(...incoming)
      this.db.writes.push({ table: this.table, operation: 'insert', ids: incoming.map((row) => row.id) })
      return { data: this.returning ? incoming : null, error: null }
    }

    let matched = table.filter((row) => this.filters.every((filter) => filter(row)))

    if (this.operation === 'update') {
      this.db.runBeforeUpdate(this.table, matched)
      // Re-evaluate: the hook models another writer changing the row between read and write.
      matched = table.filter((row) => this.filters.every((filter) => filter(row)))
      for (const row of matched) {
        Object.assign(row, this.payload as Row)
        row.updated_at = nextTimestamp()
      }
      this.db.writes.push({
        table: this.table,
        operation: 'update',
        payload: this.payload as Row,
        ids: matched.map((row) => row.id),
      })
      return { data: this.returning ? matched.map((row) => ({ ...row })) : null, error: null }
    }

    if (this.operation === 'delete') {
      for (const row of matched) table.splice(table.indexOf(row), 1)
      this.db.writes.push({ table: this.table, operation: 'delete', ids: matched.map((row) => row.id) })
      return { data: this.returning ? matched : null, error: null }
    }

    const total = matched.length
    for (const { column, ascending } of [...this.orders].reverse()) {
      matched = [...matched].sort((left, right) => {
        const a = left[column] as string | number
        const b = right[column] as string | number
        if (a === b) return 0
        return (a < b ? -1 : 1) * (ascending ? 1 : -1)
      })
    }
    if (this.window) matched = matched.slice(this.window[0], this.window[1] + 1)
    return { data: matched.map((row) => ({ ...row })), error: null, count: total }
  }
}

class InternalDb {
  tables = new Map<string, Row[]>()
  writes: FakeDb['writes'] = []
  private failures: Failure[] = []
  private updateHook: ((table: string, matched: Row[]) => void) | null = null
  rpcHandler: ((name: string, args: Row) => QueryResult | Promise<QueryResult>) | null = null

  table(name: string): Row[] {
    if (!this.tables.has(name)) this.tables.set(name, [])
    return this.tables.get(name) as Row[]
  }

  addFailure(failure: Failure) {
    this.failures.push({ ...failure })
  }

  takeFailure(table: string, operation: Failure['operation']): string | null {
    const failure = this.failures.find((entry) => entry.table === table && entry.operation === operation)
    if (!failure) return null
    if (failure.times !== undefined) {
      failure.times -= 1
      if (failure.times <= 0) this.failures.splice(this.failures.indexOf(failure), 1)
    }
    return failure.message
  }

  setUpdateHook(hook: (table: string, matched: Row[]) => void) {
    this.updateHook = hook
  }

  runBeforeUpdate(table: string, matched: Row[]) {
    this.updateHook?.(table, matched)
  }
}

export function createFakeDb(seed: Record<string, Row[]> = {}): FakeDb {
  const db = new InternalDb()
  for (const [table, rows] of Object.entries(seed)) {
    db.tables.set(table, rows.map((row) => ({ ...row })))
  }

  return {
    client: {
      from: (table: string): FakeTable => ({
        select: () => new FakeQuery(db, table, 'select'),
        update: (payload: Row) => new FakeQuery(db, table, 'update', payload),
        insert: (payload: Row | Row[]) => new FakeQuery(db, table, 'insert', payload),
        upsert: async (payload: Row | Row[], options?: { onConflict?: string }) => {
          const failure = db.takeFailure(table, 'insert')
          if (failure) return { data: null, error: { message: failure } }
          const keys = (options?.onConflict ?? 'id').split(',').map((key) => key.trim())
          const rows = db.table(table)
          const ids: unknown[] = []
          for (const incoming of Array.isArray(payload) ? payload : [payload]) {
            const existing = rows.find((row) => keys.every((key) => (row[key] ?? null) === (incoming[key] ?? null)))
            if (existing) {
              Object.assign(existing, incoming)
              existing.updated_at = nextTimestamp()
              ids.push(existing.id)
            } else {
              const created = { id: `fake-${table}-${rows.length + 1}-${Math.random().toString(16).slice(2, 8)}`, ...incoming }
              rows.push(created)
              ids.push(created.id)
            }
          }
          db.writes.push({ table, operation: 'insert', ids })
          return { data: null, error: null }
        },
        delete: () => new FakeQuery(db, table, 'delete'),
      }),
      rpc: async (name: string, args: Row = {}) => {
        if (!db.rpcHandler) throw new Error(`Unexpected rpc: ${name}`)
        return db.rpcHandler(name, args)
      },
    },
    rows: (table: string) => db.table(table),
    writes: db.writes,
    failNext: (failure: Failure) => db.addFailure(failure),
    beforeUpdate: (hook) => db.setUpdateHook(hook),
    onRpc: (handler) => {
      db.rpcHandler = handler
    },
  }
}

/**
 * What the database function `resolve_receipt_vendor` does, against the fake rows: an id or a
 * name comes back as the vendor that is standing now. A test's `onRpc` handler calls this for
 * that function name. The real function is tested on a real Postgres in tests/sql.
 */
export function fakeResolveReceiptVendor(db: FakeDb, args: Row): QueryResult {
  const vendors = db.rows('receipt_vendors')
  const key = (value: unknown): string | null => {
    if (typeof value !== 'string') return null
    const normalized = value.trim().replace(/\s+/g, ' ').toLowerCase()
    return normalized || null
  }
  const survivor = (id: unknown): Row | null => {
    let current = vendors.find((vendor) => vendor.id === id) ?? null
    for (let hops = 0; current && current.merged_into_vendor_id && hops < 20; hops += 1) {
      const next: Row | undefined = vendors.find((vendor) => vendor.id === current?.merged_into_vendor_id)
      if (!next) break
      current = next
    }
    return current
  }

  const nameKey = key(args.p_name)
  let vendor: Row | null = args.p_vendor_id ? survivor(args.p_vendor_id) : null
  if (!vendor && nameKey) {
    vendor = survivor(vendors.find((row) => row.vendor_key === nameKey)?.id)
    if (!vendor) {
      const alias = db.rows('receipt_vendor_aliases').find((row) => row.alias_key === nameKey)
      vendor = alias ? survivor(alias.vendor_id) : null
    }
  }

  let created = false
  if (!vendor && args.p_create && nameKey) {
    vendor = {
      id: `fake-vendor-${vendors.length + 1}`,
      canonical_name: String(args.p_name).trim().replace(/\s+/g, ' '),
      vendor_key: nameKey,
      status: 'unconfirmed',
      kind: args.p_kind ?? 'business',
      origin: args.p_origin ?? 'manual',
      merged_into_vendor_id: null,
      default_expense_category: null,
    }
    vendors.push(vendor)
    created = true
  }

  if (!vendor) return { data: null, error: null }
  return {
    data: {
      vendor_id: vendor.id,
      canonical_name: vendor.canonical_name,
      vendor_key: vendor.vendor_key,
      status: vendor.status ?? 'unconfirmed',
      kind: vendor.kind ?? 'business',
      default_expense_category: vendor.default_expense_category ?? null,
      created,
    },
    error: null,
  }
}

/**
 * What the database function `apply_receipt_rule_change` does, against the fake rows: the change
 * is written only if the payment is still at the version it was read at and is not behind the
 * lock date, and its history rows are written with it. It goes through the fake client, so
 * `failNext`, `beforeUpdate` and `writes` behave as they do for a plain update.
 */
export async function fakeApplyReceiptRuleChange(db: FakeDb, args: Row): Promise<QueryResult> {
  const id = args.p_transaction_id
  const current = db.rows('receipt_transactions').find((row) => row.id === id)
  if (!current) return { data: 'not_found', error: null }
  if (current.updated_at !== args.p_expected_updated_at) return { data: 'changed', error: null }

  const setting = db.rows('receipt_settings').find((row) => row.key === 'locked_before')
  const lock = (setting?.value as { date?: string } | undefined)?.date ?? null
  if (lock && String(current.transaction_date) <= lock) return { data: 'locked', error: null }

  const previousStatus = current.status
  const result = await db.client
    .from('receipt_transactions')
    .update(args.p_after as Row)
    .eq('id', id)
    .eq('updated_at', args.p_expected_updated_at)
    .select()
  if (result.error) return { data: null, error: result.error }
  const updated = (result.data as Row[] | null) ?? []
  if (!updated.length) return { data: 'changed', error: null }

  const logs = (Array.isArray(args.p_logs) ? args.p_logs : []) as Row[]
  if (logs.length) {
    await db.client.from('receipt_transaction_logs').insert(
      logs.map((entry) => ({
        transaction_id: id,
        previous_status: previousStatus,
        new_status: updated[0].status,
        action_type: entry.action_type,
        note: entry.note,
        performed_by: args.p_performed_by ?? null,
        rule_id: entry.rule_id ?? null,
      }))
    )
  }
  return { data: 'applied', error: null }
}

/**
 * The receipts database functions the services call, answered from the fake rows. Pass it to
 * `db.onRpc`. A test that needs another function wraps this and handles its own names first.
 */
export function fakeReceiptsRpc(db: FakeDb): (name: string, args: Row) => QueryResult | Promise<QueryResult> {
  return (name, args) => {
    if (name === 'resolve_receipt_vendor') return fakeResolveReceiptVendor(db, args)
    if (name === 'apply_receipt_rule_change') return fakeApplyReceiptRuleChange(db, args)
    throw new Error(`Unexpected rpc: ${name}`)
  }
}
