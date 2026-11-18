import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'

/**
 * getCustomerList (spec C1, 18 November 2026). The list used to send a separate
 * `count: 'exact', head: true` query for the selected tab's total beside the data query;
 * the total now comes from the data query itself. These tests run both shapes through
 * one in-memory fake of the PostgREST builder, so the new total is checked against what
 * the old count query would have returned, with a search term and with each SMS filter.
 */

vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))
vi.mock('@/app/actions/rbac', () => ({ checkUserPermission: vi.fn() }))
vi.mock('@/app/actions/audit', () => ({ logAuditEvent: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/services/messages', () => ({ MessageService: { getUnreadCounts: vi.fn() } }))

import { checkUserPermission } from '@/app/actions/rbac'
import { createClient } from '@/lib/supabase/server'
import { MessageService } from '@/services/messages'
import { getCustomerList, type CustomerSmsFilter } from '@/app/actions/customers'

const mockedPermission = checkUserPermission as unknown as Mock
const mockedCreateClient = createClient as unknown as Mock
const mockedUnread = MessageService.getUnreadCounts as unknown as Mock

type Row = Record<string, unknown>

// ---------------------------------------------------------------------------
// A small in-memory PostgREST builder: enough of eq, in, or (ilike), order,
// range and select({ count, head }) to evaluate the list's real filter strings.
// ---------------------------------------------------------------------------

function splitOutsideQuotes(text: string): string[] {
  const parts: string[] = []
  let current = ''
  let quoted = false
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]
    if (ch === '\\' && quoted) {
      current += ch + text[i + 1]
      i += 1
      continue
    }
    if (ch === '"') quoted = !quoted
    if (ch === ',' && !quoted) {
      parts.push(current)
      current = ''
      continue
    }
    current += ch
  }
  parts.push(current)
  return parts
}

function ilikeMatches(value: unknown, pattern: string): boolean {
  if (typeof value !== 'string') return false
  const regex = new RegExp(
    '^' + pattern.split('%').map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$',
    'i'
  )
  return regex.test(value)
}

function orPredicate(filter: string): (row: Row) => boolean {
  const clauses = splitOutsideQuotes(filter).map((clause) => {
    const match = clause.match(/^([a-z_]+)\.ilike\.(.*)$/)
    if (!match) throw new Error(`Unsupported or() clause: ${clause}`)
    let raw = match[2]
    if (raw.startsWith('"') && raw.endsWith('"')) {
      raw = raw.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\')
    }
    return { column: match[1], pattern: raw }
  })
  return (row) => clauses.some(({ column, pattern }) => ilikeMatches(row[column], pattern))
}

interface QueryLog {
  table: string
  options?: { count?: string; head?: boolean }
  orFilters: string[]
}

function createFakeClient(tables: Record<string, Row[]>) {
  const queries: QueryLog[] = []

  function from(table: string) {
    const predicates: Array<(row: Row) => boolean> = []
    const log: QueryLog = { table, orFilters: [] }
    let rangeFrom: number | null = null
    let rangeTo: number | null = null

    const builder = {
      select(_columns: string, options?: { count?: string; head?: boolean }) {
        log.options = options
        return builder
      },
      eq(column: string, value: unknown) {
        predicates.push((row) => row[column] === value)
        return builder
      },
      in(column: string, values: readonly unknown[]) {
        predicates.push((row) => values.includes(row[column]))
        return builder
      },
      or(filter: string) {
        log.orFilters.push(filter)
        predicates.push(orPredicate(filter))
        return builder
      },
      order() {
        return builder
      },
      range(start: number, end: number) {
        rangeFrom = start
        rangeTo = end
        return builder
      },
      // A PostgREST builder sends nothing until it is awaited, so only awaited queries are logged.
      then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) {
        queries.push(log)
        const matching = (tables[table] ?? []).filter((row) => predicates.every((p) => p(row)))
        const count = log.options?.count === 'exact' ? matching.length : null
        const data = log.options?.head
          ? null
          : rangeFrom === null
            ? matching
            : matching.slice(rangeFrom, (rangeTo ?? matching.length) + 1)
        return Promise.resolve({ data, count, error: null }).then(resolve, reject)
      },
    }
    return builder
  }

  return { client: { from }, queries }
}

/** The pre-C1 count query, rebuilt exactly as it was, for the expected total. */
async function oldCountQuery(
  tables: Record<string, Row[]>,
  smsFilter: CustomerSmsFilter,
  searchFilter: string | null
): Promise<number | null> {
  const { client } = createFakeClient(tables)
  let query = client.from('customers').select('id', { count: 'exact', head: true }).eq('is_placeholder', false)
  if (smsFilter === 'deactivated') query = query.in('sms_status', ['opted_out', 'sms_deactivated'])
  else if (smsFilter === 'active') query = query.in('sms_status', ['active'])
  if (searchFilter) query = query.or(searchFilter)
  const { count } = (await query) as { count: number | null }
  return count
}

// 140 customers across every sms_status, a few placeholders, and some Smiths, so the
// filtered total is larger than a page and the range cannot be what is counted.
function buildCustomers(): Row[] {
  const statuses = ['active', 'opted_out', 'sms_deactivated', null]
  const rows: Row[] = []
  for (let i = 0; i < 140; i += 1) {
    rows.push({
      id: `customer-${String(i).padStart(3, '0')}`,
      first_name: i % 3 === 0 ? 'Sam' : 'Alex',
      last_name: i % 2 === 0 ? 'Smith' : 'Jones',
      mobile_number: `+447700900${String(i).padStart(3, '0')}`,
      email: i % 5 === 0 ? `smith${i}@example.com` : `guest${i}@example.com`,
      sms_opt_in: true,
      sms_status: statuses[i % statuses.length],
      created_at: '2026-01-01T10:00:00.000Z',
      is_placeholder: i % 17 === 0,
    })
  }
  return rows
}

const TABLES: Record<string, Row[]> = {
  customers: buildCustomers(),
  customer_category_stats: [],
  customer_label_assignments: [],
}

function grantPermissions(granted: string[]) {
  mockedPermission.mockImplementation(async (moduleName: string, action: string) =>
    granted.includes(`${moduleName}:${action}`)
  )
}

describe('getCustomerList', () => {
  let fake: ReturnType<typeof createFakeClient>

  beforeEach(() => {
    vi.clearAllMocks()
    fake = createFakeClient(TABLES)
    mockedCreateClient.mockResolvedValue(fake.client)
    mockedUnread.mockResolvedValue({ 'customer-001': 2 })
    grantPermissions(['customers:view', 'messages:view'])
  })

  const cases: Array<[string, CustomerSmsFilter, string]> = [
    ['all, no search', 'all', ''],
    ['active, no search', 'active', ''],
    ['deactivated, no search', 'deactivated', ''],
    ['all, searching smith', 'all', 'smith'],
    ['active, searching smith', 'active', 'smith'],
    ['deactivated, searching smith', 'deactivated', 'smith'],
  ]

  it.each(cases)('total equals the old count query: %s', async (_label, smsFilter, searchTerm) => {
    const result = await getCustomerList({ page: 1, pageSize: 10, searchTerm, smsFilter })

    const dataQuery = fake.queries.find((q) => q.table === 'customers' && !q.options?.head)
    expect(dataQuery?.options).toEqual({ count: 'exact' })
    const searchFilter = dataQuery?.orFilters[0] ?? null
    if (searchTerm) expect(searchFilter).toBeTruthy()

    const expected = await oldCountQuery(TABLES, smsFilter, searchFilter)
    expect(result.error).toBeUndefined()
    expect(result.totalCount).toBe(expected)
    expect(result.totalCount).toBeGreaterThan(result.customers.length)
    expect(result.customers).toHaveLength(10)

    // No separate total count any more: only the two tab counts are head queries.
    const headQueries = fake.queries.filter((q) => q.table === 'customers' && q.options?.head)
    expect(headQueries).toHaveLength(2)
  })

  it('still returns both tab counts by default', async () => {
    const result = await getCustomerList({ page: 2, pageSize: 10, searchTerm: '', smsFilter: 'all' })

    const visible = TABLES.customers.filter((row) => row.is_placeholder === false)
    expect(result.smsActiveCount).toBe(visible.filter((row) => row.sms_status === 'active').length)
    expect(result.smsDeactivatedCount).toBe(
      visible.filter((row) => row.sms_status === 'opted_out' || row.sms_status === 'sms_deactivated').length
    )
  })

  it('skips the two tab counts when includeTabCounts is false', async () => {
    const result = await getCustomerList({
      page: 2,
      pageSize: 10,
      searchTerm: 'smith',
      smsFilter: 'active',
      includeTabCounts: false,
    })

    const customerQueries = fake.queries.filter((q) => q.table === 'customers')
    expect(customerQueries).toHaveLength(1)
    expect(customerQueries[0].options).toEqual({ count: 'exact' })
    expect(result.smsActiveCount).toBeNull()
    expect(result.smsDeactivatedCount).toBeNull()
    expect(result.totalCount).toBe(await oldCountQuery(TABLES, 'active', customerQueries[0].orFilters[0]))
    expect(result.customers).toHaveLength(10)
  })

  it('checks each permission once and reads labels and unread counts without re-checking', async () => {
    const result = await getCustomerList({ page: 1, pageSize: 10, searchTerm: '', smsFilter: 'all' })

    expect(mockedPermission).toHaveBeenCalledTimes(2)
    expect(mockedPermission).toHaveBeenCalledWith('customers', 'view')
    expect(mockedPermission).toHaveBeenCalledWith('messages', 'view')
    expect(fake.queries.some((q) => q.table === 'customer_label_assignments')).toBe(true)
    expect(mockedUnread).toHaveBeenCalledTimes(1)
    expect(result.unreadCounts).toEqual({ 'customer-001': 2 })
  })

  it('shows no unread badges without messages:view, as before', async () => {
    grantPermissions(['customers:view'])

    const result = await getCustomerList({ page: 1, pageSize: 10, searchTerm: '', smsFilter: 'all' })

    expect(result.error).toBeUndefined()
    expect(result.customers).toHaveLength(10)
    expect(mockedUnread).not.toHaveBeenCalled()
    expect(result.unreadCounts).toEqual({})
  })

  it('refuses without customers:view and reads nothing', async () => {
    grantPermissions(['messages:view'])

    const result = await getCustomerList({ page: 1, pageSize: 10, searchTerm: '', smsFilter: 'all' })

    expect(result.error).toBe('Insufficient permissions')
    expect(mockedCreateClient).not.toHaveBeenCalled()
    expect(mockedUnread).not.toHaveBeenCalled()
  })
})
