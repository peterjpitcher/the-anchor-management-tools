'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useSupabase } from '@/components/providers/SupabaseProvider'
import { Container } from '@/ds'
import { Card } from '@/ds'
import { Form } from '@/ds'
import { FormGroup } from '@/ds'
import { Input } from '@/ds'
import { Button } from '@/ds'
import { toast } from '@/ds'

type Props = {
  email?: string
}

export default function ResetPasswordForm({ email }: Props) {
  const supabase = useSupabase()
  const router = useRouter()
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (password.length < 8) {
      toast.error('Password must be at least 8 characters long')
      return
    }

    if (password !== confirmPassword) {
      toast.error('Passwords do not match')
      return
    }

    try {
      setIsSubmitting(true)
      const { error } = await supabase.auth.updateUser({ password })

      if (error) {
        toast.error(error.message || 'Failed to update password')
        return
      }

      toast.success('Password updated successfully')
      router.replace('/dashboard')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-sidebar p-4">
      <Container size="sm">
        <Card className="p-8">
          <div className="text-center mb-6">
            <h1 className="text-2xl font-semibold text-gray-900">Set a new password</h1>
            {email && <p className="mt-2 text-sm text-gray-600">Signed in as {email}</p>}
          </div>

          <Form onSubmit={handleSubmit} className="space-y-5">
            <FormGroup label="New password" required help="Minimum 8 characters">
              <Input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="new-password"
                minLength={8}
                required
              />
            </FormGroup>

            <FormGroup label="Confirm password" required>
              <Input
                type="password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                autoComplete="new-password"
                minLength={8}
                required
              />
            </FormGroup>

            <Button type="submit" loading={isSubmitting} disabled={isSubmitting} fullWidth>
              Save password
            </Button>
          </Form>
        </Card>
      </Container>
    </div>
  )
}
