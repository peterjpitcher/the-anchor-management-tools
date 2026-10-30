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

const GOOGLE_REVIEW_URL = 'https://g.page/r/CXmhY3UO3834EBM/review'

describe('/feedback asks everyone the same way', () => {
  it('offers Google and a private message without asking how the visit went first', async () => {
    render(await FeedbackLandingPage({ searchParams: Promise.resolve({ src: 'table-card' }) }))

    expect(screen.getByRole('link', { name: 'Leave a Google review' })).toHaveAttribute('href', GOOGLE_REVIEW_URL)
    expect(screen.getByRole('link', { name: 'Tell us privately instead' })).toHaveAttribute(
      'href',
      '/feedback/tell-us?src=table-card',
    )
    expect(screen.getByText("Good or bad, we'd like to hear about it. It only takes a moment.")).toBeInTheDocument()
    expect(screen.queryByText('I enjoyed my visit')).not.toBeInTheDocument()
    expect(screen.queryByText('It could have been better')).not.toBeInTheDocument()
  })

  it('still offers Google after a private message', () => {
    render(<FeedbackThanksPage />)

    expect(screen.getByRole('link', { name: 'Leave a Google review' })).toHaveAttribute('href', GOOGLE_REVIEW_URL)
  })
})
