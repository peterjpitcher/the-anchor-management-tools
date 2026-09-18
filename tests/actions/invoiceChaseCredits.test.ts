import { beforeEach, expect, it, vi } from 'vitest'
import { sendChasePaymentEmail } from '@/app/actions/email'
import { getInvoice } from '@/app/actions/invoices'
import { sendInvoiceEmail } from '@/lib/microsoft-graph'

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

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(sendInvoiceEmail).mockResolvedValue({ success: false, error: 'Delivery disabled in test' })
})

function form(): FormData {
  const input = new FormData()
  input.set('invoiceId', '11111111-1111-4111-8111-111111111111')
  input.set('recipientEmail', 'test@example.com')
  return input
}

it('chases only £90 after a £30 credit on the £120 original invoice', async () => {
  vi.mocked(getInvoice).mockResolvedValue({ invoice: { id: 'invoice', invoice_number: 'INV-1', status: 'sent', due_date: '2026-09-01', total_amount: 120, paid_amount: 0, credits: [{ status: 'issued', amount_inc_vat: 30 }], vendor: { name: 'Test' } } } as Awaited<ReturnType<typeof getInvoice>>)
  await sendChasePaymentEmail(form())
  expect(sendInvoiceEmail).toHaveBeenCalledTimes(1)
  expect(vi.mocked(sendInvoiceEmail).mock.calls[0][3]).toContain('Credits applied: £30.00')
  expect(vi.mocked(sendInvoiceEmail).mock.calls[0][3]).toContain('Amount Outstanding: £90.00')
})

it('refuses a chase once the £90 receipt settles the remaining balance', async () => {
  vi.mocked(getInvoice).mockResolvedValue({ invoice: { id: 'invoice', invoice_number: 'INV-1', status: 'sent', due_date: '2026-09-01', total_amount: 120, paid_amount: 90, credits: [{ status: 'issued', amount_inc_vat: 30 }] } } as Awaited<ReturnType<typeof getInvoice>>)
  expect(await sendChasePaymentEmail(form())).toMatchObject({ error: expect.stringContaining('no outstanding balance') })
  expect(sendInvoiceEmail).not.toHaveBeenCalled()
})
