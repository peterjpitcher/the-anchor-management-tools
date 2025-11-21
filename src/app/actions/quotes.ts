'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { checkUserPermission } from '@/app/actions/rbac'
import { logAuditEvent } from './audit'
import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { getTodayIsoDate, getLocalIsoDateDaysAhead, toLocalIsoDate } from '@/lib/dateUtils'
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

// Get next quote number from series
async function getNextQuoteNumber(): Promise<string> {
  const adminClient = await createAdminClient()
  
  // Get and increment the sequence atomically using the database function
  const { data, error } = await adminClient
    .rpc('get_and_increment_invoice_series', { p_series_code: 'QTE' })
    .single()

  if (error) {
    console.error('Error getting next quote number:', error)
    throw new Error('Failed to generate quote number')
  }

  // Encode the sequential number to appear non-sequential
  const encoded = ((data as { next_sequence: number }).next_sequence + 3000).toString(36).toUpperCase().padStart(5, '0')
  
  return `QTE-${encoded}`
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

    quotes?.forEach(quote => {
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

    // Update expired status for sent quotes
    const today = getTodayIsoDate()
    const updatedQuotes = quotes.map(quote => ({
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
    const supabase = await createClient()
    
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

    const lineItems: InvoiceLineItemInput[] = JSON.parse(lineItemsJson)
    if (!Array.isArray(lineItems) || lineItems.length === 0) {
      return { error: 'At least one line item is required' }
    }

    // Calculate totals
    let subtotal = 0
    let totalVat = 0

    lineItems.forEach(item => {
      const lineSubtotal = item.quantity * item.unit_price
      const lineDiscount = lineSubtotal * (item.discount_percentage / 100)
      const lineAfterDiscount = lineSubtotal - lineDiscount
      subtotal += lineAfterDiscount
    })

    const quoteDiscount = subtotal * (validatedData.quote_discount_percentage / 100)
    const afterQuoteDiscount = subtotal - quoteDiscount

    // Calculate VAT after all discounts
    lineItems.forEach(item => {
      const lineSubtotal = item.quantity * item.unit_price
      const lineDiscount = lineSubtotal * (item.discount_percentage / 100)
      const lineAfterDiscount = lineSubtotal - lineDiscount
      const lineShare = lineAfterDiscount / subtotal
      const lineAfterQuoteDiscount = lineAfterDiscount - (quoteDiscount * lineShare)
      const lineVat = lineAfterQuoteDiscount * (item.vat_rate / 100)
      totalVat += lineVat
    })

    const totalAmount = afterQuoteDiscount + totalVat

    // Get next quote number
    const quoteNumber = await getNextQuoteNumber()

    // Create quote
    const { data: quote, error: quoteError } = await supabase
      .from('quotes')
      .insert({
        quote_number: quoteNumber,
        vendor_id: validatedData.vendor_id,
        quote_date: validatedData.quote_date,
        valid_until: validatedData.valid_until,
        reference: validatedData.reference,
        quote_discount_percentage: validatedData.quote_discount_percentage,
        subtotal_amount: subtotal,
        discount_amount: quoteDiscount,
        vat_amount: totalVat,
        total_amount: totalAmount,
        notes: validatedData.notes,
        internal_notes: validatedData.internal_notes,
        status: 'draft' as QuoteStatus
      })
      .select()
      .single()

    if (quoteError) {
      console.error('Error creating quote:', quoteError)
      return { error: 'Failed to create quote' }
    }

    // Create line items
    const lineItemsToInsert = lineItems.map(item => ({
      quote_id: quote.id,
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
      // Rollback quote creation
      await supabase.from('quotes').delete().eq('id', quote.id)
      return { error: 'Failed to create quote line items' }
    }

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
      .select('*')
      .eq('id', quoteId)
      .single()

    if (fetchError || !currentQuote) {
      return { error: 'Quote not found' }
    }

    // Update status
    const { error: updateError } = await supabase
      .from('quotes')
      .update({
        status: newStatus,
        updated_at: new Date().toISOString()
      })
      .eq('id', quoteId)

    if (updateError) {
      console.error('Error updating quote status:', updateError)
      return { error: 'Failed to update quote status' }
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
      .select('*')
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

    const lineItems: InvoiceLineItemInput[] = JSON.parse(lineItemsJson)
    if (!Array.isArray(lineItems) || lineItems.length === 0) {
      return { error: 'At least one line item is required' }
    }

    // Calculate totals
    let subtotal = 0
    let totalVat = 0

    lineItems.forEach(item => {
      const lineSubtotal = item.quantity * item.unit_price
      const lineDiscount = lineSubtotal * (item.discount_percentage / 100)
      const lineAfterDiscount = lineSubtotal - lineDiscount
      subtotal += lineAfterDiscount
    })

    const quoteDiscount = subtotal * (validatedData.quote_discount_percentage / 100)
    const afterQuoteDiscount = subtotal - quoteDiscount

    // Calculate VAT after all discounts
    lineItems.forEach(item => {
      const lineSubtotal = item.quantity * item.unit_price
      const lineDiscount = lineSubtotal * (item.discount_percentage / 100)
      const lineAfterDiscount = lineSubtotal - lineDiscount
      const lineShare = lineAfterDiscount / subtotal
      const lineAfterQuoteDiscount = lineAfterDiscount - (quoteDiscount * lineShare)
      const lineVat = lineAfterQuoteDiscount * (item.vat_rate / 100)
      totalVat += lineVat
    })

    const totalAmount = afterQuoteDiscount + totalVat

    // Update quote
    const { error: updateError } = await supabase
      .from('quotes')
      .update({
        vendor_id: validatedData.vendor_id,
        quote_date: validatedData.quote_date,
        valid_until: validatedData.valid_until,
        reference: validatedData.reference,
        quote_discount_percentage: validatedData.quote_discount_percentage,
        subtotal_amount: subtotal,
        discount_amount: quoteDiscount,
        vat_amount: totalVat,
        total_amount: totalAmount,
        notes: validatedData.notes,
        internal_notes: validatedData.internal_notes,
        updated_at: new Date().toISOString()
      })
      .eq('id', quoteId)

    if (updateError) {
      console.error('Error updating quote:', updateError)
      return { error: 'Failed to update quote' }
    }

    // Delete existing line items
    const { error: deleteError } = await supabase
      .from('quote_line_items')
      .delete()
      .eq('quote_id', quoteId)

    if (deleteError) {
      console.error('Error deleting line items:', deleteError)
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
        total_amount: totalAmount,
        vendor_id: validatedData.vendor_id
      }
    })

    revalidatePath('/quotes')
    revalidatePath(`/quotes/${quoteId}`)
    
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
      .select('status')
      .eq('id', quoteId)
      .single()

    if (fetchError || !quote) {
      return { error: 'Quote not found' }
    }

    if (quote.status !== 'draft') {
      return { error: 'Only draft quotes can be deleted' }
    }

    // Soft delete the quote
    const { error: deleteError } = await supabase
      .from('quotes')
      .update({ 
        deleted_at: new Date().toISOString(),
        deleted_by: (await supabase.auth.getUser()).data.user?.id
      })
      .eq('id', quoteId)

    if (deleteError) {
      console.error('Error deleting quote:', deleteError)
      return { error: 'Failed to delete quote' }
    }

    await logAuditEvent({
      operation_type: 'delete',
      resource_type: 'quote',
      resource_id: quoteId,
      operation_status: 'success'
    })

    revalidatePath('/quotes')
    
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

    if (quote.status !== 'accepted') {
      return { error: 'Only accepted quotes can be converted to invoices' }
    }

    if (quote.converted_to_invoice_id) {
      return { error: 'This quote has already been converted to an invoice' }
    }

    // Get next invoice number
    const adminClient = await createAdminClient()
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
    const invoiceLineItems = quote.line_items.map((item: QuoteLineItem) => ({
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
      // Rollback invoice creation
      await supabase.from('invoices').delete().eq('id', invoice.id)
      return { error: 'Failed to create invoice line items' }
    }

    // Update quote with invoice reference
    const { error: updateError } = await supabase
      .from('quotes')
      .update({ converted_to_invoice_id: invoice.id })
      .eq('id', quoteId)

    if (updateError) {
      console.error('Error updating quote:', updateError)
      // Don't rollback, just log the issue
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
    
    return { invoice, success: true }
  } catch (error) {
    console.error('Error in convertQuoteToInvoice:', error)
    return { error: 'An unexpected error occurred' }
  }
}
