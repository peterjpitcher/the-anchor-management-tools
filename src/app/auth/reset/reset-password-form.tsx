'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useSupabase } from '@/components/providers/SupabaseProvider'
import { Button, Field, Input, toast } from '@/ds'
import { AuthCard } from '../_components/AuthCard'

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
    <AuthCard title="Set a new password" lead={email ? `Signed in as ${email}` : undefined}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Field label="New password" required hint="Minimum 8 characters">
          <Input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="new-password"
            minLength={8}
            required
          />
        </Field>

        <Field label="Confirm password" required>
          <Input
            type="password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            autoComplete="new-password"
            minLength={8}
            required
          />
        </Field>

        <Button type="submit" variant="primary" size="lg" loading={isSubmitting} disabled={isSubmitting} className="w-full">
          Save password
        </Button>
      </form>
    </AuthCard>
  )
}
