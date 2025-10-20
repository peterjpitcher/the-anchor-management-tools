'use client'

import { useState } from 'react'
import { useSupabase } from '@/components/providers/SupabaseProvider'
import { useRouter } from 'next/navigation'
import toast from 'react-hot-toast'
import { Button } from '@/components/ui-v2/forms/Button'
import { Input } from '@/components/ui-v2/forms/Input'
import { FormGroup } from '@/components/ui-v2/forms/FormGroup'
import { Section } from '@/components/ui-v2/layout/Section'
import { PageLayout } from '@/components/ui-v2/layout/PageLayout'
import { Card } from '@/components/ui-v2/layout/Card'

export default function ChangePasswordPage() {
  const supabase = useSupabase()
  const router = useRouter()
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault()

    if (newPassword !== confirmPassword) {
      toast.error('Passwords do not match')
      return
    }

    if (newPassword.length < 6) {
      toast.error('Password must be at least 6 characters long')
      return
    }

    try {
      setLoading(true)

      const { error } = await supabase.auth.updateUser({
        password: newPassword
      })

      if (error) throw error

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
              label="New Password" 
              required
              help="Must be at least 6 characters long"
            >
              <Input
                type="password"
                id="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                minLength={6}
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
                minLength={6}
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
