import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { Blob } from 'node:buffer'
const mocks = vi.hoisted(() => ({ user: vi.fn(), permission: vi.fn(), admin: vi.fn(), loader: vi.fn(), pdf: vi.fn(), store: vi.fn(), send: vi.fn(), audit: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth: { getUser: mocks.user } }) }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.admin }))
vi.mock('@/app/actions/rbac', () => ({ checkUserPermission: mocks.permission }))
vi.mock('@/lib/private-bookings/booking-receipt-loader', () => ({ loadBookingReceipt: mocks.loader }))
vi.mock('@/lib/private-bookings/booking-receipt-pdf', () => ({ generateBookingReceiptPDF: mocks.pdf }))
vi.mock('@/lib/private-bookings/contract-lifecycle', () => ({ CONTRACT_DOCUMENTS_BUCKET: 'private-booking-documents', storeContractSnapshot: mocks.store }))
vi.mock('@/lib/email/emailService', () => ({ sendEmail: mocks.send }))
vi.mock('@/app/actions/audit', () => ({ logAuditEvent: mocks.audit }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
import { previewPrivateBookingReceipt, generatePrivateBookingReceipt, sendPrivateBookingReceipt } from '@/app/actions/privateBookingReceipt'
import { GET } from '@/app/api/private-bookings/[id]/receipts/[documentId]/route'
const bookingId = '00000000-0000-4000-8000-000000000001'
const documentId = '00000000-0000-4000-8000-000000000002'
const model = { bookingId, generatedAt: '2026-09-18T12:00:00Z', kind: 'final_receipt', payments: [] }
const fingerprint = createHash('sha256').update(JSON.stringify({ bookingId, kind: 'final_receipt', payments: [] })).digest('hex')
const bytes = Buffer.from('immutable stored PDF bytes')
const document = { id: documentId, booking_id: bookingId, file_name: 'booking-receipt-v1.pdf', version: 1, storage_path: `${bookingId}/booking-receipt-v1.pdf`, metadata: { kind: 'final_receipt', sourceFingerprint: fingerprint, sha256: createHash('sha256').update(bytes).digest('hex') } }
let download: ReturnType<typeof vi.fn>
let rpc: ReturnType<typeof vi.fn>
let queries: Array<{ table: string; filters: Array<[string, unknown]> }>
function database() {
 return { rpc, storage: { from: () => ({ download }) }, from(table: string) {
  const query = { table, filters: [] as Array<[string, unknown]> }; queries.push(query)
  const chain = { select: () => chain, eq: (column: string, value: unknown) => { query.filters.push([column, value]); return chain }, order: () => chain, single: async () => ({ data: table === 'private_bookings' ? { contact_email: 'test@example.invalid' } : document, error: null }), then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: table === 'private_booking_documents' ? [document] : [], error: null }).then(resolve) }
  return chain
 } }
}
beforeEach(() => {
 vi.resetAllMocks(); queries = []
 mocks.user.mockResolvedValue({ data: { user: { id: 'staff-user' } } })
 mocks.permission.mockResolvedValue(true)
 mocks.loader.mockResolvedValue(model)
 mocks.pdf.mockResolvedValue(bytes)
 mocks.store.mockResolvedValue(undefined)
 mocks.send.mockResolvedValue({ success: true })
 rpc = vi.fn().mockImplementation((name: string) => Promise.resolve({ data: name === 'get_user_roles' ? [{ role_name: 'super_admin' }] : 1, error: null }))
 download = vi.fn().mockResolvedValue({ data: new Blob([bytes]), error: null })
 mocks.admin.mockImplementation(database)
})
describe('receipt permissions and immutable delivery', () => {
 it('denies logged-out reads without loading account data', async () => {
  mocks.user.mockResolvedValue({ data: { user: null } })
  expect(await previewPrivateBookingReceipt(bookingId)).toEqual({ error: 'Unauthorized' })
  expect(mocks.loader).not.toHaveBeenCalled()
 })
 it('requires pricing permission for preview and download', async () => {
  mocks.permission.mockImplementation(async (_module, action) => action !== 'view_pricing')
  expect((await previewPrivateBookingReceipt(bookingId)).error).toBe('Insufficient permissions')
  const result = await GET(new Request('https://example.invalid'), { params: Promise.resolve({ id: bookingId, documentId }) })
  expect(result.status).toBe(403)
  expect(download).not.toHaveBeenCalled()
 })
 it('rejects issuing when not a super admin', async () => {
  rpc.mockResolvedValue({ data: [{ role_name: 'manager' }], error: null })
  expect((await generatePrivateBookingReceipt(bookingId)).error).toContain('super admins')
  expect(mocks.pdf).not.toHaveBeenCalled()
 })
 it('does not report success when version reservation or immutable storage fails', async () => {
  rpc.mockImplementation(async (name: string) => ({ data: name === 'get_user_roles' ? [{ role_name: 'super_admin' }] : null, error: null }))
  expect((await generatePrivateBookingReceipt(bookingId)).error).toContain('reserve')
  expect(mocks.store).not.toHaveBeenCalled()
  rpc.mockImplementation(async (name: string) => ({ data: name === 'get_user_roles' ? [{ role_name: 'super_admin' }] : 1, error: null }))
  mocks.store.mockRejectedValue(new Error('Storage failed'))
  expect(await generatePrivateBookingReceipt(bookingId)).toEqual({ error: 'Storage failed' })
 })
 it('rejects a changing account before storing a potentially false final receipt', async () => {
  mocks.loader.mockResolvedValueOnce(model).mockResolvedValueOnce({ ...model, kind: 'payment_statement' })
  expect((await generatePrivateBookingReceipt(bookingId)).error).toContain('changed')
  expect(mocks.store).not.toHaveBeenCalled()
 })
 it('downloads exact bytes with both booking and receipt identity scoped', async () => {
  const result = await GET(new Request('https://example.invalid'), { params: Promise.resolve({ id: bookingId, documentId }) })
  expect(result.status).toBe(200)
  expect(Buffer.from(await result.arrayBuffer())).toEqual(bytes)
  expect(queries[0].filters).toEqual(expect.arrayContaining([['id', documentId], ['booking_id', bookingId], ['document_type', 'receipt']]))
  expect(mocks.pdf).not.toHaveBeenCalled()
 })
 it('keeps failed delivery recoverable without generating or duplicating the receipt', async () => {
  mocks.send.mockResolvedValueOnce({ success: false, error: 'email_suspended' })
  expect(await sendPrivateBookingReceipt(bookingId, documentId)).toEqual({ error: 'email_suspended' })
  expect(await sendPrivateBookingReceipt(bookingId, documentId)).toEqual({ success: true })
  expect(mocks.send.mock.calls[1][0].attachments[0].content).toEqual(bytes)
  expect(mocks.store).not.toHaveBeenCalled()
  expect(mocks.pdf).not.toHaveBeenCalled()
 })
 it('will not send an outdated account or tampered PDF', async () => {
  mocks.loader.mockResolvedValueOnce({ ...model, kind: 'payment_statement' })
  expect((await sendPrivateBookingReceipt(bookingId, documentId)).error).toContain('superseded')
  download.mockResolvedValue({ data: new Blob(['changed bytes']), error: null })
  expect((await sendPrivateBookingReceipt(bookingId, documentId)).error).toContain('integrity')
  expect(mocks.send).not.toHaveBeenCalled()
 })
})
