'use server'

import { createClient } from '@/lib/supabase/server'
import { checkUserPermission } from '@/app/actions/rbac'
import { logAuditEvent } from './audit'
import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import type { RecurringInvoiceWithDetails, RecurringFrequency, InvoiceLineItemInput } from '@/types/invoices'
import { InvoiceService } from '@/services/invoices'
import { addDaysIsoDate, calculateNextInvoiceIsoDate } from '@/lib/recurringInvoiceSchedule'

// Validation schemas
const RecurringInvoiceSchemaBase = z.object({
  vendor_id: z.string().uuid('Invalid vendor ID'),
  frequency: z.enum(['weekly', 'monthly', 'quarterly', 'yearly'] as const),
  start_date: z.string().refine((date) => !isNaN(Date.parse(date)), 'Invalid date'),
  next_invoice_date: z
    .string()
    .optional()
    .refine((date) => !date || !isNaN(Date.parse(date)), 'Invalid date'),
  end_date: z.string().optional().refine((date) => !date || !isNaN(Date.parse(date)), 'Invalid date'),
  days_before_due: z.number().min(0).max(365),
  reference: z.string().optional(),
  invoice_discount_percentage: z.number().min(0).max(100).default(0),
  notes: z.string().optional(),
  internal_notes: z.string().optional()
})

function applyRecurringInvoiceDateRules<T extends z.ZodTypeAny>(schema: T) {
  return schema.superRefine((data: any, ctx) => {
    const nextInvoiceDate = data.next_invoice_date || data.start_date
    const start = new Date(data.start_date)
    const next = new Date(nextInvoiceDate)

    if (next < start) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['next_invoice_date'],
        message: 'Next invoice date cannot be before the start date'
      })
    }

    if (data.end_date) {
      const end = new Date(data.end_date)
      if (next > end) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['next_invoice_date'],
          message: 'Next invoice date cannot be after the end date'
        })
      }
    }
  })
}

const CreateRecurringInvoiceSchema = applyRecurringInvoiceDateRules(RecurringInvoiceSchemaBase)

const UpdateRecurringInvoiceSchema = applyRecurringInvoiceDateRules(
  RecurringInvoiceSchemaBase.extend({
    id: z.string().uuid('Invalid recurring invoice ID'),
    is_active: z.boolean()
  })
)

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
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { error: 'Unauthorized' }
    
    const hasPermission = await checkUserPermission('invoices', 'create')
    if (!hasPermission) {
      return { error: 'You do not have permission to create recurring invoices' }
    }

    // Parse and validate data
    const validatedData = CreateRecurringInvoiceSchema.parse({
      vendor_id: formData.get('vendor_id'),
      frequency: formData.get('frequency'),
      start_date: formData.get('start_date'),
      next_invoice_date: formData.get('next_invoice_date') || undefined,
      end_date: formData.get('end_date') || undefined,
      days_before_due: parseInt(formData.get('days_before_due') as string),
      reference: formData.get('reference') || undefined,
      invoice_discount_percentage: parseFloat(formData.get('invoice_discount_percentage') as string) || 0,
      notes: formData.get('notes') || undefined,
      internal_notes: formData.get('internal_notes') || undefined
    })

    const nextInvoiceDate = validatedData.next_invoice_date || validatedData.start_date
    
    // Create recurring invoice
    const { data: recurringInvoice, error: createError } = await supabase
      .from('recurring_invoices')
      .insert({
        ...validatedData,
        next_invoice_date: nextInvoiceDate,
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
          await supabase.from('recurring_invoices').delete().eq('id', recurringInvoice.id)
          return { error: 'Failed to create line items' }
        }
      }
    }

    await logAuditEvent({
      user_id: user.id,
      user_email: user.email,
      operation_type: 'create',
      resource_type: 'recurring_invoice',
      resource_id: recurringInvoice.id,
      operation_status: 'success',
      additional_info: { 
        vendor_id: validatedData.vendor_id,
        frequency: validatedData.frequency
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
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { error: 'Unauthorized' }
    
    const hasPermission = await checkUserPermission('invoices', 'edit')
    if (!hasPermission) {
      return { error: 'You do not have permission to update recurring invoices' }
    }

    const validatedData = UpdateRecurringInvoiceSchema.parse({
      id: formData.get('id'),
      vendor_id: formData.get('vendor_id'),
      frequency: formData.get('frequency'),
      start_date: formData.get('start_date'),
      next_invoice_date: formData.get('next_invoice_date') || undefined,
      end_date: formData.get('end_date') || undefined,
      days_before_due: parseInt(formData.get('days_before_due') as string),
      reference: formData.get('reference') || undefined,
      invoice_discount_percentage: parseFloat(formData.get('invoice_discount_percentage') as string) || 0,
      notes: formData.get('notes') || undefined,
      internal_notes: formData.get('internal_notes') || undefined,
      is_active: formData.get('is_active') === 'true'
    })

    const { id, ...updateData } = validatedData

    const { error: updateError } = await supabase
      .from('recurring_invoices')
      .update({
        ...updateData,
        updated_at: new Date().toISOString()
      })
      .eq('id', id)

    if (updateError) return { error: 'Failed to update recurring invoice' }

    await supabase.from('recurring_invoice_line_items').delete().eq('recurring_invoice_id', id)

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
        if (lineItemsError) return { error: 'Failed to update line items' }
      }
    }

    await logAuditEvent({
      user_id: user.id,
      user_email: user.email,
      operation_type: 'update',
      resource_type: 'recurring_invoice',
      resource_id: id,
      operation_status: 'success'
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
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { error: 'Unauthorized' }

    const hasPermission = await checkUserPermission('invoices', 'delete')
    if (!hasPermission) return { error: 'You do not have permission to delete recurring invoices' }

    const id = formData.get('id') as string
    if (!id) return { error: 'ID required' }

    const { error: lineItemsError } = await supabase
      .from('recurring_invoice_line_items')
      .delete()
      .eq('recurring_invoice_id', id)

    if (lineItemsError) return { error: 'Failed to delete items' }

    const { error: deleteError } = await supabase
      .from('recurring_invoices')
      .delete()
      .eq('id', id)

    if (deleteError) return { error: 'Failed to delete invoice' }

    await logAuditEvent({
      user_id: user.id,
      user_email: user.email,
      operation_type: 'delete',
      resource_type: 'recurring_invoice',
      resource_id: id,
      operation_status: 'success'
    })

    revalidatePath('/invoices/recurring')
    return { success: true }
  } catch (error) {
    return { error: 'An unexpected error occurred' }
  }
}

// Generate invoice from recurring invoice
export async function generateInvoiceFromRecurring(
  recurringInvoiceId: string
) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    
    const hasPermission = await checkUserPermission('invoices', 'create')
    if (!hasPermission) return { error: 'Insufficient permissions' }

    // Get recurring invoice details
    const { data: recurringInvoice, error: fetchError } = await supabase
      .from('recurring_invoices')
      .select(`
        *,
        vendor:invoice_vendors(
          id,
          name,
          payment_terms
        ),
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

    if (fetchError || !recurringInvoice) return { error: 'Recurring invoice not found' }
    if (!recurringInvoice.is_active) return { error: 'Recurring invoice is not active' }

    // Calculate dates
    const invoiceDateIso = recurringInvoice.next_invoice_date
    const vendorPaymentTerms = typeof recurringInvoice.vendor?.payment_terms === 'number'
      ? recurringInvoice.vendor.payment_terms
      : null
    const effectivePaymentTerms = Number(vendorPaymentTerms ?? recurringInvoice.days_before_due ?? 0) || 0
    const dueDateIso = addDaysIsoDate(invoiceDateIso, effectivePaymentTerms)

    // Prepare line items for service
    const lineItems: InvoiceLineItemInput[] = (recurringInvoice.line_items ?? []).map((item: any) => ({
      catalog_item_id: item.catalog_item_id,
      description: item.description,
      quantity: Number(item.quantity) || 0,
      unit_price: Number(item.unit_price) || 0,
      discount_percentage: Number(item.discount_percentage) || 0,
      vat_rate: Number(item.vat_rate) || 0
    }))

    // Use InvoiceService to create the invoice
    const newInvoice = await InvoiceService.createInvoice({
      vendor_id: recurringInvoice.vendor_id,
      invoice_date: invoiceDateIso,
      due_date: dueDateIso,
      reference: recurringInvoice.reference,
      invoice_discount_percentage: Number(recurringInvoice.invoice_discount_percentage) || 0,
      notes: recurringInvoice.notes,
      internal_notes: recurringInvoice.internal_notes,
      line_items: lineItems
    })

    // Update recurring invoice next date
    const nextDateIso = calculateNextInvoiceIsoDate(
      invoiceDateIso,
      recurringInvoice.frequency as RecurringFrequency
    )

    await supabase
      .from('recurring_invoices')
      .update({
        next_invoice_date: nextDateIso,
        last_invoice_id: newInvoice.id,
        updated_at: new Date().toISOString()
      })
      .eq('id', recurringInvoiceId)

    await logAuditEvent({
      user_id: user?.id, // Might be undefined if triggered by cron, handle gracefully in audit
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
  } catch (error: any) {
    console.error('Error in generateInvoiceFromRecurring:', error)
    return { error: error.message || 'An unexpected error occurred' }
  }
}

export async function toggleRecurringInvoiceStatus(formData: FormData) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { error: 'Unauthorized' }

    const hasPermission = await checkUserPermission('invoices', 'edit')
    if (!hasPermission) return { error: 'Insufficient permissions' }

    const id = formData.get('id') as string
    const currentStatus = formData.get('current_status') === 'true'
    if (!id) return { error: 'ID required' }

    const { error } = await supabase
      .from('recurring_invoices')
      .update({ 
        is_active: !currentStatus,
        updated_at: new Date().toISOString()
      })
      .eq('id', id)

    if (error) return { error: 'Failed to toggle status' }

    await logAuditEvent({
      user_id: user.id,
      user_email: user.email,
      operation_type: 'update',
      resource_type: 'recurring_invoice',
      resource_id: id,
      operation_status: 'success',
      additional_info: { 
        action: !currentStatus ? 'activated' : 'deactivated'
      }
    })

    revalidatePath('/invoices/recurring')
    return { success: true, newStatus: !currentStatus }
  } catch (error) {
    return { error: 'An unexpected error occurred' }
  }
}
