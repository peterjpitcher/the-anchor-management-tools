'use client'

import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import Image from 'next/image'
import { Container } from '@/components/ui-v2/layout/Container'
import { Card } from '@/components/ui-v2/layout/Card'
import { Form, FormActions } from '@/components/ui-v2/forms/Form'
import { FormGroup } from '@/components/ui-v2/forms/FormGroup'
import { Input } from '@/components/ui-v2/forms/Input'
import { Button } from '@/components/ui-v2/forms/Button'
import { Spinner } from '@/components/ui-v2/feedback/Spinner'
import { LinkButton } from '@/components/ui-v2/navigation/LinkButton'
import { toast } from '@/components/ui-v2/feedback/Toast'
import { ArrowLeft } from 'lucide-react'

type RecoveryState =
  | 'verifying'
  | 'ready'
  | 'expired'
  | 'unsupported'

export default function RecoverPasswordPage() {
  return (
    <Suspense fallback={<RecoverPasswordFallback />}>
      <RecoverPasswordContent />
    </Suspense>
  )
}

function RecoverPasswordContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const supabase = useMemo(() => createClient(), [])
  const redirectParam = searchParams?.get('redirectedFrom') ?? searchParams?.get('next') ?? undefined
  const redirectTarget = useMemo(() => {
    if (!redirectParam) {
      return undefined
    }

    try {
      const decoded = decodeURIComponent(redirectParam)
      if (decoded.startsWith('/')) {
        return decoded
      }
    } catch {
      // ignore malformed values
    }

    return undefined
  }, [redirectParam])

  const [state, setState] = useState<RecoveryState>('verifying')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [errorDetails, setErrorDetails] = useState<string | null>(null)
  const handledRef = useRef(false)

  useEffect(() => {
    if (handledRef.current) {
      return
    }

    handledRef.current = true

    async function handleRecovery() {
      const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''))
      const queryParams = new URLSearchParams(window.location.search)

      const type = (hashParams.get('type') || queryParams.get('type') || '').toLowerCase()
      const accessToken = hashParams.get('access_token') || queryParams.get('access_token')
      const refreshToken = hashParams.get('refresh_token') || queryParams.get('refresh_token')
      const code = queryParams.get('code') || hashParams.get('code')
      const token = queryParams.get('token') || queryParams.get('token_hash') || hashParams.get('token')
      const emailFromParams = queryParams.get('email') || hashParams.get('email') || searchParams?.get('email') || undefined
      const errorDescription = hashParams.get('error_description') || queryParams.get('error_description')

      if (errorDescription) {
        console.error('Supabase recovery error:', errorDescription)
        setErrorDetails(errorDescription)
        setState('expired')
        return
      }

      if (type === 'recovery' && accessToken && refreshToken) {
        const { error } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        })

        if (error) {
          console.error('Failed to set recovery session:', error)
          setErrorDetails(error.message)
          setState('expired')
          return
        }

        const cleanUrl = new URL(window.location.href)
        cleanUrl.hash = ''
        cleanUrl.searchParams.delete('token')
        cleanUrl.searchParams.delete('token_hash')
        cleanUrl.searchParams.delete('type')
        window.history.replaceState({}, document.title, cleanUrl.toString())
        setState('ready')
        return
      }

      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code)
        if (error) {
          console.error('Failed to exchange code for session:', error)
          setErrorDetails(error.message)
          setState('expired')
          return
        }

        setState('ready')
        return
      }

      if (type === 'recovery' && token && emailFromParams) {
        const { data, error } = await supabase.auth.verifyOtp({
          type: 'recovery',
          token,
          email: emailFromParams,
        })

        if (error) {
          console.error('Failed to verify recovery token:', error)
          setErrorDetails(error.message)
          setState('expired')
          return
        }

        if (data?.session?.access_token && data.session.refresh_token) {
          const { error: setError } = await supabase.auth.setSession({
            access_token: data.session.access_token,
            refresh_token: data.session.refresh_token,
          })

          if (setError) {
            console.error('Failed to persist recovery session:', setError)
            setErrorDetails(setError.message)
            setState('expired')
            return
          }
        }

        setState('ready')
        return
      }

      console.warn('Unsupported password recovery payload', {
        type,
        hasAccessToken: Boolean(accessToken),
        hasRefreshToken: Boolean(refreshToken),
        hasCode: Boolean(code),
        hasToken: Boolean(token),
        emailProvided: Boolean(emailFromParams),
      })
      setErrorDetails('This reset link is missing required information.')
      setState('unsupported')
    }

    void handleRecovery()
  }, [searchParams, supabase])

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (newPassword !== confirmPassword) {
      toast.error('Passwords do not match')
      return
    }

    if (newPassword.length < 6) {
      toast.error('Password must be at least 6 characters long')
      return
    }

    try {
      setSubmitting(true)
      const { error } = await supabase.auth.updateUser({ password: newPassword })

      if (error) {
        console.error('Failed to update password:', error)
        toast.error('Failed to update password. Please try again.')
        return
      }

      toast.success('Password updated successfully')
      await supabase.auth.signOut()

      if (redirectTarget) {
        router.replace(`/auth/login?redirectedFrom=${encodeURIComponent(redirectTarget)}&reset=success`)
      } else {
        router.replace('/auth/login?reset=success')
      }
    } finally {
      setSubmitting(false)
    }
  }

  function renderContent() {
    if (state === 'verifying') {
      return (
        <Card className="flex flex-col items-center gap-4 py-12">
          <Spinner size="lg" />
          <p className="text-center text-sm text-gray-600">
            Verifying your password reset link…
          </p>
        </Card>
      )
    }

    if (state === 'expired') {
      return (
        <Card className="py-12">
          <div className="space-y-4 text-center">
            <h2 className="text-2xl font-semibold text-gray-900">Reset link expired</h2>
            <p className="text-sm text-gray-700">
              {errorDetails || 'The password reset link is no longer valid. Please request a new reset email.'}
            </p>
            <LinkButton href="/auth/reset-password" size="sm">
              Send new reset email
            </LinkButton>
          </div>
        </Card>
      )
    }

    if (state === 'unsupported') {
      return (
        <Card className="py-12">
          <div className="space-y-4 text-center">
            <h2 className="text-2xl font-semibold text-gray-900">Link not recognised</h2>
            <p className="text-sm text-gray-700">
              {errorDetails || 'Please open the most recent password reset email from The Anchor and try again.'}
            </p>
            <LinkButton href="/auth/reset-password" size="sm">
              Request reset email
            </LinkButton>
          </div>
        </Card>
      )
    }

    return (
      <Card>
        <Form onSubmit={handleSubmit} autoComplete="on">
          <FormGroup label="New password" required help="Minimum 6 characters">
            <Input
              id="new-password"
              name="new-password"
              type="password"
              autoComplete="new-password"
              required
              minLength={6}
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              placeholder="Enter new password"
            />
          </FormGroup>

          <FormGroup label="Confirm new password" required>
            <Input
              id="confirm-password"
              name="confirm-password"
              type="password"
              autoComplete="new-password"
              required
              minLength={6}
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              placeholder="Confirm new password"
            />
          </FormGroup>

          <FormActions>
            <Button type="submit" fullWidth size="lg" loading={submitting} disabled={submitting}>
              Update password
            </Button>
          </FormActions>
        </Form>
      </Card>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-sidebar p-4">
      <Container size="sm">
        <div className="text-center mb-8">
          <div className="mx-auto w-64 mb-4">
            <Image
              src="/logo.png"
              alt="The Anchor Logo"
              width={256}
              height={256}
              className="w-full h-auto"
              priority
            />
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold text-white">Reset your password</h1>
          <p className="mt-2 text-xs sm:text-sm text-white/80">
            Enter a new password below. You will be redirected to sign in once it is saved.
          </p>
        </div>

        {renderContent()}

        <div className="mt-6 flex justify-center">
          <LinkButton
            href={redirectTarget ? `/auth/login?redirectedFrom=${encodeURIComponent(redirectTarget)}` : '/auth/login'}
            size="sm"
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to login
          </LinkButton>
        </div>
      </Container>
    </div>
  )
}

function RecoverPasswordFallback() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-sidebar p-4">
      <Container size="sm">
        <div className="text-center mb-8">
          <div className="mx-auto w-64 mb-4">
            <Image
              src="/logo.png"
              alt="The Anchor Logo"
              width={256}
              height={256}
              className="w-full h-auto"
              priority
            />
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold text-white">Reset your password</h1>
          <p className="mt-2 text-xs sm:text-sm text-white/80">Preparing recovery form…</p>
        </div>

        <Card className="flex flex-col items-center gap-4 py-12">
          <Spinner size="lg" />
          <p className="text-center text-sm text-white/80">Loading password reset flow…</p>
        </Card>
      </Container>
    </div>
  )
}
