'use client'

import { useState, Suspense } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import Image from 'next/image'
import { Form, FormActions } from '@/components/ui-v2/forms/Form'
import { FormGroup } from '@/components/ui-v2/forms/FormGroup'
import { Input } from '@/components/ui-v2/forms/Input'
import { Button } from '@/components/ui-v2/forms/Button'
import { LinkButton } from '@/components/ui-v2/navigation/LinkButton'
import { toast } from '@/components/ui-v2/feedback/Toast'
import { Container } from '@/components/ui-v2/layout/Container'
import { Card } from '@/components/ui-v2/layout/Card'
import { Spinner } from '@/components/ui-v2/feedback/Spinner'
import { EmptyState } from '@/components/ui-v2/display/EmptyState'

// ResetPasswordForm component - Client Component
function ResetPasswordForm() {
  const [email, setEmail] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isSubmitted, setIsSubmitted] = useState(false)
  const router = useRouter()
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
        redirectTo: `${window.location.origin}/auth/callback?next=/profile/change-password`,
      })

      if (error) throw error

      setIsSubmitted(true)
      toast.success('Password reset email sent!')
    } catch (error: any) {
      console.error('Error:', error)
      toast.error('Failed to send reset email. Please try again.')
    } finally {
      setIsLoading(false)
    }
  }

  if (isSubmitted) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <Container size="sm">
          <div className="mx-auto w-64 mb-6">
            <Image 
              src="/logo.png" 
              alt="The Anchor Logo" 
              width={256}
              height={256}
              className="w-full h-auto"
              priority 
            />
          </div>
          
          <EmptyState icon={null}
            title="Check your email"
            description={`We've sent a password reset link to ${email}`}
            action={(
              <LinkButton
                href="/auth/login"
                variant="secondary"
              >
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back to login
              </LinkButton>
            )}
          />
        </Container>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <Container size="sm">
        <div className="text-center mb-8">
          {/* Logo */}
          <div className="mx-auto w-64 mb-2">
            <Image 
              src="/logo.png" 
              alt="The Anchor Logo" 
              width={256}
              height={256}
              className="w-full h-auto"
              priority 
            />
          </div>
          
          {/* Title */}
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">
            Reset your password
          </h1>
          <p className="mt-2 text-xs sm:text-sm text-gray-600">
            Enter your email address and we&apos;ll send you a reset link
          </p>
        </div>

        <Card>
          <Form onSubmit={handleSubmit} autoComplete="on">
            {/* Email Field */}
            <FormGroup
              label="Email address"
              required
            >
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
            </FormGroup>

            {/* Submit Button */}
            <FormActions>
              <Button
                type="submit"
                disabled={isLoading}
                loading={isLoading}
                fullWidth
                size="lg"
              >
                Send reset email
              </Button>
            </FormActions>

            {/* Back to Login Link */}
            <div className="text-center mt-4">
              <LinkButton
                href="/auth/login"
                variant="secondary"
                size="sm"
              >
                <ArrowLeft className="mr-1 h-4 w-4" />
                Back to login
              </LinkButton>
            </div>
          </Form>
        </Card>
      </Container>
    </div>
  )
}

// Page Component
export default function ResetPasswordPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <Spinner size="lg" />
      </div>
    }>
      <ResetPasswordForm />
    </Suspense>
  )
}