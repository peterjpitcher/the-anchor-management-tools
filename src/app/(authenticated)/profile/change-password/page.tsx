'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import toast from 'react-hot-toast'
import { Button } from '@/ds'
import { Input } from '@/ds'
import { FormGroup } from '@/ds'
import { Section } from '@/ds'
import { PageLayout } from '@/ds'
import { Card } from '@/ds'
import { changePassword } from '@/app/actions/profile'

export default function ChangePasswordPage() {
  const router = useRouter()
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault()

    if (newPassword !== confirmPassword) {
      toast.error('Passwords do not match')
      return
    }

    if (newPassword.length < 8) {
      toast.error('Password must be at least 8 characters long')
      return
    }

    try {
      setLoading(true)

      const result = await changePassword({
        currentPassword,
        newPassword,
      })

      if (!result || 'error' in result) {
        toast.error(result?.error || 'Failed to update password')
        return
      }

      toast.success('Password updated successfully')
      router.push('/profile')
    } catch (error) {
      console.error('Error updating password:', error)
      toast.error('Failed to update password')
    } finally {
      setLoading(false)
    }
  }

  return (
    <PageLayout
      title="Change Password"
      subtitle="Update your account password"
      backButton={{ label: 'Back to Profile', href: '/profile' }}
    >
      <div className="space-y-6">
        <Section>
          <Card>
            <form onSubmit={handleChangePassword} className="space-y-6">
            <FormGroup
              label="Current Password"
              required
            >
              <Input
                type="password"
                id="current-password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                required
                autoComplete="current-password"
                placeholder="Enter current password"
              />
            </FormGroup>

            <FormGroup 
              label="New Password" 
              required
              help="At least 8 characters, using at least three of uppercase, lowercase, number, and symbol"
            >
              <Input
                type="password"
                id="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                minLength={8}
                autoComplete="new-password"
                placeholder="Enter new password"
              />
            </FormGroup>

            <FormGroup 
              label="Confirm New Password" 
              required
            >
              <Input
                type="password"
                id="confirm-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                minLength={8}
                autoComplete="new-password"
                placeholder="Confirm new password"
              />
            </FormGroup>

            <div className="flex justify-end gap-3 pt-4 border-t">
              <Button 
                type="button" 
                variant="secondary" 
                onClick={() => router.push('/profile')}
              >
                Cancel
              </Button>
              <Button 
                type="submit" 
                loading={loading}
              >
                Update Password
              </Button>
            </div>
          </form>
        </Card>
      </Section>
      </div>
    </PageLayout>
  )
}
