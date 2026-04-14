'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { checkUserPermission } from '@/app/actions/rbac'
import { logAuditEvent } from './audit'
import { isGraphConfigured, sendInvoiceEmail } from '@/lib/microsoft-graph'
import { z } from 'zod'
import { getErrorMessage } from '@/lib/errors'
import { revalidatePath, revalidateTag } from 'next/cache'
import type {
  Invoice,
  InvoiceWithDetails,
  InvoiceStatus,
  InvoiceLineItemInput,
  LineItemCatalogItem
} from '@/types/invoices'
import { InvoiceService, CreateInvoiceSchema } from '@/services/invoices'

const CONTACT_NAME = process.env.COMPANY_CONTACT_NAME || 'Peter Pitcher'
const CONTACT_PHONE = process.env.COMPANY_CONTACT_PHONE || '07995087315'

type CreateInvoiceResult = { error: string } | { success: true; invoice: Invoice }
type InvoiceEmailRecipients = { to: string | null; cc: string[] }
type RemittanceAdviceResult = { sent: boolean; skippedReason?: string; error?: string }

function parseRecipientList(raw: string | null | undefined): string[] {
  if (!raw) return []
  return String(raw)
    .split(/[;,]/)
    .map((s) => s.trim())
    .filter(Boolean)
}

function formatDateForEmail(dateIso: string | null | undefined): string {
  if (!dateIso) return 'N/A'
  const date = new Date(dateIso)
  if (Number.isNaN(date.getTime())) return 'N/A'
  return date.toLocaleDateString('en-GB')
}

function formatCurrencyForEmail(amount: number | null | undefined): string {
  const safe = Number.isFinite(Number(amount)) ? Number(amount) : 0
  return `£${safe.toFixed(2)}`
}

function formatPaymentMethodForEmail(method: string | null | undefined): string | null {
  if (!method) return null
  return String(method)
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function getForcedRemittanceTestRecipient(): string | null {
  const candidate = process.env.INVOICE_REMITTANCE_TEST_RECIPIENT?.trim()
  if (!candidate || !candidate.includes('@')) return null
  return candidate
}

async function resolveInvoiceRecipientsForVendor(
  supabase: Awaited<ReturnType<typeof createClient>>,
  vendorId: string,
  vendorEmailRaw: string | null | undefined
): Promise<InvoiceEmailRecipients | { error: string }> {
  const recipientsFromVendor = parseRecipientList(vendorEmailRaw)

  const { data: contacts, error } = await supabase
    .from('invoice_vendor_contacts')
    .select('email, is_primary, receive_invoice_copy')
    .eq('vendor_id', vendorId)
    .order('is_primary', { ascending: false })
    .order('created_at', { ascending: true })

  if (error) {
    return { error: getErrorMessage(error) }
  }

  const contactEmails = (contacts || [])
    .map((contact: any) => ({
      email: typeof contact?.email === 'string' ? contact.email.trim() : '',
      isPrimary: !!contact?.is_primary,
      cc: !!contact?.receive_invoice_copy,
    }))
    .filter((contact) => contact.email && contact.email.includes('@'))

  const primaryEmail = contactEmails.find((contact) => contact.isPrimary)?.email || null
  const firstVendorEmail = recipientsFromVendor[0] || null
  const to = primaryEmail || firstVendorEmail || contactEmails[0]?.email || null

  const ccRaw = [
    ...recipientsFromVendor.slice(firstVendorEmail ? 1 : 0),
    ...contactEmails.filter((contact) => contact.cc).map((contact) => contact.email),
  ]

  const seen = new Set<string>()
  const toLower = to ? to.toLowerCase() : null
  const cc = ccRaw
    .map((email) => email.trim())
    .filter((email) => email && email.includes('@') && email.toLowerCase() !== toLower)
    .filter((email) => {
      const key = email.toLowerCase()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })

  return { to, cc }
}

async function sendPaymentReceipt(
  invoiceId: string,
  paymentId: string,
  sentByUserId?: string | null
): Promise<RemittanceAdviceResult> {
  if (!isGraphConfigured()) {
    return { sent: false, skippedReason: 'email_not_configured' }
  }

  let invoice: InvoiceWithDetails
  try {
    invoice = await InvoiceService.getInvoiceById(invoiceId)
  } catch (error: unknown) {
    const message = getErrorMessage(error)
    console.error('[Invoices] Receipt dispatch aborted:', message)
    return { sent: false, skippedReason: 'invoice_lookup_failed', error: message }
  }

  if (invoice.status !== 'paid' && invoice.status !== 'partially_paid') {
    return { sent: false, skippedReason: 'invoice_not_paid' }
  }

  const supabase = await createClient()

  // Dedup guard: skip if a receipt was already sent for this specific payment
  const { data: existingLog } = await supabase
    .from('invoice_email_logs')
    .select('id')
    .eq('payment_id', paymentId)
    .eq('status', 'sent')
    .limit(1)
    .maybeSingle()
  if (existingLog) {
    return { sent: false, skippedReason: 'already_sent' }
  }

  const forcedRecipient = getForcedRemittanceTestRecipient()
  let toAddress: string | null = null
  let ccAddresses: string[] = []
  let resolvedRecipients: InvoiceEmailRecipients | null = null

  if (forcedRecipient) {
    toAddress = forcedRecipient
    ccAddresses = []
  } else {
    const recipientResult = await resolveInvoiceRecipientsForVendor(
      supabase,
      invoice.vendor_id,
      invoice.vendor?.email || null
    )

    if ('error' in recipientResult) {
      console.error('[Invoices] Failed to resolve remittance recipients:', recipientResult.error)
      return { sent: false, skippedReason: 'recipient_lookup_failed', error: recipientResult.error }
    }

    if (!recipientResult.to) {
      return { sent: false, skippedReason: 'no_recipient' }
    }

    resolvedRecipients = recipientResult
    toAddress = recipientResult.to
    ccAddresses = recipientResult.cc
  }

  const payment = (invoice.payments || []).find(p => p.id === paymentId)
  if (!payment) {
    return { sent: false, skippedReason: 'payment_not_found' }
  }

  const paymentAmount = payment.amount ?? invoice.paid_amount
  const paymentDate = formatDateForEmail(payment.payment_date || null)
  const paymentMethod = formatPaymentMethodForEmail(payment.payment_method || null)
  const outstandingBalance = Math.max(0, invoice.total_amount - invoice.paid_amount)
  const recipientName = invoice.vendor?.contact_name || invoice.vendor?.name || 'there'

  const isFullPayment = invoice.status === 'paid'
  const subject = isFullPayment
    ? `Receipt: Invoice ${invoice.invoice_number} (Paid in Full)`
    : `Receipt: Invoice ${invoice.invoice_number} (Payment Received — Balance: £${outstandingBalance.toFixed(2)})`
  const pdfFilename = isFullPayment
    ? `receipt-${invoice.invoice_number}.pdf`
    : `receipt-${invoice.invoice_number}-partial.pdf`
  const body = `Hi ${recipientName},

I hope you're doing well!

This is a receipt confirming payment has been received for invoice ${invoice.invoice_number}.

Invoice Total: ${formatCurrencyForEmail(invoice.total_amount)}
Payment Received: ${formatCurrencyForEmail(paymentAmount)}
Total Paid: ${formatCurrencyForEmail(invoice.paid_amount)}
Outstanding Balance: ${formatCurrencyForEmail(outstandingBalance)}
Payment Date: ${paymentDate}
${paymentMethod ? `Payment Method: ${paymentMethod}` : ''}
${payment.reference ? `Reference: ${payment.reference}` : ''}

If you have any questions, just let me know.

Many thanks,
${CONTACT_NAME}
Orange Jelly Limited
${CONTACT_PHONE}`

  const emailResult = await sendInvoiceEmail(
    invoice,
    toAddress,
    subject,
    body,
    ccAddresses,
    undefined,
    {
      documentKind: 'remittance_advice',
      pdfFilename,
      remittance: {
        paymentDate: payment.payment_date || null,
        paymentAmount: paymentAmount,
        paymentMethod: payment.payment_method || null,
        paymentReference: payment.reference || null,
      },
    }
  )

  const recipients = [toAddress, ...ccAddresses]

  if (emailResult.success) {
    const { error: logError } = await supabase.from('invoice_email_logs').insert(
      recipients.map((address) => ({
        invoice_id: invoiceId,
        payment_id: paymentId,
        sent_to: address,
        sent_by: sentByUserId || null,
        subject,
        body,
        status: 'sent',
      }))
    )

    if (logError) {
      console.error('[Invoices] Failed to write remittance email logs:', logError)
    }

    await logAuditEvent({
      operation_type: 'send',
      resource_type: 'invoice',
      resource_id: invoiceId,
      operation_status: 'success',
      additional_info: {
        action: 'receipt_sent',
        invoice_number: invoice.invoice_number,
        recipient: toAddress,
        cc: ccAddresses,
        receipt_test_override: forcedRecipient
          ? {
              forced_to: forcedRecipient,
              original_to: resolvedRecipients?.to || null,
              original_cc: resolvedRecipients?.cc || [],
            }
          : null,
      },
    })

    return { sent: true }
  }

  const errorMessage = emailResult.error || 'Failed to send receipt'
  const { error: failedLogError } = await supabase.from('invoice_email_logs').insert({
    invoice_id: invoiceId,
    payment_id: paymentId,
    sent_to: toAddress,
    sent_by: sentByUserId || null,
    subject,
    body,
    status: 'failed',
    error_message: errorMessage,
  })

  if (failedLogError) {
    console.error('[Invoices] Failed to write receipt failure log:', failedLogError)
  }

  await logAuditEvent({
    operation_type: 'send',
    resource_type: 'invoice',
    resource_id: invoiceId,
    operation_status: 'failure',
    error_message: errorMessage,
    additional_info: {
      action: 'receipt_send_failed',
      invoice_number: invoice.invoice_number,
      recipient: toAddress,
      cc: ccAddresses,
      receipt_test_override: forcedRecipient
        ? {
            forced_to: forcedRecipient,
            original_to: resolvedRecipients?.to || null,
            original_cc: resolvedRecipients?.cc || [],
          }
        : null,
    },
  })

  return { sent: false, skippedReason: 'email_send_failed', error: errorMessage }
}

export async function getInvoices(
  status?: InvoiceStatus | 'unpaid',
  page: number = 1,
  limit: number = 20,
  search?: string
) {
  try {
    const hasPermission = await checkUserPermission('invoices', 'view')
    if (!hasPermission) {
      return { error: 'You do not have permission to view invoices' }
    }

    const { invoices, total } = await InvoiceService.getInvoices(status, page, limit, search)
    return { invoices, total }
  } catch (error: unknown) {
    console.error('Error in getInvoices:', error)
    return { error: getErrorMessage(error) }
  }
}

export async function getInvoice(invoiceId: string) {
  try {
    const hasPermission = await checkUserPermission('invoices', 'view')
    if (!hasPermission) {
      return { error: 'You do not have permission to view invoices' }
    }

    const invoice = await InvoiceService.getInvoiceById(invoiceId)
    return { invoice }
  } catch (error: unknown) {
    console.error('Error in getInvoice:', error)
    return { error: getErrorMessage(error) }
  }
}

export async function createInvoice(formData: FormData): Promise<CreateInvoiceResult> {
  try {
    const hasPermission = await checkUserPermission('invoices', 'create')
    if (!hasPermission) {
      return { error: 'You do not have permission to create invoices' }
    }

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { error: 'Unauthorized' }

    // Parse and validate form data
    const validatedData = CreateInvoiceSchema.parse({
      vendor_id: formData.get('vendor_id'),
      invoice_date: formData.get('invoice_date'),
      due_date: formData.get('due_date'),
      reference: formData.get('reference') || undefined,
      invoice_discount_percentage: parseFloat(formData.get('invoice_discount_percentage') as string) || 0,
      notes: formData.get('notes') || undefined,
      internal_notes: formData.get('internal_notes') || undefined
    })

    // Parse line items
    const lineItemsJson = formData.get('line_items') as string
    if (!lineItemsJson) {
      return { error: 'Line items are required' }
    }

    let lineItems: InvoiceLineItemInput[]
    try {
      const rawLineItems: InvoiceLineItemInput[] = JSON.parse(lineItemsJson)
      lineItems = rawLineItems.map((item) => ({
        catalog_item_id: item.catalog_item_id,
        description: item.description,
        quantity: Number(item.quantity) || 0,
        unit_price: Number(item.unit_price) || 0,
        discount_percentage: Number(item.discount_percentage) || 0,
        vat_rate: Number(item.vat_rate) || 0,
      }))
    } catch {
      return { error: 'Invalid line items data' }
    }
    if (!Array.isArray(lineItems) || lineItems.length === 0) {
      return { error: 'At least one line item is required' }
    }

    const invoice = await InvoiceService.createInvoice({
      ...validatedData,
      line_items: lineItems
    });

    await logAuditEvent({
      user_id: user.id,
      user_email: user.email,
      operation_type: 'create',
      resource_type: 'invoice',
      resource_id: invoice.id,
      operation_status: 'success',
      new_values: {
        invoice_number: invoice.invoice_number,
        vendor_id: invoice.vendor_id,
        total_amount: invoice.total_amount
      }
    })

    revalidatePath('/invoices')
    revalidateTag('dashboard')

    return { success: true, invoice }
  } catch (error: unknown) {
    console.error('Error in createInvoice:', error)
    if (error instanceof z.ZodError) {
      return { error: error.errors[0].message }
    }
    return { error: getErrorMessage(error) }
  }
}

export async function updateInvoiceStatus(formData: FormData) {
  try {
    const supabase = await createClient()
    const hasPermission = await checkUserPermission('invoices', 'edit')
    if (!hasPermission) {
      return { error: 'You do not have permission to update invoices' }
    }

    const invoiceId = formData.get('invoiceId') as string
    const rawStatus = formData.get('status')
    const force = String(formData.get('force') || '') === 'true'

    if (!invoiceId || !rawStatus) {
      return { error: 'Invoice ID and status are required' }
    }

    // Runtime validation: ensure status is a known InvoiceStatus value
    const VALID_INVOICE_STATUSES: readonly InvoiceStatus[] = [
      'draft', 'sent', 'partially_paid', 'paid', 'overdue', 'void', 'written_off'
    ] as const
    const newStatus = String(rawStatus) as InvoiceStatus
    if (!VALID_INVOICE_STATUSES.includes(newStatus)) {
      return { error: 'Invalid status' }
    }

    // Payment statuses must only be set through the dedicated payment recording flow
    if (newStatus === 'paid' || newStatus === 'partially_paid') {
      return { error: 'Payment statuses must be set through the payment recording flow' }
    }

    // Prevent voiding invoices that have linked OJ Projects items, unless explicitly overridden.
    if (newStatus === 'void' && !force) {
      const adminClient = createAdminClient()

      const [
        { count: entryCount, error: entryError },
        { count: recurringCount, error: recurringError },
      ] = await Promise.all([
        adminClient
          .from('oj_entries')
          .select('id', { count: 'exact', head: true })
          .eq('invoice_id', invoiceId),
        adminClient
          .from('oj_recurring_charge_instances')
          .select('id', { count: 'exact', head: true })
          .eq('invoice_id', invoiceId),
      ])

      if (entryError) {
        return { error: entryError.message || 'Failed to check linked OJ Projects entries' }
      }

      if (recurringError) {
        return { error: recurringError.message || 'Failed to check linked OJ Projects recurring charges' }
      }

      const linkedCount = (entryCount ?? 0) + (recurringCount ?? 0)
      if (linkedCount > 0) {
        return {
          error: 'This invoice has linked OJ Projects items. Voiding it will not automatically revert or unbill those entries/charges.',
          code: 'OJ_LINKED_ITEMS',
        }
      }
    }

    const [{ data: { user } }, { updatedInvoice, oldStatus }] = await Promise.all([
      supabase.auth.getUser(),
      InvoiceService.updateInvoiceStatus(invoiceId, newStatus),
    ])

    await logAuditEvent({
      operation_type: 'update',
      resource_type: 'invoice',
      resource_id: invoiceId,
      operation_status: 'success',
      old_values: { status: oldStatus },
      new_values: { status: newStatus },
      additional_info: { invoice_number: updatedInvoice.invoice_number }
    })

    // Remittance advice is handled by the dedicated payment recording flow,
    // since 'paid' status is blocked from this generic status update path.

    revalidatePath('/invoices')
    revalidatePath(`/invoices/${invoiceId}`)
    revalidateTag('dashboard')

    return { success: true }
  } catch (error: unknown) {
    console.error('Error in updateInvoiceStatus:', error)
    return { error: getErrorMessage(error) }
  }
}

export async function deleteInvoice(formData: FormData) {
  try {
    const supabase = await createClient() // Needed for user.id
    const { data: { user } } = await supabase.auth.getUser()

    const hasPermission = await checkUserPermission('invoices', 'delete')
    if (!hasPermission) {
      return { error: 'You do not have permission to delete invoices' }
    }

    const invoiceId = formData.get('invoiceId') as string
    if (!invoiceId) {
      return { error: 'Invoice ID is required' }
    }

    const deletedInvoice = await InvoiceService.deleteInvoice(invoiceId, user?.id || 'unknown')

    await logAuditEvent({
      operation_type: 'delete',
      resource_type: 'invoice',
      resource_id: invoiceId,
      operation_status: 'success',
      additional_info: { invoice_number: deletedInvoice.invoice_number }
    })

    revalidatePath('/invoices')
    revalidateTag('dashboard')
    
    return { success: true }
  } catch (error: unknown) {
    console.error('Error in deleteInvoice:', error)
    return { error: getErrorMessage(error) }
  }
}

export async function getInvoiceSummary() {
  try {
    const hasPermission = await checkUserPermission('invoices', 'view')
    if (!hasPermission) {
      return { error: 'You do not have permission to view invoice summary' }
    }

    const summary = await InvoiceService.getInvoiceSummary()
    return { summary }
  } catch (error: unknown) {
    console.error('Error in getInvoiceSummary:', error)
    return { error: getErrorMessage(error) }
  }
}

export async function getLineItemCatalog() {
  try {
    const hasPermission = await checkUserPermission('invoices', 'view')
    if (!hasPermission) {
      return { error: 'You do not have permission to view line items' }
    }

    const items = await InvoiceService.getLineItemCatalog()
    return { items: items as LineItemCatalogItem[] }
  } catch (error: unknown) {
    console.error('Error fetching line item catalog:', error)
    return { error: getErrorMessage(error) }
  }
}

export async function createCatalogItem(formData: FormData) {
  try {
    const hasPermission = await checkUserPermission('invoices', 'manage')
    if (!hasPermission) {
      return { error: 'You do not have permission to manage catalog items' }
    }

    const name = formData.get('name') as string
    const description = formData.get('description') as string
    const default_price = parseFloat(formData.get('default_price') as string) || 0
    const default_vat_rate = parseFloat(formData.get('default_vat_rate') as string) || 20

    if (!name) {
      return { error: 'Name is required' }
    }

    const item = await InvoiceService.createCatalogItem({ name, description, default_price, default_vat_rate })

    await logAuditEvent({
      operation_type: 'create',
      resource_type: 'line_item_catalog',
      resource_id: item.id,
      operation_status: 'success',
      new_values: { name }
    })

    revalidatePath('/invoices/catalog')
    
    return { item, success: true }
  } catch (error: unknown) {
    console.error('Error in createCatalogItem:', error)
    return { error: getErrorMessage(error) }
  }
}

export async function updateCatalogItem(formData: FormData) {
  try {
    const hasPermission = await checkUserPermission('invoices', 'manage')
    if (!hasPermission) {
      return { error: 'You do not have permission to manage catalog items' }
    }

    const itemId = formData.get('itemId') as string
    const name = formData.get('name') as string
    const description = formData.get('description') as string
    const default_price = parseFloat(formData.get('default_price') as string) || 0
    const default_vat_rate = parseFloat(formData.get('default_vat_rate') as string) || 20

    if (!itemId || !name) {
      return { error: 'Item ID and name are required' }
    }

    const item = await InvoiceService.updateCatalogItem(itemId, { name, description, default_price, default_vat_rate })

    await logAuditEvent({
      operation_type: 'update',
      resource_type: 'line_item_catalog',
      resource_id: item.id,
      operation_status: 'success',
      new_values: { name }
    })

    revalidatePath('/invoices/catalog')
    
    return { item, success: true }
  } catch (error: unknown) {
    console.error('Error in updateCatalogItem:', error)
    return { error: getErrorMessage(error) }
  }
}

export async function deleteCatalogItem(formData: FormData) {
  try {
    const hasPermission = await checkUserPermission('invoices', 'manage')
    if (!hasPermission) {
      return { error: 'You do not have permission to manage catalog items' }
    }

    const itemId = formData.get('itemId') as string
    if (!itemId) {
      return { error: 'Item ID is required' }
    }

    await InvoiceService.deleteCatalogItem(itemId)

    await logAuditEvent({
      operation_type: 'delete',
      resource_type: 'line_item_catalog',
      resource_id: itemId,
      operation_status: 'success'
    })

    revalidatePath('/invoices/catalog')
    
    return { success: true }
  } catch (error: unknown) {
    console.error('Error in deleteCatalogItem:', error)
    return { error: getErrorMessage(error) }
  }
}

export async function recordPayment(formData: FormData) {
  try {
    const supabase = await createClient()
    const hasPermission = await checkUserPermission('invoices', 'edit')
    if (!hasPermission) {
      return { error: 'You do not have permission to record payments' }
    }

    const invoiceId = String(formData.get('invoiceId') || '').trim()
    const paymentDate = String(formData.get('paymentDate') || '').trim()
    const amountRaw = String(formData.get('amount') || '').trim()
    const amount = Number.parseFloat(amountRaw)
    const paymentMethod = String(formData.get('paymentMethod') || '').trim()
    const reference = String(formData.get('reference') || '').trim()
    const notes = String(formData.get('notes') || '').trim()

    if (!invoiceId || !paymentDate || !paymentMethod || !amountRaw) {
      return { error: 'Missing required fields' }
    }

    if (!Number.isFinite(amount) || amount <= 0) {
      return { error: 'Payment amount must be greater than zero' }
    }

    if (Number.isNaN(Date.parse(paymentDate))) {
      return { error: 'Payment date is invalid' }
    }

    const { data: invoiceBeforePayment, error: invoiceBeforeError } = await supabase
      .from('invoices')
      .select('status')
      .eq('id', invoiceId)
      .is('deleted_at', null)
      .maybeSingle()

    if (invoiceBeforeError || !invoiceBeforePayment) {
      return { error: invoiceBeforeError?.message || 'Invoice not found' }
    }

    const [payment, { data: { user } }] = await Promise.all([
      InvoiceService.recordPayment({
        invoice_id: invoiceId,
        amount,
        payment_date: paymentDate,
        payment_method: paymentMethod,
        reference: reference || undefined,
        notes: notes || undefined
      }),
      supabase.auth.getUser()
    ])

    await logAuditEvent({
      operation_type: 'create',
      resource_type: 'invoice_payment',
      resource_id: payment.id,
      operation_status: 'success',
      new_values: { 
        invoice_id: invoiceId,
        amount,
        payment_method: paymentMethod
      }
    })

    let remittanceAdvice: RemittanceAdviceResult | null = null
    const { data: invoiceAfterPayment, error: invoiceAfterError } = await supabase
      .from('invoices')
      .select('status')
      .eq('id', invoiceId)
      .is('deleted_at', null)
      .maybeSingle()

    if (invoiceAfterError) {
      console.error('Error checking invoice status after payment:', invoiceAfterError)
    } else if (
      invoiceBeforePayment.status !== 'paid' &&
      (invoiceAfterPayment?.status === 'paid' || invoiceAfterPayment?.status === 'partially_paid')
    ) {
      remittanceAdvice = await sendPaymentReceipt(invoiceId, payment.id, user?.id || null)
    }

    revalidatePath('/invoices')
    revalidatePath(`/invoices/${invoiceId}`)
    revalidateTag('dashboard')

    return { payment, success: true, remittanceAdvice }
  } catch (error: unknown) {
    console.error('Error in recordPayment:', error)
    return { error: getErrorMessage(error) }
  }
}

export async function voidInvoice(
  invoiceId: string,
  reason: string
): Promise<{ success?: boolean; error?: string }> {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { error: 'Unauthorized' }

    // Void requires delete permission on invoices
    const hasDeletePermission = await checkUserPermission('invoices', 'delete')
    if (!hasDeletePermission) {
      return { error: 'You do not have permission to void invoices' }
    }

    // Reversing OJ entries requires oj_projects manage permission
    const hasOjPermission = await checkUserPermission('oj_projects', 'manage')
    if (!hasOjPermission) {
      return { error: 'You do not have permission to manage OJ Projects entries (required for voiding)' }
    }

    if (!invoiceId || !reason.trim()) {
      return { error: 'Invoice ID and void reason are required' }
    }

    // Fetch the invoice
    const { data: invoice, error: fetchError } = await supabase
      .from('invoices')
      .select('id, invoice_number, status, paid_amount, internal_notes')
      .eq('id', invoiceId)
      .is('deleted_at', null)
      .single()

    if (fetchError || !invoice) {
      return { error: 'Invoice not found' }
    }

    if (invoice.status === 'void') {
      return { error: 'Invoice is already voided' }
    }

    // ABSOLUTE GUARD: Cannot void an invoice with any payments
    const paidAmount = Number(invoice.paid_amount || 0)
    if (paidAmount > 0) {
      return { error: 'Cannot void an invoice with payments. Issue a credit note instead.' }
    }

    const adminClient = createAdminClient()

    // Update invoice status to void and record reason in internal_notes
    const voidNote = `[VOIDED ${new Date().toISOString()}] Reason: ${reason.trim()}`
    const updatedNotes = invoice.internal_notes
      ? `${invoice.internal_notes}\n\n${voidNote}`
      : voidNote

    const { error: updateError } = await adminClient
      .from('invoices')
      .update({
        status: 'void',
        internal_notes: updatedNotes,
      })
      .eq('id', invoiceId)

    if (updateError) {
      return { error: updateError.message || 'Failed to void invoice' }
    }

    // Reverse linked oj_entries: set status back to 'unbilled', clear billing_run_id and invoice_id
    const { error: entriesError } = await adminClient
      .from('oj_entries')
      .update({
        status: 'unbilled',
        billing_run_id: null,
        invoice_id: null,
      })
      .eq('invoice_id', invoiceId)

    if (entriesError) {
      console.error('[Invoices] Failed to reverse OJ entries on void:', entriesError)
      // Continue — the invoice is already voided, log the issue
    }

    // Reverse linked oj_recurring_charge_instances: same treatment
    const { error: recurringError } = await adminClient
      .from('oj_recurring_charge_instances')
      .update({
        status: 'unbilled',
        billing_run_id: null,
        invoice_id: null,
      })
      .eq('invoice_id', invoiceId)

    if (recurringError) {
      console.error('[Invoices] Failed to reverse OJ recurring instances on void:', recurringError)
    }

    await logAuditEvent({
      user_id: user.id,
      user_email: user.email,
      operation_type: 'update',
      resource_type: 'invoice',
      resource_id: invoiceId,
      operation_status: 'success',
      old_values: { status: invoice.status },
      new_values: { status: 'void', void_reason: reason.trim() },
      additional_info: {
        action: 'void_invoice',
        invoice_number: invoice.invoice_number,
      },
    })

    revalidatePath('/invoices')
    revalidatePath(`/invoices/${invoiceId}`)
    revalidateTag('dashboard')

    return { success: true }
  } catch (error: unknown) {
    console.error('Error in voidInvoice:', error)
    return { error: getErrorMessage(error) }
  }
}

export async function createCreditNote(
  invoiceId: string,
  amountExVat: number,
  reason: string
): Promise<{ success?: boolean; creditNote?: { id: string; credit_note_number: string; amount_inc_vat: number }; error?: string }> {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { error: 'Unauthorized' }

    const hasPermission = await checkUserPermission('invoices', 'create')
    if (!hasPermission) {
      return { error: 'You do not have permission to create credit notes' }
    }

    if (!invoiceId || !reason.trim()) {
      return { error: 'Invoice ID and reason are required' }
    }

    if (!Number.isFinite(amountExVat) || amountExVat <= 0) {
      return { error: 'Credit note amount must be greater than zero' }
    }

    // Fetch the invoice to get vendor_id and VAT rate
    const { data: invoice, error: fetchError } = await supabase
      .from('invoices')
      .select('id, invoice_number, vendor_id, vat_amount, subtotal_amount, total_amount')
      .eq('id', invoiceId)
      .is('deleted_at', null)
      .single()

    if (fetchError || !invoice) {
      return { error: 'Invoice not found' }
    }

    // Derive VAT rate from the invoice totals
    const subtotal = Number(invoice.subtotal_amount || 0)
    const vatAmount = Number(invoice.vat_amount || 0)
    const vatRate = subtotal > 0 ? Math.round((vatAmount / subtotal) * 100 * 100) / 100 : 20

    // Calculate amount inc VAT
    const amountIncVat = Math.round((amountExVat * (1 + vatRate / 100)) * 100) / 100

    // Generate sequential credit note number: CN-{YYYY}-{NNN}
    const currentYear = new Date().getFullYear()
    const { data: maxCn, error: maxError } = await supabase
      .from('credit_notes')
      .select('credit_note_number')
      .ilike('credit_note_number', `CN-${currentYear}-%`)
      .order('credit_note_number', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (maxError) {
      return { error: 'Failed to generate credit note number' }
    }

    let nextSeq = 1
    if (maxCn?.credit_note_number) {
      const parts = maxCn.credit_note_number.split('-')
      const lastSeq = parseInt(parts[2], 10)
      if (Number.isFinite(lastSeq)) {
        nextSeq = lastSeq + 1
      }
    }

    const creditNoteNumber = `CN-${currentYear}-${String(nextSeq).padStart(3, '0')}`

    // Insert the credit note
    const { data: creditNote, error: insertError } = await supabase
      .from('credit_notes')
      .insert({
        credit_note_number: creditNoteNumber,
        invoice_id: invoiceId,
        vendor_id: invoice.vendor_id,
        amount_ex_vat: amountExVat,
        vat_rate: vatRate,
        amount_inc_vat: amountIncVat,
        reason: reason.trim(),
        status: 'issued',
        created_by: user.id,
      })
      .select('id, credit_note_number, amount_inc_vat')
      .single()

    if (insertError || !creditNote) {
      console.error('[Invoices] Failed to create credit note:', insertError)
      return { error: insertError?.message || 'Failed to create credit note' }
    }

    await logAuditEvent({
      user_id: user.id,
      user_email: user.email,
      operation_type: 'create',
      resource_type: 'credit_note',
      resource_id: creditNote.id,
      operation_status: 'success',
      new_values: {
        credit_note_number: creditNoteNumber,
        invoice_id: invoiceId,
        invoice_number: invoice.invoice_number,
        amount_ex_vat: amountExVat,
        amount_inc_vat: amountIncVat,
        reason: reason.trim(),
      },
    })

    revalidatePath('/invoices')
    revalidatePath(`/invoices/${invoiceId}`)
    revalidateTag('dashboard')

    return { success: true, creditNote }
  } catch (error: unknown) {
    console.error('Error in createCreditNote:', error)
    return { error: getErrorMessage(error) }
  }
}

export async function updateInvoice(formData: FormData) {
  try {
    const hasPermission = await checkUserPermission('invoices', 'edit')
    if (!hasPermission) {
      return { error: 'You do not have permission to edit invoices' }
    }

    const invoiceId = formData.get('invoiceId') as string
    if (!invoiceId) {
      return { error: 'Invoice ID is required' }
    }

    // Check if invoice exists and is draft
    const supabase = await createClient()
    const [{ data: { user } }, { data: existingInvoice, error: fetchError }] = await Promise.all([
      supabase.auth.getUser(),
      supabase
        .from('invoices')
        .select('id, status')
        .eq('id', invoiceId)
        .is('deleted_at', null)
        .single()
    ])
    if (!user) return { error: 'Unauthorized' }

    if (fetchError || !existingInvoice) {
      return { error: 'Invoice not found' }
    }

    if (existingInvoice.status !== 'draft') {
      return { error: 'Only draft invoices can be edited' }
    }

    // Validate the main invoice data
    const validatedData = CreateInvoiceSchema.parse({
      vendor_id: formData.get('vendor_id'),
      invoice_date: formData.get('invoice_date'),
      due_date: formData.get('due_date'),
      reference: formData.get('reference') || undefined,
      invoice_discount_percentage: parseFloat(formData.get('invoice_discount_percentage') as string) || 0,
      notes: formData.get('notes') || undefined,
      internal_notes: formData.get('internal_notes') || undefined
    })

    // Parse line items
    const lineItemsJson = formData.get('line_items') as string
    let lineItems: InvoiceLineItemInput[]
    try {
      const parsed: InvoiceLineItemInput[] = JSON.parse(lineItemsJson)
      lineItems = parsed.map((item) => ({
        catalog_item_id: item.catalog_item_id,
        description: item.description,
        quantity: Number(item.quantity) || 0,
        unit_price: Number(item.unit_price) || 0,
        discount_percentage: Number(item.discount_percentage) || 0,
        vat_rate: Number(item.vat_rate) || 0,
      }))
    } catch {
      return { error: 'Invalid line items data' }
    }

    if (!lineItems || lineItems.length === 0) {
      return { error: 'At least one line item is required' }
    }

    const updatedInvoice = await InvoiceService.updateInvoice(invoiceId, {
      ...validatedData,
      line_items: lineItems
    });

    await logAuditEvent({
      user_id: user.id,
      user_email: user.email,
      operation_type: 'update',
      resource_type: 'invoice',
      resource_id: invoiceId,
      operation_status: 'success',
      new_values: {
        invoice_number: updatedInvoice.invoice_number,
        total: updatedInvoice.total_amount
      }
    })

    revalidatePath('/invoices')
    revalidatePath(`/invoices/${invoiceId}`)
    
    return { invoice: updatedInvoice, success: true }
  } catch (error: unknown) {
    console.error('Error in updateInvoice:', error)
    if (error instanceof z.ZodError) {
      return { error: error.errors[0].message }
    }
    return { error: getErrorMessage(error) }
  }
}
