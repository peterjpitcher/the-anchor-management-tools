'use server'

import { randomUUID } from 'crypto'

import { createClient, createAdminClient } from '@/lib/supabase/server'
import { checkUserPermission } from '@/app/actions/rbac'
import { logAuditEvent } from './audit'
import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { getTodayIsoDate } from '@/lib/dateUtils'
import type {
  Invoice,
  InvoiceWithDetails,
  InvoiceStatus,
  InvoiceLineItemInput,
  LineItemCatalogItem
} from '@/types/invoices'
import { calculateInvoiceTotals } from '@/lib/invoiceCalculations'

// Invoice validation schema
const CreateInvoiceSchema = z.object({
  vendor_id: z.string().uuid('Invalid vendor ID'),
  invoice_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format'),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format'),
  reference: z.string().optional(),
  invoice_discount_percentage: z.number().min(0).max(100).default(0),
  notes: z.string().optional(),
  internal_notes: z.string().optional()
})

type CreateInvoiceResult = { error: string } | { success: true; invoice: Invoice }

// Get next invoice number from series
async function getNextInvoiceNumber(seriesCode: string): Promise<string> {
  const adminClient = await createAdminClient()
  
  // Get and increment the sequence atomically using the database function
  const { data, error } = await adminClient
    .rpc('get_and_increment_invoice_series', { p_series_code: seriesCode })
    .single()

  if (error) {
    console.error('Error getting next invoice number:', error)
    throw new Error('Failed to generate invoice number')
  }

  // Encode the sequential number to appear non-sequential
  // Add 5000 to avoid low numbers, convert to base-36, uppercase, and pad
  const encoded = ((data as { next_sequence: number }).next_sequence + 5000).toString(36).toUpperCase().padStart(5, '0')
  
  return `${seriesCode}-${encoded}`
}

async function persistOverdueInvoices() {
  try {
    const adminClient = await createAdminClient()
    const today = getTodayIsoDate()

    const { error } = await adminClient
      .from('invoices')
      .update({
        status: 'overdue' as InvoiceStatus,
        updated_at: new Date().toISOString(),
      })
      .lte('due_date', today)
      .eq('status', 'sent')
      .is('deleted_at', null)

    if (error) {
      console.error('Error persisting overdue invoices:', error)
    }
  } catch (error) {
    console.error('Unexpected error while persisting overdue invoices:', error)
  }
}

export async function getInvoices(status?: InvoiceStatus | 'unpaid') {
  try {
    const supabase = await createClient()
    
    const hasPermission = await checkUserPermission('invoices', 'view')
    if (!hasPermission) {
      return { error: 'You do not have permission to view invoices' }
    }

    await persistOverdueInvoices()

    let query = supabase
      .from('invoices')
      .select(`
        *,
        vendor:invoice_vendors(*)
      `)
      .is('deleted_at', null)
      .order('invoice_date', { ascending: false })

    if (status === 'unpaid') {
      // Filter for all unpaid invoices (not paid, not void, not written off)
      query = query.in('status', ['draft', 'sent', 'partially_paid', 'overdue'])
    } else if (status) {
      query = query.eq('status', status)
    }

    const { data: invoices, error } = await query

    if (error) {
      console.error('Error fetching invoices:', error)
      return { error: 'Failed to fetch invoices' }
    }

    const today = getTodayIsoDate()
    const normalizedInvoices = invoices.map((invoice) => ({
      ...invoice,
      status:
        invoice.status === 'sent' && invoice.due_date < today
          ? ('overdue' as InvoiceStatus)
          : invoice.status,
    }))

    return { invoices: normalizedInvoices as InvoiceWithDetails[] }
  } catch (error) {
    console.error('Error in getInvoices:', error)
    return { error: 'An unexpected error occurred' }
  }
}

export async function getInvoice(invoiceId: string) {
  try {
    const supabase = await createClient()
    
    const hasPermission = await checkUserPermission('invoices', 'view')
    if (!hasPermission) {
      return { error: 'You do not have permission to view invoices' }
    }

    await persistOverdueInvoices()

    const { data: invoice, error } = await supabase
      .from('invoices')
      .select(`
        *,
        vendor:invoice_vendors(*),
        line_items:invoice_line_items(*),
        payments:invoice_payments(*)
      `)
      .eq('id', invoiceId)
      .is('deleted_at', null)
      .single()

    if (error) {
      console.error('Error fetching invoice:', error)
      return { error: 'Failed to fetch invoice' }
    }

    const today = getTodayIsoDate()
    const normalized =
      invoice.status === 'sent' && invoice.due_date < today
        ? { ...invoice, status: 'overdue' as InvoiceStatus }
        : invoice

    return { invoice: normalized as InvoiceWithDetails }
  } catch (error) {
    console.error('Error in getInvoice:', error)
    return { error: 'An unexpected error occurred' }
  }
}

export async function createInvoice(formData: FormData): Promise<CreateInvoiceResult> {
  try {
    const supabase = await createClient()
    
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

    const totals = calculateInvoiceTotals(lineItems, validatedData.invoice_discount_percentage)

    // Get next invoice number
    let invoiceNumber: string
    try {
      invoiceNumber = await getNextInvoiceNumber('INV')
    } catch (error) {
      console.error('Failed to generate invoice number:', error)
      // Fallback to UUID-based number to avoid collisions
      invoiceNumber = `INV-${randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase()}`
    }

    // Create invoice
    const { data: invoice, error: invoiceError } = await supabase
      .from('invoices')
      .insert({
        invoice_number: invoiceNumber,
        vendor_id: validatedData.vendor_id,
        invoice_date: validatedData.invoice_date,
        due_date: validatedData.due_date,
        reference: validatedData.reference,
        invoice_discount_percentage: validatedData.invoice_discount_percentage,
        subtotal_amount: totals.subtotalBeforeInvoiceDiscount,
        discount_amount: totals.invoiceDiscountAmount,
        vat_amount: totals.vatAmount,
        total_amount: totals.totalAmount,
        notes: validatedData.notes,
        internal_notes: validatedData.internal_notes,
        status: 'draft' as InvoiceStatus
      })
      .select()
      .single()

    if (invoiceError) {
      console.error('Error creating invoice:', invoiceError)
      return { error: 'Failed to create invoice' }
    }

    // Create line items
    const lineItemsToInsert = lineItems.map(item => ({
      invoice_id: invoice.id,
      catalog_item_id: item.catalog_item_id || null,
      description: item.description,
      quantity: item.quantity,
      unit_price: item.unit_price,
      discount_percentage: item.discount_percentage,
      vat_rate: item.vat_rate
      // Note: subtotal_amount, discount_amount, vat_amount, and total_amount are GENERATED columns
      // and will be automatically calculated by the database
    }))

    const { error: lineItemsError } = await supabase
      .from('invoice_line_items')
      .insert(lineItemsToInsert)

    if (lineItemsError) {
      console.error('Error creating line items:', lineItemsError)
      // Rollback invoice creation
      await supabase.from('invoices').delete().eq('id', invoice.id)
      return { error: 'Failed to create invoice line items' }
    }

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
    
    return { success: true, invoice }
  } catch (error) {
    console.error('Error in createInvoice:', error)
    if (error instanceof z.ZodError) {
      return { error: error.errors[0].message }
    }
    return { error: 'An unexpected error occurred' }
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

    if (!invoiceId || !newStatus) {
      return { error: 'Invoice ID and status are required' }
    }

    // Get current invoice
    const { data: currentInvoice, error: fetchError } = await supabase
      .from('invoices')
      .select('*')
      .eq('id', invoiceId)
      .single()

    if (fetchError || !currentInvoice) {
      return { error: 'Invoice not found' }
    }

    // Update status and paid amount if marking as paid
    const updates: any = {
      status: newStatus,
      updated_at: new Date().toISOString()
    }

    if (newStatus === 'paid') {
      updates.paid_amount = currentInvoice.total_amount
    }

    const { error: updateError } = await supabase
      .from('invoices')
      .update(updates)
      .eq('id', invoiceId)

    if (updateError) {
      console.error('Error updating invoice status:', updateError)
      return { error: 'Failed to update invoice status' }
    }

    await logAuditEvent({
      operation_type: 'update',
      resource_type: 'invoice',
      resource_id: invoiceId,
      operation_status: 'success',
      old_values: { status: currentInvoice.status },
      new_values: { status: newStatus },
      additional_info: { invoice_number: currentInvoice.invoice_number }
    })

    revalidatePath('/invoices')
    revalidatePath(`/invoices/${invoiceId}`)
    
    return { success: true }
  } catch (error) {
    console.error('Error in updateInvoiceStatus:', error)
    return { error: 'An unexpected error occurred' }
  }
}

export async function deleteInvoice(formData: FormData) {
  try {
    const supabase = await createClient()
    
    const hasPermission = await checkUserPermission('invoices', 'delete')
    if (!hasPermission) {
      return { error: 'You do not have permission to delete invoices' }
    }

    const invoiceId = formData.get('invoiceId') as string
    if (!invoiceId) {
      return { error: 'Invoice ID is required' }
    }

    // Get invoice details for audit log
    const { data: invoice, error: fetchError } = await supabase
      .from('invoices')
      .select('invoice_number, status')
      .eq('id', invoiceId)
      .single()

    if (fetchError || !invoice) {
      return { error: 'Invoice not found' }
    }

    // Only allow deletion of draft invoices
    if (invoice.status !== 'draft') {
      return { error: 'Only draft invoices can be deleted' }
    }

    // Soft delete
    const { error: deleteError } = await supabase
      .from('invoices')
      .update({ 
        deleted_at: new Date().toISOString(),
        deleted_by: (await supabase.auth.getUser()).data.user?.id
      })
      .eq('id', invoiceId)

    if (deleteError) {
      console.error('Error deleting invoice:', deleteError)
      return { error: 'Failed to delete invoice' }
    }

    await logAuditEvent({
      operation_type: 'delete',
      resource_type: 'invoice',
      resource_id: invoiceId,
      operation_status: 'success',
      additional_info: { invoice_number: invoice.invoice_number }
    })

    revalidatePath('/invoices')
    
    return { success: true }
  } catch (error) {
    console.error('Error in deleteInvoice:', error)
    return { error: 'An unexpected error occurred' }
  }
}

export async function getInvoiceSummary() {
  try {
    const supabase = await createClient()
    
    const hasPermission = await checkUserPermission('invoices', 'view')
    if (!hasPermission) {
      return { error: 'You do not have permission to view invoice summary' }
    }

    // Use the database function to get summary stats
    const { data, error } = await supabase
      .rpc('get_invoice_summary_stats')
      .single()

    if (error) {
      console.error('Error fetching invoice summary:', error)
      return { error: 'Failed to fetch invoice summary' }
    }

    const summary = data as {
      total_outstanding: number
      total_overdue: number
      total_this_month: number
      count_draft: number
    }

    return { 
      summary: {
        total_outstanding: summary.total_outstanding || 0,
        total_overdue: summary.total_overdue || 0,
        total_this_month: summary.total_this_month || 0,
        count_draft: summary.count_draft || 0
      }
    }
  } catch (error) {
    console.error('Error in getInvoiceSummary:', error)
    return { error: 'An unexpected error occurred' }
  }
}

export async function getLineItemCatalog() {
  try {
    const supabase = await createClient()
    
    const hasPermission = await checkUserPermission('invoices', 'view')
    if (!hasPermission) {
      return { error: 'You do not have permission to view line items' }
    }

    const { data: items, error } = await supabase
      .from('line_item_catalog')
      .select('*')
      .eq('is_active', true)
      .order('name')

    if (error) {
      console.error('Error fetching line item catalog:', error)
      return { error: 'Failed to fetch line items' }
    }

    return { items: items as LineItemCatalogItem[] }
  } catch (error) {
    console.error('Error in getLineItemCatalog:', error)
    return { error: 'An unexpected error occurred' }
  }
}

export async function createCatalogItem(formData: FormData) {
  try {
    const supabase = await createClient()
    
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

    const { data: item, error } = await supabase
      .from('line_item_catalog')
      .insert({
        name,
        description: description || null,
        default_price,
        default_vat_rate,
        is_active: true
      })
      .select()
      .single()

    if (error) {
      console.error('Error creating catalog item:', error)
      return { error: 'Failed to create catalog item' }
    }

    await logAuditEvent({
      operation_type: 'create',
      resource_type: 'line_item_catalog',
      resource_id: item.id,
      operation_status: 'success',
      new_values: { name }
    })

    revalidatePath('/invoices/catalog')
    
    return { item, success: true }
  } catch (error) {
    console.error('Error in createCatalogItem:', error)
    return { error: 'An unexpected error occurred' }
  }
}

export async function updateCatalogItem(formData: FormData) {
  try {
    const supabase = await createClient()
    
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

    const { data: item, error } = await supabase
      .from('line_item_catalog')
      .update({
        name,
        description: description || null,
        default_price,
        default_vat_rate,
        updated_at: new Date().toISOString()
      })
      .eq('id', itemId)
      .select()
      .single()

    if (error) {
      console.error('Error updating catalog item:', error)
      return { error: 'Failed to update catalog item' }
    }

    await logAuditEvent({
      operation_type: 'update',
      resource_type: 'line_item_catalog',
      resource_id: item.id,
      operation_status: 'success',
      new_values: { name }
    })

    revalidatePath('/invoices/catalog')
    
    return { item, success: true }
  } catch (error) {
    console.error('Error in updateCatalogItem:', error)
    return { error: 'An unexpected error occurred' }
  }
}

export async function deleteCatalogItem(formData: FormData) {
  try {
    const supabase = await createClient()
    
    const hasPermission = await checkUserPermission('invoices', 'manage')
    if (!hasPermission) {
      return { error: 'You do not have permission to manage catalog items' }
    }

    const itemId = formData.get('itemId') as string
    if (!itemId) {
      return { error: 'Item ID is required' }
    }

    // Soft delete by marking as inactive
    const { error } = await supabase
      .from('line_item_catalog')
      .update({
        is_active: false,
        updated_at: new Date().toISOString()
      })
      .eq('id', itemId)

    if (error) {
      console.error('Error deleting catalog item:', error)
      return { error: 'Failed to delete catalog item' }
    }

    await logAuditEvent({
      operation_type: 'delete',
      resource_type: 'line_item_catalog',
      resource_id: itemId,
      operation_status: 'success'
    })

    revalidatePath('/invoices/catalog')
    
    return { success: true }
  } catch (error) {
    console.error('Error in deleteCatalogItem:', error)
    return { error: 'An unexpected error occurred' }
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

    // Get current invoice
    const { data: invoice, error: fetchError } = await supabase
      .from('invoices')
      .select('*')
      .eq('id', invoiceId)
      .single()

    if (fetchError || !invoice) {
      return { error: 'Invoice not found' }
    }

    // Validate payment amount
    const outstanding = invoice.total_amount - invoice.paid_amount
    if (amount > outstanding) {
      return { error: 'Payment amount exceeds outstanding balance' }
    }

    // Record payment
    const { data: payment, error: paymentError } = await supabase
      .from('invoice_payments')
      .insert({
        invoice_id: invoiceId,
        payment_date: paymentDate,
        amount,
        payment_method: paymentMethod,
        reference: reference || null,
        notes: notes || null
      })
      .select()
      .single()

    if (paymentError) {
      console.error('Error recording payment:', paymentError)
      return { error: 'Failed to record payment' }
    }

    // Update invoice paid amount and status
    const newPaidAmount = invoice.paid_amount + amount
    let newStatus: InvoiceStatus = invoice.status

    if (newPaidAmount >= invoice.total_amount) {
      newStatus = 'paid'
    } else if (newPaidAmount > 0 && invoice.status !== 'void' && invoice.status !== 'written_off') {
      newStatus = 'partially_paid'
    }

    const { error: updateError } = await supabase
      .from('invoices')
      .update({
        paid_amount: newPaidAmount,
        status: newStatus,
        updated_at: new Date().toISOString()
      })
      .eq('id', invoiceId)

    if (updateError) {
      console.error('Error updating invoice:', updateError)
      // Try to rollback payment
      await supabase.from('invoice_payments').delete().eq('id', payment.id)
      return { error: 'Failed to update invoice' }
    }

    await logAuditEvent({
      operation_type: 'create',
      resource_type: 'invoice_payment',
      resource_id: payment.id,
      operation_status: 'success',
      new_values: { 
        invoice_id: invoiceId,
        amount,
        payment_method: paymentMethod,
        new_status: newStatus
      }
    })

    revalidatePath('/invoices')
    revalidatePath(`/invoices/${invoiceId}`)
    
    return { payment, success: true }
  } catch (error) {
    console.error('Error in recordPayment:', error)
    return { error: 'An unexpected error occurred' }
  }
}

export async function updateInvoice(formData: FormData) {
  try {
    const supabase = await createClient()
    
    const hasPermission = await checkUserPermission('invoices', 'edit')
    if (!hasPermission) {
      return { error: 'You do not have permission to edit invoices' }
    }

    const invoiceId = formData.get('invoiceId') as string
    if (!invoiceId) {
      return { error: 'Invoice ID is required' }
    }

    // Check if invoice exists and is draft
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

    const totals = calculateInvoiceTotals(lineItems, validatedData.invoice_discount_percentage)

    // Perform atomic update using admin client RPC
    const adminClient = await createAdminClient()
    const payload = {
      p_invoice_id: invoiceId,
      p_invoice_data: {
        vendor_id: validatedData.vendor_id,
        invoice_date: validatedData.invoice_date,
        due_date: validatedData.due_date,
        reference: validatedData.reference ?? null,
        invoice_discount_percentage: validatedData.invoice_discount_percentage,
        subtotal_amount: totals.subtotalBeforeInvoiceDiscount,
        discount_amount: totals.invoiceDiscountAmount,
        vat_amount: totals.vatAmount,
        total_amount: totals.totalAmount,
        notes: validatedData.notes ?? null,
        internal_notes: validatedData.internal_notes ?? null
      },
      p_line_items: lineItems.map(item => ({
        catalog_item_id: item.catalog_item_id || null,
        description: item.description,
        quantity: item.quantity,
        unit_price: item.unit_price,
        discount_percentage: item.discount_percentage,
        vat_rate: item.vat_rate
      }))
    }

    const { data: updatedInvoice, error: updateError } = await adminClient.rpc(
      'update_invoice_with_line_items',
      payload
    )

    if (updateError) {
      console.error('Error updating invoice via RPC:', updateError)
      return { error: 'Failed to update invoice' }
    }

    await logAuditEvent({
      operation_type: 'update',
      resource_type: 'invoice',
      resource_id: invoiceId,
      operation_status: 'success',
      new_values: { 
        invoice_number: updatedInvoice.invoice_number,
        total: totals.totalAmount
      }
    })

    revalidatePath('/invoices')
    revalidatePath(`/invoices/${invoiceId}`)
    
    return { invoice: updatedInvoice, success: true }
  } catch (error) {
    console.error('Error in updateInvoice:', error)
    if (error instanceof z.ZodError) {
      return { error: error.errors[0].message }
    }
    return { error: 'An unexpected error occurred' }
  }
}
