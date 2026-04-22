'use server'

import { createClient } from '@/lib/supabase/server'
import { checkUserPermission } from '@/app/actions/rbac'
import { logAuditEvent } from '@/app/actions/audit'
import { z } from 'zod'

const RecurringChargeSchema = z.object({
  vendor_id: z.string().uuid('Invalid vendor ID'),
  description: z.string().min(1, 'Description is required').max(200),
  amount_ex_vat: z.coerce.number().min(0),
  vat_rate: z.coerce.number().min(0).max(100),
  frequency: z.enum(['monthly', 'quarterly', 'annually']).default('monthly'),
  is_active: z.coerce.boolean().optional(),
  sort_order: z.coerce.number().int().min(0).max(1000).optional(),
})

export async function getRecurringCharges(vendorId: string) {
  const hasPermission = await checkUserPermission('oj_projects', 'view')
  if (!hasPermission) return { error: 'You do not have permission to view recurring charges' }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('oj_vendor_recurring_charges')
    .select('id, vendor_id, description, amount_ex_vat, vat_rate, frequency, is_active, sort_order, created_at, updated_at')
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
    frequency: formData.get('frequency') ?? undefined,
    is_active: formData.get('is_active') ?? undefined,
    sort_order: formData.get('sort_order') ?? undefined,
  })
  if (!parsed.success) return { error: parsed.error.errors[0].message }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data, error } = await supabase
    .from('oj_vendor_recurring_charges')
    .insert({
      vendor_id: parsed.data.vendor_id,
      description: parsed.data.description,
      amount_ex_vat: parsed.data.amount_ex_vat,
      vat_rate: parsed.data.vat_rate,
      frequency: parsed.data.frequency,
      is_active: parsed.data.is_active ?? true,
      sort_order: parsed.data.sort_order ?? 0,
    })
    .select('*')
    .single()

  if (error) return { error: error.message }

  await logAuditEvent({
    user_id: user?.id,
    user_email: user?.email,
    operation_type: 'create',
    resource_type: 'oj_recurring_charge',
    resource_id: data.id,
    operation_status: 'success',
    new_values: { vendor_id: data.vendor_id, description: data.description, amount_ex_vat: data.amount_ex_vat, frequency: data.frequency },
  })

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
    frequency: formData.get('frequency') ?? undefined,
    is_active: formData.get('is_active') ?? undefined,
    sort_order: formData.get('sort_order') ?? undefined,
  })
  if (!parsed.success) return { error: parsed.error.errors[0].message }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data, error } = await supabase
    .from('oj_vendor_recurring_charges')
    .update({
      description: parsed.data.description,
      amount_ex_vat: parsed.data.amount_ex_vat,
      vat_rate: parsed.data.vat_rate,
      frequency: parsed.data.frequency,
      is_active: parsed.data.is_active ?? true,
      sort_order: parsed.data.sort_order ?? 0,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select('*')
    .maybeSingle()

  if (error) return { error: error.message }
  if (!data) return { error: 'Charge not found' }

  await logAuditEvent({
    user_id: user?.id,
    user_email: user?.email,
    operation_type: 'update',
    resource_type: 'oj_recurring_charge',
    resource_id: id,
    operation_status: 'success',
    new_values: { description: data.description, amount_ex_vat: data.amount_ex_vat, is_active: data.is_active },
  })

  return { charge: data, success: true as const }
}

export async function disableRecurringCharge(formData: FormData) {
  const hasPermission = await checkUserPermission('oj_projects', 'edit')
  if (!hasPermission) return { error: 'You do not have permission to manage recurring charges' }

  const id = String(formData.get('id') || '')
  if (!id) return { error: 'Charge ID is required' }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: updatedCharge, error } = await supabase
    .from('oj_vendor_recurring_charges')
    .update({
      is_active: false,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select('id')
    .maybeSingle()

  if (error) return { error: error.message }
  if (!updatedCharge) return { error: 'Charge not found' }

  await logAuditEvent({
    user_id: user?.id,
    user_email: user?.email,
    operation_type: 'update',
    resource_type: 'oj_recurring_charge',
    resource_id: id,
    operation_status: 'success',
    additional_info: { action: 'disable' },
  })

  return { success: true as const }
}
