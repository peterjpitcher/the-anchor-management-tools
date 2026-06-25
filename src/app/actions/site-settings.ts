'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { logAuditEvent } from '@/app/actions/audit'
import { checkUserPermission } from '@/app/actions/rbac'
import { z } from 'zod'

export interface SiteSettings {
  id: string
  name: string
  phone: string | null
  email: string | null
  website: string | null
  address: string | null
  online_bookings_enabled: boolean
  sms_notifications_enabled: boolean
  auto_confirm_bookings: boolean
  default_party_size: number
  booking_duration_mins: number
  advance_booking_days: number
  deposit_amount: number
  min_group_size_deposit: number
  currency: string
  reminder_hours_before: number
  admin_email: string | null
  cc_email: string | null
}

const blankToNull = (value: unknown) => {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

const nullableEmail = z.preprocess(
  blankToNull,
  z.string().email('Invalid email address').nullable()
)

const nullableUrl = z.preprocess(
  blankToNull,
  z.string().url('Invalid website URL').nullable()
)

const nullableText = (max: number) => z.preprocess(
  blankToNull,
  z.string().max(max).nullable()
)

const SiteSettingsFormSchema = z.object({
  id: z.string().min(1, 'Missing site ID'),
  name: z.string().trim().min(1, 'Business name is required').max(120),
  phone: nullableText(40),
  email: nullableEmail,
  website: nullableUrl,
  address: nullableText(500),
  default_party_size: z.coerce.number().int().min(1).max(50),
  booking_duration_mins: z.coerce.number().int().min(15).max(480),
  advance_booking_days: z.coerce.number().int().min(0).max(730),
  deposit_amount: z.coerce.number().min(0).max(10000),
  min_group_size_deposit: z.coerce.number().int().min(1).max(100),
  currency: z.string().trim().regex(/^[A-Z]{3}$/, 'Currency must be a 3-letter code'),
  reminder_hours_before: z.coerce.number().int().min(1).max(168),
  admin_email: nullableEmail,
  cc_email: nullableEmail,
})

export async function getSiteSettings(): Promise<{ settings?: SiteSettings; error?: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Unauthorized' }

  const { data, error } = await supabase
    .from('sites')
    .select('id, name, phone, email, website, address, online_bookings_enabled, sms_notifications_enabled, auto_confirm_bookings, default_party_size, booking_duration_mins, advance_booking_days, deposit_amount, min_group_size_deposit, currency, reminder_hours_before, admin_email, cc_email')
    .limit(1)
    .single()

  if (error) return { error: error.message }
  return { settings: data as SiteSettings }
}

export async function updateSiteSettings(formData: FormData): Promise<{ success?: boolean; error?: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Unauthorized' }
  const canManage = await checkUserPermission('settings', 'manage', user.id)
  if (!canManage) return { error: 'Permission denied' }

  const parsed = SiteSettingsFormSchema.safeParse({
    id: formData.get('id'),
    name: formData.get('name'),
    phone: formData.get('phone'),
    email: formData.get('email'),
    website: formData.get('website'),
    address: formData.get('address'),
    default_party_size: formData.get('default_party_size'),
    booking_duration_mins: formData.get('booking_duration_mins'),
    advance_booking_days: formData.get('advance_booking_days'),
    deposit_amount: formData.get('deposit_amount'),
    min_group_size_deposit: formData.get('min_group_size_deposit'),
    currency: formData.get('currency'),
    reminder_hours_before: formData.get('reminder_hours_before'),
    admin_email: formData.get('admin_email'),
    cc_email: formData.get('cc_email'),
  })

  if (!parsed.success) {
    return { error: parsed.error.errors[0]?.message || 'Invalid settings' }
  }

  const updates: Record<string, unknown> = {
    name: parsed.data.name,
    phone: parsed.data.phone,
    email: parsed.data.email,
    website: parsed.data.website,
    address: parsed.data.address,
    default_party_size: parsed.data.default_party_size,
    booking_duration_mins: parsed.data.booking_duration_mins,
    advance_booking_days: parsed.data.advance_booking_days,
    deposit_amount: parsed.data.deposit_amount,
    min_group_size_deposit: parsed.data.min_group_size_deposit,
    currency: parsed.data.currency,
    reminder_hours_before: parsed.data.reminder_hours_before,
    admin_email: parsed.data.admin_email,
    cc_email: parsed.data.cc_email,
    updated_at: new Date().toISOString(),
  }

  const { error } = await supabase
    .from('sites')
    .update(updates)
    .eq('id', parsed.data.id)

  if (error) return { error: error.message }

  await logAuditEvent({
    user_id: user.id,
    operation_type: 'update',
    resource_type: 'site_settings',
    operation_status: 'success',
  })

  revalidatePath('/settings')
  return { success: true }
}

export async function updateSiteToggle(
  siteId: string,
  field: string,
  value: boolean,
): Promise<{ success?: boolean; error?: string }> {
  const allowedFields = [
    'online_bookings_enabled',
    'sms_notifications_enabled',
    'auto_confirm_bookings',
  ]
  if (!allowedFields.includes(field)) return { error: 'Invalid field' }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Unauthorized' }
  const canManage = await checkUserPermission('settings', 'manage', user.id)
  if (!canManage) return { error: 'Permission denied' }

  const { error } = await supabase
    .from('sites')
    .update({ [field]: value, updated_at: new Date().toISOString() })
    .eq('id', siteId)

  if (error) return { error: error.message }

  await logAuditEvent({
    user_id: user.id,
    operation_type: 'update',
    resource_type: 'site_settings',
    operation_status: 'success',
  })

  revalidatePath('/settings')
  return { success: true }
}
