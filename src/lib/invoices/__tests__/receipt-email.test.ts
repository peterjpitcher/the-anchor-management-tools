import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The receipt sender, on a small in-memory database.
 *
 * What matters here is what a customer can end up with: one receipt per payment, in the shared
 * wording, and never a second one because two paths raced, a record failed to save, or an
 * attempt ended without an answer. The claim store below is a fake with the one property the
 * real `idempotency_keys` table gives: of two callers, exactly one gets the claim.
 */

const mocks = vi.hoisted(() => ({
  sendInvoiceEmail: vi.fn(),
  isGraphConfigured: vi.fn(),
  reportCronFailure: vi.fn(),
  logAuditEvent: vi.fn(),
  greeting: vi.fn(),
  claims: new Map<string, { hash: string; response: { state?: string } }>(),
  claimFails: false,
}))

vi.mock('@/lib/microsoft-graph', () => ({
  isGraphConfigured: mocks.isGraphConfigured,
  sendInvoiceEmail: mocks.sendInvoiceEmail,
}))
vi.mock('@/app/actions/audit', () => ({ logAuditEvent: mocks.logAuditEvent }))
vi.mock('@/lib/cron/alerting', () => ({ reportCronFailure: mocks.reportCronFailure }))
vi.mock('@/lib/invoices/greeting', () => ({ resolveInvoiceGreetingName: mocks.greeting }))
vi.mock('@/lib/api/idempotency', () => ({
  computeIdempotencyRequestHash: (payload: unknown) => JSON.stringify(payload),
  claimIdempotencyKey: vi.fn(async (_client: unknown, key: string, hash: string) => {
    if (mocks.claimFails) throw new Error('claim store unavailable')
    const existing = mocks.claims.get(key)
    if (!existing) {
      mocks.claims.set(key, { hash, response: { state: 'processing' } })
      return { state: 'claimed' }
    }
    if (existing.response.state === 'processing') return { state: 'in_progress' }
    return { state: 'replay', response: existing.response }
  }),
  persistIdempotencyResponse: vi.fn(async (_client: unknown, key: string, hash: string, response: { state?: string }) => {
    mocks.claims.set(key, { hash, response })
  }),
  releaseIdempotencyClaim: vi.fn(async (_client: unknown, key: string) => {
    mocks.claims.delete(key)
  }),
}))

import { INVOICE_SIGN_OFF } from '@/lib/invoices/email-copy'
import {
  resolveReceiptRecipients,
  sendInvoiceReceipt,
  sendReceiptForPayPalCapture,
  sweepPayPalReceipts,
} from '@/lib/invoices/receipt-email'

type Row = Record<string, unknown>
type Filter = (row: Row) => boolean

/** Just enough of the Supabase query builder for the reads and writes this module makes. */
function createDb(seed: Record<string, Row[]> = {}) {
  const tables: Record<string, Row[]> = {
    invoices: [],
    invoice_payments: [],
    invoice_email_logs: [],
    invoice_vendor_contacts: [],
    ...seed,
  }
  const failing = new Map<string, string>()
  const touched: string[] = []

  function query(table: string) {
    const filters: Filter[] = []
    let limit: number | null = null
    let orderBy: string | null = null

    const run = () => {
      const failure = failing.get(`${table}:select`)
      if (failure) return { data: null, error: { message: failure } }
      let rows = (tables[table] ?? []).filter((row) => filters.every((filter) => filter(row)))
      if (orderBy) {
        const column = orderBy
        rows = [...rows].sort((a, b) => String(a[column]).localeCompare(String(b[column])))
      }
      if (limit !== null) rows = rows.slice(0, limit)
      return { data: rows, error: null }
    }

    const builder = {
      select: () => builder,
      eq: (column: string, value: unknown) => {
        filters.push((row) => row[column] === value)
        return builder
      },
      is: (column: string, value: unknown) => {
        filters.push((row) => (row[column] ?? null) === value)
        return builder
      },
      in: (column: string, values: unknown[]) => {
        filters.push((row) => values.includes(row[column]))
        return builder
      },
      gte: (column: string, value: string) => {
        filters.push((row) => new Date(String(row[column])).getTime() >= new Date(value).getTime())
        return builder
      },
      order: (column: string, options?: { foreignTable?: string }) => {
        if (!options?.foreignTable && column === 'created_at') orderBy = column
        return builder
      },
      limit: (count: number) => {
        limit = count
        return builder
      },
      maybeSingle: async () => {
        const result = run()
        return result.error ? result : { data: result.data?.[0] ?? null, error: null }
      },
      then: (resolve: (value: ReturnType<typeof run>) => unknown) => Promise.resolve(run()).then(resolve),
    }
    return builder
  }

  const client = {
    from: (table: string) => {
      touched.push(table)
      return {
        ...query(table),
        insert: async (rows: Row | Row[]) => {
          const failure = failing.get(`${table}:insert`)
          if (failure) return { error: { message: failure } }
          tables[table] = [...(tables[table] ?? []), ...(Array.isArray(rows) ? rows : [rows])]
          return { error: null }
        },
      }
    },
  }

  return {
    client: client as never,
    tables,
    touched,
    fail: (table: string, operation: 'select' | 'insert', message = 'database unavailable') =>
      failing.set(`${table}:${operation}`, message),
  }
}

function invoice(overrides: Row = {}): Row {
  return {
    id: 'inv-1',
    invoice_number: 'INV-003WK',
    vendor_id: 'vendor-1',
    status: 'paid',
    total_amount: 120,
    paid_amount: 120,
    deleted_at: null,
    vendor: { id: 'vendor-1', name: 'Golden Barrels Limited', email: 'accounts@client.example' },
    line_items: [],
    credits: [],
    payments: [
      { id: 'pay-1', amount: 120, payment_date: '2026-10-12', payment_method: 'bank_transfer', reference: 'BACS 4417' },
    ],
    ...overrides,
  }
}

const accepted = { success: true, messageId: 'provider-1' }

beforeEach(() => {
  vi.clearAllMocks()
  mocks.claims.clear()
  mocks.claimFails = false
  mocks.isGraphConfigured.mockReturnValue(true)
  mocks.sendInvoiceEmail.mockResolvedValue(accepted)
  mocks.greeting.mockResolvedValue('Sam')
  mocks.reportCronFailure.mockResolvedValue(undefined)
  mocks.logAuditEvent.mockResolvedValue(undefined)
  // Every switch this module reads starts off, whatever the shell running the tests has set.
  vi.stubEnv('INVOICE_PAYPAL_RECEIPTS_FROM', '')
  vi.stubEnv('INVOICE_REMITTANCE_TEST_RECIPIENT', '')
  vi.stubEnv('SUSPEND_ALL_EMAIL', '')
  vi.stubEnv('SUSPEND_ALL_COMMS', '')
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  vi.useRealTimers()
})

describe('sendInvoiceReceipt', () => {
  it('sends the shared wording once, as a receipt, and records it against the payment', async () => {
    const db = createDb({
      invoices: [invoice()],
      invoice_vendor_contacts: [
        { vendor_id: 'vendor-1', email: 'sam@client.example', is_primary: true, receive_invoice_copy: false, created_at: '2026-01-01' },
        { vendor_id: 'vendor-1', email: 'ledger@client.example', is_primary: false, receive_invoice_copy: true, created_at: '2026-01-02' },
      ],
    })

    const outcome = await sendInvoiceReceipt(db.client, { invoiceId: 'inv-1', paymentId: 'pay-1', sentByUserId: 'user-1' })

    expect(outcome).toEqual({ outcome: 'sent', invoiceNumber: 'INV-003WK' })
    expect(mocks.sendInvoiceEmail).toHaveBeenCalledTimes(1)

    const [, to, subject, body, cc, attachments, options] = mocks.sendInvoiceEmail.mock.calls[0]
    expect(to).toBe('sam@client.example')
    expect(cc).toEqual(['ledger@client.example'])
    expect(attachments).toBeUndefined()
    expect(subject).toBe('Payment received for invoice INV-003WK')
    expect(body).toBe(
      `Hi Sam,\n\nI've received your payment of £120.00 for invoice INV-003WK, thank you. That settles the invoice in full. A receipt is attached for your records.\n\n${INVOICE_SIGN_OFF}`
    )
    expect(options).toEqual({
      documentKind: 'remittance_advice',
      pdfFilename: 'receipt-INV-003WK.pdf',
      remittance: {
        paymentDate: '2026-10-12',
        paymentAmount: 120,
        paymentMethod: 'bank_transfer',
        paymentReference: 'BACS 4417',
      },
      emailKind: 'receipt',
    })

    // One log row per address, each tied to the payment, which is what stops a second receipt.
    expect(db.tables.invoice_email_logs).toEqual([
      expect.objectContaining({ payment_id: 'pay-1', invoice_id: 'inv-1', sent_to: 'sam@client.example', sent_by: 'user-1', status: 'sent', subject }),
      expect.objectContaining({ payment_id: 'pay-1', sent_to: 'ledger@client.example', status: 'sent' }),
    ])
    expect(mocks.claims.get('invoice-receipt:pay-1')?.response.state).toBe('sent')
  })

  it('never uses the old wording, the company name as a greeting, or the pub landline', async () => {
    const db = createDb({ invoices: [invoice()] })

    await sendInvoiceReceipt(db.client, { invoiceId: 'inv-1', paymentId: 'pay-1' })

    const [, , subject, body] = mocks.sendInvoiceEmail.mock.calls[0]
    expect(subject).not.toContain('Receipt: Invoice')
    expect(subject).not.toContain('Paid in Full')
    expect(body).not.toContain("I hope you're doing well")
    expect(body).not.toContain('Golden Barrels')
    expect(body).not.toMatch(/undefined|NaN|Invalid Date|£0\.00/)
    expect(body.endsWith(INVOICE_SIGN_OFF)).toBe(true)
  })

  it('greets "Hi there" when the client has no contact name', async () => {
    mocks.greeting.mockResolvedValue(null)
    const db = createDb({ invoices: [invoice()] })

    await sendInvoiceReceipt(db.client, { invoiceId: 'inv-1', paymentId: 'pay-1' })

    expect(mocks.sendInvoiceEmail.mock.calls[0][3]).toMatch(/^Hi there,\n/)
  })

  it('quotes THIS payment and what is left after it on a part payment', async () => {
    const db = createDb({
      invoices: [
        invoice({
          status: 'partially_paid',
          total_amount: 200,
          paid_amount: 150,
          payments: [
            { id: 'pay-0', amount: 100, payment_date: '2026-10-01', payment_method: 'bank_transfer' },
            { id: 'pay-1', amount: 50, payment_date: '2026-10-12', payment_method: 'cash' },
          ],
        }),
      ],
    })

    await sendInvoiceReceipt(db.client, { invoiceId: 'inv-1', paymentId: 'pay-1' })

    const [, , , body, , , options] = mocks.sendInvoiceEmail.mock.calls[0]
    expect(body).toContain("I've received your payment of £50.00 for invoice INV-003WK, thank you. That leaves £50.00 still to pay.")
    expect(options.remittance.paymentAmount).toBe(50)
    expect(options.pdfFilename).toBe('receipt-INV-003WK-partial.pdf')
  })

  it('counts an issued credit note when saying the invoice is settled', async () => {
    // £120 invoice, £30 credit, £90 paid: nothing is left, though paid is less than the total.
    const db = createDb({
      invoices: [
        invoice({
          total_amount: 120,
          paid_amount: 90,
          credits: [{ status: 'issued', amount_inc_vat: 30 }],
          payments: [{ id: 'pay-1', amount: 90, payment_date: '2026-10-12', payment_method: 'bank_transfer' }],
        }),
      ],
    })

    await sendInvoiceReceipt(db.client, { invoiceId: 'inv-1', paymentId: 'pay-1' })

    const body = mocks.sendInvoiceEmail.mock.calls[0][3]
    expect(body).toContain('your payment of £90.00')
    expect(body).toContain('That settles the invoice in full.')
    expect(body).not.toContain('still to pay')
  })

  it('sends nothing, and takes no claim, when the client has no email address', async () => {
    const db = createDb({ invoices: [invoice({ vendor: { id: 'vendor-1', name: 'No Email Ltd', email: null } })] })

    const outcome = await sendInvoiceReceipt(db.client, { invoiceId: 'inv-1', paymentId: 'pay-1' })

    expect(outcome).toEqual({ outcome: 'skipped', reason: 'no_recipient', invoiceNumber: 'INV-003WK' })
    expect(mocks.sendInvoiceEmail).not.toHaveBeenCalled()
    expect(mocks.claims.size).toBe(0)
  })

  it('sends nothing when a receipt for the payment is already on record', async () => {
    const db = createDb({
      invoices: [invoice()],
      invoice_email_logs: [{ payment_id: 'pay-1', invoice_id: 'inv-1', status: 'sent' }],
    })

    const outcome = await sendInvoiceReceipt(db.client, { invoiceId: 'inv-1', paymentId: 'pay-1' })

    expect(outcome).toMatchObject({ outcome: 'skipped', reason: 'already_sent' })
    expect(mocks.sendInvoiceEmail).not.toHaveBeenCalled()
  })

  it('skips an invoice that is not paid, a payment that is not on it, and an invoice that is gone', async () => {
    const db = createDb({ invoices: [invoice({ id: 'inv-void', status: 'void' }), invoice()] })

    expect(await sendInvoiceReceipt(db.client, { invoiceId: 'inv-void', paymentId: 'pay-1' }))
      .toMatchObject({ outcome: 'skipped', reason: 'invoice_not_paid' })
    expect(await sendInvoiceReceipt(db.client, { invoiceId: 'inv-1', paymentId: 'pay-other' }))
      .toMatchObject({ outcome: 'skipped', reason: 'payment_not_found' })
    expect(await sendInvoiceReceipt(db.client, { invoiceId: 'inv-missing', paymentId: 'pay-1' }))
      .toMatchObject({ outcome: 'skipped', reason: 'invoice_not_found' })
    expect(mocks.sendInvoiceEmail).not.toHaveBeenCalled()
  })

  it('leaves nothing behind while email is suspended, so it can still go later', async () => {
    vi.stubEnv('SUSPEND_ALL_EMAIL', 'true')
    const db = createDb({ invoices: [invoice()] })

    const outcome = await sendInvoiceReceipt(db.client, { invoiceId: 'inv-1', paymentId: 'pay-1' })

    expect(outcome).toEqual({ outcome: 'skipped', reason: 'email_suspended' })
    expect(db.touched).toEqual([])
    expect(mocks.claims.size).toBe(0)
    expect(mocks.sendInvoiceEmail).not.toHaveBeenCalled()
  })

  it('redirects to the test recipient alone when the override is set', async () => {
    vi.stubEnv('INVOICE_REMITTANCE_TEST_RECIPIENT', 'tester@orangejelly.example')
    const db = createDb({ invoices: [invoice()] })

    await sendInvoiceReceipt(db.client, { invoiceId: 'inv-1', paymentId: 'pay-1' })

    const [, to, , , cc] = mocks.sendInvoiceEmail.mock.calls[0]
    expect(to).toBe('tester@orangejelly.example')
    expect(cc).toEqual([])
    expect(db.touched).not.toContain('invoice_vendor_contacts')
  })

  describe('a refusal', () => {
    it('releases the claim and logs the failed attempt, so it can be tried again', async () => {
      mocks.sendInvoiceEmail.mockResolvedValueOnce({ success: false, error: 'Recipient email address is suppressed' })
      const db = createDb({ invoices: [invoice()] })

      const first = await sendInvoiceReceipt(db.client, { invoiceId: 'inv-1', paymentId: 'pay-1' })

      expect(first).toEqual({
        outcome: 'refused',
        error: 'Recipient email address is suppressed',
        attemptLogged: true,
        invoiceNumber: 'INV-003WK',
      })
      expect(mocks.claims.size).toBe(0)
      expect(db.tables.invoice_email_logs).toEqual([
        expect.objectContaining({ payment_id: 'pay-1', status: 'failed', error_message: 'Recipient email address is suppressed' }),
      ])

      const second = await sendInvoiceReceipt(db.client, { invoiceId: 'inv-1', paymentId: 'pay-1' })

      expect(second).toMatchObject({ outcome: 'sent' })
      expect(mocks.sendInvoiceEmail).toHaveBeenCalledTimes(2)
    })

    it('refuses, and sends nothing, when the claim cannot be taken', async () => {
      mocks.claimFails = true
      const db = createDb({ invoices: [invoice()] })

      const outcome = await sendInvoiceReceipt(db.client, { invoiceId: 'inv-1', paymentId: 'pay-1' })

      expect(outcome).toMatchObject({ outcome: 'refused', attemptLogged: false })
      expect(mocks.sendInvoiceEmail).not.toHaveBeenCalled()
    })

    it('refuses rather than sends when it cannot check for an earlier receipt', async () => {
      const db = createDb({ invoices: [invoice()] })
      db.fail('invoice_email_logs', 'select')

      const outcome = await sendInvoiceReceipt(db.client, { invoiceId: 'inv-1', paymentId: 'pay-1' })

      expect(outcome).toMatchObject({ outcome: 'refused', attemptLogged: false })
      expect(mocks.sendInvoiceEmail).not.toHaveBeenCalled()
    })

    it('will not send a receipt for a payment with no usable amount', async () => {
      const db = createDb({ invoices: [invoice({ payments: [{ id: 'pay-1', amount: 0, payment_date: '2026-10-12' }] })] })

      const outcome = await sendInvoiceReceipt(db.client, { invoiceId: 'inv-1', paymentId: 'pay-1' })

      expect(outcome).toMatchObject({ outcome: 'refused', error: 'The payment has no usable amount' })
      expect(mocks.sendInvoiceEmail).not.toHaveBeenCalled()
      expect(mocks.claims.size).toBe(0)
    })
  })

  describe('an unknown outcome', () => {
    it('keeps the claim when the send throws, so nothing sends it a second time', async () => {
      mocks.sendInvoiceEmail.mockRejectedValueOnce(new Error('socket closed'))
      const db = createDb({ invoices: [invoice()] })

      const first = await sendInvoiceReceipt(db.client, { invoiceId: 'inv-1', paymentId: 'pay-1' })

      expect(first).toEqual({ outcome: 'unknown', error: 'socket closed', invoiceNumber: 'INV-003WK' })
      expect(mocks.claims.get('invoice-receipt:pay-1')?.response.state).toBe('unknown')
      expect(db.tables.invoice_email_logs).toEqual([
        expect.objectContaining({ payment_id: 'pay-1', status: 'failed', error_message: expect.stringContaining('check Sent Items') }),
      ])

      const second = await sendInvoiceReceipt(db.client, { invoiceId: 'inv-1', paymentId: 'pay-1' })

      expect(second).toMatchObject({ outcome: 'skipped', reason: 'outcome_unknown' })
      expect(mocks.sendInvoiceEmail).toHaveBeenCalledTimes(1)
    })

    it('treats a failure the sender marks as uncertain as unknown, not as a refusal', async () => {
      // The sender never throws: a timeout after the request left comes back as a failure with
      // `uncertain` set. The mailbox may have taken the email, so this must not be retried.
      mocks.sendInvoiceEmail.mockResolvedValueOnce({ success: false, error: 'Request timed out', uncertain: true })
      const db = createDb({ invoices: [invoice()] })

      const outcome = await sendInvoiceReceipt(db.client, { invoiceId: 'inv-1', paymentId: 'pay-1' })

      expect(outcome).toMatchObject({ outcome: 'unknown', error: 'Request timed out' })
      expect(mocks.claims.get('invoice-receipt:pay-1')?.response.state).toBe('unknown')
    })

    // The wording of an error is not evidence. Only the sender's own `uncertain` flag is: a
    // definite refusal that happens to mention a timeout is still a refusal and can be retried.
    it('does not guess from the wording of an error', async () => {
      mocks.sendInvoiceEmail.mockResolvedValueOnce({ success: false, error: 'Gateway Timeout' })
      const db = createDb({ invoices: [invoice()] })

      const outcome = await sendInvoiceReceipt(db.client, { invoiceId: 'inv-1', paymentId: 'pay-1' })

      expect(outcome).toMatchObject({ outcome: 'refused', error: 'Gateway Timeout' })
      expect(mocks.claims.has('invoice-receipt:pay-1')).toBe(false)
    })
  })

  describe('sent but not recorded', () => {
    it('reports a warning and still never sends it again when the log row cannot be written', async () => {
      const db = createDb({ invoices: [invoice()] })
      db.fail('invoice_email_logs', 'insert')

      const first = await sendInvoiceReceipt(db.client, { invoiceId: 'inv-1', paymentId: 'pay-1' })

      expect(first).toEqual({
        outcome: 'sent',
        invoiceNumber: 'INV-003WK',
        warning: 'The receipt was sent, but the app could not save its record of the email.',
      })
      expect(db.tables.invoice_email_logs).toEqual([])
      expect(mocks.claims.get('invoice-receipt:pay-1')?.response.state).toBe('sent')

      const second = await sendInvoiceReceipt(db.client, { invoiceId: 'inv-1', paymentId: 'pay-1' })

      expect(second).toMatchObject({ outcome: 'skipped', reason: 'already_sent' })
      expect(mocks.sendInvoiceEmail).toHaveBeenCalledTimes(1)
    })

    it('counts it as sent when the provider took it and only our record of the send failed', async () => {
      mocks.sendInvoiceEmail.mockResolvedValueOnce({ success: false, error: 'Email sent state could not be logged', messageId: 'provider-9' })
      const db = createDb({ invoices: [invoice()] })

      const outcome = await sendInvoiceReceipt(db.client, { invoiceId: 'inv-1', paymentId: 'pay-1' })

      expect(outcome).toMatchObject({ outcome: 'sent', warning: expect.stringContaining('could not save its record') })
      expect(mocks.claims.get('invoice-receipt:pay-1')?.response.state).toBe('sent')
    })
  })

  it('sends once when two callers race for the same payment', async () => {
    let release: (value: typeof accepted) => void = () => {}
    mocks.sendInvoiceEmail.mockImplementationOnce(() => new Promise((resolve) => { release = resolve }))
    const db = createDb({ invoices: [invoice()] })

    const first = sendInvoiceReceipt(db.client, { invoiceId: 'inv-1', paymentId: 'pay-1' })
    // The first caller is now mid-send and holding the claim.
    await vi.waitFor(() => expect(mocks.sendInvoiceEmail).toHaveBeenCalledTimes(1))
    const second = await sendInvoiceReceipt(db.client, { invoiceId: 'inv-1', paymentId: 'pay-1' })

    expect(second).toMatchObject({ outcome: 'skipped', reason: 'in_progress' })

    release(accepted)
    expect(await first).toMatchObject({ outcome: 'sent' })
    expect(mocks.sendInvoiceEmail).toHaveBeenCalledTimes(1)
  })

  it('never throws, whatever the database does', async () => {
    const broken = { from: () => { throw new Error('connection refused') } } as never

    await expect(sendInvoiceReceipt(broken, { invoiceId: 'inv-1', paymentId: 'pay-1' })).resolves.toEqual({
      outcome: 'refused',
      error: 'connection refused',
      attemptLogged: false,
      invoiceNumber: undefined,
    })
    expect(mocks.sendInvoiceEmail).not.toHaveBeenCalled()
  })
})

describe('resolveReceiptRecipients', () => {
  it('prefers the primary contact, copies the rest of the client record and ticked contacts, without repeats', async () => {
    const db = createDb({
      invoice_vendor_contacts: [
        { vendor_id: 'vendor-1', email: 'Sam@client.example', is_primary: true, receive_invoice_copy: true, created_at: '2026-01-01' },
        { vendor_id: 'vendor-1', email: 'ledger@client.example', is_primary: false, receive_invoice_copy: true, created_at: '2026-01-02' },
        { vendor_id: 'vendor-1', email: 'quiet@client.example', is_primary: false, receive_invoice_copy: false, created_at: '2026-01-03' },
        { vendor_id: 'vendor-2', email: 'someone@else.example', is_primary: true, receive_invoice_copy: true, created_at: '2026-01-01' },
      ],
    })

    expect(await resolveReceiptRecipients(db.client, 'vendor-1', 'accounts@client.example; ledger@client.example, sam@client.example'))
      .toEqual({ to: 'Sam@client.example', cc: ['ledger@client.example'], forced: false })
  })

  it('reports a lookup failure instead of guessing', async () => {
    const db = createDb()
    db.fail('invoice_vendor_contacts', 'select', 'permission denied')

    expect(await resolveReceiptRecipients(db.client, 'vendor-1', 'accounts@client.example')).toEqual({ error: 'permission denied' })
  })
})

// A PayPal payment as `record_invoice_paypal_payment_atomic` writes it: the capture id is the
// reference, and `created_at` is when the app recorded it.
function payPalPayment(id: string, createdAt: string, overrides: Row = {}): Row {
  return {
    id,
    invoice_id: `inv-${id}`,
    source_kind: 'paypal',
    reference: `CAPTURE-${id}`,
    amount: 120,
    payment_date: createdAt.slice(0, 10),
    payment_method: 'paypal',
    created_at: createdAt,
    ...overrides,
  }
}

function payPalInvoice(payment: Row, overrides: Row = {}): Row {
  return invoice({
    id: payment.invoice_id,
    invoice_number: `INV-${String(payment.id).toUpperCase()}`,
    payments: [payment],
    ...overrides,
  })
}

function payPalDb(payments: Row[], extra: Record<string, Row[]> = {}) {
  return createDb({
    invoice_payments: payments,
    invoices: payments.map((payment) => payPalInvoice(payment)),
    ...extra,
  })
}

describe('sendReceiptForPayPalCapture (straight after a PayPal payment is recorded)', () => {
  it('does nothing at all while the switch is off: no query, no claim, no email', async () => {
    const payment = payPalPayment('a', '2026-10-12T10:00:00Z')
    const db = payPalDb([payment])

    await sendReceiptForPayPalCapture(db.client, { invoiceId: 'inv-a', captureId: 'CAPTURE-a', source: 'webhook' })

    expect(db.touched).toEqual([])
    expect(mocks.claims.size).toBe(0)
    expect(mocks.sendInvoiceEmail).not.toHaveBeenCalled()
  })

  it('treats a mistyped switch as off', async () => {
    vi.stubEnv('INVOICE_PAYPAL_RECEIPTS_FROM', '12/10/2026')
    const db = payPalDb([payPalPayment('a', '2026-10-12T10:00:00Z')])

    await sendReceiptForPayPalCapture(db.client, { invoiceId: 'inv-a', captureId: 'CAPTURE-a', source: 'webhook' })

    expect(db.touched).toEqual([])
    expect(mocks.sendInvoiceEmail).not.toHaveBeenCalled()
  })

  it('finds the payment by its capture reference and sends its receipt once', async () => {
    vi.stubEnv('INVOICE_PAYPAL_RECEIPTS_FROM', '2026-10-12')
    const db = payPalDb([payPalPayment('a', '2026-10-12T10:00:00Z'), payPalPayment('b', '2026-10-12T10:05:00Z')])

    await sendReceiptForPayPalCapture(db.client, { invoiceId: 'inv-b', captureId: ' CAPTURE-b ', source: 'portal' })
    await sendReceiptForPayPalCapture(db.client, { invoiceId: 'inv-b', captureId: 'CAPTURE-b', source: 'webhook' })

    expect(mocks.sendInvoiceEmail).toHaveBeenCalledTimes(1)
    expect(mocks.sendInvoiceEmail.mock.calls[0][2]).toBe('Payment received for invoice INV-B')
    expect(db.tables.invoice_email_logs).toEqual([expect.objectContaining({ payment_id: 'b', status: 'sent', sent_by: null })])
  })

  // The switch date is a London calendar date. These instants sit either side of London
  // midnight, which is 23:00 UTC in summer and 00:00 UTC in winter, so a rule written against
  // the server's own clock gets one of them wrong in one of the two zones the suite runs in.
  it.each([
    { season: 'summer time', switchDate: '2026-10-12', before: '2026-10-11T22:59:59Z', onTheDay: '2026-10-11T23:00:00Z' },
    { season: 'winter time', switchDate: '2026-11-02', before: '2026-11-01T23:59:59Z', onTheDay: '2026-11-02T00:00:00Z' },
  ])('sends from the first London second of the switch date and not the second before ($season)', async ({ switchDate, before, onTheDay }) => {
    vi.stubEnv('INVOICE_PAYPAL_RECEIPTS_FROM', switchDate)
    const db = payPalDb([payPalPayment('early', before), payPalPayment('due', onTheDay)])

    await sendReceiptForPayPalCapture(db.client, { invoiceId: 'inv-early', captureId: 'CAPTURE-early', source: 'webhook' })
    expect(mocks.sendInvoiceEmail).not.toHaveBeenCalled()
    expect(mocks.claims.size).toBe(0)

    await sendReceiptForPayPalCapture(db.client, { invoiceId: 'inv-due', captureId: 'CAPTURE-due', source: 'webhook' })
    expect(mocks.sendInvoiceEmail).toHaveBeenCalledTimes(1)
    expect(mocks.sendInvoiceEmail.mock.calls[0][2]).toBe('Payment received for invoice INV-DUE')
  })

  it('raises one alert, naming the invoice and never the customer, when the outcome is unknown', async () => {
    vi.stubEnv('INVOICE_PAYPAL_RECEIPTS_FROM', '2026-10-12')
    mocks.sendInvoiceEmail.mockRejectedValueOnce(new Error('socket closed'))
    const db = payPalDb([payPalPayment('a', '2026-10-12T10:00:00Z')])

    await sendReceiptForPayPalCapture(db.client, { invoiceId: 'inv-a', captureId: 'CAPTURE-a', source: 'webhook' })

    expect(mocks.reportCronFailure).toHaveBeenCalledTimes(1)
    const [job, error, context] = mocks.reportCronFailure.mock.calls[0]
    expect(job).toBe('invoice-paypal-receipt')
    expect((error as Error).message).toContain('invoice INV-A')
    expect((error as Error).message).toContain('Check Sent Items')
    expect((error as Error).message).toContain('before sending a receipt by hand')
    expect(JSON.stringify([(error as Error).message, context])).not.toMatch(/@|client\.example/)
  })

  it('resolves quietly, with no alert, when the receipt is refused or the lookup fails', async () => {
    vi.stubEnv('INVOICE_PAYPAL_RECEIPTS_FROM', '2026-10-12')
    mocks.sendInvoiceEmail.mockResolvedValueOnce({ success: false, error: 'Recipient email address is suppressed' })
    const db = payPalDb([payPalPayment('a', '2026-10-12T10:00:00Z')])

    await expect(sendReceiptForPayPalCapture(db.client, { invoiceId: 'inv-a', captureId: 'CAPTURE-a', source: 'webhook' })).resolves.toBeUndefined()

    db.fail('invoice_payments', 'select')
    await expect(sendReceiptForPayPalCapture(db.client, { invoiceId: 'inv-a', captureId: 'CAPTURE-a', source: 'webhook' })).resolves.toBeUndefined()

    const broken = { from: () => { throw new Error('connection refused') } } as never
    await expect(sendReceiptForPayPalCapture(broken, { invoiceId: 'inv-a', captureId: 'CAPTURE-a', source: 'webhook' })).resolves.toBeUndefined()

    expect(mocks.reportCronFailure).not.toHaveBeenCalled()
  })
})

describe('sweepPayPalReceipts (the 15 minute safety net)', () => {
  const now = new Date('2026-10-20T09:00:00Z')

  it('returns nothing and reads nothing while the switch is off', async () => {
    const db = payPalDb([payPalPayment('a', '2026-10-19T10:00:00Z')])

    expect(await sweepPayPalReceipts(db.client, { now })).toBeNull()
    expect(db.touched).toEqual([])
    expect(mocks.sendInvoiceEmail).not.toHaveBeenCalled()
  })

  it('sends for a PayPal payment with no receipt, and leaves every other payment alone', async () => {
    vi.stubEnv('INVOICE_PAYPAL_RECEIPTS_FROM', '2026-10-12')
    const owed = payPalPayment('owed', '2026-10-19T10:00:00Z')
    const receipted = payPalPayment('receipted', '2026-10-19T11:00:00Z')
    const keptClaim = payPalPayment('kept', '2026-10-19T12:00:00Z')
    const beforeSwitch = payPalPayment('early', '2026-10-11T22:59:59Z')
    const tooOld = payPalPayment('old', '2026-10-12T08:00:00Z')
    const byHand = payPalPayment('manual', '2026-10-19T13:00:00Z', { source_kind: null, payment_method: 'bank_transfer' })
    const db = payPalDb([owed, receipted, keptClaim, beforeSwitch, tooOld, byHand], {
      invoice_email_logs: [{ payment_id: 'receipted', invoice_id: 'inv-receipted', status: 'sent' }],
    })
    // An earlier attempt for this payment ended without an answer: its claim was kept.
    mocks.claims.set('invoice-receipt:kept', { hash: 'x', response: { state: 'unknown' } })

    const summary = await sweepPayPalReceipts(db.client, { now })

    expect(mocks.sendInvoiceEmail).toHaveBeenCalledTimes(1)
    expect(mocks.sendInvoiceEmail.mock.calls[0][2]).toBe('Payment received for invoice INV-OWED')
    // Owed: the one it sent and the one with a kept claim, which it looked at and left.
    expect(summary).toEqual({ owed: 2, sent: 1, skipped: 1, refused: 0, unknown: 0 })
    // A kept claim was alerted when it happened. The sweep does not raise it again every run.
    expect(mocks.reportCronFailure).not.toHaveBeenCalled()
  })

  it('never sends a late receipt for a payment recorded before the switch date, even inside the seven days', async () => {
    // Switched on at 09:00 on the 20th for the 20th: yesterday's payment is inside the window
    // and has no receipt, and must stay that way.
    vi.stubEnv('INVOICE_PAYPAL_RECEIPTS_FROM', '2026-10-20')
    const db = payPalDb([
      payPalPayment('yesterday', '2026-10-19T22:59:59Z'),
      payPalPayment('today', '2026-10-19T23:00:00Z'),
    ])

    const summary = await sweepPayPalReceipts(db.client, { now })

    expect(summary).toMatchObject({ owed: 1, sent: 1 })
    expect(mocks.sendInvoiceEmail).toHaveBeenCalledTimes(1)
    expect(mocks.sendInvoiceEmail.mock.calls[0][2]).toBe('Payment received for invoice INV-TODAY')
  })

  it('applies the same London boundary in winter time', async () => {
    vi.stubEnv('INVOICE_PAYPAL_RECEIPTS_FROM', '2026-11-02')
    const db = payPalDb([
      payPalPayment('before', '2026-11-01T23:59:59Z'),
      payPalPayment('due', '2026-11-02T00:00:00Z'),
    ])

    const summary = await sweepPayPalReceipts(db.client, { now: new Date('2026-11-03T09:00:00Z') })

    expect(summary).toMatchObject({ owed: 1, sent: 1 })
    expect(mocks.sendInvoiceEmail.mock.calls[0][2]).toBe('Payment received for invoice INV-DUE')
  })

  it('sends once when the sweep and the capture path race for the same payment', async () => {
    vi.stubEnv('INVOICE_PAYPAL_RECEIPTS_FROM', '2026-10-12')
    let release: (value: typeof accepted) => void = () => {}
    mocks.sendInvoiceEmail.mockImplementationOnce(() => new Promise((resolve) => { release = resolve }))
    const db = payPalDb([payPalPayment('a', '2026-10-19T10:00:00Z')])

    const afterCapture = sendReceiptForPayPalCapture(db.client, { invoiceId: 'inv-a', captureId: 'CAPTURE-a', source: 'portal' })
    // The capture path is now mid-send and holding the claim when the sweep comes round.
    await vi.waitFor(() => expect(mocks.sendInvoiceEmail).toHaveBeenCalledTimes(1))
    const summary = await sweepPayPalReceipts(db.client, { now })

    expect(summary).toEqual({ owed: 1, sent: 0, skipped: 1, refused: 0, unknown: 0 })

    release(accepted)
    await afterCapture
    expect(mocks.sendInvoiceEmail).toHaveBeenCalledTimes(1)
    expect(db.tables.invoice_email_logs).toHaveLength(1)
  })

  it('tries a refused receipt again on the next run', async () => {
    vi.stubEnv('INVOICE_PAYPAL_RECEIPTS_FROM', '2026-10-12')
    mocks.sendInvoiceEmail.mockResolvedValueOnce({ success: false, error: 'Mailbox unavailable' })
    const db = payPalDb([payPalPayment('a', '2026-10-19T10:00:00Z')])

    expect(await sweepPayPalReceipts(db.client, { now })).toEqual({ owed: 1, sent: 0, skipped: 0, refused: 1, unknown: 0 })
    expect(await sweepPayPalReceipts(db.client, { now })).toEqual({ owed: 1, sent: 1, skipped: 0, refused: 0, unknown: 0 })
    expect(await sweepPayPalReceipts(db.client, { now })).toEqual({ owed: 0, sent: 0, skipped: 0, refused: 0, unknown: 0 })
    expect(mocks.sendInvoiceEmail).toHaveBeenCalledTimes(2)
    expect(mocks.reportCronFailure).not.toHaveBeenCalled()
  })

  it('gives up after three refusals and asks a person once, rather than failing every 15 minutes for a week', async () => {
    vi.stubEnv('INVOICE_PAYPAL_RECEIPTS_FROM', '2026-10-12')
    mocks.sendInvoiceEmail.mockResolvedValue({ success: false, error: 'Recipient email address is suppressed' })
    const db = payPalDb([payPalPayment('a', '2026-10-19T10:00:00Z')])

    for (let run = 0; run < 6; run += 1) {
      await sweepPayPalReceipts(db.client, { now })
    }

    expect(mocks.sendInvoiceEmail).toHaveBeenCalledTimes(3)
    expect(mocks.reportCronFailure).toHaveBeenCalledTimes(1)
    const message = (mocks.reportCronFailure.mock.calls[0][1] as Error).message
    expect(message).toContain('invoice INV-A')
    expect(message).toContain('refused 3 times')
    expect(message).toContain('Send a receipt by hand')
    expect(message).not.toContain('@')
  })

  it('alerts once for an unknown outcome and does not try that payment again', async () => {
    vi.stubEnv('INVOICE_PAYPAL_RECEIPTS_FROM', '2026-10-12')
    mocks.sendInvoiceEmail.mockResolvedValueOnce({ success: false, error: 'Request timed out', uncertain: true })
    const db = payPalDb([payPalPayment('a', '2026-10-19T10:00:00Z')])

    expect(await sweepPayPalReceipts(db.client, { now })).toMatchObject({ unknown: 1 })
    expect(await sweepPayPalReceipts(db.client, { now })).toMatchObject({ unknown: 0, skipped: 1, sent: 0 })

    expect(mocks.sendInvoiceEmail).toHaveBeenCalledTimes(1)
    expect(mocks.reportCronFailure).toHaveBeenCalledTimes(1)
    expect((mocks.reportCronFailure.mock.calls[0][1] as Error).message).toContain('Check Sent Items')
  })

  it('sends at most twenty in a run and leaves the rest for the next', async () => {
    vi.stubEnv('INVOICE_PAYPAL_RECEIPTS_FROM', '2026-10-12')
    const payments = Array.from({ length: 23 }, (_, index) =>
      payPalPayment(`p${String(index).padStart(2, '0')}`, `2026-10-19T10:${String(index).padStart(2, '0')}:00Z`)
    )
    const db = payPalDb(payments)

    expect(await sweepPayPalReceipts(db.client, { now })).toMatchObject({ owed: 23, sent: 20 })
    expect(await sweepPayPalReceipts(db.client, { now })).toMatchObject({ owed: 3, sent: 3 })
    expect(mocks.sendInvoiceEmail).toHaveBeenCalledTimes(23)
  })

  it('does not let payments it leaves alone use up the run and hold newer receipts back', async () => {
    vi.stubEnv('INVOICE_PAYPAL_RECEIPTS_FROM', '2026-10-12')
    // Twenty-five older payments whose claims were kept, then one new payment owed a receipt.
    const stuck = Array.from({ length: 25 }, (_, index) =>
      payPalPayment(`s${String(index).padStart(2, '0')}`, `2026-10-18T10:${String(index).padStart(2, '0')}:00Z`)
    )
    for (const payment of stuck) {
      mocks.claims.set(`invoice-receipt:${payment.id}`, { hash: 'x', response: { state: 'unknown' } })
    }
    const db = payPalDb([...stuck, payPalPayment('fresh', '2026-10-19T10:00:00Z')])

    const summary = await sweepPayPalReceipts(db.client, { now })

    expect(summary).toEqual({ owed: 26, sent: 1, skipped: 25, refused: 0, unknown: 0 })
    expect(mocks.sendInvoiceEmail.mock.calls[0][2]).toBe('Payment received for invoice INV-FRESH')
  })

  it('stops starting new receipts once its time is up', async () => {
    vi.stubEnv('INVOICE_PAYPAL_RECEIPTS_FROM', '2026-10-12')
    const db = payPalDb([payPalPayment('a', '2026-10-19T10:00:00Z'), payPalPayment('b', '2026-10-19T10:01:00Z')])

    const summary = await sweepPayPalReceipts(db.client, { now, deadline: Date.now() - 1 })

    expect(summary).toEqual({ owed: 2, sent: 0, skipped: 0, refused: 0, unknown: 0 })
    expect(mocks.sendInvoiceEmail).not.toHaveBeenCalled()
  })

  it('throws when it cannot read the payments, for the caller to contain', async () => {
    vi.stubEnv('INVOICE_PAYPAL_RECEIPTS_FROM', '2026-10-12')
    const db = payPalDb([payPalPayment('a', '2026-10-19T10:00:00Z')])
    db.fail('invoice_payments', 'select', 'timeout')

    await expect(sweepPayPalReceipts(db.client, { now })).rejects.toThrow('Could not read PayPal payments')
    expect(mocks.sendInvoiceEmail).not.toHaveBeenCalled()
  })
})
