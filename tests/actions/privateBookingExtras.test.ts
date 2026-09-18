import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { requirePrivateBookingBillingAdmin, loadInvoiceForSending } from '@/lib/private-bookings/invoice-access'
import { storeContractSnapshot } from '@/lib/private-bookings/contract-lifecycle'
import { sendInvoiceEmail } from '@/lib/microsoft-graph'
import { checkUserPermission } from '@/app/actions/rbac'
import { resendPrivateBookingExtraInvoice, getPrivateBookingBilling, deletePrivateBookingExtras, issuePrivateBookingExtras, previewPrivateBookingExtras, recordPrivateBookingInvoicePayment, savePrivateBookingExtras } from '@/app/actions/privateBookingExtras'
import type { ExtraChargeBatch } from '@/lib/private-bookings/extra-charges'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/private-bookings/invoice-access', () => ({ requirePrivateBookingBillingAdmin: vi.fn(), loadInvoiceForSending: vi.fn() }))
vi.mock('@/lib/microsoft-graph', () => ({ sendInvoiceEmail: vi.fn() }))
vi.mock('@/lib/private-bookings/contract-lifecycle', () => ({ storeContractSnapshot: vi.fn() }))
vi.mock('@/app/actions/audit', () => ({ logAuditEvent: vi.fn() }))
vi.mock('@/app/actions/rbac', () => ({ checkUserPermission: vi.fn() }))
vi.mock('@/lib/dateUtils', () => ({ getTodayIsoDate: () => '2026-09-18', formatDateFull: (date: string) => date }))
vi.mock('@/lib/invoices/payment-link-footer', () => ({ invoiceCanOfferPayPal: vi.fn(() => false), invoicePortalUrl: vi.fn() }))

const bookingId = '11111111-1111-4111-8111-111111111111'
const batchId = '22222222-2222-4222-8222-222222222222'
const originalId = '33333333-3333-4333-8333-333333333333'
const invoiceId = '44444444-4444-4444-8444-444444444444'
const receiptId = '55555555-5555-4555-8555-555555555555'
const actorId = '66666666-6666-4666-8666-666666666666'
const lines = [{ description: 'Additional agreed food', quantity: 2, unit_price: 12.5, discount_percentage: 0, vat_rate: 20 }]
let batch: ExtraChargeBatch
let sentAt: string | null
let paypalEnabled: boolean
let invoiceCount: number
let deliveryState: string
let deliveryClaimCount: number
let rpc: ReturnType<typeof vi.fn>

function database(): void {
  const from = vi.fn((table: string) => {
    const response = () => ({ data: table === 'private_booking_charge_batches' ? batch : table === 'private_bookings' ? { id: bookingId, invoice_id: originalId, contact_email: 'test@example.com', status: 'confirmed' } : table === 'private_booking_invoices' ? { kind: 'supplementary' } : null, error: null })
    const chain: Record<string, unknown> = {}
    for (const method of ['select', 'eq', 'order', 'in', 'is']) chain[method] = vi.fn(() => chain)
    chain.single = vi.fn(async () => response())
    chain.insert = vi.fn(async () => ({ error: null }))
    chain.update = vi.fn((value: { sent_at?: string }) => { if (value.sent_at) sentAt = value.sent_at; return chain })
    chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve(response()).then(resolve)
    return chain
  })
  rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
    if (name === 'claim_private_booking_extra_delivery') {
      if (deliveryState === 'sending' || (deliveryState !== 'not_sent' && !args.p_resend)) return { data: { claimed: false, state: deliveryState }, error: null }
      deliveryState = 'sending'
      return { data: { claimed: true, state: 'sending', claim_id: `claim-${++deliveryClaimCount}` }, error: null }
    }
    if (name === 'finish_private_booking_extra_delivery') {
      deliveryState = args.p_sent ? 'sent' : 'failed'
      return { data: { success: true }, error: null }
    }
    if (name === 'issue_private_booking_charge_batch') {
      const created = batch.status === 'draft'
      if (created) { invoiceCount++; batch = { ...batch, status: 'issued', invoice_id: invoiceId, revision: batch.revision + 1 } }
      return { data: { created, invoice: { id: invoiceId, invoice_number: 'INV-EXTRA', sent_at: sentAt }, batch }, error: null }
    }
    if (name === 'save_private_booking_charge_batch') return { data: { ...batch, lines: args.p_lines }, error: null }
    if (name === 'record_private_booking_allocated_payment') return { data: { receipt_id: receiptId }, error: null }
    return { data: { success: true }, error: null }
  })
  vi.mocked(createAdminClient).mockReturnValue({ from, rpc } as unknown as ReturnType<typeof createAdminClient>)
}

beforeEach(() => {
  vi.clearAllMocks()
  batch = { id: batchId, booking_id: bookingId, status: 'draft', invoice_id: null, lines, due_date: '2026-09-25', reference: 'Extra food', revision: 1, created_at: '2026-09-18T10:00:00Z', updated_at: '2026-09-18T10:00:00Z' }
  sentAt = null; paypalEnabled = true; invoiceCount = 0; deliveryState = 'not_sent'; deliveryClaimCount = 0
  vi.mocked(requirePrivateBookingBillingAdmin).mockResolvedValue({ userId: actorId })
  vi.mocked(createClient).mockResolvedValue({ auth: { getUser: async () => ({ data: { user: { id: actorId } } }) } } as unknown as Awaited<ReturnType<typeof createClient>>)
  vi.mocked(checkUserPermission).mockResolvedValue(true)
  vi.mocked(loadInvoiceForSending).mockImplementation(async id => ({ id, invoice_number: id === originalId ? 'INV-ORIGINAL' : 'INV-EXTRA', status: 'sent', total_amount: 30, paid_amount: 0, due_date: '2026-09-25', vendor_id: 'vendor', vendor: { paypal_payments_enabled: paypalEnabled } }) as unknown as Awaited<ReturnType<typeof loadInvoiceForSending>>)
  vi.mocked(sendInvoiceEmail).mockResolvedValue({ success: true })
  database()
})

async function issueInput() {
  const { preview } = await previewPrivateBookingExtras(bookingId, batchId)
  expect(preview).toBeDefined()
  return { bookingId, batchId, expectedRevision: 1, sourceHash: preview!.sourceHash, allowWithoutOnlinePayment: false }
}

describe('private booking additional invoice actions', () => {
  it('does not expose billing to booking staff without pricing access', async () => {
    vi.mocked(checkUserPermission).mockImplementation(async (_module, action) => action === 'view')
    expect((await getPrivateBookingBilling(bookingId)).error).toBe('Insufficient permissions')
    expect(createAdminClient).not.toHaveBeenCalled()
  })

  it('denies draft, preview and issuing before privileged database access', async () => {
    vi.mocked(requirePrivateBookingBillingAdmin).mockResolvedValue({ error: 'Only super admins can raise a booking invoice.' })
    expect((await savePrivateBookingExtras({ bookingId, dueDate: '2026-09-25', lines })).error).toMatch('super admins')
    expect((await previewPrivateBookingExtras(bookingId, batchId)).error).toMatch('super admins')
    expect((await issuePrivateBookingExtras({ bookingId, batchId, expectedRevision: 1, sourceHash: 'invalid', allowWithoutOnlinePayment: true })).error).toMatch('super admins')
    expect(rpc).not.toHaveBeenCalled()
  })

  it('saves a draft without creating an invoice, delivery or inherited discount', async () => {
    expect((await savePrivateBookingExtras({ bookingId, batchId, expectedRevision: 1, dueDate: '2026-09-25', lines })).batch?.lines).toEqual([{ ...lines[0], display_order: 0 }])
    expect(rpc).toHaveBeenCalledWith('save_private_booking_charge_batch', expect.objectContaining({ p_expected_revision: 1, p_lines: [{ ...lines[0], display_order: 0 }] }))
    expect(invoiceCount).toBe(0)
    expect(sendInvoiceEmail).not.toHaveBeenCalled()
  })

  it('rejects stale preview without issuing', async () => {
    const input = await issueInput()
    batch = { ...batch, revision: 2, lines: [{ ...lines[0], unit_price: 20 }] }
    expect((await issuePrivateBookingExtras(input)).error).toMatch('changed')
    expect(rpc).not.toHaveBeenCalled()
  })

  it('issues only extra charges and does not reissue or resend after success', async () => {
    const input = await issueInput()
    const first = await issuePrivateBookingExtras(input)
    const repeated = await issuePrivateBookingExtras(input)
    expect(first).toMatchObject({ invoiceId, sent: true })
    expect(repeated).toMatchObject({ invoiceId, sent: true })
    expect(invoiceCount).toBe(1)
    expect(sendInvoiceEmail).toHaveBeenCalledTimes(1)
    const body = vi.mocked(sendInvoiceEmail).mock.calls[0][3]
    expect(body).toContain('£30.00')
    expect(body).not.toMatch(/undefined|NaN|Invalid Date/)
  })

  it('keeps the invoice recoverable when suspended email fails, and retry uses it', async () => {
    const input = await issueInput()
    vi.mocked(sendInvoiceEmail).mockResolvedValueOnce({ success: false, error: 'Email sending suspended' })
    expect(await issuePrivateBookingExtras(input)).toMatchObject({ invoiceId, sent: false, warning: 'Email sending suspended' })
    expect(await issuePrivateBookingExtras(input)).toMatchObject({ invoiceId, sent: false, warning: expect.stringContaining('Use Resend') })
    expect(await resendPrivateBookingExtraInvoice(bookingId, invoiceId)).toMatchObject({ sent: true })
    expect(invoiceCount).toBe(1)
  })

  it('claims one delivery when concurrent issue requests see an unsent invoice', async () => {
    const input = await issueInput()
    let finishSend: ((value: { success: boolean }) => void) | undefined
    vi.mocked(sendInvoiceEmail).mockImplementation(() => new Promise(resolve => { finishSend = resolve }))
    const first = issuePrivateBookingExtras(input)
    await vi.waitFor(() => expect(sendInvoiceEmail).toHaveBeenCalledTimes(1))
    const second = await issuePrivateBookingExtras(input)
    expect(second).toMatchObject({ invoiceId, sent: false, warning: expect.stringContaining('already being processed') })
    finishSend!({ success: true })
    expect(await first).toMatchObject({ invoiceId, sent: true })
    expect(invoiceCount).toBe(1)
    expect(sendInvoiceEmail).toHaveBeenCalledTimes(1)
  })

  it('keeps successful delivery and reports strict archive failure clearly', async () => {
    const input = await issueInput()
    vi.mocked(sendInvoiceEmail).mockResolvedValue({ success: true, pdfBuffer: Buffer.from('exact sent PDF') })
    vi.mocked(storeContractSnapshot).mockRejectedValueOnce(new Error('Storage unavailable'))
    const result = await issuePrivateBookingExtras(input)
    expect(result).toMatchObject({ invoiceId, sent: true, warning: expect.stringContaining('PDF could not be archived') })
    expect(deliveryState).toBe('sent')
    expect(storeContractSnapshot).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ strict: true, fileName: 'invoice-INV-EXTRA-claim-1.pdf' }))
    expect(sendInvoiceEmail).toHaveBeenCalledTimes(1)
  })

  it('archives each resend under its own delivery identity without replacing the earlier PDF', async () => {
    const input = await issueInput()
    const firstPdf = Buffer.from('original exact invoice PDF')
    const resentPdf = Buffer.from('resent exact invoice PDF')
    vi.mocked(sendInvoiceEmail)
      .mockResolvedValueOnce({ success: true, pdfBuffer: firstPdf })
      .mockResolvedValueOnce({ success: true, pdfBuffer: resentPdf })
    expect((await issuePrivateBookingExtras(input)).sent).toBe(true)
    expect((await resendPrivateBookingExtraInvoice(bookingId, invoiceId)).sent).toBe(true)
    const snapshots = vi.mocked(storeContractSnapshot).mock.calls.map(call => call[1])
    expect(snapshots).toHaveLength(2)
    expect(snapshots[0]).toMatchObject({ strict: true, fileName: 'invoice-INV-EXTRA-claim-1.pdf', content: firstPdf, metadata: { delivery_claim_id: 'claim-1', snapshot_schema_version: 1 } })
    expect(snapshots[1]).toMatchObject({ strict: true, fileName: 'invoice-INV-EXTRA-claim-2.pdf', content: resentPdf, metadata: { delivery_claim_id: 'claim-2', snapshot_schema_version: 1 } })
  })

  it('requires explicit acknowledgement when online payment is disabled', async () => {
    paypalEnabled = false
    const input = await issueInput()
    expect((await issuePrivateBookingExtras(input)).error).toMatch('Online payment is disabled')
    expect(invoiceCount).toBe(0)
    expect((await issuePrivateBookingExtras({ ...input, allowWithoutOnlinePayment: true })).sent).toBe(true)
  })

  it('requires a valid explicit due date and does not save a past due date', async () => {
    expect((await savePrivateBookingExtras({ bookingId, dueDate: '2026-09-17', lines })).error).toMatch('due date')
    expect(rpc).not.toHaveBeenCalled()
  })

  it('discards a draft with its expected revision', async () => {
    expect(await deletePrivateBookingExtras(bookingId, batchId, 1)).toEqual({ success: true })
    expect(rpc).toHaveBeenCalledWith('discard_private_booking_charge_batch', { p_booking_id: bookingId, p_batch_id: batchId, p_expected_revision: 1 })
  })

  it('passes a single receipt identity and explicit dated allocations atomically', async () => {
    const result = await recordPrivateBookingInvoicePayment({ bookingId, receiptId, paymentDate: '2026-09-17', amount: 30, method: 'bank_transfer', allocations: [{ invoiceId: originalId, amount: 10 }, { invoiceId, amount: 20 }] })
    expect(result).toEqual({ success: true, receiptId })
    expect(rpc).toHaveBeenCalledWith('record_private_booking_allocated_payment', expect.objectContaining({ p_receipt_id: receiptId, p_payment_date: '2026-09-17', p_allocations: [{ invoice_id: originalId, amount: 10 }, { invoice_id: invoiceId, amount: 20 }] }))
  })

  it('rejects mismatched, repeated, fractional-penny and future allocations before any payment', async () => {
    for (const patch of [{ allocations: [{ invoiceId, amount: 20 }] }, { allocations: [{ invoiceId, amount: 10 }, { invoiceId, amount: 20 }] }, { amount: 30.001 }, { paymentDate: '2026-09-19' }]) {
      const result = await recordPrivateBookingInvoicePayment({ bookingId, receiptId, paymentDate: '2026-09-17', amount: 30, method: 'cash', allocations: [{ invoiceId, amount: 30 }], ...patch })
      expect(result.error).toBeTruthy()
    }
    expect(rpc).not.toHaveBeenCalled()
  })

  it('denies recording payments without manage_deposits', async () => {
    vi.mocked(checkUserPermission).mockResolvedValue(false)
    expect((await recordPrivateBookingInvoicePayment({ bookingId, receiptId, paymentDate: '2026-09-17', amount: 30, method: 'cash', allocations: [{ invoiceId, amount: 30 }] })).error).toBe('Insufficient permissions')
    expect(rpc).not.toHaveBeenCalled()
  })
})
