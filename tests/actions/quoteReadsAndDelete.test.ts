import { beforeEach, describe, expect, it, vi } from 'vitest'
import { columnsNamedBySelect, publicSchemaColumns, type ColumnReference } from '../helpers/generatedSchema'

/**
 * The quote reads and the quote delete, run against a client that knows which columns the real
 * tables have and refuses a query that names any other, the way PostgREST does.
 *
 * The Quotes list was dead in production from 3 March to 13 October 2026 because three reads
 * filtered on `quotes.deleted_at`, a column the table has never had. An ordinary mocked client
 * answers any filter, so nothing failed. This one answers a missing column in a read with the
 * 400 body PostgREST gave on the day ("column quotes.deleted_at does not exist", code 42703).
 */

vi.mock('@/app/actions/rbac', () => ({ checkUserPermission: vi.fn() }))
vi.mock('@/app/actions/audit', () => ({ logAuditEvent: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))

import { checkUserPermission } from '@/app/actions/rbac'
import { logAuditEvent } from '@/app/actions/audit'
import { createClient } from '@/lib/supabase/server'
import { deleteQuote, getQuote, getQuoteSummary, getQuotes } from '@/app/actions/quotes'

type Row = Record<string, unknown>
type Result = { data: unknown; error: { code: string; message: string } | null }

interface Query {
  table: string
  op: 'select' | 'update' | 'delete'
  filters: Array<[column: string, value: unknown]>
}

const DRAFT = 'a1f0c1de-0000-4000-8000-000000000001'
const SENT = 'a1f0c1de-0000-4000-8000-000000000002'
const LAPSED = 'a1f0c1de-0000-4000-8000-000000000003'
const ACCEPTED = 'a1f0c1de-0000-4000-8000-000000000004'

/** Rows shaped like the live table: every key here is a real `quotes` column. */
function quote(id: string, status: string, totalAmount: number, validUntil: string, quoteDate: string): Row {
  return {
    id,
    quote_number: `Q-${id.slice(-3)}`,
    vendor_id: 'b2e1d2ef-0000-4000-8000-000000000001',
    quote_date: quoteDate,
    valid_until: validUntil,
    reference: null,
    status,
    quote_discount_percentage: 0,
    subtotal_amount: totalAmount,
    discount_amount: 0,
    vat_amount: 0,
    total_amount: totalAmount,
    notes: null,
    internal_notes: null,
    converted_to_invoice_id: null,
    created_at: '2026-10-01T09:00:00Z',
    updated_at: '2026-10-01T09:00:00Z',
  }
}

function seed(): Row[] {
  return [
    quote(DRAFT, 'draft', 100, '2999-12-31', '2026-10-04'),
    quote(SENT, 'sent', 200.5, '2999-12-31', '2026-10-03'),
    quote(LAPSED, 'sent', 50, '2000-01-01', '2026-10-02'),
    quote(ACCEPTED, 'accepted', 300, '2999-12-31', '2026-10-01'),
  ]
}

/**
 * A stand-in for the Supabase client that holds `quotes` rows and checks every column a query
 * names against the generated schema types before it answers.
 */
function useQuotes(rows: Row[], options: { afterRead?: () => void } = {}): { rows: Row[]; queries: Query[] } {
  const schema = publicSchemaColumns()
  const state = { rows, queries: [] as Query[] }

  const client = {
    from(table: string) {
      const query: Query = { table, op: 'select', filters: [] }
      state.queries.push(query)
      const named: ColumnReference[] = []
      let payload: Row = {}
      let returning = false

      const run = async (mode: 'one' | 'maybe' | 'many'): Promise<Result> => {
        const missing = named.find(({ table: owner, column }) => !schema.get(owner)?.has(column))
        if (missing) {
          return query.op === 'update' && missing.column in payload
            ? { data: null, error: { code: 'PGRST204', message: `Could not find the '${missing.column}' column of '${missing.table}' in the schema cache` } }
            : { data: null, error: { code: '42703', message: `column ${missing.table}.${missing.column} does not exist` } }
        }
        expect(table).toBe('quotes')

        const matched = state.rows.filter((row) => query.filters.every(([column, value]) => row[column] === value))
        let data: Row[] = matched.map((row) => ({ ...row }))
        if (query.op === 'delete') {
          state.rows = state.rows.filter((row) => !matched.includes(row))
          if (!returning) data = []
        } else if (query.op === 'update') {
          for (const row of matched) Object.assign(row, payload)
          if (!returning) data = []
        } else {
          options.afterRead?.()
        }

        if (mode === 'one') {
          return data.length === 1
            ? { data: data[0], error: null }
            : { data: null, error: { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' } }
        }
        if (mode === 'maybe') return { data: data[0] ?? null, error: null }
        return { data, error: null }
      }

      const builder = {
        select(columns = '*') {
          named.push(...columnsNamedBySelect(table, columns, schema))
          if (query.op !== 'select') returning = true
          return builder
        },
        update(patch: Row) {
          query.op = 'update'
          payload = patch
          named.push(...Object.keys(patch).map((column) => ({ table, column })))
          return builder
        },
        delete() {
          query.op = 'delete'
          return builder
        },
        eq(column: string, value: unknown) {
          named.push({ table, column })
          query.filters.push([column, value])
          return builder
        },
        is(column: string, value: unknown) {
          named.push({ table, column })
          query.filters.push([column, value])
          return builder
        },
        order(column: string) {
          named.push({ table, column })
          return builder
        },
        single: () => run('one'),
        maybeSingle: () => run('maybe'),
        then: (resolve: (result: Result) => unknown, reject?: (reason: unknown) => unknown) => run('many').then(resolve, reject),
      }
      return builder
    },
  }

  vi.mocked(createClient).mockResolvedValue(client as unknown as Awaited<ReturnType<typeof createClient>>)
  return state
}

function deleteForm(quoteId: string): FormData {
  const form = new FormData()
  form.set('quoteId', quoteId)
  return form
}

describe('quote reads and delete', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(checkUserPermission).mockResolvedValue(true)
  })

  it('the stand-in refuses a column the table does not have, as the live API does', async () => {
    useQuotes(seed())
    const client = await createClient()

    const filtered = await client.from('quotes').select('status').is('deleted_at', null)
    const selected = await client.from('quotes').select('id, status, deleted_at').eq('id', DRAFT).single()

    expect(filtered).toEqual({ data: null, error: { code: '42703', message: 'column quotes.deleted_at does not exist' } })
    expect(selected.error?.code).toBe('42703')
  })

  it('totals the list summary', async () => {
    useQuotes(seed())

    const result = await getQuoteSummary()

    expect(result).toEqual({
      summary: { total_pending: 200.5, total_expired: 50, total_accepted: 300, draft_badge: 1 },
    })
  })

  it('lists every quote, and shows a sent quote past its date as expired', async () => {
    useQuotes(seed())

    const result = await getQuotes()

    expect(result.error).toBeUndefined()
    expect(result.quotes?.map((row) => [row.id, row.status])).toEqual([
      [DRAFT, 'draft'],
      [SENT, 'sent'],
      [LAPSED, 'expired'],
      [ACCEPTED, 'accepted'],
    ])
  })

  it('lists the quotes of one status', async () => {
    useQuotes(seed())

    const result = await getQuotes('draft')

    expect(result.error).toBeUndefined()
    expect(result.quotes?.map((row) => row.id)).toEqual([DRAFT])
  })

  it('loads one quote for the detail page', async () => {
    useQuotes(seed())

    const result = await getQuote(SENT)

    expect(result.error).toBeUndefined()
    expect(result.quote).toMatchObject({ id: SENT, status: 'sent', total_amount: 200.5 })
  })

  it('deletes a draft with one guarded delete and nothing else', async () => {
    const state = useQuotes(seed())

    const result = await deleteQuote(deleteForm(DRAFT))

    expect(result).toEqual({ success: true })
    expect(state.rows.map((row) => row.id)).toEqual([SENT, LAPSED, ACCEPTED])
    // The line items go by ON DELETE CASCADE. Deleting them first, as the old fallback did,
    // could strip a quote that was sent in the meantime and then survived the status guard.
    expect(state.queries).toEqual([
      { table: 'quotes', op: 'select', filters: [['id', DRAFT]] },
      { table: 'quotes', op: 'delete', filters: [['id', DRAFT], ['status', 'draft']] },
    ])
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ operation_type: 'delete', resource_type: 'quote', resource_id: DRAFT, operation_status: 'success' })
    )
  })

  it('refuses to delete a quote that is not a draft', async () => {
    const state = useQuotes(seed())

    const result = await deleteQuote(deleteForm(SENT))

    expect(result).toEqual({ error: 'Only draft quotes can be deleted' })
    expect(state.rows).toHaveLength(4)
    expect(state.queries.map((query) => query.op)).toEqual(['select'])
    expect(logAuditEvent).not.toHaveBeenCalled()
  })

  it('removes nothing when the quote is sent between the check and the delete', async () => {
    const rows = seed()
    const state = useQuotes(rows, {
      afterRead: () => {
        rows[0].status = 'sent'
      },
    })

    const result = await deleteQuote(deleteForm(DRAFT))

    expect(result).toEqual({ error: 'Quote is no longer deletable' })
    expect(state.rows).toHaveLength(4)
    expect(logAuditEvent).not.toHaveBeenCalled()
  })

  it('says not found for a quote that does not exist', async () => {
    useQuotes(seed())

    const result = await deleteQuote(deleteForm('a1f0c1de-0000-4000-8000-00000000ffff'))

    expect(result).toEqual({ error: 'Quote not found' })
    expect(logAuditEvent).not.toHaveBeenCalled()
  })
})
