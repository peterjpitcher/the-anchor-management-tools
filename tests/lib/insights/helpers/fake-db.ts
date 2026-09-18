import type { InsightsDb } from '@/lib/insights/types'

/**
 * In-memory stand-in for the Supabase client, for insights section tests.
 *
 * Supports the read chain sections use: select (with count and head), eq, neq, gt, gte,
 * lt, lte, in, is, not, like, ilike, or (flat conditions), filter, match, order, range,
 * limit, single, maybeSingle and abortSignal, plus rpc through registered handlers.
 *
 * Column lists are ignored: rows come back whole, so put any embedded relation straight
 * into the fixture row (e.g. `{ id: 'b1', event: { name: 'Quiz' } }`). Dotted paths such
 * as 'event.date' work in filters and ordering. Compare timestamps in one format: the
 * code under test builds bounds with toISOString(), so fixtures should use '...Z' too.
 *
 * Write methods throw, because insights sections are read only.
 */

type Row = Record<string, unknown>
type Predicate = (row: Row) => boolean

export interface FakeCall {
  table: string
  kind: 'select' | 'rpc'
  args?: unknown
}

function valueAt(row: Row, path: string): unknown {
  return path.split('.').reduce<unknown>((value, key) => (value && typeof value === 'object' ? (value as Row)[key] : undefined), row)
}

function comparable(value: unknown): number | string | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'number') return value
  if (typeof value === 'boolean') return value ? 1 : 0
  return String(value)
}

function compareValues(a: unknown, b: unknown): number {
  const left = comparable(a)
  const right = comparable(b)
  if (left === null && right === null) return 0
  if (left === null) return -1
  if (right === null) return 1
  if (typeof left === 'number' && typeof right === 'number') return left - right
  const leftNumber = Number(left)
  const rightNumber = Number(right)
  if (typeof left !== typeof right && Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) return leftNumber - rightNumber
  return String(left) < String(right) ? -1 : String(left) > String(right) ? 1 : 0
}

function parseList(value: unknown): unknown[] {
  if (Array.isArray(value)) return value
  const text = String(value).trim().replace(/^\(/, '').replace(/\)$/, '')
  return text.length ? text.split(',').map((item) => item.trim().replace(/^"|"$/g, '')) : []
}

function likeToRegex(pattern: string, insensitive: boolean): RegExp {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.')
  return new RegExp(`^${escaped}$`, insensitive ? 'i' : '')
}

function predicateFor(column: string, operator: string, value: unknown): Predicate {
  switch (operator) {
    case 'eq': return (row) => compareValues(valueAt(row, column), value) === 0 && valueAt(row, column) !== null && valueAt(row, column) !== undefined
    case 'neq': return (row) => { const v = valueAt(row, column); return v !== null && v !== undefined && compareValues(v, value) !== 0 }
    case 'gt': return (row) => { const v = valueAt(row, column); return v !== null && v !== undefined && compareValues(v, value) > 0 }
    case 'gte': return (row) => { const v = valueAt(row, column); return v !== null && v !== undefined && compareValues(v, value) >= 0 }
    case 'lt': return (row) => { const v = valueAt(row, column); return v !== null && v !== undefined && compareValues(v, value) < 0 }
    case 'lte': return (row) => { const v = valueAt(row, column); return v !== null && v !== undefined && compareValues(v, value) <= 0 }
    case 'in': {
      const list = parseList(value)
      return (row) => list.some((item) => compareValues(valueAt(row, column), item) === 0 && valueAt(row, column) !== null)
    }
    case 'is': {
      const target = value === 'null' ? null : value === 'true' ? true : value === 'false' ? false : value
      return (row) => {
        const v = valueAt(row, column)
        return target === null ? v === null || v === undefined : v === target
      }
    }
    case 'like': return (row) => likeToRegex(String(value), false).test(String(valueAt(row, column) ?? ''))
    case 'ilike': return (row) => likeToRegex(String(value), true).test(String(valueAt(row, column) ?? ''))
    case 'cs': {
      const needles = parseList(value)
      return (row) => {
        const v = valueAt(row, column)
        return Array.isArray(v) && needles.every((needle) => v.includes(needle))
      }
    }
    default: throw new Error(`Fake db does not support operator "${operator}"`)
  }
}

function parseOrCondition(condition: string): Predicate {
  const trimmed = condition.trim()
  const andMatch = /^and\((.*)\)$/.exec(trimmed)
  if (andMatch) {
    const parts = splitTopLevel(andMatch[1]).map(parseOrCondition)
    return (row) => parts.every((part) => part(row))
  }
  const notMatch = /^([^.]+(?:\.[^.]+)*?)\.not\.([a-z]+)\.(.*)$/.exec(trimmed)
  if (notMatch) {
    const inner = predicateFor(notMatch[1], notMatch[2], notMatch[3])
    return (row) => !inner(row)
  }
  const match = /^(.+?)\.(eq|neq|gt|gte|lt|lte|in|is|like|ilike|cs)\.(.*)$/.exec(trimmed)
  if (!match) throw new Error(`Fake db cannot parse or() condition "${condition}"`)
  return predicateFor(match[1], match[2], match[3])
}

function splitTopLevel(text: string): string[] {
  const parts: string[] = []
  let depth = 0
  let current = ''
  for (const char of text) {
    if (char === '(') depth += 1
    if (char === ')') depth -= 1
    if (char === ',' && depth === 0) {
      parts.push(current)
      current = ''
    } else {
      current += char
    }
  }
  if (current.trim()) parts.push(current)
  return parts
}

export class FakeQuery implements PromiseLike<{ data: unknown; error: { message: string; code?: string } | null; count: number | null }> {
  private predicates: Predicate[] = []
  private sorts: { column: string; ascending: boolean; nullsFirst: boolean }[] = []
  private from = 0
  private to = Number.POSITIVE_INFINITY
  private limitCount = Number.POSITIVE_INFINITY
  private singleMode: 'none' | 'single' | 'maybe' = 'none'
  private countMode: string | null = null
  private head = false

  constructor(private readonly db: FakeDb, private readonly table: string) {}

  select(_columns?: string, options: { count?: string; head?: boolean } = {}): this {
    this.countMode = options.count ?? null
    this.head = options.head ?? false
    return this
  }

  insert(): never { throw new Error('Insights sections are read only (insert)') }
  update(): never { throw new Error('Insights sections are read only (update)') }
  upsert(): never { throw new Error('Insights sections are read only (upsert)') }
  delete(): never { throw new Error('Insights sections are read only (delete)') }

  eq(column: string, value: unknown): this { this.predicates.push(predicateFor(column, 'eq', value)); return this }
  neq(column: string, value: unknown): this { this.predicates.push(predicateFor(column, 'neq', value)); return this }
  gt(column: string, value: unknown): this { this.predicates.push(predicateFor(column, 'gt', value)); return this }
  gte(column: string, value: unknown): this { this.predicates.push(predicateFor(column, 'gte', value)); return this }
  lt(column: string, value: unknown): this { this.predicates.push(predicateFor(column, 'lt', value)); return this }
  lte(column: string, value: unknown): this { this.predicates.push(predicateFor(column, 'lte', value)); return this }
  in(column: string, values: unknown[]): this { this.predicates.push(predicateFor(column, 'in', values)); return this }
  is(column: string, value: unknown): this { this.predicates.push(predicateFor(column, 'is', value === null ? 'null' : value)); return this }
  like(column: string, pattern: string): this { this.predicates.push(predicateFor(column, 'like', pattern)); return this }
  ilike(column: string, pattern: string): this { this.predicates.push(predicateFor(column, 'ilike', pattern)); return this }
  contains(column: string, value: unknown[]): this { this.predicates.push(predicateFor(column, 'cs', value)); return this }
  filter(column: string, operator: string, value: unknown): this { this.predicates.push(predicateFor(column, operator, value)); return this }
  match(values: Row): this {
    for (const [column, value] of Object.entries(values)) this.eq(column, value)
    return this
  }
  not(column: string, operator: string, value: unknown): this {
    const inner = predicateFor(column, operator, value === null ? 'null' : value)
    this.predicates.push((row) => !inner(row))
    return this
  }
  or(filters: string): this {
    const parts = splitTopLevel(filters).map(parseOrCondition)
    this.predicates.push((row) => parts.some((part) => part(row)))
    return this
  }
  order(column: string, options: { ascending?: boolean; nullsFirst?: boolean } = {}): this {
    this.sorts.push({ column, ascending: options.ascending ?? true, nullsFirst: options.nullsFirst ?? false })
    return this
  }
  range(from: number, to: number): this { this.from = from; this.to = to; return this }
  limit(count: number): this { this.limitCount = count; return this }
  abortSignal(): this { return this }
  maybeSingle(): this { this.singleMode = 'maybe'; return this }
  single(): this { this.singleMode = 'single'; return this }

  private resolve(): { data: unknown; error: { message: string; code?: string } | null; count: number | null } {
    this.db.calls.push({ table: this.table, kind: 'select' })
    const failure = this.db.failures.get(this.table)
    if (failure) return { data: null, error: { message: failure }, count: null }
    let rows = (this.db.tables[this.table] ?? []).filter((row) => this.predicates.every((predicate) => predicate(row)))
    for (const sort of [...this.sorts].reverse()) {
      rows = [...rows].sort((a, b) => {
        const left = valueAt(a, sort.column)
        const right = valueAt(b, sort.column)
        const leftNull = left === null || left === undefined
        const rightNull = right === null || right === undefined
        if (leftNull || rightNull) {
          if (leftNull && rightNull) return 0
          return (leftNull ? -1 : 1) * (sort.nullsFirst ? 1 : -1)
        }
        const result = compareValues(left, right)
        return sort.ascending ? result : -result
      })
    }
    const count = this.countMode ? rows.length : null
    rows = rows.slice(this.from, Math.min(this.to + 1, this.from + this.limitCount))
    const cloned = rows.map((row) => structuredClone(row))
    if (this.head) return { data: null, error: null, count }
    if (this.singleMode === 'maybe') {
      if (cloned.length > 1) return { data: null, error: { message: 'More than one row' }, count }
      return { data: cloned[0] ?? null, error: null, count }
    }
    if (this.singleMode === 'single') {
      if (cloned.length !== 1) return { data: null, error: { message: 'Expected one row', code: 'PGRST116' }, count }
      return { data: cloned[0], error: null, count }
    }
    return { data: cloned, error: null, count }
  }

  then<TResult1 = { data: unknown; error: { message: string; code?: string } | null; count: number | null }, TResult2 = never>(
    onfulfilled?: ((value: { data: unknown; error: { message: string; code?: string } | null; count: number | null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve().then(() => this.resolve()).then(onfulfilled, onrejected)
  }
}

export class FakeDb {
  tables: Record<string, Row[]> = {}
  failures = new Map<string, string>()
  rpcHandlers: Record<string, (args: Record<string, unknown>) => unknown> = {}
  calls: FakeCall[] = []

  constructor(tables: Record<string, Row[]> = {}) {
    this.tables = tables
  }

  /** Make every read of `table` return a PostgREST-style error. */
  fail(table: string, message = 'Fixture failure'): this {
    this.failures.set(table, message)
    return this
  }

  from = (table: string): FakeQuery => new FakeQuery(this, table)

  rpc = (fn: string, args: Record<string, unknown> = {}): PromiseLike<{ data: unknown; error: { message: string } | null }> & { abortSignal(): unknown } => {
    this.calls.push({ table: fn, kind: 'rpc', args })
    const handler = this.rpcHandlers[fn]
    const result = Promise.resolve().then(() => {
      if (this.failures.has(fn)) return { data: null, error: { message: this.failures.get(fn) ?? 'Fixture failure' } }
      if (!handler) return { data: null, error: { message: `No fake handler for rpc ${fn}` } }
      return { data: handler(args), error: null }
    })
    return Object.assign(result, { abortSignal: () => result })
  }

  asDb(): InsightsDb {
    return this as unknown as InsightsDb
  }
}
