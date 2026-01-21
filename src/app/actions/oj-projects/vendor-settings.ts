'use server'

import { createClient } from '@/lib/supabase/server'
import { checkUserPermission } from '@/app/actions/rbac'
import { z } from 'zod'

const BillingSettingsSchema = z.object({
  vendor_id: z.string().uuid('Invalid vendor ID'),
  client_code: z.string().trim().min(1).max(10).optional().or(z.literal('')).optional(),
  billing_mode: z.enum(['full', 'cap'] as const),
  monthly_cap_inc_vat: z.coerce.number().min(0).optional(),
  hourly_rate_ex_vat: z.coerce.number().min(0).max(10000),
  vat_rate: z.coerce.number().min(0).max(100),
  mileage_rate: z.coerce.number().min(0).max(100),
  retainer_included_hours_per_month: z.coerce.number().min(0).max(1000).optional(),
})

export async function getVendorBillingSettings(vendorId: string) {
  const hasPermission = await checkUserPermission('oj_projects', 'view')
  if (!hasPermission) return { error: 'You do not have permission to view OJ Projects settings' }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('oj_vendor_billing_settings')
    .select('*')
    .eq('vendor_id', vendorId)
    .maybeSingle()

  if (error) return { error: error.message }
  return { settings: data || null }
}

export async function upsertVendorBillingSettings(formData: FormData) {
  const hasPermission = await checkUserPermission('oj_projects', 'edit')
  if (!hasPermission) return { error: 'You do not have permission to edit OJ Projects settings' }

  const parsed = BillingSettingsSchema.safeParse({
    vendor_id: formData.get('vendor_id'),
    client_code: formData.get('client_code') ?? undefined,
    billing_mode: formData.get('billing_mode'),
    monthly_cap_inc_vat: formData.get('monthly_cap_inc_vat') ?? undefined,
    hourly_rate_ex_vat: formData.get('hourly_rate_ex_vat'),
    vat_rate: formData.get('vat_rate'),
    mileage_rate: formData.get('mileage_rate'),
    retainer_included_hours_per_month: formData.get('retainer_included_hours_per_month') ?? undefined,
  })

  if (!parsed.success) return { error: parsed.error.errors[0].message }

  if (parsed.data.billing_mode === 'cap') {
    const cap = parsed.data.monthly_cap_inc_vat
    if (typeof cap !== 'number' || !Number.isFinite(cap) || cap <= 0) {
      return { error: 'Monthly cap (inc VAT) is required for cap billing mode' }
    }
  }

  const clientCode = (parsed.data.client_code || '').trim()
  const normalizedClientCode = clientCode ? clientCode.toUpperCase().replace(/[^A-Z0-9]/g, '') : null

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('oj_vendor_billing_settings')
    .upsert(
      {
        vendor_id: parsed.data.vendor_id,
        client_code: normalizedClientCode,
        billing_mode: parsed.data.billing_mode,
        monthly_cap_inc_vat: parsed.data.billing_mode === 'cap' ? parsed.data.monthly_cap_inc_vat : null,
        hourly_rate_ex_vat: parsed.data.hourly_rate_ex_vat,
        vat_rate: parsed.data.vat_rate,
        mileage_rate: parsed.data.mileage_rate,
        retainer_included_hours_per_month: parsed.data.retainer_included_hours_per_month ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'vendor_id' }
    )
    .select('*')
    .single()

  if (error) return { error: error.message }
  return { settings: data, success: true as const }
}

