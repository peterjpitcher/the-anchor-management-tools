// Staff screens say "sign in", as the sign-in screens themselves do, never "log in".

import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('@/lib/env', () => ({ getAppUrl: () => 'https://management.example.test' }))
vi.mock('next/image', () => ({
  default: ({ alt }: { alt: string }) => <span role="img" aria-label={alt} />,
}))
vi.mock('next/navigation', () => ({
  usePathname: () => '/onboarding/success',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}))

import OnboardingSuccessPage from '@/app/(employee-onboarding)/onboarding/success/page'
import ErrorPage from '@/app/error/page'

describe('sign-in wording', () => {
  it('tells a new starter how to sign in next time', async () => {
    render(await OnboardingSuccessPage({ searchParams: Promise.resolve({}) }))

    expect(screen.getByText('How to Sign In Next Time')).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/log ?in/i)
  })

  it('points an expired reset link at the sign-in page', async () => {
    render(await ErrorPage({ searchParams: Promise.resolve({ code: 'otp_expired' }) }))

    expect(screen.getByText(/request another password reset from the sign-in page/)).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/log ?in/i)
  })
})
