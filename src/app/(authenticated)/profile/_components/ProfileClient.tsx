'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'

import {
  PageHeader,
  Card,
  CardHeader,
  CardBody,
} from '@/ds'
import {
  Button,
  Avatar,
  Field,
  Input,
  Switch,
  PageLoading,
  Empty,
  Badge,
  ConfirmDialog,
} from '@/ds'
import { Icon } from '@/ds/icons'
import { toast } from '@/ds'
import { formatDateInLondon, getTodayIsoDate } from '@/lib/dateUtils'

import {
  loadProfile,
  updateProfile as updateProfileAction,
  toggleNotification as toggleNotificationAction,
  exportProfileData,
  requestAccountDeletion as requestAccountDeletionAction,
  uploadAvatar,
  removeAvatar,
} from '@/app/actions/profile'

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------ */
/*  ProfileClient                                                      */
/* ------------------------------------------------------------------ */

export function ProfileClient() {
  const router = useRouter()
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [removingAvatar, setRemovingAvatar] = useState(false)
  const [saving, setSaving] = useState(false)
  const [fullName, setFullName] = useState('')
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [showRemoveAvatarConfirm, setShowRemoveAvatarConfirm] = useState(false)
  const avatarInputRef = useRef<HTMLInputElement | null>(null)

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
    } catch {
      toast.error('Failed to update profile')
    } finally {
      setSaving(false)
    }
  }

  async function handleUploadAvatar(event: React.ChangeEvent<HTMLInputElement>) {
    try {
      setUploading(true)
      if (!event.target.files || event.target.files.length === 0) return
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
    } catch {
      toast.error('Failed to upload avatar')
    } finally {
      event.target.value = ''
      setUploading(false)
    }
  }

  async function handleRemoveAvatar() {
    try {
      setRemovingAvatar(true)
      const result = await removeAvatar()
      if (!result || 'error' in result) {
        toast.error(result?.error || 'Failed to remove avatar')
        return
      }
      toast.success('Avatar removed')
      setShowRemoveAvatarConfirm(false)
      await fetchProfile()
    } catch {
      toast.error('Failed to remove avatar')
    } finally {
      setRemovingAvatar(false)
    }
  }

  async function toggleNotification(type: 'sms' | 'email') {
    if (!profile) return
    try {
      const field = type === 'sms' ? 'sms_notifications' : 'email_notifications'
      const updatedValue = type === 'sms' ? !profile.sms_notifications : !profile.email_notifications
      const result = await toggleNotificationAction({ field, value: updatedValue })
      if (!result || 'error' in result) {
        toast.error(result?.error || 'Failed to update notification preferences')
        return
      }
      toast.success(`${type === 'sms' ? 'SMS' : 'Email'} notifications ${updatedValue ? 'enabled' : 'disabled'}`)
      await fetchProfile()
    } catch {
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
    } catch {
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
    } catch {
      toast.error('Failed to submit deletion request')
    }
  }

  /* ---- Loading state ---- */

  if (loading) {
    return (
      <div>
        <PageHeader
          breadcrumbs={[{ label: 'Profile' }]}
          title="My Profile"
          subtitle="Manage your account details"
        />
        <PageLoading className="min-h-0 py-16" />
      </div>
    )
  }

  if (!profile) {
    return (
      <div>
        <PageHeader
          breadcrumbs={[{ label: 'Profile' }]}
          title="My Profile"
        />
        <Card>
          <Empty title="Profile not found" description="We could not load your profile information." />
        </Card>
      </div>
    )
  }

  /* ---- Main render ---- */

  return (
    <div>
      <PageHeader
        breadcrumbs={[{ label: 'Profile' }]}
        title="My Profile"
        subtitle="Manage your account details"
      />

      {/* Delete confirmation */}
      <ConfirmDialog
        open={showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(false)}
        onConfirm={requestAccountDeletion}
        title="Request Account Deletion"
        message="Are you sure you want to request account deletion? This action cannot be undone."
        confirmLabel="Request Deletion"
        tone="danger"
      />
      <ConfirmDialog
        open={showRemoveAvatarConfirm}
        onClose={() => setShowRemoveAvatarConfirm(false)}
        onConfirm={handleRemoveAvatar}
        title="Remove Profile Photo"
        message="Remove your profile photo from your account?"
        confirmLabel="Remove Photo"
        tone="danger"
      />

      <div className="grid grid-cols-1 gap-6 md:grid-cols-[1fr_320px]">
        {/* Left column: form cards */}
        <div className="space-y-6 order-2 md:order-1">
          {/* Personal Details */}
          <Card>
            <CardHeader title="Personal Details" />
            <CardBody>
              <div className="space-y-4">
                <Field label="Email">
                  <Input
                    type="email"
                    value={profile.email || ''}
                    disabled
                  />
                </Field>

                <Field label="Full Name">
                  <Input
                    type="text"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                  />
                </Field>

                <div className="flex justify-end">
                  <Button
                    variant="primary"
                    onClick={() => void handleUpdateProfile()}
                    loading={saving}
                  >
                    Save Changes
                  </Button>
                </div>
              </div>
            </CardBody>
          </Card>

          {/* Security */}
          <Card>
            <CardHeader title="Security" />
            <CardBody>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-[13px] font-medium text-text-strong">Password</p>
                    <p className="text-xs text-text-muted">Change your account password</p>
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => router.push('/profile/change-password')}
                  >
                    Change Password
                  </Button>
                </div>
              </div>
            </CardBody>
          </Card>

          {/* Notifications */}
          <Card>
            <CardHeader title="Notifications" />
            <CardBody>
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-[13px] font-medium text-text-strong">SMS Notifications</p>
                    <p className="text-xs text-text-muted">Receive booking confirmations and reminders via SMS</p>
                  </div>
                  <Switch
                    checked={profile.sms_notifications}
                    onChange={() => void toggleNotification('sms')}
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-[13px] font-medium text-text-strong">Email Notifications</p>
                    <p className="text-xs text-text-muted">Receive updates and newsletters via email</p>
                  </div>
                  <Switch
                    checked={profile.email_notifications}
                    onChange={() => void toggleNotification('email')}
                  />
                </div>
              </div>
            </CardBody>
          </Card>

          {/* Data & Privacy */}
          <Card>
            <CardHeader title="Data & Privacy" />
            <CardBody>
              <div className="space-y-4">
                <Button
                  variant="secondary"
                  onClick={() => void exportData()}
                  icon={<Icon name="download" size={16} />}
                >
                  Export My Data
                </Button>

                <div className="pt-4 border-t border-border">
                  <Button
                    variant="danger"
                    onClick={() => setShowDeleteConfirm(true)}
                    icon={<Icon name="trash" size={16} />}
                  >
                    Request Account Deletion
                  </Button>
                  <p className="mt-2 text-xs text-text-muted">
                    Once requested, we will contact you within 48 hours to process your deletion request.
                  </p>
                </div>
              </div>
            </CardBody>
          </Card>
        </div>

        {/* Right column: Avatar sidebar */}
        <div className="order-1 md:order-2">
          <Card>
            <CardBody>
              <div className="flex flex-col items-center text-center space-y-4">
                {/* Avatar */}
                <div className="relative">
                  {profile.avatar_url ? (
                    <div className="w-20 h-20 rounded-full overflow-hidden">
                      <img
                        src={`${process.env.NEXT_PUBLIC_SUPABASE_URL || ''}/storage/v1/object/public/avatars/${profile.avatar_url}`}
                        alt="Avatar"
                        className="w-full h-full object-cover"
                      />
                    </div>
                  ) : (
                    <Avatar name={profile.full_name || profile.email} size="xl" />
                  )}
                </div>

                <div>
                  <h3 className="text-sm font-semibold text-text-strong">
                    {profile.full_name || profile.email}
                  </h3>
                  <p className="text-xs text-text-muted">{profile.email}</p>
                </div>

                {/* Upload controls */}
                <div className="flex flex-wrap items-center justify-center gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    loading={uploading}
                    onClick={() => avatarInputRef.current?.click()}
                  >
                    Change Photo
                  </Button>
                  {profile.avatar_url ? (
                    <Button
                      variant="danger"
                      size="sm"
                      loading={removingAvatar}
                      onClick={() => setShowRemoveAvatarConfirm(true)}
                    >
                      Remove Photo
                    </Button>
                  ) : null}
                  <input
                    ref={avatarInputRef}
                    id="avatar-upload-ds"
                    type="file"
                    accept="image/*"
                    className="sr-only"
                    onChange={(e) => void handleUploadAvatar(e)}
                    disabled={uploading}
                  />
                </div>

                {/* Account stats */}
                <div className="w-full border-t border-border pt-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-text-muted">Member since</span>
                    <span className="text-xs text-text-strong">
                      {formatDateInLondon(profile.created_at, {
                        day: 'numeric',
                        month: 'long',
                        year: 'numeric',
                      })}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-text-muted">Last updated</span>
                    <span className="text-xs text-text-strong">
                      {formatDateInLondon(profile.updated_at, {
                        day: 'numeric',
                        month: 'long',
                        year: 'numeric',
                      })}
                    </span>
                  </div>
                </div>
              </div>
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  )
}
