'use client'

import { useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Image from 'next/image'
import { signIn as signInAction } from '@/app/actions/auth'
import { Container } from '@/components/ui-v2/layout/Container'
import { Card } from '@/components/ui-v2/layout/Card'
import { Form, FormActions } from '@/components/ui-v2/forms/Form'
import { FormGroup } from '@/components/ui-v2/forms/FormGroup'
import { Input } from '@/components/ui-v2/forms/Input'
import { Button } from '@/components/ui-v2/forms/Button'
import { LinkButton } from '@/components/ui-v2/navigation/LinkButton'
import { toast } from '@/components/ui-v2/feedback/Toast'

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

export default function LoginForm() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
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

    const res = await signInAction(email.trim(), password)
    if ('error' in res && res.error) {
      toast.error(String(res.error))
      return
    }

    toast.success('Signed in')
    clearCookie(LOGIN_REDIRECT_COOKIE)
    router.replace(redirectTo)
    router.refresh()
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-sidebar p-4">
      <Container size="sm">
        <div className="text-center mb-8">
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
          <h1 className="text-2xl sm:text-3xl font-bold text-white">Sign in</h1>
          <p className="mt-2 text-xs sm:text-sm text-white/80">Use your Management Tools credentials.</p>
        </div>

        <Card>
          <Form onSubmit={handleSubmit} autoComplete="on" showLoading={false}>
            <FormGroup label="Email address" required>
              <Input
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
              />
            </FormGroup>

            <FormGroup label="Password" required>
              <Input
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </FormGroup>

            <div className="flex items-center justify-between text-sm">
              <LinkButton href="/auth/reset-password" variant="ghost" size="sm">
                Forgot password?
              </LinkButton>
              {redirectTo !== '/dashboard' && (
                <div className="text-xs text-gray-500">After sign in: {redirectTo}</div>
              )}
            </div>

            <FormActions>
              <Button type="submit" size="lg" fullWidth>
                Sign in
              </Button>
            </FormActions>
          </Form>
        </Card>
      </Container>
    </div>
  )
}
