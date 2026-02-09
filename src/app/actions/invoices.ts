'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { checkUserPermission } from '@/app/actions/rbac'
import { logAuditEvent } from './audit'
import { isGraphConfigured, sendInvoiceEmail } from '@/lib/microsoft-graph'
import { z } from 'zod'
import { revalidatePath, revalidateTag } from 'next/cache'
import type {
  Invoice,
  InvoiceWithDetails,
  InvoiceStatus,
  InvoiceLineItemInput,
  LineItemCatalogItem
} from '@/types/invoices'
import { InvoiceService, CreateInvoiceSchema } from '@/services/invoices'

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
    return { error: error.message || 'Failed to resolve invoice recipients' }
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

async function sendRemittanceAdviceForPaidInvoice(
  invoiceId: string,
  sentByUserId?: string | null
): Promise<RemittanceAdviceResult> {
  if (!isGraphConfigured()) {
    return { sent: false, skippedReason: 'email_not_configured' }
  }

  let invoice: InvoiceWithDetails
  try {
    invoice = await InvoiceService.getInvoiceById(invoiceId)
  } catch (error: any) {
    const message = error?.message || 'Failed to load invoice for remittance advice'
    console.error('[Invoices] Remittance advice aborted:', message)
    return { sent: false, skippedReason: 'invoice_lookup_failed', error: message }
  }

  if (invoice.status !== 'paid') {
    return { sent: false, skippedReason: 'invoice_not_paid' }
  }

  const supabase = await createClient()
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

  const latestPayment = (invoice.payments || [])
    .slice()
    .sort((a, b) => {
      const aDate = new Date(a.payment_date || a.created_at || 0).getTime()
      const bDate = new Date(b.payment_date || b.created_at || 0).getTime()
      return bDate - aDate
    })[0]

  const paymentAmount = latestPayment?.amount ?? invoice.paid_amount
  const paymentDate = formatDateForEmail(latestPayment?.payment_date || null)
  const paymentMethod = formatPaymentMethodForEmail(latestPayment?.payment_method || null)
  const outstandingBalance = Math.max(0, invoice.total_amount - invoice.paid_amount)
  const recipientName = invoice.vendor?.contact_name || invoice.vendor?.name || 'there'

  const subject = `Remittance Advice: Invoice ${invoice.invoice_number} (Paid)`
  const body = `Hi ${recipientName},

I hope you're doing well!

This is a remittance advice confirming payment has been received for invoice ${invoice.invoice_number}.

Invoice Total: ${formatCurrencyForEmail(invoice.total_amount)}
Payment Received: ${formatCurrencyForEmail(paymentAmount)}
Total Paid: ${formatCurrencyForEmail(invoice.paid_amount)}
Outstanding Balance: ${formatCurrencyForEmail(outstandingBalance)}
Payment Date: ${paymentDate}
${paymentMethod ? `Payment Method: ${paymentMethod}` : ''}
${latestPayment?.reference ? `Reference: ${latestPayment.reference}` : ''}

If you have any questions, just let me know.

Many thanks,
Peter Pitcher
Orange Jelly Limited
07995087315`

  const emailResult = await sendInvoiceEmail(
    invoice,
    toAddress,
    subject,
    body,
    ccAddresses,
    undefined,
    {
      documentKind: 'remittance_advice',
      remittance: {
        paymentDate: latestPayment?.payment_date || null,
        paymentAmount: paymentAmount,
        paymentMethod: latestPayment?.payment_method || null,
        paymentReference: latestPayment?.reference || null,
      },
    }
  )

  const recipients = [toAddress, ...ccAddresses]

  if (emailResult.success) {
    const { error: logError } = await supabase.from('invoice_email_logs').insert(
      recipients.map((address) => ({
        invoice_id: invoiceId,
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
        action: 'remittance_advice_sent',
        invoice_number: invoice.invoice_number,
        recipient: toAddress,
        cc: ccAddresses,
        remittance_test_override: forcedRecipient
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

  const errorMessage = emailResult.error || 'Failed to send remittance advice'
  const { error: failedLogError } = await supabase.from('invoice_email_logs').insert({
    invoice_id: invoiceId,
    sent_to: toAddress,
    sent_by: sentByUserId || null,
    subject,
    body,
    status: 'failed',
    error_message: errorMessage,
  })

  if (failedLogError) {
    console.error('[Invoices] Failed to write remittance failure log:', failedLogError)
  }

  await logAuditEvent({
    operation_type: 'send',
    resource_type: 'invoice',
    resource_id: invoiceId,
    operation_status: 'failure',
    error_message: errorMessage,
    additional_info: {
      action: 'remittance_advice_send_failed',
      invoice_number: invoice.invoice_number,
      recipient: toAddress,
      cc: ccAddresses,
      remittance_test_override: forcedRecipient
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
  } catch (error: any) {
    console.error('Error in getInvoices:', error)
    return { error: error.message || 'An unexpected error occurred' }
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
  } catch (error: any) {
    console.error('Error in getInvoice:', error)
    return { error: error.message || 'An unexpected error occurred' }
  }
}

export async function createInvoice(formData: FormData): Promise<CreateInvoiceResult> {
  try {
    const hasPermission = await checkUserPermission('invoices', 'create')
    if (!hasPermission) {
      return { error: 'You do not have permission to create invoices' }
    }

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

    const rawLineItems: InvoiceLineItemInput[] = JSON.parse(lineItemsJson)
    const lineItems: InvoiceLineItemInput[] = rawLineItems.map((item) => ({
      catalog_item_id: item.catalog_item_id,
      description: item.description,
      quantity: Number(item.quantity) || 0,
      unit_price: Number(item.unit_price) || 0,
      discount_percentage: Number(item.discount_percentage) || 0,
      vat_rate: Number(item.vat_rate) || 0,
    }))
    if (!Array.isArray(lineItems) || lineItems.length === 0) {
      return { error: 'At least one line item is required' }
    }

    const invoice = await InvoiceService.createInvoice({
      ...validatedData,
      line_items: lineItems
    });

    await logAuditEvent({
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
    revalidatePath('/dashboard')
    
    return { success: true, invoice }
  } catch (error: any) {
    console.error('Error in createInvoice:', error)
    if (error instanceof z.ZodError) {
      return { error: error.errors[0].message }
    }
    return { error: error.message || 'An unexpected error occurred' }
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
    const newStatus = formData.get('status') as InvoiceStatus
    const force = String(formData.get('force') || '') === 'true'

    if (!invoiceId || !newStatus) {
      return { error: 'Invoice ID and status are required' }
    }

    // Prevent voiding invoices that have linked OJ Projects items, unless explicitly overridden.
    if (newStatus === 'void' && !force) {
      const adminClient = createAdminClient()

      const { count: entryCount, error: entryError } = await adminClient
        .from('oj_entries')
        .select('id', { count: 'exact', head: true })
        .eq('invoice_id', invoiceId)

      if (entryError) {
        return { error: entryError.message || 'Failed to check linked OJ Projects entries' }
      }

      const { count: recurringCount, error: recurringError } = await adminClient
        .from('oj_recurring_charge_instances')
        .select('id', { count: 'exact', head: true })
        .eq('invoice_id', invoiceId)

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

    const { updatedInvoice, oldStatus } = await InvoiceService.updateInvoiceStatus(invoiceId, newStatus)
    const { data: { user } } = await supabase.auth.getUser()

    await logAuditEvent({
      operation_type: 'update',
      resource_type: 'invoice',
      resource_id: invoiceId,
      operation_status: 'success',
      old_values: { status: oldStatus },
      new_values: { status: newStatus },
      additional_info: { invoice_number: updatedInvoice.invoice_number }
    })

    let remittanceAdvice: RemittanceAdviceResult | null = null
    if (newStatus === 'paid' && oldStatus !== 'paid') {
      remittanceAdvice = await sendRemittanceAdviceForPaidInvoice(invoiceId, user?.id || null)
    }

    revalidatePath('/invoices')
    revalidatePath(`/invoices/${invoiceId}`)
    revalidateTag('dashboard')
    revalidatePath('/dashboard')
    
    return { success: true, remittanceAdvice }
  } catch (error: any) {
    console.error('Error in updateInvoiceStatus:', error)
    return { error: error.message || 'An unexpected error occurred' }
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
    revalidatePath('/dashboard')
    
    return { success: true }
  } catch (error: any) {
    console.error('Error in deleteInvoice:', error)
    return { error: error.message || 'An unexpected error occurred' }
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
  } catch (error: any) {
    console.error('Error in getInvoiceSummary:', error)
    return { error: error.message || 'An unexpected error occurred' }
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
  } catch (error: any) {
    console.error('Error fetching line item catalog:', error)
    return { error: error.message || 'An unexpected error occurred' }
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
  } catch (error: any) {
    console.error('Error in createCatalogItem:', error)
    return { error: error.message || 'An unexpected error occurred' }
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
  } catch (error: any) {
    console.error('Error in updateCatalogItem:', error)
    return { error: error.message || 'An unexpected error occurred' }
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
  } catch (error: any) {
    console.error('Error in deleteCatalogItem:', error)
    return { error: error.message || 'An unexpected error occurred' }
  }
}

export async function recordPayment(formData: FormData) {
  try {
    const supabase = await createClient()
    const hasPermission = await checkUserPermission('invoices', 'edit')
    if (!hasPermission) {
      return { error: 'You do not have permission to record payments' }
    }

    const invoiceId = formData.get('invoiceId') as string
    const paymentDate = formData.get('paymentDate') as string
    const amount = parseFloat(formData.get('amount') as string)
    const paymentMethod = formData.get('paymentMethod') as string
    const reference = formData.get('reference') as string
    const notes = formData.get('notes') as string

    if (!invoiceId || !paymentDate || !amount || !paymentMethod) {
      return { error: 'Missing required fields' }
    }

    const payment = await InvoiceService.recordPayment({
      invoice_id: invoiceId,
      amount,
      payment_date: paymentDate,
      payment_method: paymentMethod,
      reference: reference || undefined,
      notes: notes || undefined
    });
    const { data: { user } } = await supabase.auth.getUser()

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

    const remittanceAdvice = await sendRemittanceAdviceForPaidInvoice(invoiceId, user?.id || null)

    revalidatePath('/invoices')
    revalidatePath(`/invoices/${invoiceId}`)
    
    return { payment, success: true, remittanceAdvice }
  } catch (error: any) {
    console.error('Error in recordPayment:', error)
    return { error: error.message || 'An unexpected error occurred' }
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
    const supabase = await createClient() // Needed for existingInvoice check
    const { data: existingInvoice, error: fetchError } = await supabase
      .from('invoices')
      .select('*')
      .eq('id', invoiceId)
      .single()

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
  } catch (error: any) {
    console.error('Error in updateInvoice:', error)
    if (error instanceof z.ZodError) {
      return { error: error.errors[0].message }
    }
    return { error: error.message || 'An unexpected error occurred' }
  }
}
