import { describe, expect, it, vi } from 'vitest'
import { resolveInvoiceGreetingName } from '@/lib/invoices/greeting'

type Rows = { contacts?: unknown; vendor?: unknown; customer?: unknown; contactsError?: unknown; throwOn?: string }

function makeSupabase(rows: Rows) {
  const from = vi.fn((table: string) => {
    if (rows.throwOn === table) throw new Error('database unavailable')
    if (table === 'invoice_vendor_contacts') {
      const limit = vi.fn().mockResolvedValue({ data: rows.contacts ?? [], error: rows.contactsError ?? null })
      const eqPrimary = vi.fn(() => ({ limit }))
      const eqVendor = vi.fn(() => ({ eq: eqPrimary }))
      return { select: vi.fn(() => ({ eq: eqVendor })) }
    }
    const data = table === 'invoice_vendors' ? rows.vendor : rows.customer
    const maybeSingle = vi.fn().mockResolvedValue({ data: data ?? null, error: null })
    return { select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle })) })) }
  })
  return { from } as never
}

// Greet a person by first name, never a company. Every automatic invoice email used to open
// "Dear Golden Barrels Limited" because the greeting read the client record's legacy contact
// name and then fell back to the company name.
describe('resolveInvoiceGreetingName', () => {
  it('uses the first name of the primary contact', async () => {
    const supabase = makeSupabase({ contacts: [{ name: 'Sam Example', is_primary: true }] })
    await expect(resolveInvoiceGreetingName(supabase, 'vendor-1')).resolves.toBe('Sam')
  })

  it('falls back to the linked guest record, which is how a private hire customer is known', async () => {
    const supabase = makeSupabase({ contacts: [], vendor: { customer_id: 'customer-1' }, customer: { first_name: 'Alex' } })
    await expect(resolveInvoiceGreetingName(supabase, 'vendor-1')).resolves.toBe('Alex')
  })

  it('returns null, for "Hi there", when there is no person on file', async () => {
    await expect(resolveInvoiceGreetingName(makeSupabase({ contacts: [], vendor: { customer_id: null } }), 'vendor-1')).resolves.toBeNull()
    await expect(resolveInvoiceGreetingName(makeSupabase({ contacts: [{ name: '  ', is_primary: true }], vendor: null }), 'vendor-1')).resolves.toBeNull()
    await expect(resolveInvoiceGreetingName(makeSupabase({}), null)).resolves.toBeNull()
  })

  it('never reads the company name or the legacy contact name on the client record', async () => {
    const supabase = makeSupabase({ contacts: [], vendor: { customer_id: null, name: 'Golden Barrels Limited', contact_name: 'Golden Barrels Limited' } })
    await expect(resolveInvoiceGreetingName(supabase, 'vendor-1')).resolves.toBeNull()
  })

  // A greeting is not worth failing a send over.
  it('never throws: a failed lookup means "Hi there"', async () => {
    await expect(resolveInvoiceGreetingName(makeSupabase({ throwOn: 'invoice_vendor_contacts' }), 'vendor-1')).resolves.toBeNull()
    const supabase = makeSupabase({ contactsError: { message: 'denied' }, vendor: { customer_id: 'customer-1' }, customer: { first_name: 'Alex' } })
    await expect(resolveInvoiceGreetingName(supabase, 'vendor-1')).resolves.toBe('Alex')
  })
})
