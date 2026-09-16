import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'

/**
 * A retro rule run reads the set it is about to change. Paging it by offset skipped one
 * unprocessed transaction for every row the previous chunk moved out of `pending`, and stopped
 * early because the row count shrank under the cursor, while the toast still said success.
 * These tests pin the traversal itself: every matching transaction is visited exactly once, and
 * the run always ends.
 */

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}))

vi.mock('@/app/actions/rbac', () => ({
  checkUserPermission: vi.fn(),
}))

vi.mock('@/app/actions/audit', () => ({
  logAuditEvent: vi.fn(),
}))

vi.mock('@/lib/audit-helpers', () => ({
  getCurrentUser: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}))

vi.mock('@/lib/unified-job-queue', () => ({
  jobQueue: {
    enqueue: vi.fn().mockResolvedValue({ success: true }),
  },
}))

vi.mock('@/services/receipts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/receipts')>()
  return {
    ...actual,
    applyAutomationRules: vi.fn(),
  }
})

import { checkUserPermission } from '@/app/actions/rbac'
import { getCurrentUser } from '@/lib/audit-helpers'
import { createAdminClient } from '@/lib/supabase/admin'
import { applyAutomationRules } from '@/services/receipts'
import { runReceiptRuleRetroactivelyStep } from '@/app/actions/receipts'

const mockedPermission = checkUserPermission as unknown as Mock
const mockedCurrentUser = getCurrentUser as unknown as Mock
const mockedCreateAdminClient = createAdminClient as unknown as Mock
const mockedApplyAutomationRules = applyAutomationRules as unknown as Mock

const RULE = { id: 'rule-1', name: 'Retro rule', is_active: true }
const CHUNK_SIZE = 100
const TRANSACTION_COUNT = 250

type FakeRow = {
  id: string
  status: string
  transaction_date: string
}

type OrderKey = { column: keyof FakeRow; ascending: boolean }

function buildRows(count: number, dateFor: (index: number) => string): FakeRow[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `tx-${String(index).padStart(3, '0')}`,
    status: 'pending',
    transaction_date: dateFor(index),
  }))
}

function sortRows(rows: FakeRow[], orders: OrderKey[], tieSeed: number): FakeRow[] {
  const sorted = [...rows].sort((a, b) => {
    for (const { column, ascending } of orders) {
      const left = a[column]
      const right = b[column]
      if (left === right) continue
      return ascending ? (left < right ? -1 : 1) : left < right ? 1 : -1
    }
    return 0
  })

  if (!tieSeed || !orders.length) {
    return sorted
  }

  // Postgres gives no order to rows that tie on every ORDER BY key, and is free to return them
  // differently on the next request. Rotating each tie group models that, which is what breaks
  // offset paging over a non-unique sort key.
  const result: FakeRow[] = []
  let index = 0
  while (index < sorted.length) {
    let end = index + 1
    while (
      end < sorted.length &&
      orders.every(({ column }) => sorted[end][column] === sorted[index][column])
    ) {
      end += 1
    }
    const group = sorted.slice(index, end)
    const rotation = tieSeed % group.length
    result.push(...group.slice(rotation), ...group.slice(0, rotation))
    index = end
  }
  return result
}

function createFakeDb(rows: FakeRow[], options: { shuffleTies?: boolean } = {}) {
  const store = new Map(rows.map((row) => [row.id, { ...row }]))
  let queryCount = 0

  function createIdsQuery() {
    const orders: OrderKey[] = []
    const predicates: Array<(row: FakeRow) => boolean> = []

    const builder = {
      order(column: keyof FakeRow, config?: { ascending?: boolean }) {
        orders.push({ column, ascending: config?.ascending !== false })
        return builder
      },
      eq(column: keyof FakeRow, value: string) {
        predicates.push((row) => row[column] === value)
        return builder
      },
      gt(column: keyof FakeRow, value: string) {
        predicates.push((row) => row[column] > value)
        return builder
      },
      async range(from: number, to: number) {
        queryCount += 1
        const matched = [...store.values()].filter((row) =>
          predicates.every((predicate) => predicate(row))
        )
        const ordered = sortRows(matched, orders, options.shuffleTies ? queryCount : 0)
        return {
          data: ordered.slice(from, to + 1).map((row) => ({ id: row.id })),
          count: matched.length,
          error: null,
        }
      },
    }

    return builder
  }

  const client = {
    from(table: string) {
      if (table === 'receipt_rules') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: RULE, error: null }),
            }),
          }),
        }
      }
      if (table === 'receipt_transactions') {
        return {
          select: (columns: string) => {
            if (columns !== 'id') {
              throw new Error(`Unexpected select columns: ${columns}`)
            }
            return createIdsQuery()
          },
        }
      }
      throw new Error(`Unexpected table: ${table}`)
    },
  }

  return { client, store }
}

/**
 * Mirrors the loop in `useRetroRuleRunner`: feed the cursor the last step returned back in, stop
 * on `done`, and refuse to repeat a chunk if the cursor ever fails to move.
 */
async function runFullRetro(options: { scope?: 'pending' | 'all' } = {}) {
  const MAX_ITERATIONS = 300
  let cursor: string | null = null
  let reviewed = 0
  let iterations = 0
  const chunkSizes: number[] = []

  while (iterations < MAX_ITERATIONS) {
    const step = await runReceiptRuleRetroactivelyStep({
      ruleId: RULE.id,
      scope: options.scope ?? 'pending',
      cursor,
      offset: reviewed,
      chunkSize: CHUNK_SIZE,
    })

    if (!step.success) {
      throw new Error(step.error)
    }

    reviewed += step.reviewed
    chunkSizes.push(step.reviewed)
    iterations += 1

    if (step.done) {
      return { reviewed, iterations, chunkSizes, done: true, total: step.total }
    }

    if (!step.nextCursor || step.nextCursor === cursor || step.reviewed === 0) {
      return { reviewed, iterations, chunkSizes, done: false, total: step.total }
    }

    cursor = step.nextCursor
  }

  return { reviewed, iterations, chunkSizes, done: false, total: reviewed }
}

function trackVisits(options: { store: Map<string, FakeRow>; matches: boolean }) {
  const visited: string[] = []

  mockedApplyAutomationRules.mockImplementation(async (ids: string[]) => {
    visited.push(...ids)

    if (options.matches) {
      // A matching rule auto-completes the transaction, so it leaves the pending set the run is
      // reading. This is exactly what made offset paging skip rows.
      ids.forEach((id) => {
        const row = options.store.get(id)
        if (row) {
          row.status = 'auto_completed'
        }
      })
    }

    return {
      statusAutoUpdated: options.matches ? ids.length : 0,
      classificationUpdated: 0,
      matched: options.matches ? ids.length : 0,
      vendorIntended: 0,
      expenseIntended: 0,
      samples: [],
    }
  })

  return visited
}

const allIds = () => buildRows(TRANSACTION_COUNT, () => '2026-09-01').map((row) => row.id)

describe('Retro rule run traversal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedPermission.mockResolvedValue(true)
    mockedCurrentUser.mockResolvedValue({ user_id: 'user-1', user_email: 'user@example.com' })
  })

  it('visits all 250 pending transactions exactly once when the rule matches every one', async () => {
    // Several transactions per day, as a real statement import produces.
    const rows = buildRows(TRANSACTION_COUNT, (index) => `2026-09-${String((index % 28) + 1).padStart(2, '0')}`)
    const { client, store } = createFakeDb(rows)
    mockedCreateAdminClient.mockReturnValue(client)
    const visited = trackVisits({ store, matches: true })

    const run = await runFullRetro()

    expect(run.done).toBe(true)
    expect(run.chunkSizes).toEqual([100, 100, 50])
    expect(visited).toHaveLength(TRANSACTION_COUNT)
    expect(new Set(visited).size).toBe(TRANSACTION_COUNT)
    expect([...visited].sort()).toEqual(allIds())
    expect(run.reviewed).toBe(TRANSACTION_COUNT)
    // Nothing is left behind in the pending set.
    expect([...store.values()].filter((row) => row.status === 'pending')).toHaveLength(0)
  })

  it('terminates and still visits every transaction when the rule matches none', async () => {
    const rows = buildRows(TRANSACTION_COUNT, (index) => `2026-09-${String((index % 28) + 1).padStart(2, '0')}`)
    const { client, store } = createFakeDb(rows)
    mockedCreateAdminClient.mockReturnValue(client)
    const visited = trackVisits({ store, matches: false })

    const run = await runFullRetro()

    expect(run.done).toBe(true)
    expect(run.iterations).toBe(3)
    expect(visited).toHaveLength(TRANSACTION_COUNT)
    expect(new Set(visited).size).toBe(TRANSACTION_COUNT)
    // The rule changed nothing, so every row is still pending and none was read twice.
    expect([...store.values()].every((row) => row.status === 'pending')).toBe(true)
  })

  it('visits no row twice when every row shares one transaction_date', async () => {
    const rows = buildRows(TRANSACTION_COUNT, () => '2026-09-01')
    const { client, store } = createFakeDb(rows, { shuffleTies: true })
    mockedCreateAdminClient.mockReturnValue(client)
    const visited = trackVisits({ store, matches: false })

    const run = await runFullRetro({ scope: 'all' })

    expect(run.done).toBe(true)
    expect(new Set(visited).size).toBe(visited.length)
    expect([...visited].sort()).toEqual(allIds())
  })

  it('reports a failure rather than a silent success when the caller cannot manage receipts', async () => {
    mockedPermission.mockResolvedValue(false)

    const step = await runReceiptRuleRetroactivelyStep({ ruleId: RULE.id })

    expect(step).toEqual({ success: false, error: 'Insufficient permissions' })
    expect(mockedApplyAutomationRules).not.toHaveBeenCalled()
  })
})
