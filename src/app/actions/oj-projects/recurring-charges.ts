'use server'

import { createClient } from '@/lib/supabase/server'
import { checkUserPermission } from '@/app/actions/rbac'
import { z } from 'zod'

const RecurringChargeSchema = z.object({
  vendor_id: z.string().uuid('Invalid vendor ID'),
  description: z.string().min(1, 'Description is required').max(200),
  amount_ex_vat: z.coerce.number().min(0),
  vat_rate: z.coerce.number().min(0).max(100),
  is_active: z.coerce.boolean().optional(),
  sort_order: z.coerce.number().int().min(0).max(1000).optional(),
})

export async function getRecurringCharges(vendorId: string) {
  const hasPermission = await checkUserPermission('oj_projects', 'view')
  if (!hasPermission) return { error: 'You do not have permission to view recurring charges' }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('oj_vendor_recurring_charges')
    .select('*')
    .eq('vendor_id', vendorId)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })

  if (error) return { error: error.message }
  return { charges: data || [] }
}

export async function createRecurringCharge(formData: FormData) {
  const hasPermission = await checkUserPermission('oj_projects', 'edit')
  if (!hasPermission) return { error: 'You do not have permission to manage recurring charges' }

  const parsed = RecurringChargeSchema.safeParse({
    vendor_id: formData.get('vendor_id'),
    description: formData.get('description'),
    amount_ex_vat: formData.get('amount_ex_vat'),
    vat_rate: formData.get('vat_rate'),
    is_active: formData.get('is_active') ?? undefined,
    sort_order: formData.get('sort_order') ?? undefined,
  })
  if (!parsed.success) return { error: parsed.error.errors[0].message }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('oj_vendor_recurring_charges')
    .insert({
      vendor_id: parsed.data.vendor_id,
      description: parsed.data.description,
      amount_ex_vat: parsed.data.amount_ex_vat,
      vat_rate: parsed.data.vat_rate,
      is_active: parsed.data.is_active ?? true,
      sort_order: parsed.data.sort_order ?? 0,
    })
    .select('*')
    .single()

  if (error) return { error: error.message }
  return { charge: data, success: true as const }
}

export async function updateRecurringCharge(formData: FormData) {
  const hasPermission = await checkUserPermission('oj_projects', 'edit')
  if (!hasPermission) return { error: 'You do not have permission to manage recurring charges' }

  const id = String(formData.get('id') || '')
  if (!id) return { error: 'Charge ID is required' }

  const parsed = RecurringChargeSchema.safeParse({
    vendor_id: formData.get('vendor_id'),
    description: formData.get('description'),
    amount_ex_vat: formData.get('amount_ex_vat'),
    vat_rate: formData.get('vat_rate'),
    is_active: formData.get('is_active') ?? undefined,
    sort_order: formData.get('sort_order') ?? undefined,
  })
  if (!parsed.success) return { error: parsed.error.errors[0].message }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('oj_vendor_recurring_charges')
    .update({
      description: parsed.data.description,
      amount_ex_vat: parsed.data.amount_ex_vat,
      vat_rate: parsed.data.vat_rate,
      is_active: parsed.data.is_active ?? true,
      sort_order: parsed.data.sort_order ?? 0,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select('*')
    .single()

  if (error) return { error: error.message }
  return { charge: data, success: true as const }
}

export async function disableRecurringCharge(formData: FormData) {
  const hasPermission = await checkUserPermission('oj_projects', 'edit')
  if (!hasPermission) return { error: 'You do not have permission to manage recurring charges' }

  const id = String(formData.get('id') || '')
  if (!id) return { error: 'Charge ID is required' }

  const supabase = await createClient()
  const { error } = await supabase
    .from('oj_vendor_recurring_charges')
    .update({
      is_active: false,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)

  if (error) return { error: error.message }
  return { success: true as const }
}

