'use server'

import { createClient } from '@/lib/supabase/server'
import { checkUserPermission } from '@/app/actions/rbac'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { logAuditEvent } from './audit'

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
  const hasPermission = await checkUserPermission('invoices', 'view')
  if (!hasPermission) return { error: 'Insufficient permissions' }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('invoice_vendor_contacts')
    .select('id, vendor_id, name, email, phone, role, is_primary, receive_invoice_copy, created_at')
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
  const { data: createdContact, error } = await supabase
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
    .select('id, vendor_id, role, is_primary, receive_invoice_copy')
    .maybeSingle()

  if (error) return { error: error.message }
  if (!createdContact) return { error: 'Failed to create contact' }

  const { data: { user } } = await supabase.auth.getUser()
  await logAuditEvent({
    user_id: user?.id,
    ...(user?.email && { user_email: user.email }),
    operation_type: 'create',
    resource_type: 'invoice_vendor_contact',
    resource_id: createdContact.id,
    operation_status: 'success',
    new_values: {
      vendor_id: createdContact.vendor_id,
      role: createdContact.role,
      is_primary: createdContact.is_primary,
      receive_invoice_copy: createdContact.receive_invoice_copy,
    },
  })

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
    .select('id, vendor_id, role, is_primary, receive_invoice_copy')
    .maybeSingle()

  if (error) return { error: error.message }
  if (!updatedContact) return { error: 'Contact not found' }

  const { data: { user } } = await supabase.auth.getUser()
  await logAuditEvent({
    user_id: user?.id,
    ...(user?.email && { user_email: user.email }),
    operation_type: 'update',
    resource_type: 'invoice_vendor_contact',
    resource_id: updatedContact.id,
    operation_status: 'success',
    new_values: {
      vendor_id: updatedContact.vendor_id,
      role: updatedContact.role,
      is_primary: updatedContact.is_primary,
      receive_invoice_copy: updatedContact.receive_invoice_copy,
    },
  })

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
    .select('id, vendor_id, role, is_primary, receive_invoice_copy')
    .maybeSingle()

  if (error) return { error: error.message }
  if (!deletedContact) return { error: 'Contact not found' }

  const { data: { user } } = await supabase.auth.getUser()
  await logAuditEvent({
    user_id: user?.id,
    ...(user?.email && { user_email: user.email }),
    operation_type: 'delete',
    resource_type: 'invoice_vendor_contact',
    resource_id: deletedContact.id,
    operation_status: 'success',
    old_values: {
      vendor_id: deletedContact.vendor_id,
      role: deletedContact.role,
      is_primary: deletedContact.is_primary,
      receive_invoice_copy: deletedContact.receive_invoice_copy,
    },
  })

  revalidatePath('/invoices/vendors')
  return { success: true }
}
