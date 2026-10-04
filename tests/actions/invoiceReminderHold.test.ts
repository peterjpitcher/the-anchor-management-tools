import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Hold and resume for automatic invoice reminders. The server decides who may hold and until
 * when; the form on the invoice page is only a courtesy.
 */

vi.mock('@/app/actions/rbac', () => ({ checkUserPermission: vi.fn() }))
vi.mock('@/app/actions/audit', () => ({ logAuditEvent: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))

import { revalidatePath } from 'next/cache'
import { checkUserPermission } from '@/app/actions/rbac'
import { logAuditEvent } from '@/app/actions/audit'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { holdInvoiceReminders, resumeInvoiceReminders } from '@/app/actions/invoice-reminders'

type Row = Record<string, unknown>

const INVOICE_ID = '7c1e4b2a-9d3f-4e6a-8b5c-1f2e3d4c5b6a'

interface Recorded {
  op: 'select' | 'update'
  payload?: Row
  filters: Array<[string, ...unknown[]]>
}

/** An admin client that answers every invoice read with `invoice` and records every write. */
function seedInvoice(invoice: Row | null, options: { failUpdate?: boolean } = {}): Recorded[] {
  const recorded: Recorded[] = []
  const admin = {
    from(table: string) {
      expect(table).toBe('invoices')
      const query: Recorded = { op: 'select', filters: [] }
      recorded.push(query)
      const builder: Record<string, unknown> = {
        select: () => builder,
        update: (payload: Row) => Object.assign(query, { op: 'update', payload }) && builder,
        eq: (...args: unknown[]) => query.filters.push(['eq', ...args]) && builder,
        is: (...args: unknown[]) => query.filters.push(['is', ...args]) && builder,
        maybeSingle: async () => {
          if (query.op === 'update') {
            return options.failUpdate
              ? { data: null, error: { message: 'write failed' } }
              : { data: invoice ? { id: invoice.id, ...query.payload } : null, error: null }
          }
          return { data: invoice, error: null }
        },
      }
      return builder
    },
  }
  vi.mocked(createAdminClient).mockReturnValue(admin as unknown as ReturnType<typeof createAdminClient>)
  return recorded
}

function writes(recorded: Recorded[]): Row[] {
  return recorded.filter((query) => query.op === 'update').map((query) => query.payload as Row)
}

const sentInvoice: Row = { id: INVOICE_ID, invoice_number: 'INV-0101', status: 'overdue', reminders_held_until: null }

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
})

afterAll(() => {
  vi.useRealTimers()
})

beforeEach(() => {
  vi.clearAllMocks()
  // Tuesday 13 October 2026, mid-morning in London.
  vi.setSystemTime(new Date('2026-10-13T09:30:00.000Z'))
  vi.mocked(checkUserPermission).mockResolvedValue(true)
  vi.mocked(createClient).mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: { id: 'user-1' } }, error: null }) },
  } as never)
})

describe('holdInvoiceReminders', () => {
  it('refuses a user without invoices edit permission, before touching the database', async () => {
    vi.mocked(checkUserPermission).mockResolvedValue(false)
    const recorded = seedInvoice(sentInvoice)

    const result = await holdInvoiceReminders({ invoiceId: INVOICE_ID, heldUntil: '2026-10-20' })

    expect(result).toEqual({ error: 'You do not have permission to edit invoices' })
    expect(checkUserPermission).toHaveBeenCalledWith('invoices', 'edit')
    expect(createAdminClient).not.toHaveBeenCalled()
    expect(recorded).toEqual([])
    expect(logAuditEvent).not.toHaveBeenCalled()
  })

  it('refuses an id that is not a uuid', async () => {
    const recorded = seedInvoice(sentInvoice)

    const result = await holdInvoiceReminders({ invoiceId: 'not-an-id', heldUntil: '2026-10-20' })

    expect(result).toEqual({ error: 'That is not a valid invoice' })
    expect(recorded).toEqual([])
  })

  it('refuses a date in the past', async () => {
    const recorded = seedInvoice(sentInvoice)

    const result = await holdInvoiceReminders({ invoiceId: INVOICE_ID, heldUntil: '2026-10-12' })

    expect(result).toEqual({ error: 'The hold date must be today or later.' })
    expect(recorded).toEqual([])
  })

  it('judges "today" on the London clock, not the server clock', async () => {
    // 23:30 UTC on the 13th is already 00:30 on the 14th in London (British Summer Time).
    vi.setSystemTime(new Date('2026-10-13T23:30:00.000Z'))
    seedInvoice(sentInvoice)

    expect(await holdInvoiceReminders({ invoiceId: INVOICE_ID, heldUntil: '2026-10-13' })).toEqual({
      error: 'The hold date must be today or later.',
    })
    expect(await holdInvoiceReminders({ invoiceId: INVOICE_ID, heldUntil: '2026-10-14' })).toMatchObject({ success: true })
  })

  it('refuses a date that does not exist, or is not a date', async () => {
    const recorded = seedInvoice(sentInvoice)

    expect(await holdInvoiceReminders({ invoiceId: INVOICE_ID, heldUntil: '2027-02-31' })).toEqual({
      error: 'That is not a valid date',
    })
    expect(await holdInvoiceReminders({ invoiceId: INVOICE_ID, heldUntil: '20/10/2026' })).toEqual({
      error: 'Choose a date to hold reminders until',
    })
    expect(recorded).toEqual([])
  })

  it('refuses a reason longer than 500 characters', async () => {
    const recorded = seedInvoice(sentInvoice)

    const result = await holdInvoiceReminders({ invoiceId: INVOICE_ID, heldUntil: '2026-10-20', reason: 'x'.repeat(501) })

    expect(result).toEqual({ error: 'Keep the reason to 500 characters or fewer' })
    expect(recorded).toEqual([])
  })

  it('holds through the chosen date, writes only the hold, and audits who and why', async () => {
    const recorded = seedInvoice(sentInvoice)

    const result = await holdInvoiceReminders({
      invoiceId: INVOICE_ID,
      heldUntil: '2026-10-20',
      reason: '  Transfer promised for the 19th  ',
    })

    expect(result).toEqual({ success: true, heldUntil: '2026-10-20' })

    // The hold never touches the record of what has been sent.
    expect(writes(recorded)).toEqual([{ reminders_held_until: '2026-10-20', updated_at: '2026-10-13T09:30:00.000Z' }])
    const update = recorded.find((query) => query.op === 'update')
    expect(update?.filters).toContainEqual(['eq', 'id', INVOICE_ID])
    expect(update?.filters).toContainEqual(['is', 'deleted_at', null])

    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 'user-1',
        operation_type: 'update',
        resource_type: 'invoice',
        resource_id: INVOICE_ID,
        operation_status: 'success',
        old_values: { reminders_held_until: null },
        new_values: {
          action: 'reminders_held',
          invoice_number: 'INV-0101',
          reminders_held_until: '2026-10-20',
          reason: 'Transfer promised for the 19th',
        },
      })
    )
    expect(revalidatePath).toHaveBeenCalledWith(`/invoices/${INVOICE_ID}`)
  })

  it('accepts today, and records no reason when none is given', async () => {
    seedInvoice(sentInvoice)

    const result = await holdInvoiceReminders({ invoiceId: INVOICE_ID, heldUntil: '2026-10-13' })

    expect(result).toEqual({ success: true, heldUntil: '2026-10-13' })
    expect(vi.mocked(logAuditEvent).mock.calls[0][0].new_values).toMatchObject({ reason: null })
  })

  it.each([
    ['paid', 'This invoice is already paid, so there are no reminders to hold.'],
    ['void', 'This invoice has been withdrawn, so there are no reminders to hold.'],
    ['written_off', 'This invoice has been withdrawn, so there are no reminders to hold.'],
  ])('refuses a %s invoice', async (status, message) => {
    const recorded = seedInvoice({ ...sentInvoice, status })

    const result = await holdInvoiceReminders({ invoiceId: INVOICE_ID, heldUntil: '2026-10-20' })

    expect(result).toEqual({ error: message })
    expect(writes(recorded)).toEqual([])
    expect(logAuditEvent).not.toHaveBeenCalled()
  })

  it('refuses an invoice that is deleted or does not exist', async () => {
    const recorded = seedInvoice(null)

    const result = await holdInvoiceReminders({ invoiceId: INVOICE_ID, heldUntil: '2026-10-20' })

    expect(result).toEqual({ error: 'Invoice not found' })
    // The read excludes deleted invoices.
    expect(recorded[0].filters).toContainEqual(['is', 'deleted_at', null])
    expect(writes(recorded)).toEqual([])
  })

  it('says so when the hold could not be saved, and audits nothing', async () => {
    seedInvoice(sentInvoice, { failUpdate: true })

    const result = await holdInvoiceReminders({ invoiceId: INVOICE_ID, heldUntil: '2026-10-20' })

    expect(result).toEqual({ error: 'The hold could not be saved. Reload and try again.' })
    expect(logAuditEvent).not.toHaveBeenCalled()
  })

  it('refuses when nobody is signed in', async () => {
    vi.mocked(createClient).mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: null }, error: null }) },
    } as never)
    const recorded = seedInvoice(sentInvoice)

    expect(await holdInvoiceReminders({ invoiceId: INVOICE_ID, heldUntil: '2026-10-20' })).toEqual({ error: 'Unauthorized' })
    expect(recorded).toEqual([])
  })
})

describe('resumeInvoiceReminders', () => {
  it('refuses a user without invoices edit permission', async () => {
    vi.mocked(checkUserPermission).mockResolvedValue(false)
    const recorded = seedInvoice({ ...sentInvoice, reminders_held_until: '2026-10-20' })

    expect(await resumeInvoiceReminders({ invoiceId: INVOICE_ID })).toEqual({
      error: 'You do not have permission to edit invoices',
    })
    expect(recorded).toEqual([])
  })

  it('refuses an id that is not a uuid', async () => {
    const recorded = seedInvoice(sentInvoice)

    expect(await resumeInvoiceReminders({ invoiceId: '1; drop table invoices' })).toEqual({
      error: 'That is not a valid invoice',
    })
    expect(recorded).toEqual([])
  })

  it('clears the hold, writes nothing else, and audits it', async () => {
    const recorded = seedInvoice({ ...sentInvoice, reminders_held_until: '2026-10-20' })

    const result = await resumeInvoiceReminders({ invoiceId: INVOICE_ID })

    expect(result).toEqual({ success: true, heldUntil: null })
    expect(writes(recorded)).toEqual([{ reminders_held_until: null, updated_at: '2026-10-13T09:30:00.000Z' }])
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        resource_id: INVOICE_ID,
        old_values: { reminders_held_until: '2026-10-20' },
        new_values: { action: 'reminders_resumed', invoice_number: 'INV-0101', reminders_held_until: null },
      })
    )
    expect(revalidatePath).toHaveBeenCalledWith(`/invoices/${INVOICE_ID}`)
  })

  it('refuses an invoice that is deleted or does not exist', async () => {
    seedInvoice(null)

    expect(await resumeInvoiceReminders({ invoiceId: INVOICE_ID })).toEqual({ error: 'Invoice not found' })
    expect(logAuditEvent).not.toHaveBeenCalled()
  })
})
