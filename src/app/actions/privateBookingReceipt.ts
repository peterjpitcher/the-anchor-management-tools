'use server'

import { createHash } from 'node:crypto'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { checkUserPermission } from '@/app/actions/rbac'
import { loadBookingReceipt } from '@/lib/private-bookings/booking-receipt-loader'
import { generateBookingReceiptPDF } from '@/lib/private-bookings/booking-receipt-pdf'
import { CONTRACT_DOCUMENTS_BUCKET, storeContractSnapshot } from '@/lib/private-bookings/contract-lifecycle'
import type { BookingReceiptDocument, BookingReceiptModel } from '@/lib/private-bookings/booking-receipt'
import { sendEmail } from '@/lib/email/emailService'
import { invoiceReplyToAddress, invoiceSenderIdentity } from '@/lib/email/invoice-sender'
import { logAuditEvent } from './audit'
import { revalidatePath } from 'next/cache'

const uuid = z.string().uuid()
async function authorise(mutation = false): Promise<string> {
  const client = await createClient()
  const { data: { user } } = await client.auth.getUser()
  if (!user) throw new Error('Unauthorized')
  if (!await checkUserPermission('private_bookings', 'view', user.id) || !await checkUserPermission('private_bookings', 'view_pricing', user.id)) throw new Error('Insufficient permissions')
  if (mutation) {
    const { data, error } = await createAdminClient().rpc('get_user_roles', { p_user_id: user.id })
    if (error || !(data as Array<{ role_name: string }> | null)?.some(role => role.role_name === 'super_admin')) throw new Error('Only super admins can issue or send booking receipts.')
  }
  return user.id
}
function errorMessage(error: unknown): string { return error instanceof Error ? error.message : 'Could not complete the booking receipt request.' }
function fingerprint(model: BookingReceiptModel): string {
  const { generatedAt: _generatedAt, ...account } = model
  return createHash('sha256').update(JSON.stringify(account)).digest('hex')
}
function documentUrl(bookingId: string, documentId: string): string { return `/api/private-bookings/${bookingId}/receipts/${documentId}` }

export async function previewPrivateBookingReceipt(bookingId: string): Promise<{ success?: boolean; error?: string; data?: { model: BookingReceiptModel; documents: BookingReceiptDocument[] } }> {
  try {
    uuid.parse(bookingId)
    await authorise()
    const model = await loadBookingReceipt(bookingId)
    const { data, error } = await createAdminClient().from('private_booking_documents').select('id, version, file_name, generated_at, metadata').eq('booking_id', bookingId).eq('document_type', 'receipt').order('version', { ascending: false })
    if (error) throw new Error('Could not load previous receipt versions.')
    const documents: BookingReceiptDocument[] = (data ?? []).map((document, index) => ({ id: document.id, version: document.version, fileName: document.file_name, generatedAt: document.generated_at, kind: document.metadata?.kind === 'final_receipt' ? 'final_receipt' : 'payment_statement', superseded: index > 0 || document.metadata?.sourceFingerprint !== fingerprint(model), url: documentUrl(bookingId, document.id) }))
    return { success: true, data: { model, documents } }
  } catch (error) { return { error: errorMessage(error) } }
}

export async function generatePrivateBookingReceipt(bookingId: string): Promise<{ success?: boolean; error?: string; data?: { documentId: string; url: string; kind: BookingReceiptModel['kind'] } }> {
  try {
    uuid.parse(bookingId)
    const userId = await authorise(true)
    const model = await loadBookingReceipt(bookingId)
    const db = createAdminClient()
    const { data: version, error: versionError } = await db.rpc('reserve_private_booking_receipt_version', { p_booking_id: bookingId })
    if (versionError || !Number.isInteger(version) || version < 1) throw new Error('Could not reserve a receipt version. Please retry.')
    const content = await generateBookingReceiptPDF(model, version)
    if (fingerprint(model) !== fingerprint(await loadBookingReceipt(bookingId))) throw new Error('The booking account changed during generation. Please preview and generate again.')
    const fileName = `booking-receipt-v${version}.pdf`
    await storeContractSnapshot(db, { bookingId, version, fileName, content, mimeType: 'application/pdf', generatedBy: userId, documentType: 'receipt', strict: true, metadata: { kind: model.kind, snapshot: model, sourceFingerprint: fingerprint(model), sha256: createHash('sha256').update(content).digest('hex') } })
    const { data: document, error } = await db.from('private_booking_documents').select('id').eq('booking_id', bookingId).eq('document_type', 'receipt').eq('version', version).single()
    if (error || !document) throw new Error('The receipt was stored but could not be read. Refresh the receipt list before retrying.')
    await logAuditEvent({ user_id: userId, operation_type: 'create', resource_type: 'private_booking_receipt', resource_id: document.id, operation_status: 'success', additional_info: { booking_id: bookingId, version, kind: model.kind } })
    revalidatePath(`/private-bookings/${bookingId}`)
    return { success: true, data: { documentId: document.id, url: documentUrl(bookingId, document.id), kind: model.kind } }
  } catch (error) { return { error: errorMessage(error) } }
}

export async function sendPrivateBookingReceipt(bookingId: string, documentId: string): Promise<{ success?: boolean; error?: string }> {
  try {
    uuid.parse(bookingId); uuid.parse(documentId)
    const userId = await authorise(true)
    const db = createAdminClient()
    const [{ data: booking, error: bookingError }, { data: document, error: documentError }] = await Promise.all([
      db.from('private_bookings').select('contact_email').eq('id', bookingId).single(),
      db.from('private_booking_documents').select('*').eq('id', documentId).eq('booking_id', bookingId).eq('document_type', 'receipt').single(),
    ])
    if (bookingError || documentError || !document || !booking) throw new Error('The booking receipt could not be loaded.')
    const email = z.string().email().safeParse(booking.contact_email)
    if (!email.success) throw new Error('Add a valid booking contact email before sending a receipt.')
    const currentModel = await loadBookingReceipt(bookingId)
    if (document.metadata?.sourceFingerprint !== fingerprint(currentModel)) throw new Error('This receipt has been superseded by account changes. Generate a current version before sending.')
    const { data: stored, error: storageError } = await db.storage.from(CONTRACT_DOCUMENTS_BUCKET).download(document.storage_path)
    if (storageError || !stored) throw new Error('The stored receipt is unavailable. Nothing was sent.')
    const content = Buffer.from(await stored.arrayBuffer())
    if (createHash('sha256').update(content).digest('hex') !== document.metadata?.sha256) throw new Error('The stored receipt failed its integrity check. Nothing was sent.')
    const title = document.metadata?.kind === 'final_receipt' ? 'Final receipt' : 'Payment statement'
    const sent = await sendEmail({ to: email.data, subject: `${title} for your private booking`, text: `Please find your ${title.toLowerCase()} attached. It lists the booking charges and recorded payments.\n\nOrange Jelly Limited`, from: invoiceSenderIdentity(), replyTo: invoiceReplyToAddress(), privateBookingId: bookingId, commType: 'private_booking_receipt', requireLog: true, attachments: [{ name: document.file_name, content, contentType: 'application/pdf' }], metadata: { receipt_document_id: documentId, version: document.version } })
    await logAuditEvent({ user_id: userId, operation_type: 'send', resource_type: 'private_booking_receipt', resource_id: documentId, operation_status: sent.success ? 'success' : 'failure', additional_info: { booking_id: bookingId, version: document.version, error: sent.error ?? null } })
    if (!sent.success) return { error: sent.error ?? 'Receipt delivery failed. The stored receipt is available to download or retry.' }
    return { success: true }
  } catch (error) { return { error: errorMessage(error) } }
}
