import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('next/font/local', () => {
  const font = (): { variable: string; className: string } => ({
    variable: 'mock-font-variable',
    className: 'mock-font',
  })
  return { default: font }
})

import FeedbackLandingPage from '@/app/(feedback)/feedback/page'
import FeedbackThanksPage from '@/app/(feedback)/feedback/thanks/page'
import { GOOGLE_REVIEW_URL } from '@/lib/feedback/google-review-url'

// The Place ID the website records in docs/SSOT.md (section 12). Pinned here so a
// change to the constant has to change the test too.
const EXPECTED_GOOGLE_REVIEW_URL =
  'https://search.google.com/local/writereview?placeid=ChIJDcbcERJxdkgReaFjdQ7fzfg'

describe('the Google review link', () => {
  it('is the Place ID write-a-review URL, never a g.page short link', () => {
    // Two g.page links rotted silently on the website and took every review ask
    // with them; the website bans them in tests/unit/review-links.test.ts.
    expect(GOOGLE_REVIEW_URL).toBe(EXPECTED_GOOGLE_REVIEW_URL)
    expect(GOOGLE_REVIEW_URL).not.toContain('g.page')
  })
})

describe('/feedback asks everyone the same way', () => {
  it('offers Google and a private message without asking how the visit went first', async () => {
    render(await FeedbackLandingPage({ searchParams: Promise.resolve({ src: 'table-card' }) }))

    expect(screen.getByRole('link', { name: 'Leave a Google review' })).toHaveAttribute(
      'href',
      EXPECTED_GOOGLE_REVIEW_URL,
    )
    expect(screen.getByRole('link', { name: 'Send us private feedback' })).toHaveAttribute(
      'href',
      '/feedback/tell-us?src=table-card',
    )
    expect(
      screen.getByText(
        'We read everything. You can leave a public Google review, or send feedback straight to the team.',
      ),
    ).toBeInTheDocument()
    expect(screen.queryByText('I enjoyed my visit')).not.toBeInTheDocument()
    expect(screen.queryByText('It could have been better')).not.toBeInTheDocument()
    expect(screen.queryByText(/instead/i)).not.toBeInTheDocument()
  })

  it('gives both choices the same size and visual weight', async () => {
    render(await FeedbackLandingPage({ searchParams: Promise.resolve({}) }))

    const google = screen.getByRole('link', { name: 'Leave a Google review' })
    const privately = screen.getByRole('link', { name: 'Send us private feedback' })

    expect(privately).toHaveAttribute('href', '/feedback/tell-us')
    // Identical class lists mean neither is styled as the default answer.
    expect(google.className).not.toBe('')
    expect(google.className).toBe(privately.className)
  })

  it('carries no g.page link anywhere on the page', async () => {
    const { container } = render(await FeedbackLandingPage({ searchParams: Promise.resolve({}) }))

    const hrefs = Array.from(container.querySelectorAll('a')).map((a) => a.getAttribute('href') ?? '')
    expect(hrefs.some((href) => href.includes('g.page'))).toBe(false)
  })
})

describe('/feedback/thanks', () => {
  it('still offers the public Google review after a private message', () => {
    const { container } = render(<FeedbackThanksPage />)

    expect(
      screen.getByRole('link', { name: "You're also welcome to leave a public Google review" }),
    ).toHaveAttribute('href', EXPECTED_GOOGLE_REVIEW_URL)
    const hrefs = Array.from(container.querySelectorAll('a')).map((a) => a.getAttribute('href') ?? '')
    expect(hrefs.some((href) => href.includes('g.page'))).toBe(false)
  })
})
