'use server'

import { createClient } from '@/lib/supabase/server'
import { checkUserPermission } from '@/app/actions/rbac'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'

const ContactSchema = z.object({
  vendorId: z.string().uuid('Invalid vendor ID'),
  name: z.string().optional(),
  email: z.string().email('Invalid email address'),
  phone: z.string().optional(),
  role: z.string().optional(),
  isPrimary: z.coerce.boolean().optional(),
  receiveInvoiceCopy: z.coerce.boolean().optional(),
})

export async function getVendorContacts(vendorId: string) {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('invoice_vendor_contacts')
    .select('*')
    .eq('vendor_id', vendorId)
    .order('is_primary', { ascending: false })
    .order('created_at', { ascending: true })

  if (error) return { error: error.message }
  return { contacts: data || [] }
}

export async function createVendorContact(formData: FormData) {
  const hasPermission = await checkUserPermission('invoices', 'edit')
  if (!hasPermission) return { error: 'Insufficient permissions' }

  const parsed = ContactSchema.safeParse({
    vendorId: formData.get('vendorId'),
    name: formData.get('name') || undefined,
    email: formData.get('email'),
    phone: formData.get('phone') || undefined,
    role: formData.get('role') || undefined,
    isPrimary: formData.get('isPrimary') === 'true',
    receiveInvoiceCopy: formData.get('receiveInvoiceCopy') === 'true',
  })
  if (!parsed.success) return { error: parsed.error.errors[0].message }

  const supabase = await createClient()
  const { error } = await supabase
    .from('invoice_vendor_contacts')
    .insert({
      vendor_id: parsed.data.vendorId,
      name: parsed.data.name || null,
      email: parsed.data.email,
      phone: parsed.data.phone || null,
      role: parsed.data.role || null,
      is_primary: parsed.data.isPrimary || false,
      receive_invoice_copy: parsed.data.receiveInvoiceCopy || false,
    })

  if (error) return { error: error.message }
  revalidatePath('/invoices/vendors')
  return { success: true }
}

export async function updateVendorContact(formData: FormData) {
  const hasPermission = await checkUserPermission('invoices', 'edit')
  if (!hasPermission) return { error: 'Insufficient permissions' }

  const id = String(formData.get('id') || '')
  if (!id) return { error: 'Contact ID is required' }

  const parsed = ContactSchema.safeParse({
    vendorId: formData.get('vendorId'),
    name: formData.get('name') || undefined,
    email: formData.get('email'),
    phone: formData.get('phone') || undefined,
    role: formData.get('role') || undefined,
    isPrimary: formData.get('isPrimary') === 'true',
    receiveInvoiceCopy: formData.get('receiveInvoiceCopy') === 'true',
  })
  if (!parsed.success) return { error: parsed.error.errors[0].message }

  const supabase = await createClient()
  const { data: updatedContact, error } = await supabase
    .from('invoice_vendor_contacts')
    .update({
      name: parsed.data.name || null,
      email: parsed.data.email,
      phone: parsed.data.phone || null,
      role: parsed.data.role || null,
      is_primary: parsed.data.isPrimary || false,
      receive_invoice_copy: parsed.data.receiveInvoiceCopy || false,
    })
    .eq('id', id)
    .select('id')
    .maybeSingle()

  if (error) return { error: error.message }
  if (!updatedContact) return { error: 'Contact not found' }
  revalidatePath('/invoices/vendors')
  return { success: true }
}

export async function deleteVendorContact(formData: FormData) {
  const hasPermission = await checkUserPermission('invoices', 'edit')
  if (!hasPermission) return { error: 'Insufficient permissions' }

  const id = String(formData.get('id') || '')
  if (!id) return { error: 'Contact ID is required' }

  const supabase = await createClient()
  const { data: deletedContact, error } = await supabase
    .from('invoice_vendor_contacts')
    .delete()
    .eq('id', id)
    .select('id')
    .maybeSingle()

  if (error) return { error: error.message }
  if (!deletedContact) return { error: 'Contact not found' }
  revalidatePath('/invoices/vendors')
  return { success: true }
}
