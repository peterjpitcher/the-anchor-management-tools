import type { SupabaseClient } from '@supabase/supabase-js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import tablesJson from '@/lib/mcp/generated/tables.json'
import type { ManifestTable } from '@/lib/mcp/manifest/build'
import { errorResult, textResult } from '@/lib/mcp/bridge'

/**
 * Read-only access to any table or view, as the acting account (row level security applies).
 *
 * There is deliberately no matching write: every change the app can make is a server action or
 * a staff route, and going through those keeps the business rules. Raw row edits stay with the
 * Supabase connector for development and approved data fixes.
 */

export const TABLES = tablesJson as ManifestTable[]
const TABLES_BY_NAME = new Map(TABLES.map((table) => [table.name, table]))

export const MAX_QUERY_ROWS = 1000
const DEFAULT_QUERY_ROWS = 100

export const FILTER_OPERATORS = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike', 'in', 'is'] as const
export type FilterOperator = (typeof FILTER_OPERATORS)[number]

export interface RecordFilter {
  column: string
  op: FilterOperator
  value?: unknown
}

export interface QueryRecordsInput {
  table: string
  select?: string
  filters?: RecordFilter[]
  order?: Array<{ column: string; ascending?: boolean }>
  limit?: number
  offset?: number
  count?: boolean
}

/** PostgREST select syntax: columns, embeds, aliases and casts. Nothing else. */
const SELECT_PATTERN = /^[A-Za-z0-9_,.*:()!\s-]+$/

export function describeData(table?: string): CallToolResult {
  if (!table) {
    return textResult({
      total: TABLES.length,
      tables: TABLES.map((entry) => ({ name: entry.name, kind: entry.kind, columns: entry.columns.length })),
      note: 'Pass a table name to see its columns. Prefer an action (find_actions) where one exists: actions apply the business rules, raw rows do not.',
    })
  }
  const entry = TABLES_BY_NAME.get(table)
  if (!entry) return errorResult(`No table or view called "${table}". Call describe_data with no table to list them.`)
  return textResult(entry)
}

export function validateQuery(input: QueryRecordsInput): string | null {
  const table = TABLES_BY_NAME.get(input.table)
  if (!table) return `No table or view called "${input.table}".`
  const columns = new Set(table.columns.map((column) => column.name))

  if (input.select !== undefined && !SELECT_PATTERN.test(input.select)) {
    return 'select may only hold column names, embeds such as customers(first_name), aliases and casts.'
  }
  for (const filter of input.filters ?? []) {
    if (!columns.has(filter.column)) return `"${input.table}" has no column "${filter.column}".`
    if (!FILTER_OPERATORS.includes(filter.op)) return `Unknown operator "${String(filter.op)}".`
    if (filter.op === 'in' && !Array.isArray(filter.value)) return `"in" needs an array value (column "${filter.column}").`
    if (filter.op === 'is' && ![null, true, false].includes(filter.value as null | boolean)) {
      return `"is" takes null, true or false (column "${filter.column}").`
    }
  }
  for (const order of input.order ?? []) {
    if (!columns.has(order.column)) return `"${input.table}" has no column "${order.column}" to order by.`
  }
  if (input.limit !== undefined && (input.limit < 1 || input.limit > MAX_QUERY_ROWS)) {
    return `limit must be between 1 and ${MAX_QUERY_ROWS}.`
  }
  if (input.offset !== undefined && input.offset < 0) return 'offset cannot be negative.'
  return null
}

export async function queryRecords(client: SupabaseClient, input: QueryRecordsInput): Promise<CallToolResult> {
  const problem = validateQuery(input)
  if (problem) return errorResult(problem)

  const limit = input.limit ?? DEFAULT_QUERY_ROWS
  const offset = input.offset ?? 0
  let query = client
    .from(input.table)
    .select(input.select?.trim() || '*', input.count ? { count: 'exact' } : undefined)

  for (const filter of input.filters ?? []) {
    const value = filter.value
    switch (filter.op) {
      case 'eq': query = query.eq(filter.column, value); break
      case 'neq': query = query.neq(filter.column, value); break
      case 'gt': query = query.gt(filter.column, value); break
      case 'gte': query = query.gte(filter.column, value); break
      case 'lt': query = query.lt(filter.column, value); break
      case 'lte': query = query.lte(filter.column, value); break
      case 'like': query = query.like(filter.column, String(value)); break
      case 'ilike': query = query.ilike(filter.column, String(value)); break
      case 'in': query = query.in(filter.column, value as unknown[]); break
      case 'is': query = query.is(filter.column, value as null | boolean); break
    }
  }
  for (const order of input.order ?? []) {
    query = query.order(order.column, { ascending: order.ascending ?? true })
  }

  const { data, error, count } = await query.range(offset, offset + limit - 1)
  if (error) {
    // A failed read is an error, never an empty list: an agent would read [] as "there are none".
    return errorResult(
      [error.message, error.code && `code ${error.code}`, error.details, error.hint].filter(Boolean).join('; '),
    )
  }

  const rows = data ?? []
  return textResult({
    table: input.table,
    offset,
    returned: rows.length,
    ...(input.count ? { total: count } : {}),
    more: input.count ? (count ?? 0) > offset + rows.length : rows.length === limit,
    rows,
  })
}
