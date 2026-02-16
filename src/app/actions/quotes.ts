'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { checkUserPermission } from '@/app/actions/rbac'
import { logAuditEvent } from './audit'
import { z } from 'zod'
import { revalidatePath, revalidateTag } from 'next/cache'
import { getTodayIsoDate, getLocalIsoDateDaysAhead, toLocalIsoDate } from '@/lib/dateUtils'
import { calculateInvoiceTotals } from '@/lib/invoiceCalculations'
import { QuoteService, isQuoteStatusTransitionAllowed } from '@/services/quotes'
import type { 
  Quote, 
  QuoteWithDetails, 
  QuoteStatus,
  QuoteLineItem,
  InvoiceLineItemInput
} from '@/types/invoices'

// Quote validation schema
const CreateQuoteSchema = z.object({
  vendor_id: z.string().uuid('Invalid vendor ID'),
  quote_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format'),
  valid_until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format'),
  reference: z.string().optional(),
  quote_discount_percentage: z.number().min(0).max(100).default(0),
  notes: z.string().optional(),
  internal_notes: z.string().optional()
})

function normalizeQuoteLineItems(lineItems: InvoiceLineItemInput[]): InvoiceLineItemInput[] {
  return lineItems.map((item) => ({
    catalog_item_id: item.catalog_item_id || undefined,
    description: String(item.description || ''),
    quantity: Number(item.quantity) || 0,
    unit_price: Number(item.unit_price) || 0,
    discount_percentage: Number(item.discount_percentage) || 0,
    vat_rate: Number(item.vat_rate) || 0,
  }))
}

function isSoftDeletedRecord(record: Record<string, unknown> | null | undefined): boolean {
  if (!record) return false
  if (!Object.prototype.hasOwnProperty.call(record, 'deleted_at')) return false
  return Boolean((record as any).deleted_at)
}

// Get quote summary
export async function getQuoteSummary() {
  try {
    const supabase = await createClient()
    
    // Check permissions
    const hasPermission = await checkUserPermission('invoices', 'view')
    if (!hasPermission) {
      return { error: 'You do not have permission to view quotes' }
    }

    // Get all quotes for summary
    const { data: quotes, error } = await supabase
      .from('quotes')
      .select('status, total_amount, valid_until')
      .is('deleted_at', null)

    if (error) {
      console.error('Error fetching quote summary:', error)
      return { error: 'Failed to fetch quote summary' }
    }

    // Calculate summary
    const summary = {
      total_pending: 0,
      total_expired: 0,
      total_accepted: 0,
      draft_badge: 0
    }

    const today = new Date()
    today.setHours(0, 0, 0, 0)

    const visibleQuotes = (quotes || []).filter((quote: any) => !isSoftDeletedRecord(quote as Record<string, unknown>))

    visibleQuotes.forEach(quote => {
      if (quote.status === 'draft') {
        summary.draft_badge++
      } else if (quote.status === 'sent') {
        const validUntil = new Date(quote.valid_until)
        if (validUntil < today) {
          summary.total_expired += quote.total_amount
        } else {
          summary.total_pending += quote.total_amount
        }
      } else if (quote.status === 'accepted') {
        summary.total_accepted += quote.total_amount
      }
    })

    return { summary }
  } catch (error) {
    console.error('Error in getQuoteSummary:', error)
    return { error: 'An unexpected error occurred' }
  }
}

export async function getQuotes(status?: QuoteStatus) {
  try {
    const supabase = await createClient()
    
    const hasPermission = await checkUserPermission('invoices', 'view')
    if (!hasPermission) {
      return { error: 'You do not have permission to view quotes' }
    }

    let query = supabase
      .from('quotes')
      .select(`
        *,
        vendor:invoice_vendors(*),
        converted_invoice:invoices(id, invoice_number)
      `)
      .order('quote_date', { ascending: false })

    if (status) {
      query = query.eq('status', status)
    }

    const { data: quotes, error } = await query

    if (error) {
      console.error('Error fetching quotes:', error)
      return { error: 'Failed to fetch quotes' }
    }

    const visibleQuotes = (quotes || []).filter((quote: any) => !isSoftDeletedRecord(quote as Record<string, unknown>))

    // Update expired status for sent quotes
    const today = getTodayIsoDate()
    const updatedQuotes = visibleQuotes.map(quote => ({
      ...quote,
      status: quote.status === 'sent' && quote.valid_until < today ? 'expired' as QuoteStatus : quote.status
    }))

    return { quotes: updatedQuotes as QuoteWithDetails[] }
  } catch (error) {
    console.error('Error in getQuotes:', error)
    return { error: 'An unexpected error occurred' }
  }
}

export async function getQuote(quoteId: string) {
  try {
    const supabase = await createClient()
    
    const hasPermission = await checkUserPermission('invoices', 'view')
    if (!hasPermission) {
      return { error: 'You do not have permission to view quotes' }
    }

    const { data: quote, error } = await supabase
      .from('quotes')
      .select(`
        *,
        vendor:invoice_vendors(*),
        line_items:quote_line_items(*),
        converted_invoice:invoices(id, invoice_number)
      `)
      .eq('id', quoteId)
      .single()

    if (error) {
      console.error('Error fetching quote:', error)
      return { error: 'Failed to fetch quote' }
    }

    if (isSoftDeletedRecord(quote as Record<string, unknown>)) {
      return { error: 'Quote not found' }
    }

    // Update expired status if needed
    const today = getTodayIsoDate()
    if (quote.status === 'sent' && quote.valid_until < today) {
      quote.status = 'expired' as QuoteStatus
    }

    return { quote: quote as QuoteWithDetails }
  } catch (error) {
    console.error('Error in getQuote:', error)
    return { error: 'An unexpected error occurred' }
  }
}

export async function createQuote(formData: FormData) {
  try {
    const hasPermission = await checkUserPermission('invoices', 'create')
    if (!hasPermission) {
      return { error: 'You do not have permission to create quotes' }
    }

    // Parse and validate form data
    const validatedData = CreateQuoteSchema.parse({
      vendor_id: formData.get('vendor_id'),
      quote_date: formData.get('quote_date'),
      valid_until: formData.get('valid_until'),
      reference: formData.get('reference') || undefined,
      quote_discount_percentage: parseFloat(formData.get('quote_discount_percentage') as string) || 0,
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
      lineItems = normalizeQuoteLineItems(JSON.parse(lineItemsJson))
    } catch {
      return { error: 'Invalid line items data' }
    }

    if (!Array.isArray(lineItems) || lineItems.length === 0) {
      return { error: 'At least one line item is required' }
    }

    const quote = await QuoteService.createQuote({
        vendor_id: validatedData.vendor_id,
        quote_date: validatedData.quote_date,
        valid_until: validatedData.valid_until,
        reference: validatedData.reference,
        quote_discount_percentage: validatedData.quote_discount_percentage,
        notes: validatedData.notes,
        internal_notes: validatedData.internal_notes,
        line_items: lineItems
      })

    await logAuditEvent({
      operation_type: 'create',
      resource_type: 'quote',
      resource_id: quote.id,
      operation_status: 'success',
      new_values: { 
        quote_number: quote.quote_number,
        vendor_id: quote.vendor_id,
        total_amount: quote.total_amount
      }
    })

    revalidatePath('/quotes')
    revalidateTag('dashboard')
    revalidatePath('/dashboard')
    
    return { quote, success: true }
  } catch (error) {
    console.error('Error in createQuote:', error)
    if (error instanceof z.ZodError) {
      return { error: error.errors[0].message }
    }
    return { error: 'An unexpected error occurred' }
  }
}

export async function updateQuoteStatus(formData: FormData) {
  try {
    const supabase = await createClient()
    
    const hasPermission = await checkUserPermission('invoices', 'edit')
    if (!hasPermission) {
      return { error: 'You do not have permission to update quotes' }
    }

    const quoteId = formData.get('quoteId') as string
    const newStatus = formData.get('status') as QuoteStatus

    if (!quoteId || !newStatus) {
      return { error: 'Quote ID and status are required' }
    }

    // Get current quote
    const { data: currentQuote, error: fetchError } = await supabase
      .from('quotes')
      .select('id, quote_number, status, converted_to_invoice_id')
      .eq('id', quoteId)
      .single()

    if (fetchError || !currentQuote) {
      return { error: 'Quote not found' }
    }

    if (currentQuote.status === newStatus) {
      return { success: true }
    }

    if (!isQuoteStatusTransitionAllowed(currentQuote.status as QuoteStatus, newStatus)) {
      return { error: `Invalid quote status transition from ${currentQuote.status} to ${newStatus}` }
    }

    if (currentQuote.converted_to_invoice_id) {
      return { error: 'Converted quotes cannot have their status changed' }
    }

    // Update status
    const { data: updatedQuote, error: updateError } = await supabase
      .from('quotes')
      .update({
        status: newStatus,
        updated_at: new Date().toISOString()
      })
      .eq('id', quoteId)
      .eq('status', currentQuote.status)
      .select('id')
      .maybeSingle()

    if (updateError) {
      console.error('Error updating quote status:', updateError)
      return { error: 'Failed to update quote status' }
    }

    if (!updatedQuote) {
      return { error: 'Quote status changed before this update could be applied' }
    }

    await logAuditEvent({
      operation_type: 'update',
      resource_type: 'quote',
      resource_id: quoteId,
      operation_status: 'success',
      old_values: { status: currentQuote.status },
      new_values: { status: newStatus },
      additional_info: { quote_number: currentQuote.quote_number }
    })

    revalidatePath('/quotes')
    revalidatePath(`/quotes/${quoteId}`)
    revalidateTag('dashboard')
    revalidatePath('/dashboard')
    
    return { success: true }
  } catch (error) {
    console.error('Error in updateQuoteStatus:', error)
    return { error: 'An unexpected error occurred' }
  }
}

export async function updateQuote(formData: FormData) {
  try {
    const supabase = await createClient()
    
    const hasPermission = await checkUserPermission('invoices', 'edit')
    if (!hasPermission) {
      return { error: 'You do not have permission to update quotes' }
    }

    const quoteId = formData.get('quote_id') as string
    if (!quoteId) {
      return { error: 'Quote ID is required' }
    }

    // Get current quote
    const { data: currentQuote, error: fetchError } = await supabase
      .from('quotes')
      .select(`
        *,
        line_items:quote_line_items(*)
      `)
      .eq('id', quoteId)
      .single()

    if (fetchError || !currentQuote) {
      return { error: 'Quote not found' }
    }

    if (currentQuote.status !== 'draft') {
      return { error: 'Only draft quotes can be edited' }
    }

    // Parse and validate form data
    const validatedData = CreateQuoteSchema.parse({
      vendor_id: formData.get('vendor_id'),
      quote_date: formData.get('quote_date'),
      valid_until: formData.get('valid_until'),
      reference: formData.get('reference') || undefined,
      quote_discount_percentage: parseFloat(formData.get('quote_discount_percentage') as string) || 0,
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
      lineItems = normalizeQuoteLineItems(JSON.parse(lineItemsJson))
    } catch {
      return { error: 'Invalid line items data' }
    }

    if (!Array.isArray(lineItems) || lineItems.length === 0) {
      return { error: 'At least one line item is required' }
    }

    const totals = calculateInvoiceTotals(lineItems, validatedData.quote_discount_percentage)

    const previousQuoteValues = {
      vendor_id: currentQuote.vendor_id,
      quote_date: currentQuote.quote_date,
      valid_until: currentQuote.valid_until,
      reference: currentQuote.reference,
      quote_discount_percentage: currentQuote.quote_discount_percentage,
      subtotal_amount: currentQuote.subtotal_amount,
      discount_amount: currentQuote.discount_amount,
      vat_amount: currentQuote.vat_amount,
      total_amount: currentQuote.total_amount,
      notes: currentQuote.notes,
      internal_notes: currentQuote.internal_notes,
    }

    const previousLineItems = Array.isArray(currentQuote.line_items)
      ? currentQuote.line_items.map((item: any) => ({
          quote_id: quoteId,
          catalog_item_id: item.catalog_item_id || null,
          description: item.description,
          quantity: item.quantity,
          unit_price: item.unit_price,
          discount_percentage: item.discount_percentage,
          vat_rate: item.vat_rate
        }))
      : []

    const quoteUpdatePayload = {
      vendor_id: validatedData.vendor_id,
      quote_date: validatedData.quote_date,
      valid_until: validatedData.valid_until,
      reference: validatedData.reference,
      quote_discount_percentage: validatedData.quote_discount_percentage,
      subtotal_amount: totals.subtotalBeforeInvoiceDiscount,
      discount_amount: totals.invoiceDiscountAmount,
      vat_amount: totals.vatAmount,
      total_amount: totals.totalAmount,
      notes: validatedData.notes,
      internal_notes: validatedData.internal_notes,
      updated_at: new Date().toISOString()
    }

    // Update quote
    const { data: updatedQuote, error: updateError } = await supabase
      .from('quotes')
      .update(quoteUpdatePayload)
      .eq('id', quoteId)
      .eq('status', 'draft')
      .select('id')
      .maybeSingle()

    if (updateError) {
      console.error('Error updating quote:', updateError)
      return { error: 'Failed to update quote' }
    }

    if (!updatedQuote) {
      return { error: 'Quote changed before this update could be applied' }
    }

    // Delete existing line items
    const { error: deleteError } = await supabase
      .from('quote_line_items')
      .delete()
      .eq('quote_id', quoteId)

    if (deleteError) {
      console.error('Error deleting line items:', deleteError)
      const { data: rolledBackQuote, error: rollbackQuoteError } = await supabase
        .from('quotes')
        .update({
          ...previousQuoteValues,
          updated_at: new Date().toISOString()
        })
        .eq('id', quoteId)
        .eq('status', 'draft')
        .select('id')
        .maybeSingle()

      if (rollbackQuoteError) {
        console.error('Failed to roll back quote after line-item delete failure:', rollbackQuoteError)
      } else if (!rolledBackQuote) {
        console.error('Failed to roll back quote after line-item delete failure: quote no longer draft')
      }
      return { error: 'Failed to update line items' }
    }

    // Create new line items
    const lineItemsToInsert = lineItems.map(item => ({
      quote_id: quoteId,
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
      .from('quote_line_items')
      .insert(lineItemsToInsert)

    if (lineItemsError) {
      console.error('Error creating line items:', lineItemsError)
      const { data: rolledBackQuote, error: rollbackQuoteError } = await supabase
        .from('quotes')
        .update({
          ...previousQuoteValues,
          updated_at: new Date().toISOString()
        })
        .eq('id', quoteId)
        .eq('status', 'draft')
        .select('id')
        .maybeSingle()

      if (rollbackQuoteError) {
        console.error('Failed to roll back quote after line-item insert failure:', rollbackQuoteError)
      } else if (!rolledBackQuote) {
        console.error('Failed to roll back quote after line-item insert failure: quote no longer draft')
      }

      if (previousLineItems.length > 0) {
        const { error: rollbackLineItemsError } = await supabase
          .from('quote_line_items')
          .insert(previousLineItems)
        if (rollbackLineItemsError) {
          console.error('Failed to restore prior quote line items after insert failure:', rollbackLineItemsError)
        }
      }
      return { error: 'Failed to create quote line items' }
    }

    await logAuditEvent({
      operation_type: 'update',
      resource_type: 'quote',
      resource_id: quoteId,
      operation_status: 'success',
      old_values: { 
        total_amount: currentQuote.total_amount,
        vendor_id: currentQuote.vendor_id
      },
      new_values: { 
        total_amount: totals.totalAmount,
        vendor_id: validatedData.vendor_id
      }
    })

    revalidatePath('/quotes')
    revalidatePath(`/quotes/${quoteId}`)
    revalidateTag('dashboard')
    revalidatePath('/dashboard')
    
    return { success: true }
  } catch (error) {
    console.error('Error in updateQuote:', error)
    if (error instanceof z.ZodError) {
      return { error: error.errors[0].message }
    }
    return { error: 'An unexpected error occurred' }
  }
}

// Delete quote
export async function deleteQuote(formData: FormData) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    
    const hasPermission = await checkUserPermission('invoices', 'delete')
    if (!hasPermission) {
      return { error: 'You do not have permission to delete quotes' }
    }

    const quoteId = formData.get('quoteId') as string
    if (!quoteId) {
      return { error: 'Quote ID is required' }
    }

    // Check if quote can be deleted (only draft quotes)
    const { data: quote, error: fetchError } = await supabase
      .from('quotes')
      .select('*')
      .eq('id', quoteId)
      .single()

    if (fetchError || !quote) {
      return { error: 'Quote not found' }
    }

    if (isSoftDeletedRecord(quote as Record<string, unknown>)) {
      return { error: 'Quote not found' }
    }

    if (quote.status !== 'draft') {
      return { error: 'Only draft quotes can be deleted' }
    }

    // Prefer soft delete where supported, but fall back to hard delete when
    // legacy quote schemas do not have deleted_at/deleted_by columns.
    const { data: softDeleted, error: softDeleteError } = await supabase
      .from('quotes')
      .update({ 
        deleted_at: new Date().toISOString(),
        deleted_by: user?.id || null
      })
      .eq('id', quoteId)
      .eq('status', 'draft')
      .select('id')
      .maybeSingle()

    const missingSoftDeleteColumns =
      softDeleteError &&
      (
        (softDeleteError as any).code === '42703' ||
        /deleted_at|deleted_by/i.test(softDeleteError.message || '')
      )

    if (softDeleteError && !missingSoftDeleteColumns) {
      console.error('Error deleting quote:', softDeleteError)
      return { error: 'Failed to delete quote' }
    }

    if (missingSoftDeleteColumns) {
      const { error: lineItemsDeleteError } = await supabase
        .from('quote_line_items')
        .delete()
        .eq('quote_id', quoteId)

      if (lineItemsDeleteError) {
        console.error('Error deleting quote line items before hard delete:', lineItemsDeleteError)
        return { error: 'Failed to delete quote line items' }
      }

      const { data: hardDeleted, error: hardDeleteError } = await supabase
        .from('quotes')
        .delete()
        .eq('id', quoteId)
        .eq('status', 'draft')
        .select('id')
        .maybeSingle()

      if (hardDeleteError) {
        console.error('Error hard deleting quote:', hardDeleteError)
        return { error: 'Failed to delete quote' }
      }

      if (!hardDeleted) {
        return { error: 'Quote is no longer deletable' }
      }
    } else if (!softDeleted) {
      return { error: 'Quote is no longer deletable' }
    }

    await logAuditEvent({
      operation_type: 'delete',
      resource_type: 'quote',
      resource_id: quoteId,
      operation_status: 'success'
    })

    revalidatePath('/quotes')
    revalidateTag('dashboard')
    revalidatePath('/dashboard')
    
    return { success: true }
  } catch (error) {
    console.error('Error in deleteQuote:', error)
    return { error: 'An unexpected error occurred' }
  }
}

export async function convertQuoteToInvoice(quoteId: string) {
  try {
    const supabase = await createClient()
    
    const hasPermission = await checkUserPermission('invoices', 'create')
    if (!hasPermission) {
      return { error: 'You do not have permission to convert quotes to invoices' }
    }

    // Get quote with line items
    const { data: quote, error: quoteError } = await supabase
      .from('quotes')
      .select(`
        *,
        line_items:quote_line_items(*)
      `)
      .eq('id', quoteId)
      .single()

    if (quoteError || !quote) {
      return { error: 'Quote not found' }
    }

    if (isSoftDeletedRecord(quote as Record<string, unknown>)) {
      return { error: 'Quote not found' }
    }

    if (quote.status !== 'accepted') {
      return { error: 'Only accepted quotes can be converted to invoices' }
    }

    if (quote.converted_to_invoice_id) {
      return { error: 'This quote has already been converted to an invoice' }
    }

    const quoteLineItems = Array.isArray(quote.line_items) ? quote.line_items as QuoteLineItem[] : []
    if (quoteLineItems.length === 0) {
      return { error: 'Quote has no line items and cannot be converted' }
    }

    // Get next invoice number
    const adminClient = await createAdminClient()
    const rollbackCreatedInvoice = async (invoiceId: string) => {
      const { error: lineItemsDeleteError } = await adminClient
        .from('invoice_line_items')
        .delete()
        .eq('invoice_id', invoiceId)
      if (lineItemsDeleteError) {
        console.error('Error rolling back invoice line items after conversion failure:', lineItemsDeleteError)
      }

      const { error: invoiceDeleteError } = await adminClient
        .from('invoices')
        .delete()
        .eq('id', invoiceId)
      if (invoiceDeleteError) {
        console.error('Error rolling back invoice after conversion failure:', invoiceDeleteError)
      }
    }

    const { data: seriesData, error: seriesError } = await adminClient
      .rpc('get_and_increment_invoice_series', { p_series_code: 'INV' })
      .single()

    if (seriesError) {
      console.error('Error getting invoice number:', seriesError)
      return { error: 'Failed to generate invoice number' }
    }

    const encoded = ((seriesData as { next_sequence: number }).next_sequence + 5000).toString(36).toUpperCase().padStart(5, '0')
    const invoiceNumber = `INV-${encoded}`

    // Create invoice from quote
    const { data: invoice, error: invoiceError } = await supabase
      .from('invoices')
      .insert({
        invoice_number: invoiceNumber,
        vendor_id: quote.vendor_id,
        invoice_date: getTodayIsoDate(),
        due_date: getLocalIsoDateDaysAhead(30),
        reference: quote.reference,
        invoice_discount_percentage: quote.quote_discount_percentage,
        subtotal_amount: quote.subtotal_amount,
        discount_amount: quote.discount_amount,
        vat_amount: quote.vat_amount,
        total_amount: quote.total_amount,
        notes: quote.notes,
        internal_notes: quote.internal_notes,
        status: 'draft' as const
      })
      .select()
      .single()

    if (invoiceError) {
      console.error('Error creating invoice:', invoiceError)
      return { error: 'Failed to create invoice' }
    }

    // Copy line items
    const invoiceLineItems = quoteLineItems.map((item: QuoteLineItem) => ({
      invoice_id: invoice.id,
      catalog_item_id: item.catalog_item_id,
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
      .insert(invoiceLineItems)

    if (lineItemsError) {
      console.error('Error creating invoice line items:', lineItemsError)
      await rollbackCreatedInvoice(invoice.id)
      return { error: 'Failed to create invoice line items' }
    }

    // Finalize conversion only if quote is still accepted and unconverted.
    const { data: updatedQuote, error: updateError } = await supabase
      .from('quotes')
      .update({ converted_to_invoice_id: invoice.id })
      .eq('id', quoteId)
      .eq('status', 'accepted')
      .is('converted_to_invoice_id', null)
      .select('id')
      .maybeSingle()

    if (updateError || !updatedQuote) {
      console.error('Error updating quote:', updateError)
      await rollbackCreatedInvoice(invoice.id)
      return { error: 'Quote conversion could not be finalized. Please retry.' }
    }

    await logAuditEvent({
      operation_type: 'create',
      resource_type: 'invoice',
      resource_id: invoice.id,
      operation_status: 'success',
      additional_info: { 
        converted_from_quote: quote.quote_number,
        invoice_number: invoice.invoice_number
      }
    })

    revalidatePath('/quotes')
    revalidatePath('/invoices')
    revalidateTag('dashboard')
    revalidatePath('/dashboard')
    
    return { invoice, success: true }
  } catch (error) {
    console.error('Error in convertQuoteToInvoice:', error)
    return { error: 'An unexpected error occurred' }
  }
}
