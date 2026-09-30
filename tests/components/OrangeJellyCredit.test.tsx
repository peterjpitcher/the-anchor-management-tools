// The "Built and maintained by Orange Jelly" line: only the brand name is a link, and the
// feed's nofollow choice reaches the anchor.

import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('@/lib/orange-jelly-credit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/orange-jelly-credit')>()
  return { ...actual, getOrangeJellyCredit: vi.fn(async () => actual.FALLBACK_CREDIT) }
})

import { OrangeJellyCredit, OrangeJellyCreditLine } from '@/app/auth/_components/OrangeJellyCredit'
import { FALLBACK_CREDIT } from '@/lib/orange-jelly-credit'

describe('OrangeJellyCreditLine', () => {
  it('reads "Built and maintained by Orange Jelly" with only the brand name linked', () => {
    const { container } = render(<OrangeJellyCreditLine credit={FALLBACK_CREDIT} />)

    expect(container.querySelector('p')?.textContent).toBe('Built and maintained by Orange Jelly')
    const link = screen.getByRole('link', { name: 'Orange Jelly' })
    expect(link).toHaveAttribute('href', 'https://www.orangejelly.co.uk/')
    expect(link).not.toHaveAttribute('rel')
  })

  it('marks the link nofollow when the feed asks for it', () => {
    render(<OrangeJellyCreditLine credit={{ ...FALLBACK_CREDIT, rel: 'nofollow' }} />)

    expect(screen.getByRole('link', { name: 'Orange Jelly' })).toHaveAttribute('rel', 'nofollow')
  })

  it('renders just the link when the prefix is empty', () => {
    const { container } = render(<OrangeJellyCreditLine credit={{ ...FALLBACK_CREDIT, prefix: '' }} />)

    expect(container.querySelector('p')?.textContent).toBe('Orange Jelly')
  })

  it('passes the style classes to the line and the link', () => {
    const { container } = render(
      <OrangeJellyCreditLine credit={FALLBACK_CREDIT} className="text-xs" linkClassName="underline" />,
    )

    expect(container.querySelector('p')).toHaveClass('text-xs')
    expect(screen.getByRole('link', { name: 'Orange Jelly' })).toHaveClass('underline')
  })
})

describe('OrangeJellyCredit', () => {
  it('renders the line the loader resolves', async () => {
    render(await OrangeJellyCredit({ className: 'text-xs' }))

    expect(screen.getByRole('link', { name: 'Orange Jelly' })).toHaveAttribute('href', 'https://www.orangejelly.co.uk/')
    expect(screen.getByText(/Built and maintained by/)).toHaveClass('text-xs')
  })
})
