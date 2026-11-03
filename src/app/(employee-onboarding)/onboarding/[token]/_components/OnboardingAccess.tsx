'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Alert, Button, Field, Input } from '@/ds'
import { AuthCard, AuthLink } from '@/app/auth/_components/AuthCard'
import { signInToOnboarding } from '@/app/actions/employeeInvite'
import { signOutOnThisDevice } from '@/app/actions/onboardingSignOut'

interface OnboardingSignInFormProps {
  token: string
  email: string
  /** Called once signed in. Without it the page reloads, which then loads the saved details. */
  onSignedIn?: () => void
}

/**
 * Sign in to carry on, on the onboarding page itself. Once a starter has set a password the
 * invite link only works alongside a session for that account (onboarding-session.ts), so someone
 * coming back on another device signs in here. The email is the one the invite went to, so it is
 * shown, not asked for.
 */
export function OnboardingSignInForm({ token, email, onSignedIn }: OnboardingSignInFormProps) {
  const router = useRouter()
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError('')
    if (!password) {
      setError('Enter your password.')
      return
    }

    setLoading(true)
    try {
      const result = await signInToOnboarding(token, password)
      if (result.success) {
        if (onSignedIn) {
          onSignedIn()
        } else {
          router.refresh()
        }
        return
      }
      setError(result.error)
    } catch {
      setError('We could not sign you in just now. Please try again in a moment.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <p className="text-sm text-text-muted">
        You have already set a password for <strong>{email}</strong>. Sign in with it to carry on with your profile.
      </p>

      {/* Lets a password manager match the saved password to this email. */}
      <input type="email" name="username" autoComplete="username" value={email} readOnly hidden />

      <Field label="Password" error={error || undefined}>
        <Input
          id="onboarding-sign-in-password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      </Field>

      <Button type="submit" variant="primary" loading={loading} className="w-full">
        Sign In and Carry On
      </Button>

      <p className="text-sm text-text-muted">
        Forgotten it?{' '}
        <AuthLink href="/auth/reset-password" className="text-sm">
          Reset your password
        </AuthLink>
        , then open your invite link again.
      </p>
    </form>
  )
}

/** The whole page, for a starter who opens their link with no session. */
export function OnboardingSignInCard({ token, email }: { token: string; email: string }) {
  return (
    <AuthCard title="Sign In to Carry On">
      <OnboardingSignInForm token={token} email={email} />
    </AuthCard>
  )
}

/** Loads the page again, for a snapshot that failed to load. */
export function RetryLoadButton() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)

  return (
    <Button
      type="button"
      variant="primary"
      size="lg"
      className="w-full"
      loading={loading}
      onClick={() => {
        setLoading(true)
        router.refresh()
        // refresh() gives no promise to wait on; let the button press again after a moment.
        window.setTimeout(() => setLoading(false), 1500)
      }}
    >
      Try Again
    </Button>
  )
}

/**
 * For a link opened while signed in as somebody else: sign out, then open it again. That somebody
 * is often a manager, so only this browser is signed out, never their other devices.
 */
export function SignOutAndRetryButton() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  return (
    <div className="space-y-3">
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <Button
        type="button"
        variant="primary"
        size="lg"
        className="w-full"
        loading={loading}
        onClick={async () => {
          setLoading(true)
          setError('')
          try {
            const result = await signOutOnThisDevice()
            if (result && 'error' in result && result.error) {
              setError('We could not sign you out. Please try again.')
              return
            }
            router.refresh()
          } catch {
            setError('We could not sign you out. Please try again.')
          } finally {
            setLoading(false)
          }
        }}
      >
        Sign Out
      </Button>
    </div>
  )
}

/**
 * On the finished page after an onboarding link (not portal setup, which never signs in). Creating
 * the password, or signing in to carry on, signed this browser in as the starter, which may be a
 * shared venue device or a manager's computer, so they are offered a way to sign out there. The
 * page shows this only when it has found a session (success/page.tsx), and it signs out this
 * browser only, so the starter stays signed in on their own phone.
 */
export function FinishedSignOutButton() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [signedOut, setSignedOut] = useState(false)

  if (signedOut) {
    return <Alert tone="success" role="status">You are signed out on this device.</Alert>
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-text-muted">
        You are signed in on this device. If it is not your own phone or computer, sign out now.
      </p>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <Button
        type="button"
        variant="secondary"
        loading={loading}
        onClick={async () => {
          setLoading(true)
          setError('')
          try {
            const result = await signOutOnThisDevice()
            if (result && 'error' in result && result.error) {
              setError('We could not sign you out. Please try again.')
              return
            }
            setSignedOut(true)
          } catch {
            setError('We could not sign you out. Please try again.')
          } finally {
            setLoading(false)
          }
        }}
      >
        Sign Out
      </Button>
    </div>
  )
}
