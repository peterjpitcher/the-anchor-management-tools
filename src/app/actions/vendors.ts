'use server'

import { createClient, createAdminClient } from '@/lib/supabase/server'
import { checkUserPermission } from '@/app/actions/rbac'
import { logAuditEvent } from './audit'
import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import type { InvoiceVendor } from '@/types/invoices'

// Vendor validation schema
const VendorSchema = z.object({
  name: z.string().min(1, 'Company name is required'),
  contact_name: z.string().optional(),
  email: z.string().email('Invalid email format').optional().or(z.literal('')),
  phone: z.string().optional(),
  address: z.string().optional(),
  vat_number: z.string().optional(),
  payment_terms: z.number().min(0).default(30),
  notes: z.string().optional()
})

export async function getVendors() {
  try {
    const supabase = await createClient()
    
    const hasPermission = await checkUserPermission('invoices', 'view')
    if (!hasPermission) {
      return { error: 'You do not have permission to view vendors' }
    }

    const { data: vendors, error } = await supabase
      .from('invoice_vendors')
      .select('*')
      .eq('is_active', true)
      .order('name')

    if (error) {
      console.error('Error fetching vendors:', error)
      return { error: 'Failed to fetch vendors' }
    }

    return { vendors: vendors as InvoiceVendor[] }
  } catch (error) {
    console.error('Error in getVendors:', error)
    return { error: 'An unexpected error occurred' }
  }
}

export async function createVendor(formData: FormData) {
  try {
    const supabase = await createClient()
    
    const hasPermission = await checkUserPermission('invoices', 'create')
    if (!hasPermission) {
      return { error: 'You do not have permission to create vendors' }
    }

    const validatedData = VendorSchema.parse({
      name: formData.get('name'),
      contact_name: formData.get('contact_name') || undefined,
      email: formData.get('email') || undefined,
      phone: formData.get('phone') || undefined,
      address: formData.get('address') || undefined,
      vat_number: formData.get('vat_number') || undefined,
      payment_terms: parseInt(formData.get('payment_terms') as string) || 30,
      notes: formData.get('notes') || undefined
    })

    const { data: vendor, error } = await supabase
      .from('invoice_vendors')
      .insert([validatedData])
      .select()
      .single()

    if (error) {
      console.error('Error creating vendor:', error)
      return { error: 'Failed to create vendor' }
    }

    await logAuditEvent({
      operation_type: 'create',
      resource_type: 'vendor',
      resource_id: vendor.id,
      operation_status: 'success',
      new_values: { name: vendor.name }
    })

    revalidatePath('/invoices/vendors')
    revalidatePath('/invoices/new')
    
    return { vendor, success: true }
  } catch (error) {
    console.error('Error in createVendor:', error)
    if (error instanceof z.ZodError) {
      return { error: error.errors[0].message }
    }
    return { error: 'An unexpected error occurred' }
  }
}

export async function updateVendor(formData: FormData) {
  try {
    const supabase = await createClient()
    
    const hasPermission = await checkUserPermission('invoices', 'edit')
    if (!hasPermission) {
      return { error: 'You do not have permission to update vendors' }
    }

    const vendorId = formData.get('vendorId') as string
    if (!vendorId) {
      return { error: 'Vendor ID is required' }
    }

    const validatedData = VendorSchema.parse({
      name: formData.get('name'),
      contact_name: formData.get('contact_name') || undefined,
      email: formData.get('email') || undefined,
      phone: formData.get('phone') || undefined,
      address: formData.get('address') || undefined,
      vat_number: formData.get('vat_number') || undefined,
      payment_terms: parseInt(formData.get('payment_terms') as string) || 30,
      notes: formData.get('notes') || undefined
    })

    const { data: vendor, error } = await supabase
      .from('invoice_vendors')
      .update(validatedData)
      .eq('id', vendorId)
      .select()
      .single()

    if (error) {
      console.error('Error updating vendor:', error)
      return { error: 'Failed to update vendor' }
    }

    await logAuditEvent({
      operation_type: 'update',
      resource_type: 'vendor',
      resource_id: vendor.id,
      operation_status: 'success',
      new_values: { name: vendor.name }
    })

    revalidatePath('/invoices/vendors')
    revalidatePath('/invoices')
    
    return { vendor, success: true }
  } catch (error) {
    console.error('Error in updateVendor:', error)
    if (error instanceof z.ZodError) {
      return { error: error.errors[0].message }
    }
    return { error: 'An unexpected error occurred' }
  }
}

export async function deleteVendor(formData: FormData) {
  try {
    const supabase = await createClient()
    
    const hasPermission = await checkUserPermission('invoices', 'delete')
    if (!hasPermission) {
      return { error: 'You do not have permission to delete vendors' }
    }

    const vendorId = formData.get('vendorId') as string
    if (!vendorId) {
      return { error: 'Vendor ID is required' }
    }

    // Check if vendor has any invoices
    const { data: invoices, error: checkError } = await supabase
      .from('invoices')
      .select('id')
      .eq('vendor_id', vendorId)
      .limit(1)

    if (checkError) {
      console.error('Error checking vendor usage:', checkError)
      return { error: 'Failed to check vendor usage' }
    }

    if (invoices && invoices.length > 0) {
      // Soft delete by marking as inactive
      const { error } = await supabase
        .from('invoice_vendors')
        .update({ is_active: false })
        .eq('id', vendorId)

      if (error) {
        console.error('Error deactivating vendor:', error)
        return { error: 'Failed to deactivate vendor' }
      }

      await logAuditEvent({
        operation_type: 'deactivate',
        resource_type: 'vendor',
        resource_id: vendorId,
        operation_status: 'success',
        additional_info: { reason: 'Has associated invoices' }
      })
    } else {
      // Hard delete if no invoices
      const { error } = await supabase
        .from('invoice_vendors')
        .delete()
        .eq('id', vendorId)

      if (error) {
        console.error('Error deleting vendor:', error)
        return { error: 'Failed to delete vendor' }
      }

      await logAuditEvent({
        operation_type: 'delete',
        resource_type: 'vendor',
        resource_id: vendorId,
        operation_status: 'success'
      })
    }

    revalidatePath('/invoices/vendors')
    
    return { success: true }
  } catch (error) {
    console.error('Error in deleteVendor:', error)
    return { error: 'An unexpected error occurred' }
  }
}