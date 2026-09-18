'use client'

import { useState, Suspense } from 'react'
// import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { ArrowLeft } from 'lucide-react'
import { Button, Field, Input, LinkButton, Spinner, toast } from '@/ds'
import { AuthCard } from '../_components/AuthCard'

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
      <AuthCard title="Check your email" lead={`We've sent a password reset link to ${email}`}>
        <LinkButton href="/auth/login" variant="secondary" size="lg" className="w-full">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to login
        </LinkButton>
      </AuthCard>
    )
  }

  return (
    <AuthCard
      title="Reset your password"
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
          Send reset email
        </Button>

        <div className="text-center">
          <a href="/auth/login" className="auth__link inline-flex items-center text-xs">
            <ArrowLeft className="mr-1 h-3.5 w-3.5" />
            Back to login
          </a>
        </div>
      </form>
    </AuthCard>
  )
}

// Page Component
export default function ResetPasswordPage() {
  return (
    <Suspense fallback={
      <div className="auth">
        <Spinner size="lg" />
      </div>
    }>
      <ResetPasswordForm />
    </Suspense>
  )
}
