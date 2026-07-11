'use client'

import { useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Image from 'next/image'
import { signIn as signInAction } from '@/app/actions/auth'
import { Button, Field, Input, Spinner } from '@/ds'
import { toast } from '@/ds'

const LOGIN_REDIRECT_COOKIE = 'post_login_redirect'

function sanitizeRedirectTarget(raw: string | null) {
  if (!raw) return '/dashboard'

  try {
    const trimmed = raw.trim()
    if (!trimmed.startsWith('/')) return '/dashboard'
    if (trimmed.startsWith('//')) return '/dashboard'
    if (trimmed.toLowerCase().startsWith('/auth/')) return '/dashboard'
    return trimmed
  } catch {
    return '/dashboard'
  }
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

  const redirectedFrom = searchParams.get('redirectedFrom')
  const redirectTo = useMemo(() => {
    const cookieRedirectTarget = getCookie(LOGIN_REDIRECT_COOKIE)
    return sanitizeRedirectTarget(redirectedFrom || cookieRedirectTarget)
  }, [redirectedFrom])

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
      const res = await signInAction(email.trim(), password)
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
      <div className="auth">
        <div className="auth__card">
          <h1 className="auth__h1">Two-factor authentication</h1>
          <p className="auth__lead">Enter the 6-digit code from your authenticator app.</p>
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
            <button
              type="button"
              className="auth__link text-center text-sm"
              onClick={() => setTwoFactorMode(false)}
            >
              Back to sign in
            </button>
          </form>
        </div>
      </div>
    )
  }

  return (
    <div className="auth">
      <div className="auth__card">
        <div className="auth__brand">
          <div className="auth__logo">
            <Image
              src="/logo.png"
              alt="The Anchor Logo"
              width={44}
              height={44}
              className="w-full h-auto rounded-[10px]"
              priority
            />
          </div>
          <div>
            <div className="auth__title">The Anchor</div>
            <div className="auth__sub">Management Tools</div>
          </div>
        </div>

        <h1 className="auth__h1">Sign in</h1>
        <p className="auth__lead">Enter your credentials to continue.</p>

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
            <a href="/auth/reset-password" className="auth__link text-xs">
              Forgot password?
            </a>
            {redirectTo !== '/dashboard' && (
              <span className="min-w-0 truncate text-xs text-text-subtle">After sign in: {redirectTo}</span>
            )}
          </div>

          <Button type="submit" variant="primary" size="lg" loading={loading} className="w-full">
            {loading ? <Spinner size="sm" /> : null}
            Sign in
          </Button>
        </form>

        <div className="auth__divider">or</div>

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
          Sign in with Microsoft 365
        </Button>

        <div className="auth__footer">
          <span className="text-text-subtle text-xs">&copy; {new Date().getFullYear()} The Anchor</span>
        </div>
      </div>
    </div>
  )
}
