'use server'

import { createClient } from '@/lib/supabase/server'
import { logAuditEvent } from './audit'
import { revalidatePath } from 'next/cache'

type ProfileRecord = {
  id: string
  email: string | null
  full_name: string | null
  avatar_url: string | null
  created_at: string
  updated_at: string
  sms_notifications: boolean
  email_notifications: boolean
}

export async function loadProfile() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return { error: 'Not authenticated' }
  }

  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .maybeSingle<ProfileRecord>()

  if (error) {
    console.error('Error loading profile', error)
    return { error: 'Failed to load profile' }
  }

  if (!data) {
    const insertPayload = {
      id: user.id,
      email: user.email,
      full_name: user.user_metadata?.full_name ?? '',
      sms_notifications: true,
      email_notifications: true,
    }

    const { data: inserted, error: insertError } = await supabase
      .from('profiles')
      .insert(insertPayload)
      .select()
      .single<ProfileRecord>()

    if (insertError) {
      console.error('Error creating profile', insertError)
      return { error: 'Failed to create profile' }
    }

    return { success: true as const, profile: inserted }
  }

  return { success: true as const, profile: data }
}

export async function updateProfile({
  fullName,
}: {
  fullName: string
}) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return { error: 'Not authenticated' }
  }

  const { data: updatedProfile, error } = await supabase
    .from('profiles')
    .update({
      full_name: fullName,
      updated_at: new Date().toISOString(),
    })
    .eq('id', user.id)
    .select('id')
    .maybeSingle()

  if (error) {
    console.error('Error updating profile', error)
    return { error: 'Failed to update profile' }
  }

  if (!updatedProfile) {
    return { error: 'Profile not found' }
  }

  revalidatePath('/profile')
  return { success: true as const }
}

export async function toggleNotification({
  field,
  value,
}: {
  field: 'sms_notifications' | 'email_notifications'
  value: boolean
}) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return { error: 'Not authenticated' }
  }

  const { data: updatedProfile, error } = await supabase
    .from('profiles')
    .update({
      [field]: value,
      updated_at: new Date().toISOString(),
    })
    .eq('id', user.id)
    .select('id')
    .maybeSingle()

  if (error) {
    console.error('Error updating notifications', error)
    return { error: 'Failed to update notification preferences' }
  }

  if (!updatedProfile) {
    return { error: 'Profile not found' }
  }

  revalidatePath('/profile')
  return { success: true as const }
}

export async function exportProfileData() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return { error: 'Not authenticated' }
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single<ProfileRecord>()

  if (profileError) {
    console.error('Error exporting profile data', profileError)
    return { error: 'Failed to export data' }
  }

  const { data: messages } = await supabase
    .from('messages')
    .select('*')
    .eq('customer_id', user.id)

  const exportPayload = {
    profile,
    messages: messages || [],
    exportDate: new Date().toISOString(),
  }

  return {
    success: true as const,
    filename: `profile-data-${new Date().toISOString().split('T')[0]}.json`,
    content: JSON.stringify(exportPayload, null, 2),
  }
}

export async function requestAccountDeletion(reason = 'User requested account deletion') {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return { error: 'Not authenticated' }
  }

  try {
    await logAuditEvent({
      user_id: user.id,
      operation_type: 'delete_request',
      resource_type: 'profile',
      resource_id: user.id,
      operation_status: 'success',
      additional_info: { reason, status: 'pending' },
    })

    return { success: true as const }
  } catch (error) {
    console.error('Error logging account deletion request', error)
    return { error: 'Failed to submit deletion request' }
  }
}

export async function uploadAvatar(formData: FormData) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return { error: 'Not authenticated' }
  }

  const file = formData.get('avatar') as File | null
  if (!file || file.size === 0) {
    return { error: 'No file uploaded' }
  }

  const fileExt = file.name.split('.').pop()
  const fileName = `${user.id}.${fileExt || 'png'}`
  const filePath = `avatars/${fileName}`

  const { error: uploadError } = await supabase.storage
    .from('avatars')
    .upload(filePath, file, {
      cacheControl: '3600',
      upsert: true,
    })

  if (uploadError) {
    console.error('Error uploading avatar', uploadError)
    return { error: 'Failed to upload avatar' }
  }

  const { data: updatedProfile, error: updateError } = await supabase
    .from('profiles')
    .update({
      avatar_url: filePath,
      updated_at: new Date().toISOString(),
    })
    .eq('id', user.id)
    .select('id')
    .maybeSingle()

  if (updateError) {
    console.error('Error updating profile avatar', updateError)
    return { error: 'Failed to update avatar' }
  }

  if (!updatedProfile) {
    const { error: cleanupError } = await supabase.storage
      .from('avatars')
      .remove([filePath])

    if (cleanupError) {
      console.error('Failed to remove uploaded avatar after profile missing', cleanupError)
      return { error: 'Profile not found. Manual file cleanup may be required.' }
    }

    return { error: 'Profile not found' }
  }

  revalidatePath('/profile')
  return { success: true as const, avatarUrl: filePath }
}
