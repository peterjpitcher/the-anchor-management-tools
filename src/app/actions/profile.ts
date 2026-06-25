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

function normalizeExportEmail(value: string | null | undefined): string | null {
  const trimmed = value?.trim().toLowerCase()
  return trimmed || null
}

function uniqueExportEmails(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.map(normalizeExportEmail).filter((value): value is string => Boolean(value))))
}

const MAX_AVATAR_BYTES = 5 * 1024 * 1024
const AVATAR_TYPES = {
  'image/jpeg': {
    ext: 'jpg',
    matches: (bytes: Uint8Array) => bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff,
  },
  'image/png': {
    ext: 'png',
    matches: (bytes: Uint8Array) =>
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47 &&
      bytes[4] === 0x0d &&
      bytes[5] === 0x0a &&
      bytes[6] === 0x1a &&
      bytes[7] === 0x0a,
  },
  'image/webp': {
    ext: 'webp',
    matches: (bytes: Uint8Array) =>
      bytes[0] === 0x52 &&
      bytes[1] === 0x49 &&
      bytes[2] === 0x46 &&
      bytes[3] === 0x46 &&
      bytes[8] === 0x57 &&
      bytes[9] === 0x45 &&
      bytes[10] === 0x42 &&
      bytes[11] === 0x50,
  },
} as const

async function validateAvatarFile(file: File): Promise<{ ext: string } | { error: string }> {
  if (file.size > MAX_AVATAR_BYTES) {
    return { error: 'Avatar must be 5 MB or smaller' }
  }

  const avatarType = AVATAR_TYPES[file.type.toLowerCase() as keyof typeof AVATAR_TYPES]
  if (!avatarType) {
    return { error: 'Avatar must be a JPG, PNG, or WebP image' }
  }

  const header = new Uint8Array(await file.arrayBuffer()).slice(0, 12)
  if (!avatarType.matches(header)) {
    return { error: 'Avatar file content does not match the selected image type' }
  }

  return { ext: avatarType.ext }
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

  const emails = uniqueExportEmails([profile.email, user.email])
  let customerIds: string[] = []

  if (emails.length > 0) {
    const { data: customers, error: customersError } = await supabase
      .from('customers')
      .select('id')
      .in('email', emails)

    if (customersError) {
      console.error('Error resolving customers for profile export', customersError)
      return { error: 'Failed to export customer data' }
    }

    customerIds = Array.from(new Set((customers || []).map((customer) => customer.id).filter(Boolean)))
  }

  let messages: unknown[] = []

  if (customerIds.length > 0) {
    const { data: messageRows, error: messagesError } = await supabase
      .from('messages')
      .select('*')
      .in('customer_id', customerIds)

    if (messagesError) {
      console.error('Error exporting profile messages', messagesError)
      return { error: 'Failed to export messages' }
    }

    messages = messageRows || []
  }

  const exportPayload = {
    profile,
    customerIds,
    messages,
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

function getPasswordStrengthError(password: string, email?: string | null): string | null {
  if (password.length < 8) {
    return 'Password must be at least 8 characters long'
  }

  const categoryCount = [
    /[a-z]/.test(password),
    /[A-Z]/.test(password),
    /\d/.test(password),
    /[^A-Za-z0-9]/.test(password),
  ].filter(Boolean).length

  if (categoryCount < 3) {
    return 'Password must include at least three of: uppercase, lowercase, number, symbol'
  }

  const emailName = email?.split('@')[0]?.toLowerCase()
  if (emailName && emailName.length >= 4 && password.toLowerCase().includes(emailName)) {
    return 'Password must not include your email name'
  }

  return null
}

export async function changePassword({
  currentPassword,
  newPassword,
}: {
  currentPassword: string
  newPassword: string
}) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return { error: 'Not authenticated' }
  }

  if (!user.email) {
    return { error: 'This account does not have an email address' }
  }

  if (!currentPassword) {
    return { error: 'Enter your current password' }
  }

  const strengthError = getPasswordStrengthError(newPassword, user.email)
  if (strengthError) {
    return { error: strengthError }
  }

  if (currentPassword === newPassword) {
    return { error: 'New password must be different from your current password' }
  }

  const { error: signInError } = await supabase.auth.signInWithPassword({
    email: user.email,
    password: currentPassword,
  })

  if (signInError) {
    return { error: 'Current password is incorrect' }
  }

  const { error: updateError } = await supabase.auth.updateUser({
    password: newPassword,
  })

  if (updateError) {
    console.error('Error updating password', updateError)
    return { error: 'Failed to update password' }
  }

  try {
    await logAuditEvent({
      user_id: user.id,
      operation_type: 'password_change',
      resource_type: 'profile',
      resource_id: user.id,
      operation_status: 'success',
    })
  } catch (auditError) {
    console.error('Error logging password change audit event', auditError)
  }

  return { success: true as const }
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

  const validation = await validateAvatarFile(file)
  if ('error' in validation) {
    return validation
  }

  const fileName = `${user.id}.${validation.ext}`
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

export async function removeAvatar() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return { error: 'Not authenticated' }
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('avatar_url')
    .eq('id', user.id)
    .maybeSingle<Pick<ProfileRecord, 'avatar_url'>>()

  if (profileError) {
    console.error('Error loading profile avatar', profileError)
    return { error: 'Failed to load avatar' }
  }

  if (!profile) {
    return { error: 'Profile not found' }
  }

  const { data: updatedProfile, error: updateError } = await supabase
    .from('profiles')
    .update({
      avatar_url: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', user.id)
    .select('id')
    .maybeSingle()

  if (updateError) {
    console.error('Error removing profile avatar', updateError)
    return { error: 'Failed to remove avatar' }
  }

  if (!updatedProfile) {
    return { error: 'Profile not found' }
  }

  if (profile.avatar_url) {
    const { error: removeError } = await supabase.storage
      .from('avatars')
      .remove([profile.avatar_url])

    if (removeError) {
      console.error('Error deleting avatar file', removeError)
    }
  }

  try {
    await logAuditEvent({
      user_id: user.id,
      operation_type: 'update',
      resource_type: 'profile',
      resource_id: user.id,
      operation_status: 'success',
      additional_info: { field: 'avatar_url', action: 'removed' },
    })
  } catch (auditError) {
    console.error('Error logging avatar removal audit event', auditError)
  }

  revalidatePath('/profile')
  return { success: true as const }
}
