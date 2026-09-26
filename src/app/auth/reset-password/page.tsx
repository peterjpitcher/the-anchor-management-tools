'use client'

import { useState, Suspense } from 'react'
// import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button, Field, Input, LinkButton, PageLoading, toast, Icon } from '@/ds'
import { AuthCard, AuthLink } from '../_components/AuthCard'

// ResetPasswordForm component - Client Component
function ResetPasswordForm() {
  const [email, setEmail] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isSubmitted, setIsSubmitted] = useState(false)
  // const router = useRouter()
  const supabase = createClient()

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    e.stopPropagation()
    
    if (!email) {
      toast.error('Please enter your email address')
      return
    }
    
    setIsLoading(true)

    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/auth/confirm?next=/auth/reset`,
      })

      if (error) throw error

      setIsSubmitted(true)
      toast.success('Password reset email sent!')
    } catch (error: unknown) {
      console.error('Error:', error)
      toast.error('Failed to send reset email. Please try again.')
    } finally {
      setIsLoading(false)
    }
  }

  if (isSubmitted) {
    return (
      <AuthCard title="Check Your Email" lead={`We've sent a password reset link to ${email}`}>
        <LinkButton
          href="/auth/login"
          variant="secondary"
          size="lg"
          className="w-full"
          icon={<Icon name="arrowLeft" size={16} />}
        >
          Back to Login
        </LinkButton>
      </AuthCard>
    )
  }

  return (
    <AuthCard
      title="Reset Your Password"
      lead="Enter your email address and we'll send you a reset link."
    >
      <form onSubmit={handleSubmit} autoComplete="on" className="flex flex-col gap-4">
        <Field label="Email address" required>
          <Input
            id="reset-email"
            name="reset-email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
          />
        </Field>

        <Button type="submit" variant="primary" size="lg" disabled={isLoading} loading={isLoading} className="w-full">
          Send Reset Email
        </Button>

        <div className="text-center">
          <AuthLink href="/auth/login">
            <Icon name="arrowLeft" size={14} />
            Back to Login
          </AuthLink>
        </div>
      </form>
    </AuthCard>
  )
}

// Page Component
export default function ResetPasswordPage() {
  return (
    <Suspense fallback={
      <AuthCard title="Reset Your Password">
        <PageLoading inline />
      </AuthCard>
    }>
      <ResetPasswordForm />
    </Suspense>
  )
}
