import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

/**
 * Record Payment and its receipt.
 *
 * The payment is the thing that matters: once it is saved, nothing about the receipt may turn
 * the result into an error. The tick on the page is a choice the server enforces, and the
 * sending itself lives in `@/lib/invoices/receipt-email`, which has its own tests.
 */

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  createAdminClient: vi.fn(),
  checkUserPermission: vi.fn(),
  sendInvoiceReceipt: vi.fn(),
  resolveReceiptRecipients: vi.fn(),
  resolveInvoiceGreetingName: vi.fn(),
  recordPayment: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }))
vi.mock('@/app/actions/rbac', () => ({ checkUserPermission: mocks.checkUserPermission }))
vi.mock('@/app/actions/audit', () => ({ logAuditEvent: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/invoices/receipt-email', () => ({
  sendInvoiceReceipt: mocks.sendInvoiceReceipt,
  resolveReceiptRecipients: mocks.resolveReceiptRecipients,
}))
vi.mock('@/lib/invoices/greeting', () => ({ resolveInvoiceGreetingName: mocks.resolveInvoiceGreetingName }))
vi.mock('@/services/invoices', () => ({
  InvoiceService: { recordPayment: mocks.recordPayment },
  CreateInvoiceSchema: { parse: vi.fn() },
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))

import { getReceiptEmailContext, recordPayment } from '@/app/actions/invoices'

const INVOICE_ID = '7f06990b-7636-4d72-b610-460168da18ec'
const adminClient = { marker: 'admin client' }

/** The signed-in user's client: the two status reads either side of the payment. */
function sessionClient(statuses: { before?: string; after?: string; afterError?: boolean } = {}) {
  const { before = 'sent', after = 'paid', afterError = false } = statuses
  let reads = 0
  return {
    from: vi.fn(() => ({
      select: () => ({
        eq: () => ({
          is: () => ({
            maybeSingle: async () => {
              reads += 1
              if (reads === 1) return { data: { status: before }, error: null }
              return afterError
                ? { data: null, error: { message: 'read failed' } }
                : { data: { status: after }, error: null }
            },
          }),
        }),
      }),
    })),
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }) },
  }
}

function paymentForm(overrides: Record<string, string> = {}): FormData {
  const form = new FormData()
  form.set('invoiceId', INVOICE_ID)
  form.set('paymentDate', '2026-10-12')
  form.set('amount', '100')
  form.set('paymentMethod', 'bank_transfer')
  for (const [key, value] of Object.entries(overrides)) form.set(key, value)
  return form
}

const savedPayment = { id: 'pay-1', invoice_id: INVOICE_ID, amount: 100 }

beforeEach(() => {
  vi.clearAllMocks()
  mocks.checkUserPermission.mockResolvedValue(true)
  mocks.createClient.mockResolvedValue(sessionClient())
  mocks.createAdminClient.mockReturnValue(adminClient)
  mocks.recordPayment.mockResolvedValue(savedPayment)
  mocks.sendInvoiceReceipt.mockResolvedValue({ outcome: 'sent', invoiceNumber: 'INV-003WK' })
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('recordPayment: when a receipt is sent', () => {
  it('sends it through the receipt module on the admin client when the invoice becomes paid', async () => {
    const result = await recordPayment(paymentForm())

    expect(result).toMatchObject({ success: true, payment: savedPayment, receipt: { outcome: 'sent' } })
    expect(result).not.toHaveProperty('warning')
    expect(mocks.sendInvoiceReceipt).toHaveBeenCalledTimes(1)
    // The admin client: the email log and the contact tables are closed to most staff.
    expect(mocks.sendInvoiceReceipt).toHaveBeenCalledWith(adminClient, {
      invoiceId: INVOICE_ID,
      paymentId: 'pay-1',
      sentByUserId: 'user-1',
    })
  })

  it('sends it when the payment leaves the invoice part paid', async () => {
    mocks.createClient.mockResolvedValue(sessionClient({ after: 'partially_paid' }))

    expect(await recordPayment(paymentForm({ amount: '50' }))).toMatchObject({ success: true })
    expect(mocks.sendInvoiceReceipt).toHaveBeenCalledTimes(1)
  })

  it('sends nothing when the invoice was already paid before this payment', async () => {
    mocks.createClient.mockResolvedValue(sessionClient({ before: 'paid', after: 'paid' }))

    expect(await recordPayment(paymentForm({ amount: '10' }))).toMatchObject({ success: true })
    expect(mocks.sendInvoiceReceipt).not.toHaveBeenCalled()
  })

  it('sends nothing when the payment itself could not be saved', async () => {
    mocks.recordPayment.mockRejectedValue(new Error('Payment exceeds the balance'))

    expect(await recordPayment(paymentForm())).toEqual({ error: 'Payment exceeds the balance' })
    expect(mocks.sendInvoiceReceipt).not.toHaveBeenCalled()
  })
})

describe('recordPayment: the receipt tick is enforced on the server', () => {
  it('sends nothing when the tick is off, and still records the payment', async () => {
    const result = await recordPayment(paymentForm({ send_receipt: 'false' }))

    expect(mocks.recordPayment).toHaveBeenCalledTimes(1)
    expect(mocks.recordPayment).toHaveBeenCalledWith(expect.objectContaining({ invoice_id: INVOICE_ID, amount: 100 }))
    expect(mocks.sendInvoiceReceipt).not.toHaveBeenCalled()
    expect(result).toMatchObject({ success: true, payment: savedPayment, receipt: { outcome: 'not_requested' } })
    expect(result).not.toHaveProperty('warning')
    expect(result).not.toHaveProperty('error')
  })

  it('sends exactly one when the tick is on', async () => {
    await recordPayment(paymentForm({ send_receipt: 'true' }))

    expect(mocks.sendInvoiceReceipt).toHaveBeenCalledTimes(1)
  })

  it('sends when the field is absent, so callers that predate the tick behave as before', async () => {
    await recordPayment(paymentForm())

    expect(mocks.sendInvoiceReceipt).toHaveBeenCalledTimes(1)
  })

  // Boolean('false') is true, and a hand-built request could carry anything. Only the exact
  // string the page sends for a tick counts as a yes.
  it.each(['False', 'no', '0', 'on', 'TRUE', ''])('treats %j as a no', async (value) => {
    const result = await recordPayment(paymentForm({ send_receipt: value }))

    expect(mocks.sendInvoiceReceipt).not.toHaveBeenCalled()
    expect(result).toMatchObject({ success: true, receipt: { outcome: 'not_requested' } })
  })
})

describe('recordPayment: a receipt problem never fails the payment', () => {
  it('returns success with a warning when the receipt is refused', async () => {
    mocks.sendInvoiceReceipt.mockResolvedValue({
      outcome: 'refused',
      error: 'Recipient email address is suppressed',
      attemptLogged: true,
      invoiceNumber: 'INV-003WK',
    })

    const result = await recordPayment(paymentForm({ send_receipt: 'true' }))

    expect(result).toMatchObject({ success: true, payment: savedPayment, receipt: { outcome: 'refused' } })
    expect(result).not.toHaveProperty('error')
    expect(result.warning).toBe(
      'Payment recorded, but the receipt email was not sent (Recipient email address is suppressed). Please send the customer a receipt by hand.'
    )
  })

  it('says to check Sent Items when it cannot tell whether the receipt went', async () => {
    mocks.sendInvoiceReceipt.mockResolvedValue({ outcome: 'unknown', error: 'Request timed out', invoiceNumber: 'INV-003WK' })

    const result = await recordPayment(paymentForm())

    expect(result).toMatchObject({ success: true, payment: savedPayment })
    expect(result.warning).toBe(
      'Payment recorded. The receipt email may or may not have been sent: check Sent Items before sending one by hand.'
    )
  })

  it('says so when the client has no email address to send it to', async () => {
    mocks.sendInvoiceReceipt.mockResolvedValue({ outcome: 'skipped', reason: 'no_recipient', invoiceNumber: 'INV-003WK' })

    const result = await recordPayment(paymentForm())

    expect(result).toMatchObject({ success: true })
    expect(result.warning).toBe('Payment recorded. No receipt was sent because this client has no email address.')
  })

  it('passes on the warning when the receipt went but its record could not be saved', async () => {
    mocks.sendInvoiceReceipt.mockResolvedValue({
      outcome: 'sent',
      invoiceNumber: 'INV-003WK',
      warning: 'The receipt was sent, but the app could not save its record of the email.',
    })

    const result = await recordPayment(paymentForm())

    expect(result).toMatchObject({ success: true })
    expect(result.warning).toBe('Payment recorded. The receipt was sent, but the app could not save its record of the email.')
  })

  it('stays quiet when a receipt for the payment has already gone', async () => {
    mocks.sendInvoiceReceipt.mockResolvedValue({ outcome: 'skipped', reason: 'already_sent', invoiceNumber: 'INV-003WK' })

    expect(await recordPayment(paymentForm())).not.toHaveProperty('warning')
  })

  it('still returns success when the sender blows up or its client cannot be built', async () => {
    mocks.sendInvoiceReceipt.mockRejectedValue(new Error('unexpected'))
    const thrown = await recordPayment(paymentForm())

    mocks.createAdminClient.mockImplementation(() => {
      throw new Error('Missing Supabase environment variables')
    })
    mocks.createClient.mockResolvedValue(sessionClient())
    const noClient = await recordPayment(paymentForm())

    for (const result of [thrown, noClient]) {
      expect(result).toMatchObject({ success: true, payment: savedPayment, receipt: { outcome: 'refused' } })
      expect(result).not.toHaveProperty('error')
      expect(result.warning).toContain('Payment recorded, but the receipt email was not sent')
    }
  })

  it('warns, without sending, when it cannot re-read the invoice after the payment', async () => {
    mocks.createClient.mockResolvedValue(sessionClient({ afterError: true }))

    const result = await recordPayment(paymentForm())

    expect(result).toMatchObject({ success: true, payment: savedPayment })
    expect(result.warning).toContain('the receipt email was not sent')
    expect(mocks.sendInvoiceReceipt).not.toHaveBeenCalled()
  })
})

describe('getReceiptEmailContext (who the tick on the page names)', () => {
  function adminWithInvoice(result: { data: unknown; error: unknown }) {
    return {
      from: vi.fn(() => ({
        select: () => ({ eq: () => ({ is: () => ({ maybeSingle: async () => result }) }) }),
      })),
    }
  }

  it('returns the first name and where the receipt would go', async () => {
    const admin = adminWithInvoice({ data: { vendor_id: 'vendor-1', vendor: { email: 'accounts@client.example' } }, error: null })
    mocks.createAdminClient.mockReturnValue(admin)
    mocks.resolveReceiptRecipients.mockResolvedValue({ to: 'sam@client.example', cc: ['ledger@client.example'], forced: false })
    mocks.resolveInvoiceGreetingName.mockResolvedValue('Sam')

    expect(await getReceiptEmailContext(INVOICE_ID)).toEqual({
      context: { firstName: 'Sam', to: 'sam@client.example', ccCount: 1 },
    })
    expect(mocks.resolveReceiptRecipients).toHaveBeenCalledWith(admin, 'vendor-1', 'accounts@client.example')
    expect(mocks.resolveInvoiceGreetingName).toHaveBeenCalledWith(admin, 'vendor-1')
  })

  it('reports no address rather than inventing one', async () => {
    mocks.createAdminClient.mockReturnValue(adminWithInvoice({ data: { vendor_id: 'vendor-1', vendor: null }, error: null }))
    mocks.resolveReceiptRecipients.mockResolvedValue({ to: null, cc: [], forced: false })
    mocks.resolveInvoiceGreetingName.mockResolvedValue(null)

    expect(await getReceiptEmailContext(INVOICE_ID)).toEqual({ context: { firstName: null, to: null, ccCount: 0 } })
  })

  it('refuses someone who may not record payments, before reading anything', async () => {
    mocks.checkUserPermission.mockResolvedValue(false)

    expect(await getReceiptEmailContext(INVOICE_ID)).toEqual({ error: 'You do not have permission to record payments' })
    expect(mocks.checkUserPermission).toHaveBeenCalledWith('invoices', 'edit')
    expect(mocks.createAdminClient).not.toHaveBeenCalled()
  })

  it('returns an error, not a guess, when the id is not an invoice id or a lookup fails', async () => {
    expect(await getReceiptEmailContext('not-an-id')).toEqual({ error: 'Invoice not found' })
    expect(mocks.createAdminClient).not.toHaveBeenCalled()

    mocks.createAdminClient.mockReturnValue(adminWithInvoice({ data: { vendor_id: 'vendor-1', vendor: null }, error: null }))
    mocks.resolveReceiptRecipients.mockResolvedValue({ error: 'permission denied' })
    mocks.resolveInvoiceGreetingName.mockResolvedValue(null)

    expect(await getReceiptEmailContext(INVOICE_ID)).toEqual({ error: 'permission denied' })
  })
})
