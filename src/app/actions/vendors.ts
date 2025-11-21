'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { checkUserPermission } from '@/app/actions/rbac'
import { logAuditEvent } from './audit'
import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import type { InvoiceVendor } from '@/types/invoices'
import { parsePaymentTermsValue } from '@/lib/vendors/paymentTerms'
import { VendorService } from '@/services/vendors' // Import the new service

// Vendor validation schema
const VendorSchema = z.object({
  name: z.string().min(1, 'Company name is required'),
  contact_name: z.string().optional().or(z.literal('')),
  email: z.string().email('Invalid email format').optional().or(z.literal('')),
  phone: z.string().optional().or(z.literal('')),
  address: z.string().optional().or(z.literal('')),
  vat_number: z.string().optional().or(z.literal('')),
  payment_terms: z.number().min(0).default(30),
  notes: z.string().optional().or(z.literal(''))
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
      payment_terms: parsePaymentTermsValue(formData.get('payment_terms')),
      notes: formData.get('notes') || undefined
    })

    const vendor = await VendorService.createVendor(validatedData);

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
  } catch (error: any) {
    console.error('Error in createVendor:', error)
    if (error instanceof z.ZodError) {
      return { error: error.errors[0].message }
    }
    return { error: error.message || 'An unexpected error occurred' }
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
      payment_terms: parsePaymentTermsValue(formData.get('payment_terms')),
      notes: formData.get('notes') || undefined
    })

    const vendor = await VendorService.updateVendor(vendorId, validatedData);

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
  } catch (error: any) {
    console.error('Error in updateVendor:', error)
    if (error instanceof z.ZodError) {
      return { error: error.errors[0].message }
    }
    return { error: error.message || 'An unexpected error occurred' }
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

    const { action } = await VendorService.deleteVendor(vendorId);

    await logAuditEvent({
      operation_type: action === 'deactivated' ? 'deactivate' : 'delete',
      resource_type: 'vendor',
      resource_id: vendorId,
      operation_status: 'success',
      additional_info: action === 'deactivated' ? { reason: 'Has associated invoices' } : undefined
    })

    revalidatePath('/invoices/vendors')
    
    return { success: true }
  } catch (error: any) {
    console.error('Error in deleteVendor:', error)
    return { error: error.message || 'An unexpected error occurred' }
  }
}