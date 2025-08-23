'use client'

import { useState, useEffect, useCallback } from 'react'
import { useSupabase } from '@/components/providers/SupabaseProvider'
import { useRouter } from 'next/navigation'
import { 
  UserCircleIcon, 
  CameraIcon,
  KeyIcon,
  BellIcon,
  TrashIcon,
  ArrowDownTrayIcon
} from '@heroicons/react/24/outline'
import Link from 'next/link'
// New UI components
import { Page } from '@/components/ui-v2/layout/Page'
import { Card } from '@/components/ui-v2/layout/Card'
import { Section } from '@/components/ui-v2/layout/Section'
import { Button } from '@/components/ui-v2/forms/Button'
import { LinkButton } from '@/components/ui-v2/navigation/LinkButton'
import { FormGroup } from '@/components/ui-v2/forms/FormGroup'
import { Input } from '@/components/ui-v2/forms/Input'
import { Toggle } from '@/components/ui-v2/forms/Toggle'
import { toast } from '@/components/ui-v2/feedback/Toast'
import { Skeleton } from '@/components/ui-v2/feedback/Skeleton'
import { EmptyState } from '@/components/ui-v2/display/EmptyState'
import { ConfirmDialog } from '@/components/ui-v2/overlay/ConfirmDialog'

interface Profile {
  id: string
  email: string
  full_name: string | null
  avatar_url: string | null
  created_at: string
  updated_at: string
  sms_notifications: boolean
  email_notifications: boolean
}

export default function ProfilePage() {
  const supabase = useSupabase()
  const router = useRouter()
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [fullName, setFullName] = useState('')
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  const loadProfile = useCallback(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        router.push('/auth/login')
        return
      }

      // First check if profile exists
      const { data: fetchedProfile, error: fetchError } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single()

      let existingProfile = fetchedProfile
      
      if (fetchError && fetchError.code === 'PGRST116') {
        // Profile doesn't exist, create it
        const { data: newProfile, error: createError } = await (supabase
          .from('profiles') as any)
          .insert({
            id: user.id,
            email: user.email,
            full_name: user.user_metadata?.full_name || '',
            sms_notifications: true,
            email_notifications: true
          })
          .select()
          .single()

        if (createError) throw createError
        existingProfile = newProfile
      } else if (fetchError) {
        throw fetchError
      }

      setProfile(existingProfile)
      setFullName((existingProfile as any)?.full_name || '')
    } catch (error) {
      console.error('Error loading profile:', error)
      toast.error('Failed to load profile')
    } finally {
      setLoading(false)
    }
  }, [supabase, router])

  useEffect(() => {
    loadProfile()
  }, [loadProfile])

  async function updateProfile() {
    if (!profile) return

    try {
      setSaving(true)
      const { error } = await (supabase
        .from('profiles') as any)
        .update({
          full_name: fullName,
          updated_at: new Date().toISOString()
        })
        .eq('id', profile.id)

      if (error) throw error

      toast.success('Profile updated successfully')
      await loadProfile()
    } catch (error) {
      console.error('Error updating profile:', error)
      toast.error('Failed to update profile')
    } finally {
      setSaving(false)
    }
  }

  async function uploadAvatar(event: React.ChangeEvent<HTMLInputElement>) {
    try {
      setUploading(true)

      if (!event.target.files || event.target.files.length === 0) {
        return
      }

      const file = event.target.files[0]
      const fileExt = file.name.split('.').pop()
      const fileName = `${profile?.id}.${fileExt}`
      const filePath = `avatars/${fileName}`

      // Upload to Supabase Storage
      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(filePath, file, { upsert: true })

      if (uploadError) throw uploadError

      // Update profile with avatar URL
      const { error: updateError } = await (supabase
        .from('profiles') as any)
        .update({ 
          avatar_url: filePath,
          updated_at: new Date().toISOString()
        })
        .eq('id', profile?.id)

      if (updateError) throw updateError

      toast.success('Avatar uploaded successfully')
      await loadProfile()
    } catch (error) {
      console.error('Error uploading avatar:', error)
      toast.error('Failed to upload avatar')
    } finally {
      setUploading(false)
    }
  }

  async function toggleNotification(type: 'sms' | 'email') {
    if (!profile) return

    try {
      const update = type === 'sms' 
        ? { sms_notifications: !profile.sms_notifications }
        : { email_notifications: !profile.email_notifications }

      const { error } = await (supabase
        .from('profiles') as any)
        .update({
          ...update,
          updated_at: new Date().toISOString()
        })
        .eq('id', profile.id)

      if (error) throw error

      toast.success(`${type === 'sms' ? 'SMS' : 'Email'} notifications ${update[`${type}_notifications`] ? 'enabled' : 'disabled'}`)
      await loadProfile()
    } catch (error) {
      console.error('Error updating notifications:', error)
      toast.error('Failed to update notification preferences')
    }
  }

  async function exportData() {
    try {
      // Fetch all user data
      const { data: bookings } = await supabase
        .from('bookings')
        .select('*, event:events(*)')
        .eq('customer_id', profile?.id || '')

      const { data: messages } = await supabase
        .from('messages')
        .select('*')
        .eq('customer_id', profile?.id || '')

      const userData = {
        profile,
        bookings,
        messages,
        exportDate: new Date().toISOString()
      }

      // Create and download JSON file
      const blob = new Blob([JSON.stringify(userData, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `profile-data-${new Date().toISOString().split('T')[0]}.json`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)

      toast.success('Data exported successfully')
    } catch (error) {
      console.error('Error exporting data:', error)
      toast.error('Failed to export data')
    }
  }

  async function requestAccountDeletion() {
    try {
      // Log the deletion request
      const { error } = await (supabase
        .from('audit_logs') as any)
        .insert({
          user_id: profile?.id,
          entity_type: 'profile',
          entity_id: profile?.id,
          action: 'delete_request',
          details: { reason: 'User requested account deletion' }
        })

      if (error) throw error

      toast.success('Account deletion request submitted. We will contact you within 48 hours.')
      setShowDeleteConfirm(false)
    } catch (error) {
      console.error('Error requesting deletion:', error)
      toast.error('Failed to submit deletion request')
    }
  }

  if (loading) {
    return (
      <Page title="My Profile">
        <div className="space-y-6">
          <Card>
            <Skeleton className="h-48" />
          </Card>
          <Card>
            <Skeleton className="h-32" />
          </Card>
          <Card>
            <Skeleton className="h-32" />
          </Card>
        </div>
      </Page>
    )
  }

  if (!profile) {
    return (
      <Page title="My Profile">
        <Card>
          <EmptyState
            title="Profile not found"
            description="We couldn't load your profile information."
            action={
              <Button onClick={loadProfile}>
                Try Again
              </Button>
            }
          />
        </Card>
      </Page>
    )
  }

  return (
    <Page title="My Profile">
      {/* Delete confirmation dialog */}
      <ConfirmDialog
        open={showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(false)}
        onConfirm={requestAccountDeletion}
        title="Request Account Deletion"
        message="Are you sure you want to request account deletion? This action cannot be undone."
        confirmText="Request Deletion"
      />

      {/* Profile Information */}
      <Section title="Profile Information">
        <Card>
            <div className="space-y-6">
              {/* Avatar */}
              <div className="flex items-center space-x-6">
                <div className="relative">
                  <div className="h-24 w-24 rounded-full bg-gray-200 flex items-center justify-center overflow-hidden">
                    {profile.avatar_url ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img
                        src={`${process.env.NEXT_PUBLIC_SUPABASE_URL || ''}/storage/v1/object/public/avatars/${profile.avatar_url}`}
                        alt="Avatar"
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <UserCircleIcon className="h-20 w-20 text-gray-400" />
                    )}
                  </div>
                  <label htmlFor="avatar-upload" className="absolute bottom-0 right-0 bg-white rounded-full p-1 shadow-lg cursor-pointer hover:bg-gray-50">
                    <CameraIcon className="h-5 w-5 text-gray-600" />
                    <input
                      id="avatar-upload"
                      name="avatar"
                      type="file"
                      accept="image/*"
                      className="sr-only"
                      onChange={uploadAvatar}
                      disabled={uploading}
                    />
                  </label>
                </div>
                <div>
                  <p className="text-sm text-gray-500">
                    {uploading ? 'Uploading...' : 'Click the camera icon to upload a new avatar'}
                  </p>
                </div>
              </div>

              {/* Form Fields */}
              <div>
                <FormGroup label="Email">
                  <Input
                    type="email"
                    value={profile.email || ''}
                    disabled
                  />
                </FormGroup>
              </div>

                <FormGroup label="Full Name">
                  <Input
                    type="text"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                  />
                </FormGroup>

                <FormGroup label="Member Since">
                  <p className="text-sm text-gray-900">
                    {new Date(profile.created_at).toLocaleDateString('en-GB', {
                      day: 'numeric',
                      month: 'long',
                      year: 'numeric'
                    })}
                  </p>
                </FormGroup>

                <div className="flex justify-end">
                  <Button
                    onClick={updateProfile}
                    disabled={saving}
                    loading={saving}
                    variant="primary"
                  >
                    Save Changes
                  </Button>
                </div>
            </div>
          </Card>
        </Section>

        {/* Security Settings */}
        <Section title="Security">
          <Card>
            <div className="space-y-4">
              <LinkButton
                href="/profile/change-password"
                variant="secondary"
              >
                <KeyIcon className="h-5 w-5 mr-2" />
                Change Password
              </LinkButton>
            </div>
          </Card>
        </Section>

        {/* Notification Preferences */}
        <Section title="Notification Preferences">
          <Card>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center">
                  <BellIcon className="h-5 w-5 text-gray-400 mr-3" />
                  <div>
                    <p className="text-sm font-medium text-gray-900">SMS Notifications</p>
                    <p className="text-sm text-gray-500">Receive booking confirmations and reminders via SMS</p>
                  </div>
                </div>
                <Toggle
                  checked={profile.sms_notifications}
                  onChange={() => toggleNotification('sms')}
                />
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center">
                  <BellIcon className="h-5 w-5 text-gray-400 mr-3" />
                  <div>
                    <p className="text-sm font-medium text-gray-900">Email Notifications</p>
                    <p className="text-sm text-gray-500">Receive updates and newsletters via email</p>
                  </div>
                </div>
                <Toggle
                  checked={profile.email_notifications}
                  onChange={() => toggleNotification('email')}
                />
              </div>
            </div>
          </Card>
        </Section>

        {/* Data & Privacy */}
        <Section title="Data & Privacy">
          <Card>
            <div className="space-y-4">
              <Button
                onClick={exportData}
                variant="secondary"
              >
                <ArrowDownTrayIcon className="h-5 w-5 mr-2" />
                Export My Data
              </Button>

              <div className="pt-4 border-t border-gray-200">
                <Button
                  onClick={() => setShowDeleteConfirm(true)}
                  variant="danger"
                >
                  <TrashIcon className="h-5 w-5 mr-2" />
                  Request Account Deletion
                </Button>
                <p className="mt-2 text-sm text-gray-500">
                  Once requested, we will contact you within 48 hours to process your deletion request.
                </p>
              </div>
            </div>
          </Card>
        </Section>
      </Page>
  )
}