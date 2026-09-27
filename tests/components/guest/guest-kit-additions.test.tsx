import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import {
  GuestButton,
  GuestCardHeader,
  GuestChoice,
  GuestField,
  GuestInput,
  GuestIntro,
  GuestSection,
  GuestStatusMark,
  guestFieldControlProps,
} from '@/components/features/guest'
import { GuestErrorBoundary } from '@/components/features/guest/GuestErrorBoundary'
import { GuestSubmitButton } from '@/components/features/shared/GuestSubmitButton'
import NotFound from '@/app/not-found'
import { GUEST_CONTACT } from '@/lib/guest-contact'

// The barrel re-exports GuestShell, which loads the guest webfonts, and
// next/font/google is a build-time transform with no loader under Vitest.
vi.mock('next/font/google', () => {
  const font = (): { variable: string; className: string } => ({
    variable: 'mock-font-variable',
    className: 'mock-font',
  })
  return { DM_Serif_Display: font, Outfit: font, Clicker_Script: font }
})

// The chunk recovery navigates the window, which jsdom cannot do. Keep the detection real.
vi.mock('@/components/features/shared/ChunkErrorReloader', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/components/features/shared/ChunkErrorReloader')>()),
  recoverFromChunkFailure: vi.fn(),
  retryPendingNavigation: vi.fn(),
}))

describe('GuestIntro', () => {
  it('renders the kicker, the one h1 and the lead', () => {
    render(<GuestIntro kicker="Table booking" title="Manage table booking" lead="Hi Sam." />)

    expect(screen.getByText('Table booking')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: 'Manage table booking' })).toBeInTheDocument()
    expect(screen.getByText('Hi Sam.')).toBeInTheDocument()
  })
})

describe('GuestSection and GuestCardHeader', () => {
  it('name their group with a level 2 heading', () => {
    render(
      <>
        <GuestSection title="Your food choices" titleId="food">
          <p>Seats</p>
        </GuestSection>
        <GuestCardHeader title="Payment Status" description="What is paid and what is due" />
      </>
    )

    expect(screen.getByRole('region', { name: 'Your food choices' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'Payment Status' })).toBeInTheDocument()
    expect(screen.getByText('What is paid and what is due')).toBeInTheDocument()
  })
})

describe('GuestButton states', () => {
  it('disables itself, marks itself busy and swaps the label while loading', () => {
    render(
      <GuestButton loading loadingText="Saving...">
        Save changes
      </GuestButton>
    )

    const button = screen.getByRole('button', { name: 'Saving...' })
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('aria-busy', 'true')
  })

  it('fills the column only on a phone with fullWidth="mobile"', () => {
    render(<GuestButton fullWidth="mobile">Submit</GuestButton>)

    const className = screen.getByRole('button', { name: 'Submit' }).className
    expect(className).toContain('w-full')
    expect(className).toContain('sm:w-auto')
    // Without this a column form stretches the submit back to full width at every size.
    expect(className).toContain('sm:self-start')
  })

  it('reports a chosen answer tile as pressed', () => {
    render(
      <>
        <GuestButton variant="choice" pressed>
          On the table
        </GuestButton>
        <GuestButton variant="choice" pressed={false}>
          At the bar
        </GuestButton>
      </>
    )

    expect(screen.getByRole('button', { name: 'On the table' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'At the bar' })).toHaveAttribute('aria-pressed', 'false')
  })
})

describe('GuestSubmitButton', () => {
  it('is a guest primary submit that says it is working after the first click', async () => {
    const user = userEvent.setup()
    render(
      <form onSubmit={(event) => event.preventDefault()}>
        <GuestSubmitButton loadingText="Saving...">Save changes</GuestSubmitButton>
      </form>
    )

    const button = screen.getByRole('button', { name: 'Save changes' })
    expect(button).toHaveAttribute('type', 'submit')
    expect(button.className).toContain('bg-anchor-gold-dark')

    await user.click(button)

    expect(await screen.findByRole('button', { name: 'Saving...' })).toBeDisabled()
  })
})

describe('GuestInput and GuestChoice', () => {
  it('swaps the border to the danger colour when invalid, rather than stacking two', () => {
    render(
      <GuestField id="email" label="Email" error="Enter an email address.">
        <GuestInput {...guestFieldControlProps({ id: 'email', error: 'Enter an email address.' })} invalid />
      </GuestField>
    )

    const input = screen.getByLabelText('Email')
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(input.className).toContain('border-anchor-danger')
    expect(input.className).not.toContain('border-guest-border-strong')
  })

  it('makes the whole row the label of its tick box', () => {
    render(<GuestChoice type="checkbox" id="consent" name="consent" label="Keep me posted" />)

    expect(screen.getByRole('checkbox', { name: 'Keep me posted' })).toHaveAttribute('id', 'consent')
  })
})

describe('GuestStatusMark', () => {
  it('is decorative and hidden from assistive tech', () => {
    const { container } = render(<GuestStatusMark tone="success" />)

    expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true')
  })
})

describe('the guest error and not-found pages', () => {
  it('shows the guest-branded 404 with a way back to the website', () => {
    const { container } = render(<NotFound />)

    expect(container.querySelectorAll('main')).toHaveLength(1)
    expect(container.querySelectorAll('.guest-theme')).toHaveLength(1)
    expect(screen.getByRole('heading', { level: 1, name: "We can't find that page" })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Go to The Anchor website' })).toHaveAttribute(
      'href',
      GUEST_CONTACT.website
    )
  })

  it('offers a retry and the phone number when a public page crashes', async () => {
    const user = userEvent.setup()
    const reset = vi.fn()
    render(<GuestErrorBoundary error={new Error('Database timeout')} reset={reset} />)

    expect(screen.getByRole('heading', { level: 1, name: 'Something went wrong' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: `Call ${GUEST_CONTACT.phoneDisplay}` })).toHaveAttribute(
      'href',
      GUEST_CONTACT.telHref
    )

    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(reset).toHaveBeenCalledTimes(1)
  })

  it('asks for a reload, not a retry, when a stale tab cannot load a chunk', () => {
    const error = new Error('Loading chunk 123 failed.')
    error.name = 'ChunkLoadError'
    render(<GuestErrorBoundary error={error} reset={vi.fn()} />)

    expect(screen.getByRole('heading', { level: 1, name: 'This page has been updated' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reload page' })).toBeInTheDocument()
  })
})
