'use client'

import { useState, useEffect, useCallback } from 'react'
import { useSupabase } from '@/components/providers/SupabaseProvider'
import { useRouter } from 'next/navigation'
import toast from 'react-hot-toast'
import { 
  UserCircleIcon, 
  CameraIcon,
  KeyIcon,
  BellIcon,
  TrashIcon,
  ArrowDownTrayIcon
} from '@heroicons/react/24/outline'
import Link from 'next/link'

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
        const { data: newProfile, error: createError } = await supabase
          .from('profiles')
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
      setFullName(existingProfile?.full_name || '')
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
      const { error } = await supabase
        .from('profiles')
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
      const { error: updateError } = await supabase
        .from('profiles')
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

      const { error } = await supabase
        .from('profiles')
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
        .eq('customer_id', profile?.id)

      const { data: messages } = await supabase
        .from('messages')
        .select('*')
        .eq('customer_id', profile?.id)

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
    if (!confirm('Are you sure you want to request account deletion? This action cannot be undone.')) {
      return
    }

    try {
      // Log the deletion request
      const { error } = await supabase
        .from('audit_logs')
        .insert({
          user_id: profile?.id,
          entity_type: 'profile',
          entity_id: profile?.id,
          action: 'delete_request',
          details: { reason: 'User requested account deletion' }
        })

      if (error) throw error

      toast.success('Account deletion request submitted. We will contact you within 48 hours.')
    } catch (error) {
      console.error('Error requesting deletion:', error)
      toast.error('Failed to submit deletion request')
    }
  }

  if (loading) {
    return <div className="p-6 text-center">Loading profile...</div>
  }

  if (!profile) {
    return <div className="p-6 text-center">Profile not found</div>
  }

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold text-gray-900 mb-8">My Profile</h1>

      <div className="space-y-6">
        {/* Profile Information */}
        <div className="bg-white shadow sm:rounded-lg">
          <div className="px-4 py-5 sm:p-6">
            <h3 className="text-lg font-medium leading-6 text-gray-900 mb-4">
              Profile Information
            </h3>

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
                <label htmlFor="email" className="block text-sm font-medium text-gray-700">
                  Email
                </label>
                <input
                  type="email"
                  id="email"
                  value={profile.email || ''}
                  disabled
                  className="mt-1 block w-full rounded-lg border-gray-300 bg-gray-50 shadow-sm sm:text-sm"
                />
              </div>

              <div>
                <label htmlFor="full_name" className="block text-sm font-medium text-gray-700">
                  Full Name
                </label>
                <input
                  type="text"
                  id="full_name"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="mt-1 block w-full rounded-lg border-gray-300 shadow-sm focus:border-green-500 focus:ring-green-500 focus:ring-2 sm:text-sm"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">
                  Member Since
                </label>
                <p className="mt-1 text-sm text-gray-900">
                  {new Date(profile.created_at).toLocaleDateString('en-GB', {
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric'
                  })}
                </p>
              </div>

              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={updateProfile}
                  disabled={saving}
                  className="inline-flex items-center px-6 py-3 md:py-2 border border-transparent text-base md:text-sm font-medium rounded-lg shadow-sm text-white bg-green-600 hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 disabled:opacity-50 disabled:cursor-not-allowed min-h-[44px]"
                >
                  {saving ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Security Settings */}
        <div className="bg-white shadow sm:rounded-lg">
          <div className="px-4 py-5 sm:p-6">
            <h3 className="text-lg font-medium leading-6 text-gray-900 mb-4">
              Security
            </h3>
            <div className="space-y-4">
              <Link
                href="/profile/change-password"
                className="inline-flex items-center text-blue-600 hover:text-blue-900 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 rounded"
              >
                <KeyIcon className="h-5 w-5 mr-2" />
                Change Password
              </Link>
            </div>
          </div>
        </div>

        {/* Notification Preferences */}
        <div className="bg-white shadow sm:rounded-lg">
          <div className="px-4 py-5 sm:p-6">
            <h3 className="text-lg font-medium leading-6 text-gray-900 mb-4">
              Notification Preferences
            </h3>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center">
                  <BellIcon className="h-5 w-5 text-gray-400 mr-3" />
                  <div>
                    <p className="text-sm font-medium text-gray-900">SMS Notifications</p>
                    <p className="text-sm text-gray-500">Receive booking confirmations and reminders via SMS</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => toggleNotification('sms')}
                  className={`${
                    profile.sms_notifications ? 'bg-green-600' : 'bg-gray-200'
                  } relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2`}
                >
                  <span
                    className={`${
                      profile.sms_notifications ? 'translate-x-5' : 'translate-x-0'
                    } pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out`}
                  />
                </button>
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center">
                  <BellIcon className="h-5 w-5 text-gray-400 mr-3" />
                  <div>
                    <p className="text-sm font-medium text-gray-900">Email Notifications</p>
                    <p className="text-sm text-gray-500">Receive updates and newsletters via email</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => toggleNotification('email')}
                  className={`${
                    profile.email_notifications ? 'bg-green-600' : 'bg-gray-200'
                  } relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2`}
                >
                  <span
                    className={`${
                      profile.email_notifications ? 'translate-x-5' : 'translate-x-0'
                    } pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out`}
                  />
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Data & Privacy */}
        <div className="bg-white shadow sm:rounded-lg">
          <div className="px-4 py-5 sm:p-6">
            <h3 className="text-lg font-medium leading-6 text-gray-900 mb-4">
              Data & Privacy
            </h3>
            <div className="space-y-4">
              <button
                onClick={exportData}
                className="inline-flex items-center text-blue-600 hover:text-blue-900 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 rounded"
              >
                <ArrowDownTrayIcon className="h-5 w-5 mr-2" />
                Export My Data
              </button>

              <div className="pt-4 border-t border-gray-200">
                <button
                  onClick={requestAccountDeletion}
                  className="inline-flex items-center text-red-600 hover:text-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 rounded"
                >
                  <TrashIcon className="h-5 w-5 mr-2" />
                  Request Account Deletion
                </button>
                <p className="mt-2 text-sm text-gray-500">
                  Once requested, we will contact you within 48 hours to process your deletion request.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}