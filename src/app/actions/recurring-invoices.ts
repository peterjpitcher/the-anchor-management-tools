'use server'

import { createClient, createAdminClient } from '@/lib/supabase/server'
import { checkUserPermission } from '@/app/actions/rbac'
import { logAuditEvent } from './audit'
import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { toLocalIsoDate } from '@/lib/dateUtils'
import type { RecurringInvoice, RecurringInvoiceWithDetails, RecurringFrequency, InvoiceLineItemInput, InvoiceStatus } from '@/types/invoices'

// Validation schemas
const CreateRecurringInvoiceSchema = z.object({
  vendor_id: z.string().uuid('Invalid vendor ID'),
  frequency: z.enum(['weekly', 'monthly', 'quarterly', 'yearly'] as const),
  start_date: z.string().refine((date) => !isNaN(Date.parse(date)), 'Invalid date'),
  end_date: z.string().optional().refine((date) => !date || !isNaN(Date.parse(date)), 'Invalid date'),
  days_before_due: z.number().min(0).max(365),
  reference: z.string().optional(),
  invoice_discount_percentage: z.number().min(0).max(100).default(0),
  notes: z.string().optional(),
  internal_notes: z.string().optional()
})

const UpdateRecurringInvoiceSchema = CreateRecurringInvoiceSchema.extend({
  id: z.string().uuid('Invalid recurring invoice ID'),
  is_active: z.boolean()
})

// Get all recurring invoices
export async function getRecurringInvoices() {
  try {
    const supabase = await createClient()
    
    // Check permissions
    const hasPermission = await checkUserPermission('invoices', 'view')
    if (!hasPermission) {
      return { error: 'You do not have permission to view recurring invoices' }
    }

    const { data, error } = await supabase
      .from('recurring_invoices')
      .select(`
        *,
        vendor:invoice_vendors(
          id,
          name,
          contact_name,
          email,
          phone,
          address,
          vat_number,
          payment_terms
        ),
        line_items:recurring_invoice_line_items(
          id,
          catalog_item_id,
          description,
          quantity,
          unit_price,
          discount_percentage,
          vat_rate
        ),
        last_invoice:invoices!recurring_invoices_last_invoice_id_fkey(
          id,
          invoice_number,
          invoice_date,
          status
        )
      `)
      .order('created_at', { ascending: false })

    if (error) {
      console.error('Error fetching recurring invoices:', error)
      return { error: 'Failed to fetch recurring invoices' }
    }

    return { recurringInvoices: data as RecurringInvoiceWithDetails[] }
  } catch (error) {
    console.error('Error in getRecurringInvoices:', error)
    return { error: 'An unexpected error occurred' }
  }
}

// Get single recurring invoice
export async function getRecurringInvoice(id: string) {
  try {
    const supabase = await createClient()
    
    // Check permissions
    const hasPermission = await checkUserPermission('invoices', 'view')
    if (!hasPermission) {
      return { error: 'You do not have permission to view recurring invoices' }
    }

    const { data, error } = await supabase
      .from('recurring_invoices')
      .select(`
        *,
        vendor:invoice_vendors(
          id,
          name,
          contact_name,
          email,
          phone,
          address,
          vat_number,
          payment_terms
        ),
        line_items:recurring_invoice_line_items(
          id,
          catalog_item_id,
          description,
          quantity,
          unit_price,
          discount_percentage,
          vat_rate
        ),
        last_invoice:invoices!recurring_invoices_last_invoice_id_fkey(
          id,
          invoice_number,
          invoice_date,
          status
        )
      `)
      .eq('id', id)
      .single()

    if (error) {
      console.error('Error fetching recurring invoice:', error)
      return { error: 'Failed to fetch recurring invoice' }
    }

    return { recurringInvoice: data as RecurringInvoiceWithDetails }
  } catch (error) {
    console.error('Error in getRecurringInvoice:', error)
    return { error: 'An unexpected error occurred' }
  }
}

// Create recurring invoice
export async function createRecurringInvoice(formData: FormData) {
  try {
    const supabase = await createClient()
    
    // Check permissions
    const hasPermission = await checkUserPermission('invoices', 'create')
    if (!hasPermission) {
      return { error: 'You do not have permission to create recurring invoices' }
    }

    // Parse and validate data
    const validatedData = CreateRecurringInvoiceSchema.parse({
      vendor_id: formData.get('vendor_id'),
      frequency: formData.get('frequency'),
      start_date: formData.get('start_date'),
      end_date: formData.get('end_date') || undefined,
      days_before_due: parseInt(formData.get('days_before_due') as string),
      reference: formData.get('reference') || undefined,
      invoice_discount_percentage: parseFloat(formData.get('invoice_discount_percentage') as string) || 0,
      notes: formData.get('notes') || undefined,
      internal_notes: formData.get('internal_notes') || undefined
    })

    // Calculate next invoice date based on start date and frequency
    const nextInvoiceDate = new Date(validatedData.start_date)
    
    // Create recurring invoice
    const { data: recurringInvoice, error: createError } = await supabase
      .from('recurring_invoices')
      .insert({
        ...validatedData,
        next_invoice_date: nextInvoiceDate.toISOString(),
        is_active: true
      })
      .select()
      .single()

    if (createError) {
      console.error('Error creating recurring invoice:', createError)
      return { error: 'Failed to create recurring invoice' }
    }

    // Add line items
    const lineItemsJson = formData.get('line_items')
    if (lineItemsJson) {
      const lineItems = JSON.parse(lineItemsJson as string)
      
      if (lineItems.length > 0) {
        const { error: lineItemsError } = await supabase
          .from('recurring_invoice_line_items')
          .insert(
            lineItems.map((item: InvoiceLineItemInput) => ({
              recurring_invoice_id: recurringInvoice.id,
              catalog_item_id: item.catalog_item_id || null,
              description: item.description,
              quantity: item.quantity,
              unit_price: item.unit_price,
              discount_percentage: item.discount_percentage || 0,
              vat_rate: item.vat_rate
            }))
          )

        if (lineItemsError) {
          console.error('Error creating line items:', lineItemsError)
          // Delete the recurring invoice if line items fail
          await supabase.from('recurring_invoices').delete().eq('id', recurringInvoice.id)
          return { error: 'Failed to create line items' }
        }
      }
    }

    await logAuditEvent({
      operation_type: 'create',
      resource_type: 'recurring_invoice',
      resource_id: recurringInvoice.id,
      operation_status: 'success',
      additional_info: { 
        vendor_id: validatedData.vendor_id,
        frequency: validatedData.frequency,
        start_date: validatedData.start_date
      }
    })

    revalidatePath('/invoices/recurring')
    
    return { success: true, recurringInvoice }
  } catch (error) {
    console.error('Error in createRecurringInvoice:', error)
    if (error instanceof z.ZodError) {
      return { error: error.errors[0].message }
    }
    return { error: 'An unexpected error occurred' }
  }
}

// Update recurring invoice
export async function updateRecurringInvoice(formData: FormData) {
  try {
    const supabase = await createClient()
    
    // Check permissions
    const hasPermission = await checkUserPermission('invoices', 'edit')
    if (!hasPermission) {
      return { error: 'You do not have permission to update recurring invoices' }
    }

    // Parse and validate data
    const validatedData = UpdateRecurringInvoiceSchema.parse({
      id: formData.get('id'),
      vendor_id: formData.get('vendor_id'),
      frequency: formData.get('frequency'),
      start_date: formData.get('start_date'),
      end_date: formData.get('end_date') || undefined,
      days_before_due: parseInt(formData.get('days_before_due') as string),
      reference: formData.get('reference') || undefined,
      invoice_discount_percentage: parseFloat(formData.get('invoice_discount_percentage') as string) || 0,
      notes: formData.get('notes') || undefined,
      internal_notes: formData.get('internal_notes') || undefined,
      is_active: formData.get('is_active') === 'true'
    })

    const { id, ...updateData } = validatedData

    // Update recurring invoice
    const { error: updateError } = await supabase
      .from('recurring_invoices')
      .update({
        ...updateData,
        updated_at: new Date().toISOString()
      })
      .eq('id', id)

    if (updateError) {
      console.error('Error updating recurring invoice:', updateError)
      return { error: 'Failed to update recurring invoice' }
    }

    // Update line items (delete existing and recreate)
    await supabase
      .from('recurring_invoice_line_items')
      .delete()
      .eq('recurring_invoice_id', id)

    const lineItemsJson = formData.get('line_items')
    if (lineItemsJson) {
      const lineItems = JSON.parse(lineItemsJson as string)
      
      if (lineItems.length > 0) {
        const { error: lineItemsError } = await supabase
          .from('recurring_invoice_line_items')
          .insert(
            lineItems.map((item: InvoiceLineItemInput) => ({
              recurring_invoice_id: id,
              catalog_item_id: item.catalog_item_id || null,
              description: item.description,
              quantity: item.quantity,
              unit_price: item.unit_price,
              discount_percentage: item.discount_percentage || 0,
              vat_rate: item.vat_rate
            }))
          )

        if (lineItemsError) {
          console.error('Error updating line items:', lineItemsError)
          return { error: 'Failed to update line items' }
        }
      }
    }

    await logAuditEvent({
      operation_type: 'update',
      resource_type: 'recurring_invoice',
      resource_id: id,
      operation_status: 'success',
      additional_info: { 
        vendor_id: validatedData.vendor_id,
        is_active: validatedData.is_active
      }
    })

    revalidatePath('/invoices/recurring')
    revalidatePath(`/invoices/recurring/${id}`)
    
    return { success: true }
  } catch (error) {
    console.error('Error in updateRecurringInvoice:', error)
    if (error instanceof z.ZodError) {
      return { error: error.errors[0].message }
    }
    return { error: 'An unexpected error occurred' }
  }
}

// Delete recurring invoice
export async function deleteRecurringInvoice(formData: FormData) {
  try {
    const supabase = await createClient()
    
    // Check permissions
    const hasPermission = await checkUserPermission('invoices', 'delete')
    if (!hasPermission) {
      return { error: 'You do not have permission to delete recurring invoices' }
    }

    const id = formData.get('id') as string
    if (!id) {
      return { error: 'Recurring invoice ID is required' }
    }

    // Always soft delete (deactivate) recurring invoices
    const { error: updateError } = await supabase
      .from('recurring_invoices')
      .update({ 
        is_active: false,
        updated_at: new Date().toISOString()
      })
      .eq('id', id)

    if (updateError) {
      console.error('Error deactivating recurring invoice:', updateError)
      return { error: 'Failed to deactivate recurring invoice' }
    }

    await logAuditEvent({
      operation_type: 'update',
      resource_type: 'recurring_invoice',
      resource_id: id,
      operation_status: 'success',
      additional_info: { action: 'deactivated' }
    })

    revalidatePath('/invoices/recurring')
    
    return { success: true }
  } catch (error) {
    console.error('Error in deleteRecurringInvoice:', error)
    return { error: 'An unexpected error occurred' }
  }
}

// Generate invoice from recurring invoice
export async function generateInvoiceFromRecurring(recurringInvoiceId: string) {
  try {
    const supabase = await createClient()
    const adminClient = await createAdminClient()
    
    // Check permissions
    const hasPermission = await checkUserPermission('invoices', 'create')
    if (!hasPermission) {
      return { error: 'You do not have permission to generate invoices' }
    }

    // Get recurring invoice details
    const { data: recurringInvoice, error: fetchError } = await supabase
      .from('recurring_invoices')
      .select(`
        *,
        line_items:recurring_invoice_line_items(
          catalog_item_id,
          description,
          quantity,
          unit_price,
          discount_percentage,
          vat_rate
        )
      `)
      .eq('id', recurringInvoiceId)
      .single()

    if (fetchError || !recurringInvoice) {
      console.error('Error fetching recurring invoice:', fetchError)
      return { error: 'Recurring invoice not found' }
    }

    if (!recurringInvoice.is_active) {
      return { error: 'Recurring invoice is not active' }
    }

    // Calculate dates
    const invoiceDate = new Date()
    const dueDate = new Date()
    dueDate.setDate(dueDate.getDate() + recurringInvoice.days_before_due)

    // Get next invoice number
    const { data: seriesData } = await adminClient
      .from('invoice_series')
      .select('series_code')
      .single()

    const seriesCode = seriesData?.series_code || 'INV'
    
    // Get and increment the sequence atomically
    const { data: sequenceData, error: sequenceError } = await adminClient
      .rpc('get_and_increment_invoice_series', { p_series_code: seriesCode })
      .single()

    if (sequenceError) {
      console.error('Error getting invoice number:', sequenceError)
      return { error: 'Failed to generate invoice number' }
    }

    // Generate invoice number
    const encoded = ((sequenceData as any).next_sequence + 5000).toString(36).toUpperCase().padStart(5, '0')
    const invoiceNumber = `${seriesCode}-${encoded}`

    // Calculate totals (same logic as in createInvoice)
    let subtotal = 0
    let totalVat = 0

    if (recurringInvoice.line_items) {
      recurringInvoice.line_items.forEach((item: any) => {
        const lineSubtotal = item.quantity * item.unit_price
        const lineDiscount = lineSubtotal * (item.discount_percentage / 100)
        const lineAfterDiscount = lineSubtotal - lineDiscount
        subtotal += lineAfterDiscount
      })

      const invoiceDiscount = subtotal * (recurringInvoice.invoice_discount_percentage / 100)
      const afterInvoiceDiscount = subtotal - invoiceDiscount

      recurringInvoice.line_items.forEach((item: any) => {
        const lineSubtotal = item.quantity * item.unit_price
        const lineDiscount = lineSubtotal * (item.discount_percentage / 100)
        const lineAfterDiscount = lineSubtotal - lineDiscount
        const itemShare = subtotal > 0 ? lineAfterDiscount / subtotal : 0
        const itemAfterInvoiceDiscount = lineAfterDiscount - (invoiceDiscount * itemShare)
        const itemVat = itemAfterInvoiceDiscount * (item.vat_rate / 100)
        totalVat += itemVat
      })
    }

    const invoiceDiscountAmount = subtotal * (recurringInvoice.invoice_discount_percentage / 100)
    const totalAmount = subtotal - invoiceDiscountAmount + totalVat

    // Create invoice
    const { data: newInvoice, error: invoiceError } = await supabase
      .from('invoices')
      .insert({
        invoice_number: invoiceNumber,
        vendor_id: recurringInvoice.vendor_id,
        invoice_date: toLocalIsoDate(invoiceDate),
        due_date: toLocalIsoDate(dueDate),
        reference: recurringInvoice.reference,
        invoice_discount_percentage: recurringInvoice.invoice_discount_percentage,
        subtotal_amount: subtotal,
        discount_amount: invoiceDiscountAmount,
        vat_amount: totalVat,
        total_amount: totalAmount,
        notes: recurringInvoice.notes,
        internal_notes: recurringInvoice.internal_notes,
        status: 'draft' as InvoiceStatus
      })
      .select()
      .single()

    if (invoiceError) {
      console.error('Error creating invoice:', invoiceError)
      return { error: 'Failed to create invoice' }
    }

    // Create line items
    if (recurringInvoice.line_items && recurringInvoice.line_items.length > 0) {
      const lineItemsToInsert = recurringInvoice.line_items.map((item: any) => ({
        invoice_id: newInvoice.id,
        catalog_item_id: item.catalog_item_id || null,
        description: item.description,
        quantity: item.quantity,
        unit_price: item.unit_price,
        discount_percentage: item.discount_percentage || 0,
        vat_rate: item.vat_rate
        // GENERATED columns excluded
      }))

      const { error: lineItemsError } = await supabase
        .from('invoice_line_items')
        .insert(lineItemsToInsert)

      if (lineItemsError) {
        console.error('Error creating line items:', lineItemsError)
        // Rollback invoice creation
        await supabase.from('invoices').delete().eq('id', newInvoice.id)
        return { error: 'Failed to create invoice line items' }
      }
    }

    // Update next invoice date
    const nextDate = calculateNextInvoiceDate(
      invoiceDate,
      recurringInvoice.frequency as RecurringFrequency
    )

    const { error: updateError } = await supabase
      .from('recurring_invoices')
      .update({
        next_invoice_date: nextDate.toISOString(),
        last_invoice_id: newInvoice.id,
        updated_at: new Date().toISOString()
      })
      .eq('id', recurringInvoiceId)

    if (updateError) {
      console.error('Error updating recurring invoice:', updateError)
    }

    await logAuditEvent({
      operation_type: 'create',
      resource_type: 'invoice',
      resource_id: newInvoice.id,
      operation_status: 'success',
      additional_info: { 
        source: 'recurring_invoice',
        recurring_invoice_id: recurringInvoiceId,
        invoice_number: newInvoice.invoice_number
      }
    })

    revalidatePath('/invoices')
    revalidatePath('/invoices/recurring')
    
    return { success: true, invoice: newInvoice }
  } catch (error) {
    console.error('Error in generateInvoiceFromRecurring:', error)
    return { error: 'An unexpected error occurred' }
  }
}

// Toggle recurring invoice active status
export async function toggleRecurringInvoiceStatus(formData: FormData) {
  try {
    const supabase = await createClient()
    
    // Check permissions
    const hasPermission = await checkUserPermission('invoices', 'edit')
    if (!hasPermission) {
      return { error: 'You do not have permission to update recurring invoices' }
    }

    const id = formData.get('id') as string
    const currentStatus = formData.get('current_status') === 'true'
    
    if (!id) {
      return { error: 'Recurring invoice ID is required' }
    }

    // Toggle the status
    const { error: updateError } = await supabase
      .from('recurring_invoices')
      .update({ 
        is_active: !currentStatus,
        updated_at: new Date().toISOString()
      })
      .eq('id', id)

    if (updateError) {
      console.error('Error toggling recurring invoice status:', updateError)
      return { error: 'Failed to update recurring invoice status' }
    }

    await logAuditEvent({
      operation_type: 'update',
      resource_type: 'recurring_invoice',
      resource_id: id,
      operation_status: 'success',
      additional_info: { 
        action: !currentStatus ? 'activated' : 'deactivated',
        old_status: currentStatus,
        new_status: !currentStatus
      }
    })

    revalidatePath('/invoices/recurring')
    
    return { success: true, newStatus: !currentStatus }
  } catch (error) {
    console.error('Error in toggleRecurringInvoiceStatus:', error)
    return { error: 'An unexpected error occurred' }
  }
}

// Helper function to calculate next invoice date
function calculateNextInvoiceDate(currentDate: Date, frequency: RecurringFrequency): Date {
  const nextDate = new Date(currentDate)
  
  switch (frequency) {
    case 'weekly':
      nextDate.setDate(nextDate.getDate() + 7)
      break
    case 'monthly':
      nextDate.setMonth(nextDate.getMonth() + 1)
      break
    case 'quarterly':
      nextDate.setMonth(nextDate.getMonth() + 3)
      break
    case 'yearly':
      nextDate.setFullYear(nextDate.getFullYear() + 1)
      break
  }
  
  return nextDate
}
