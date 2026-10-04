import { beforeEach, expect, it, vi } from 'vitest'
import { getInvoiceEmailDraftContext, sendChasePaymentEmail, sendInvoiceViaEmail } from '@/app/actions/email'
import { getInvoice } from '@/app/actions/invoices'
import { checkUserPermission } from '@/app/actions/rbac'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendInvoiceEmail } from '@/lib/microsoft-graph'
import { INVOICE_SIGN_OFF } from '@/lib/invoices/email-copy'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn(async () => ({ auth: { getUser: async () => ({ data: { user: { id: 'user' } } }) } })) }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn(() => ({})) }))
vi.mock('@/app/actions/rbac', () => ({ checkUserPermission: vi.fn(async () => true) }))
vi.mock('@/app/actions/audit', () => ({ logAuditEvent: vi.fn() }))
vi.mock('@/app/actions/invoices', () => ({ getInvoice: vi.fn() }))
vi.mock('@/app/actions/quotes', () => ({ getQuote: vi.fn() }))
vi.mock('@/lib/microsoft-graph', () => ({ isGraphConfigured: () => true, sendInvoiceEmail: vi.fn(), sendQuoteEmail: vi.fn(), testEmailConnection: vi.fn() }))
vi.mock('@/lib/invoice-recipients', () => ({ parseRecipientList: () => ['test@example.com'], resolveManualInvoiceRecipients: async () => ({ to: 'test@example.com', cc: [] }) }))
vi.mock('@/lib/api/idempotency', () => ({ claimIdempotencyKey: async () => ({ state: 'claimed' }), computeIdempotencyRequestHash: () => 'hash', releaseIdempotencyClaim: vi.fn(), persistIdempotencyResponse: vi.fn() }))
vi.mock('@/lib/dateUtils', () => ({ getTodayIsoDate: () => '2026-09-18' }))

const INVOICE_ID = '11111111-1111-4111-8111-111111111111'

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(checkUserPermission).mockResolvedValue(true)
  vi.mocked(createAdminClient).mockReturnValue({} as ReturnType<typeof createAdminClient>)
  vi.mocked(sendInvoiceEmail).mockResolvedValue({ success: false, error: 'Delivery disabled in test' })
})

function form(fields: Record<string, string> = {}): FormData {
  const input = new FormData()
  input.set('invoiceId', INVOICE_ID)
  input.set('recipientEmail', 'test@example.com')
  for (const [name, value] of Object.entries(fields)) input.set(name, value)
  return input
}

/**
 * An admin client that answers the lookups the email draft context makes: the client's
 * primary contact, the booking an invoice belongs to, and that booking's event date.
 */
function draftContextDatabase(rows: {
  primaryContact?: string | null
  bookingEventDate?: string | null
}): void {
  const from = (table: string) => {
    const single =
      table === 'invoices' ? { vendor_id: 'vendor-1' }
        : table === 'private_booking_invoices' ? (rows.bookingEventDate ? { booking_id: 'booking-1' } : null)
          : table === 'private_bookings' ? { event_date: rows.bookingEventDate }
            : table === 'invoice_vendors' ? { customer_id: null }
              : null
    const list = table === 'invoice_vendor_contacts' && rows.primaryContact
      ? [{ name: rows.primaryContact, is_primary: true }]
      : []
    const chain: Record<string, unknown> = {}
    for (const method of ['select', 'eq', 'is', 'order']) chain[method] = () => chain
    chain.limit = async () => ({ data: list, error: null })
    chain.maybeSingle = async () => ({ data: single, error: null })
    chain.insert = async () => ({ error: null })
    return chain
  }
  vi.mocked(createAdminClient).mockReturnValue({ from } as unknown as ReturnType<typeof createAdminClient>)
}

const overdueInvoice = { id: INVOICE_ID, invoice_number: 'INV-1', vendor_id: 'vendor-1', status: 'sent', due_date: '2026-09-01', total_amount: 120, paid_amount: 0, vendor: { name: 'Golden Barrels Limited', contact_name: 'Golden Barrels Accounts' } }

it('chases only £90 after a £30 credit on the £120 original invoice', async () => {
  vi.mocked(getInvoice).mockResolvedValue({ invoice: { id: 'invoice', invoice_number: 'INV-1', status: 'sent', due_date: '2026-09-01', total_amount: 120, paid_amount: 0, credits: [{ status: 'issued', amount_inc_vat: 30 }], vendor: { name: 'Test' } } } as Awaited<ReturnType<typeof getInvoice>>)
  await sendChasePaymentEmail(form())
  expect(sendInvoiceEmail).toHaveBeenCalledTimes(1)
  expect(vi.mocked(sendInvoiceEmail).mock.calls[0][3]).toContain('Credits applied: £30.00')
  expect(vi.mocked(sendInvoiceEmail).mock.calls[0][3]).toContain('Amount outstanding: £90.00')
})

it('labels the email as a chase, so the history and the reminder job can tell it from the invoice', async () => {
  vi.mocked(getInvoice).mockResolvedValue({ invoice: overdueInvoice } as Awaited<ReturnType<typeof getInvoice>>)
  await sendChasePaymentEmail(form())
  expect(vi.mocked(sendInvoiceEmail).mock.calls[0][6]).toEqual({ emailKind: 'chase' })
})

it('builds a blank chase from the shared wording: first name, one sign-off, no company name', async () => {
  draftContextDatabase({ primaryContact: 'Mihiir Example' })
  vi.mocked(getInvoice).mockResolvedValue({ invoice: overdueInvoice } as Awaited<ReturnType<typeof getInvoice>>)

  await sendChasePaymentEmail(form())

  const [, , subject, body] = vi.mocked(sendInvoiceEmail).mock.calls[0]
  expect(subject).toBe('Gentle reminder: Invoice INV-1 - 17 days overdue')
  expect(String(body).startsWith('Hi Mihiir,\n\n')).toBe(true)
  expect(body).toContain('was due on Tuesday 1 September and is now 17 days overdue')
  expect(String(body).endsWith(INVOICE_SIGN_OFF)).toBe(true)
  expect(body).not.toContain('Golden')
  expect(body).not.toMatch(/P\.S\.|undefined|NaN|Invalid Date/)
})

it('names the booking at The Anchor when it chases a private hire invoice', async () => {
  draftContextDatabase({ bookingEventDate: '2026-11-14' })
  vi.mocked(getInvoice).mockResolvedValue({ invoice: overdueInvoice } as Awaited<ReturnType<typeof getInvoice>>)

  await sendChasePaymentEmail(form())

  const body = vi.mocked(sendInvoiceEmail).mock.calls[0][3]
  expect(body).toContain('invoice INV-1 for your booking at The Anchor on Saturday 14 November 2026 was due')
  expect(String(body).startsWith('Hi there,\n\n')).toBe(true)
})

it('sends the text the owner wrote in the dialog, untouched, and looks nothing up for it', async () => {
  const from = vi.fn()
  vi.mocked(createAdminClient).mockReturnValue({ from } as unknown as ReturnType<typeof createAdminClient>)
  vi.mocked(getInvoice).mockResolvedValue({ invoice: overdueInvoice } as Awaited<ReturnType<typeof getInvoice>>)

  await sendChasePaymentEmail(form({ subject: 'About INV-1', body: 'Hi Mihiir,\n\nMy own words.' }))

  const [, , subject, body] = vi.mocked(sendInvoiceEmail).mock.calls[0]
  expect(subject).toBe('About INV-1')
  expect(body).toBe('Hi Mihiir,\n\nMy own words.')
  expect(from).not.toHaveBeenCalled()
})

it('still chases, greeting "Hi there", when the greeting lookup fails', async () => {
  // The default admin stand-in here has no `from`, so every lookup throws.
  vi.mocked(getInvoice).mockResolvedValue({ invoice: overdueInvoice } as Awaited<ReturnType<typeof getInvoice>>)

  await sendChasePaymentEmail(form())

  expect(String(vi.mocked(sendInvoiceEmail).mock.calls[0][3]).startsWith('Hi there,\n\n')).toBe(true)
})

it('labels a manual send as an invoice and gives a blank one the shared wording', async () => {
  draftContextDatabase({ primaryContact: 'Mihiir Example' })
  vi.mocked(getInvoice).mockResolvedValue({ invoice: { ...overdueInvoice, due_date: '2026-10-09' } } as Awaited<ReturnType<typeof getInvoice>>)

  await sendInvoiceViaEmail(form())

  const [, , subject, body, , , options] = vi.mocked(sendInvoiceEmail).mock.calls[0]
  expect(subject).toBe('Invoice INV-1 from Orange Jelly')
  expect(String(body).startsWith('Hi Mihiir,\n\n')).toBe(true)
  expect(body).toContain('Invoice INV-1 is attached: £120.00, due Friday 9 October.')
  expect(body).not.toContain('Default invoice email template used')
  expect(options).toEqual({ emailKind: 'invoice' })
})

it('returns the warnings from a send whose follow-up writes failed, so the dialog can show them', async () => {
  vi.mocked(sendInvoiceEmail).mockResolvedValue({ success: true, messageId: 'message-1' })
  vi.mocked(getInvoice).mockResolvedValue({ invoice: overdueInvoice } as Awaited<ReturnType<typeof getInvoice>>)
  // The log table refuses the insert: the email has gone, the record of it has not.
  const from = (table: string) => {
    const chain: Record<string, unknown> = {}
    for (const method of ['select', 'eq', 'is', 'order']) chain[method] = () => chain
    chain.limit = async () => ({ data: [], error: null })
    chain.maybeSingle = async () => ({ data: null, error: null })
    chain.insert = async () => ({ error: table === 'invoice_email_logs' ? { message: 'insert refused' } : null })
    return chain
  }
  vi.mocked(createAdminClient).mockReturnValue({ from } as unknown as ReturnType<typeof createAdminClient>)
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

  const result = await sendChasePaymentEmail(form())

  expect(result).toMatchObject({ success: true, warnings: ['Chase email sent but delivery log persistence failed'] })
  consoleError.mockRestore()
})

it('resolves the draft context for the dialogs: first name and booking date, nothing else', async () => {
  draftContextDatabase({ primaryContact: 'Dr Priya Example', bookingEventDate: '2026-11-14' })

  expect(await getInvoiceEmailDraftContext(INVOICE_ID)).toEqual({ greetingName: 'Priya', bookingEventDate: '2026-11-14', isPrivateHire: true })
})

it('gives the neutral draft context without the view permission, a valid id or a working lookup', async () => {
  draftContextDatabase({ primaryContact: 'Priya Example', bookingEventDate: '2026-11-14' })
  const neutral = { greetingName: null, bookingEventDate: null, isPrivateHire: false }

  vi.mocked(checkUserPermission).mockResolvedValueOnce(false)
  expect(await getInvoiceEmailDraftContext(INVOICE_ID)).toEqual(neutral)
  expect(await getInvoiceEmailDraftContext('not-a-uuid')).toEqual(neutral)

  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.mocked(createAdminClient).mockImplementation(() => { throw new Error('no service key') })
  expect(await getInvoiceEmailDraftContext(INVOICE_ID)).toEqual(neutral)
  consoleError.mockRestore()
})

it('refuses a chase once the £90 receipt settles the remaining balance', async () => {
  vi.mocked(getInvoice).mockResolvedValue({ invoice: { id: 'invoice', invoice_number: 'INV-1', status: 'sent', due_date: '2026-09-01', total_amount: 120, paid_amount: 90, credits: [{ status: 'issued', amount_inc_vat: 30 }] } } as Awaited<ReturnType<typeof getInvoice>>)
  expect(await sendChasePaymentEmail(form())).toMatchObject({ error: expect.stringContaining('no outstanding balance') })
  expect(sendInvoiceEmail).not.toHaveBeenCalled()
})
