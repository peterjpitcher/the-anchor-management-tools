import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'

/**
 * Recurring invoices bill vendors on a schedule with nobody watching, so the failure
 * modes are quiet ones: billing a cancelled agreement, billing the same period twice,
 * or getting the due date wrong. None of this file was covered.
 *
 * The date maths deliberately uses the real `recurringInvoiceSchedule` module rather
 * than a mock, because "the schedule advanced correctly" is the assertion that matters.
 */

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/app/actions/rbac', () => ({ checkUserPermission: vi.fn() }))
vi.mock('@/app/actions/audit', () => ({ logAuditEvent: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/services/invoices', () => ({ InvoiceService: { createInvoice: vi.fn() } }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { generateInvoiceFromRecurring } from '@/app/actions/recurring-invoices'
import { createClient } from '@/lib/supabase/server'
import { checkUserPermission } from '@/app/actions/rbac'
import { InvoiceService } from '@/services/invoices'

const mockedCreateClient = createClient as unknown as Mock
const mockedPermission = checkUserPermission as unknown as Mock
const mockedCreateInvoice = InvoiceService.createInvoice as unknown as Mock

const BASE_RECURRING = {
  id: 'rec-1',
  vendor_id: 'vendor-1',
  is_active: true,
  frequency: 'monthly',
  next_invoice_date: '2026-01-31',
  days_before_due: 14,
  reference: 'RETAINER',
  invoice_discount_percentage: 0,
  notes: null,
  internal_notes: null,
  vendor: { id: 'vendor-1', name: 'Acme', payment_terms: 30 },
  line_items: [
    { catalog_item_id: 'cat-1', description: 'Retainer', quantity: 2, unit_price: 100, discount_percentage: 0, vat_rate: 20 },
  ],
}

/**
 * @param opts.recurring       the row returned for the recurring invoice lookup
 * @param opts.scheduleUpdated whether the guarded schedule update matched a row
 */
function mockSupabase(opts: {
  recurring?: any
  fetchError?: any
  scheduleUpdated?: boolean
  scheduleUpdateError?: any
  updates?: any[]
} = {}) {
  const updates = opts.updates ?? []

  const selectChain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({
      data: opts.fetchError ? null : (opts.recurring ?? BASE_RECURRING),
      error: opts.fetchError ?? null,
    }),
  }

  const updateChain: any = {
    update: vi.fn((payload: any) => { updates.push(payload); return updateChain }),
    eq: vi.fn(() => updateChain),
    select: vi.fn(() => updateChain),
    maybeSingle: vi.fn().mockResolvedValue({
      data: opts.scheduleUpdated === false ? null : { id: 'rec-1' },
      error: opts.scheduleUpdateError ?? null,
    }),
  }

  let call = 0
  const from = vi.fn(() => {
    call += 1
    return call === 1 ? selectChain : updateChain
  })

  mockedCreateClient.mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }) },
    from,
  })

  return { from, updates, updateChain }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockedPermission.mockResolvedValue(true)
  mockedCreateInvoice.mockResolvedValue({ id: 'inv-1', invoice_number: 'INV-001' })
})

describe('generateInvoiceFromRecurring', () => {
  it('refuses without invoices create permission and raises no invoice', async () => {
    mockedPermission.mockResolvedValue(false)
    mockSupabase()

    const result = await generateInvoiceFromRecurring('rec-1')

    expect(result).toEqual({ error: 'Insufficient permissions' })
    expect(mockedCreateInvoice).not.toHaveBeenCalled()
  })

  it('refuses to bill a recurring invoice that has been switched off', async () => {
    mockSupabase({ recurring: { ...BASE_RECURRING, is_active: false } })

    const result = await generateInvoiceFromRecurring('rec-1')

    expect(result).toEqual({ error: 'Recurring invoice is not active' })
    expect(mockedCreateInvoice).not.toHaveBeenCalled()
  })

  it('reports a missing recurring invoice rather than billing anything', async () => {
    mockSupabase({ fetchError: { message: 'no rows' } })

    const result = await generateInvoiceFromRecurring('rec-1')

    expect(result).toEqual({ error: 'Recurring invoice not found' })
    expect(mockedCreateInvoice).not.toHaveBeenCalled()
  })

  it('prefers the vendor payment terms over days_before_due when setting the due date', async () => {
    mockSupabase()

    await generateInvoiceFromRecurring('rec-1')

    // 2026-01-31 + 30 days of vendor terms, not + 14 days_before_due.
    expect(mockedCreateInvoice).toHaveBeenCalledWith(expect.objectContaining({
      invoice_date: '2026-01-31',
      due_date: '2026-03-02',
      vendor_id: 'vendor-1',
    }))
  })

  it('falls back to days_before_due when the vendor has no payment terms', async () => {
    mockSupabase({ recurring: { ...BASE_RECURRING, vendor: { id: 'vendor-1', name: 'Acme', payment_terms: null } } })

    await generateInvoiceFromRecurring('rec-1')

    // 2026-01-31 + 14 days.
    expect(mockedCreateInvoice).toHaveBeenCalledWith(expect.objectContaining({ due_date: '2026-02-14' }))
  })

  it('advances the schedule so the same period cannot bill twice', async () => {
    const { updates } = mockSupabase()

    const result = await generateInvoiceFromRecurring('rec-1')

    expect(result.success).toBe(true)
    // Monthly from 31 Jan clamps to the end of February rather than overflowing into March.
    expect(updates[0]).toMatchObject({ next_invoice_date: '2026-02-28', last_invoice_id: 'inv-1' })
  })

  it('advances a weekly schedule by seven days', async () => {
    const { updates } = mockSupabase({
      recurring: { ...BASE_RECURRING, frequency: 'weekly', next_invoice_date: '2026-03-05' },
    })

    await generateInvoiceFromRecurring('rec-1')

    expect(updates[0]).toMatchObject({ next_invoice_date: '2026-03-12' })
  })

  it('reports a conflict when the recurring invoice was deactivated mid-run', async () => {
    // The update is guarded with .eq('is_active', true), so a concurrent switch-off
    // matches no row. Reporting success here would leave the schedule un-advanced and
    // bill the same period again on the next run.
    mockSupabase({ scheduleUpdated: false })

    const result = await generateInvoiceFromRecurring('rec-1')

    expect(result.error).toMatch(/changed before schedule update completed/i)
    expect(result.success).toBeUndefined()
  })

  it('reports an error when the schedule update itself fails', async () => {
    mockSupabase({ scheduleUpdateError: { message: 'deadlock' } })

    const result = await generateInvoiceFromRecurring('rec-1')

    expect(result.error).toMatch(/Failed to update recurring invoice schedule/i)
  })

  it('passes the line items through with numeric coercion', async () => {
    mockSupabase({
      recurring: {
        ...BASE_RECURRING,
        line_items: [
          { catalog_item_id: 'c1', description: 'Thing', quantity: '3', unit_price: '12.50', discount_percentage: null, vat_rate: '20' },
        ],
      },
    })

    await generateInvoiceFromRecurring('rec-1')

    expect(mockedCreateInvoice).toHaveBeenCalledWith(expect.objectContaining({
      line_items: [
        { catalog_item_id: 'c1', description: 'Thing', quantity: 3, unit_price: 12.5, discount_percentage: 0, vat_rate: 20 },
      ],
    }))
  })

  it('returns the error message rather than throwing when invoice creation fails', async () => {
    mockSupabase()
    mockedCreateInvoice.mockRejectedValue(new Error('vendor is archived'))

    const result = await generateInvoiceFromRecurring('rec-1')

    expect(result.error).toMatch(/vendor is archived/i)
  })
})
