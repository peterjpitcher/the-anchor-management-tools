'use server'

import { createClient } from '@/lib/supabase/server'
import { checkUserPermission } from '@/app/actions/rbac'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'

const ContactSchema = z.object({
  vendorId: z.string().uuid('Invalid vendor ID'),
  name: z.string().optional(),
  email: z.string().email('Invalid email address'),
  isPrimary: z.coerce.boolean().optional()
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
    isPrimary: formData.get('isPrimary') === 'true'
  })
  if (!parsed.success) return { error: parsed.error.errors[0].message }

  const supabase = await createClient()
  const { error } = await supabase
    .from('invoice_vendor_contacts')
    .insert({
      vendor_id: parsed.data.vendorId,
      name: parsed.data.name || null,
      email: parsed.data.email,
      is_primary: parsed.data.isPrimary || false
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
    isPrimary: formData.get('isPrimary') === 'true'
  })
  if (!parsed.success) return { error: parsed.error.errors[0].message }

  const supabase = await createClient()
  const { error } = await supabase
    .from('invoice_vendor_contacts')
    .update({
      name: parsed.data.name || null,
      email: parsed.data.email,
      is_primary: parsed.data.isPrimary || false
    })
    .eq('id', id)

  if (error) return { error: error.message }
  revalidatePath('/invoices/vendors')
  return { success: true }
}

export async function deleteVendorContact(formData: FormData) {
  const hasPermission = await checkUserPermission('invoices', 'edit')
  if (!hasPermission) return { error: 'Insufficient permissions' }

  const id = String(formData.get('id') || '')
  if (!id) return { error: 'Contact ID is required' }

  const supabase = await createClient()
  const { error } = await supabase
    .from('invoice_vendor_contacts')
    .delete()
    .eq('id', id)

  if (error) return { error: error.message }
  revalidatePath('/invoices/vendors')
  return { success: true }
}

