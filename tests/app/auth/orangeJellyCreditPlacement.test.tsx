// The Orange Jelly credit shows under the card on the public /auth screens only. The auth layout
// reads it on the server and hands it to AuthCard through context; AuthCard on /error,
// /unauthorized and the invite-link states has no provider, so it shows no credit there.

import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('next/image', () => ({
  default: ({ alt }: { alt: string }) => <span role="img" aria-label={alt} />,
}))

// The real OrangeJellyCredit is an async Server Component, which the client renderer cannot
// run. Stand in a synchronous one that renders the real line with the fallback credit.
vi.mock('@/app/auth/_components/OrangeJellyCredit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/app/auth/_components/OrangeJellyCredit')>()
  const { FALLBACK_CREDIT } = await import('@/lib/orange-jelly-credit')
  return {
    ...actual,
    OrangeJellyCredit: (props: { className?: string; linkClassName?: string }) => (
      <actual.OrangeJellyCreditLine credit={FALLBACK_CREDIT} {...props} />
    ),
  }
})

import AuthLayout from '@/app/auth/layout'
import RecoverPage from '@/app/auth/recover/page'
import { AuthCard } from '@/app/auth/_components/AuthCard'

describe('Orange Jelly credit placement', () => {
  it('shows the credit under the card on an /auth screen', () => {
    render(
      <AuthLayout>
        <RecoverPage />
      </AuthLayout>,
    )

    const link = screen.getByRole('link', { name: 'Orange Jelly' })
    expect(link).toHaveAttribute('href', 'https://www.orangejelly.co.uk/')
    expect(link.closest('p')?.textContent).toBe('Built and maintained by Orange Jelly')
    expect(link.closest('p')).toHaveClass('text-xs', 'text-text-soft')

    // Under the card, not inside it.
    const card = screen.getByRole('heading', { name: 'Check Your Inbox' }).parentElement
    expect(card).not.toContainElement(link)
    expect(card?.parentElement).toContainElement(link)
  })

  it('shows no credit on a card outside /auth', () => {
    render(<AuthCard title="Access Denied" lead="You do not have permission to view this page." />)

    expect(screen.queryByText(/Built and maintained by/)).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Orange Jelly' })).not.toBeInTheDocument()
  })
})
