'use client'

import { useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { signIn as signInAction } from '@/app/actions/auth'
import { Button, Field, Input, toast } from '@/ds'
import { safeRelativePath } from '@/lib/portal/next-path'
import { AuthCard, AuthDivider, AuthLink } from '../../_components/AuthCard'

const LOGIN_REDIRECT_COOKIE = 'post_login_redirect'

/**
 * The page to open after signing in: a path on this site only, never another site and never
 * a sign-in page. `safeRelativePath` also refuses a backslash, which browsers read as `//`, so
 * `/\evil.example` cannot send someone away after they have typed their password.
 */
function sanitizeRedirectTarget(raw: string | null) {
  const path = safeRelativePath(raw)
  if (!path) return '/dashboard'
  if (path.toLowerCase().startsWith('/auth/')) return '/dashboard'
  return path
}

function getCookie(name: string): string | null {
  if (typeof document === 'undefined') return null
  const namePrefix = `${name}=`
  const cookieEntry = document.cookie
    .split(';')
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith(namePrefix))
  if (!cookieEntry) return null
  return decodeURIComponent(cookieEntry.slice(namePrefix.length))
}

function clearCookie(name: string) {
  if (typeof document === 'undefined') return
  document.cookie = `${name}=; Max-Age=0; Path=/; SameSite=Lax`
}

export default function LoginClient() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [twoFactorMode, setTwoFactorMode] = useState(false)
  const [twoFactorCode, setTwoFactorCode] = useState('')
  const router = useRouter()
  const searchParams = useSearchParams()

  // `next` (a link that asks for sign-in on purpose), the legacy `redirectedFrom`, or the cookie
  // the middleware sets when it sends a signed-out visitor here from the page they wanted.
  const nextParam = searchParams.get('next')
  const redirectedFrom = searchParams.get('redirectedFrom')
  const redirectTo = useMemo(() => {
    const cookieRedirectTarget = getCookie(LOGIN_REDIRECT_COOKIE)
    return sanitizeRedirectTarget(nextParam || redirectedFrom || cookieRedirectTarget)
  }, [nextParam, redirectedFrom])

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()

    if (!email.trim()) {
      toast.error('Enter your email address')
      return
    }
    if (!password) {
      toast.error('Enter your password')
      return
    }

    setLoading(true)
    try {
      // The server decides where a portal-only user goes, honouring this only when it is a safe
      // /portal/ link (an emailed training link, say); everyone else goes to redirectTo.
      const res = await signInAction(email.trim(), password, redirectTo)
      if ('error' in res && res.error) {
        toast.error(String(res.error))
        setLoading(false)
        return
      }

      toast.success('Signed in')
      clearCookie(LOGIN_REDIRECT_COOKIE)
      const destination = ('redirectTo' in res && res.redirectTo) ? res.redirectTo : redirectTo
      router.replace(destination)
      router.refresh()
    } catch {
      toast.error('Something went wrong. Please try again.')
      setLoading(false)
    }
  }

  if (twoFactorMode) {
    return (
      <AuthCard title="Two-Factor Authentication" lead="Enter the 6-digit code from your authenticator app.">
        <form
          onSubmit={(e) => {
            e.preventDefault()
            /* 2FA verify logic would go here when server supports it */
            setTwoFactorMode(false)
          }}
          className="flex flex-col gap-4"
        >
          <Field label="Verification code" required>
            <Input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              placeholder="000000"
              value={twoFactorCode}
              onChange={(e) => setTwoFactorCode(e.target.value.replace(/\D/g, ''))}
            />
          </Field>
          <Button type="submit" variant="primary" size="lg" className="w-full">
            Verify
          </Button>
          <Button type="button" variant="link" className="self-center text-sm" onClick={() => setTwoFactorMode(false)}>
            Back to Sign In
          </Button>
        </form>
      </AuthCard>
    )
  }

  return (
    <AuthCard
      title="Sign In"
      lead="Enter your credentials to continue."
      footer={<>&copy; {new Date().getFullYear()} Orange Jelly</>}
    >
      <form onSubmit={handleSubmit} autoComplete="on" className="flex flex-col gap-4">
        <Field label="Email address" required>
          <Input
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
          />
        </Field>

        <Field label="Password" required>
          <Input
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>

        <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
          <AuthLink href="/auth/reset-password">Forgot password?</AuthLink>
          {redirectTo !== '/dashboard' && (
            <span className="min-w-0 truncate text-xs text-text-soft">After sign in: {redirectTo}</span>
          )}
        </div>

        <Button type="submit" variant="primary" size="lg" loading={loading} className="w-full">
          Sign In
        </Button>
      </form>

      <AuthDivider />

      <Button
        type="button"
        variant="secondary"
        size="lg"
        className="w-full"
        onClick={() => {
          /* Microsoft SSO placeholder - integrate when available */
          toast.error('Microsoft SSO is not yet configured')
        }}
      >
        Sign In with Microsoft 365
      </Button>
    </AuthCard>
  )
}
