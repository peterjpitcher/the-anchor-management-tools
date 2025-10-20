'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { 
  UserCircleIcon, 
  CameraIcon,
  KeyIcon,
  BellIcon,
  TrashIcon,
  ArrowDownTrayIcon
} from '@heroicons/react/24/outline'
// New UI components
import { PageLayout } from '@/components/ui-v2/layout/PageLayout'
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
import { getTodayIsoDate } from '@/lib/dateUtils'
import { useSupabase } from '@/components/providers/SupabaseProvider'
import {
  loadProfile,
  updateProfile as updateProfileAction,
  toggleNotification as toggleNotificationAction,
  exportProfileData,
  requestAccountDeletion as requestAccountDeletionAction,
  uploadAvatar,
} from '@/app/actions/profile'

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

  const fetchProfile = useCallback(async () => {
    setLoading(true)
    try {
      const result = await loadProfile()
      if (!result || 'error' in result) {
        toast.error(result?.error || 'Failed to load profile')
        setProfile(null)
        return
      }

      const record = result.profile as Profile
      setProfile(record)
      setFullName(record.full_name ?? '')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void fetchProfile()
  }, [fetchProfile])

  async function handleUpdateProfile() {
    if (!profile) return

    try {
      setSaving(true)
      const result = await updateProfileAction({ fullName })
      if (!result || 'error' in result) {
        toast.error(result?.error || 'Failed to update profile')
        return
      }
      toast.success('Profile updated successfully')
      await fetchProfile()
    } catch (error) {
      console.error('Error updating profile:', error)
      toast.error('Failed to update profile')
    } finally {
      setSaving(false)
    }
  }

  async function handleUploadAvatar(event: React.ChangeEvent<HTMLInputElement>) {
    try {
      setUploading(true)

      if (!event.target.files || event.target.files.length === 0) {
        return
      }

      const file = event.target.files[0]
      const formData = new FormData()
      formData.append('avatar', file)

      const result = await uploadAvatar(formData)
      if (!result || 'error' in result) {
        toast.error(result?.error || 'Failed to upload avatar')
        return
      }

      toast.success('Avatar uploaded successfully')
      await fetchProfile()
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
      const field = type === 'sms' ? 'sms_notifications' : 'email_notifications'
      const updatedValue = type === 'sms' ? !profile.sms_notifications : !profile.email_notifications

      const result = await toggleNotificationAction({
        field,
        value: updatedValue,
      })

      if (!result || 'error' in result) {
        toast.error(result?.error || 'Failed to update notification preferences')
        return
      }

      toast.success(`${type === 'sms' ? 'SMS' : 'Email'} notifications ${updatedValue ? 'enabled' : 'disabled'}`)
      await fetchProfile()
    } catch (error) {
      console.error('Error updating notifications:', error)
      toast.error('Failed to update notification preferences')
    }
  }

  async function exportData() {
    try {
      const result = await exportProfileData()
      if (!result || 'error' in result) {
        toast.error(result?.error || 'Failed to export data')
        return
      }

      const blob = new Blob([result.content], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = result.filename || `profile-data-${getTodayIsoDate()}.json`
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
      const result = await requestAccountDeletionAction()
      if (!result || 'error' in result) {
        toast.error(result?.error || 'Failed to submit deletion request')
        return
      }

      toast.success('Account deletion request submitted. We will contact you within 48 hours.')
      setShowDeleteConfirm(false)
    } catch (error) {
      console.error('Error requesting deletion:', error)
      toast.error('Failed to submit deletion request')
    }
  }

  if (loading) {
    return (
      <PageLayout
        title="My Profile"
        subtitle="Manage your account details"
        backButton={{ label: 'Back to Dashboard', href: '/dashboard' }}
        loading
        loadingLabel="Loading profile..."
      />
    )
  }

  if (!profile) {
    return (
      <PageLayout
        title="My Profile"
        subtitle="We couldn't load your profile information."
        backButton={{ label: 'Back to Dashboard', href: '/dashboard' }}
        error="Profile not found"
      />
    )
  }

  return (
    <PageLayout
      title="My Profile"
      subtitle="Manage your account details"
      backButton={{ label: 'Back to Dashboard', href: '/dashboard' }}
    >
      <div className="space-y-6">
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
                      onChange={handleUploadAvatar}
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
                    onClick={handleUpdateProfile}
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
      </div>
    </PageLayout>
  )
}
