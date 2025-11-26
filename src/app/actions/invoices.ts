'use server'

import { createClient } from '@/lib/supabase/server'
import { checkUserPermission } from '@/app/actions/rbac'
import { logAuditEvent } from './audit'
import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import type {
  Invoice,
  InvoiceWithDetails,
  InvoiceStatus,
  InvoiceLineItemInput,
  LineItemCatalogItem
} from '@/types/invoices'
import { InvoiceService, CreateInvoiceSchema } from '@/services/invoices'

type CreateInvoiceResult = { error: string } | { success: true; invoice: Invoice }

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
    const hasPermission = await checkUserPermission('invoices', 'edit')
    if (!hasPermission) {
      return { error: 'You do not have permission to update invoices' }
    }

    const invoiceId = formData.get('invoiceId') as string
    const newStatus = formData.get('status') as InvoiceStatus

    if (!invoiceId || !newStatus) {
      return { error: 'Invoice ID and status are required' }
    }

    const { updatedInvoice, oldStatus } = await InvoiceService.updateInvoiceStatus(invoiceId, newStatus)

    await logAuditEvent({
      operation_type: 'update',
      resource_type: 'invoice',
      resource_id: invoiceId,
      operation_status: 'success',
      old_values: { status: oldStatus },
      new_values: { status: newStatus },
      additional_info: { invoice_number: updatedInvoice.invoice_number }
    })

    revalidatePath('/invoices')
    revalidatePath(`/invoices/${invoiceId}`)
    
    return { success: true }
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

    revalidatePath('/invoices')
    revalidatePath(`/invoices/${invoiceId}`)
    
    return { payment, success: true }
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
