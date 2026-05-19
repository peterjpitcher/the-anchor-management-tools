'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { logAuditEvent } from '@/app/actions/audit'

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

  const id = formData.get('id') as string
  if (!id) return { error: 'Missing site ID' }

  const updates: Record<string, unknown> = {
    name: formData.get('name') as string || 'The Anchor',
    phone: formData.get('phone') as string || null,
    email: formData.get('email') as string || null,
    website: formData.get('website') as string || null,
    address: formData.get('address') as string || null,
    default_party_size: parseInt(formData.get('default_party_size') as string) || 2,
    booking_duration_mins: parseInt(formData.get('booking_duration_mins') as string) || 90,
    advance_booking_days: parseInt(formData.get('advance_booking_days') as string) || 30,
    deposit_amount: parseFloat(formData.get('deposit_amount') as string) || 10.00,
    min_group_size_deposit: parseInt(formData.get('min_group_size_deposit') as string) || 7,
    currency: formData.get('currency') as string || 'GBP',
    reminder_hours_before: parseInt(formData.get('reminder_hours_before') as string) || 24,
    admin_email: formData.get('admin_email') as string || null,
    cc_email: formData.get('cc_email') as string || null,
    updated_at: new Date().toISOString(),
  }

  const { error } = await supabase
    .from('sites')
    .update(updates)
    .eq('id', id)

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
