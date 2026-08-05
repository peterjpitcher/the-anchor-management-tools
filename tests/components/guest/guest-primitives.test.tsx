import { render, screen, within } from '@testing-library/react'
import { Clock } from 'lucide-react'
import { describe, expect, it, vi } from 'vitest'
import {
  DetailGrid,
  DetailRow,
  GuestAlert,
  GuestAmount,
  GuestBlockedState,
  GuestButton,
  GuestCard,
  GuestField,
  guestFieldControlProps,
  guestFieldIds,
  GUEST_INPUT_CLASS,
  TrustLine,
} from '@/components/features/guest'

// The barrel re-exports GuestShell, which loads the guest webfonts, and
// next/font/google is a build-time transform with no loader under Vitest.
// Any test importing from '@/components/features/guest' needs this stub.
vi.mock('next/font/google', () => {
  const font = (): { variable: string; className: string } => ({
    variable: 'mock-font-variable',
    className: 'mock-font',
  })
  return { DM_Serif_Display: font, Outfit: font, Clicker_Script: font }
})

describe('GuestCard', () => {
  it('renders plain by default and adds the gold rule only on accent', () => {
    const { container, rerender } = render(<GuestCard>Plain</GuestCard>)

    const plain = container.firstElementChild as HTMLElement
    expect(plain.className).toContain('rounded-guest-card')
    expect(plain.className).not.toContain('border-t-anchor-gold')

    rerender(<GuestCard variant="accent">Accent</GuestCard>)
    // Exactly one accent card per page: this is the one signature motif.
    expect((container.firstElementChild as HTMLElement).className).toContain(
      'border-t-anchor-gold'
    )
  })

  it('passes extra classes through without losing its own', () => {
    const { container } = render(<GuestCard className="p-0">Body</GuestCard>)

    const card = container.firstElementChild as HTMLElement
    expect(card.className).toContain('p-0')
    expect(card.className).not.toContain('p-5')
    expect(card.className).toContain('bg-guest-surface')
  })
})

describe('GuestAlert', () => {
  it('defaults problem to role=alert and the other tones to role=status', () => {
    const { rerender } = render(<GuestAlert tone="problem">Something broke</GuestAlert>)
    expect(screen.getByRole('alert')).toHaveTextContent('Something broke')

    rerender(<GuestAlert tone="success">All done</GuestAlert>)
    expect(screen.getByRole('status')).toHaveTextContent('All done')

    rerender(<GuestAlert tone="notice">Heads up</GuestAlert>)
    expect(screen.getByRole('status')).toHaveTextContent('Heads up')
  })

  it('lets a caller override the role and set a live region', () => {
    render(
      <GuestAlert tone="problem" role="status" live="polite">
        Saving
      </GuestAlert>
    )

    const alert = screen.getByRole('status')
    expect(alert).toHaveAttribute('aria-live', 'polite')
  })

  it('renders each tone with its title, and hides the icon from assistive tech', () => {
    const { container } = render(
      <GuestAlert tone="notice" title="Your hold expires soon" icon={Clock}>
        We are holding your table.
      </GuestAlert>
    )

    expect(screen.getByText('Your hold expires soon')).toBeInTheDocument()
    expect(screen.getByText('We are holding your table.')).toBeInTheDocument()
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
  })

  it('renders an action inside itself and pads out to suit', () => {
    const { container } = render(
      <GuestAlert
        tone="notice"
        title="Payment needed"
        action={<GuestButton>Pay now</GuestButton>}
      >
        Your booking is not paid yet.
      </GuestAlert>
    )

    const alert = screen.getByRole('status')
    expect(within(alert).getByRole('button', { name: 'Pay now' })).toBeInTheDocument()
    expect((container.firstElementChild as HTMLElement).className).toContain('p-4')
  })
})

describe('GuestField', () => {
  it('wires the label to the control', () => {
    render(
      <GuestField id="party-size" label="Party size">
        <input {...guestFieldControlProps({ id: 'party-size' })} className={GUEST_INPUT_CLASS} />
      </GuestField>
    )

    expect(screen.getByLabelText('Party size')).toHaveAttribute('id', 'party-size')
  })

  it('renders the hint above the control and points aria-describedby at it', () => {
    const hint = 'We share this with the kitchen.'
    render(
      <GuestField id="requirements" label="Special requirements" hint={hint}>
        <textarea
          {...guestFieldControlProps({ id: 'requirements', hint })}
          className={GUEST_INPUT_CLASS}
        />
      </GuestField>
    )

    const control = screen.getByLabelText('Special requirements')
    const { hintId } = guestFieldIds('requirements')

    expect(screen.getByText(hint)).toHaveAttribute('id', hintId)
    expect(control).toHaveAttribute('aria-describedby', hintId)
    // The hint is the lawful basis for collecting dietary data, so it must
    // precede the control in the DOM, not trail it.
    expect(
      screen.getByText(hint).compareDocumentPosition(control) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
  })

  it('marks the control invalid and describes it by both hint and error', () => {
    const hint = 'We reply within a day.'
    const error = 'Enter an email address we can reply to.'
    render(
      <GuestField id="email" label="Email" hint={hint} error={error} required>
        <input
          {...guestFieldControlProps({ id: 'email', hint, error, required: true })}
          className={GUEST_INPUT_CLASS}
        />
      </GuestField>
    )

    const control = screen.getByLabelText(/Email/)
    const { hintId, errorId } = guestFieldIds('email')

    expect(control).toHaveAttribute('aria-invalid', 'true')
    expect(control).toBeRequired()
    expect(control).toHaveAttribute('aria-describedby', `${hintId} ${errorId}`)
    expect(screen.getByText(error)).toHaveAttribute('id', errorId)
  })

  it('leaves aria attributes off entirely when there is nothing to describe', () => {
    render(
      <GuestField id="name" label="Name">
        <input {...guestFieldControlProps({ id: 'name' })} className={GUEST_INPUT_CLASS} />
      </GuestField>
    )

    const control = screen.getByLabelText('Name')
    expect(control).not.toHaveAttribute('aria-describedby')
    expect(control).not.toHaveAttribute('aria-invalid')
    expect(control).not.toBeRequired()
  })
})

describe('GuestAmount', () => {
  it('renders the page-sized money statement with its optional sub line', () => {
    render(<GuestAmount label="Deposit due now" value="£30.00" sub="£10 per person" />)

    expect(screen.getByText('Deposit due now')).toBeInTheDocument()
    const figure = screen.getByText('£30.00')
    expect(figure.className).toContain('text-[48px]')
    // DM Serif Display is single weight 400: never faux-bold it.
    expect(figure.className).toContain('font-normal')
    expect(screen.getByText('£10 per person')).toBeInTheDocument()
  })

  it('renders the smaller right-aligned inline variant for the booking portal', () => {
    render(<GuestAmount label="Balance remaining" value="£250.00" size="inline" />)

    const figure = screen.getByText('£250.00')
    expect(figure.className).toContain('text-[22px]')
    expect(figure.className).not.toContain('text-[48px]')
  })
})

describe('DetailRow', () => {
  it('renders label and value, tinting only deadline values', () => {
    render(
      <>
        <DetailRow label="Covers" value="3" />
        <DetailRow label="Hold expires" value="7:15pm" emphasis="deadline" />
      </>
    )

    expect(screen.getByText('Covers')).toBeInTheDocument()
    expect(screen.getByText('3').className).toContain('text-guest-text')
    expect(screen.getByText('7:15pm').className).toContain('text-guest-accent-text')
  })
})

describe('DetailGrid', () => {
  it('renders every item and stays single column on the narrowest phones', () => {
    const { container } = render(
      <DetailGrid
        items={[
          { label: 'Reference', value: 'PK-8823' },
          { label: 'Registration', value: 'AB12 CDE' },
        ]}
      />
    )

    expect(screen.getByText('Reference')).toBeInTheDocument()
    expect(screen.getByText('AB12 CDE')).toBeInTheDocument()

    const grid = container.firstElementChild as HTMLElement
    expect(grid.className).toContain('grid-cols-1')
    expect(grid.className).toContain('min-[380px]:grid-cols-2')
  })

  it('renders nothing but the wrapper when given no items', () => {
    const { container } = render(<DetailGrid items={[]} />)

    expect((container.firstElementChild as HTMLElement).children).toHaveLength(0)
  })
})

describe('TrustLine', () => {
  it('defaults to the PayPal reassurance and hides its dot', () => {
    const { container } = render(<TrustLine />)

    expect(screen.getByText(/Secure payment via PayPal/)).toBeInTheDocument()
    expect(container.querySelector('[aria-hidden="true"]')).not.toBeNull()
  })

  it('accepts an override', () => {
    render(<TrustLine>Secure payment via PayPal</TrustLine>)

    expect(screen.getByText(/Secure payment via PayPal/)).toBeInTheDocument()
  })
})

describe('GuestBlockedState', () => {
  const baseProps = {
    kicker: 'Table booking',
    heading: 'Payment link unavailable',
    lead: 'we could not open your payment link.',
    reason: 'This payment link has expired.',
    primaryAction: { label: 'Call 01753 682707', href: 'tel:+441753682707' },
  }

  it('leads with the reason in a problem alert, and offers a way to get help', () => {
    render(<GuestBlockedState {...baseProps} />)

    expect(screen.getByRole('heading', { level: 1, name: baseProps.heading })).toBeInTheDocument()
    expect(screen.getByText(baseProps.kicker)).toBeInTheDocument()
    expect(screen.getByText(baseProps.lead)).toBeInTheDocument()

    const alert = screen.getByRole('alert')
    expect(within(alert).getByText(baseProps.reason)).toBeInTheDocument()
    // Phone number comes from the one contact source, never a literal.
    expect(alert).toHaveTextContent('Please call 01753 682707 for help.')

    const primary = screen.getByRole('link', { name: 'Call 01753 682707' })
    expect(primary).toHaveAttribute('href', 'tel:+441753682707')
    expect(primary).toHaveAttribute('referrerpolicy', 'no-referrer')
  })

  it('renders the secondary action only when given one', () => {
    const { rerender } = render(<GuestBlockedState {...baseProps} />)
    expect(screen.getAllByRole('link')).toHaveLength(1)

    rerender(
      <GuestBlockedState
        {...baseProps}
        secondaryAction={{ label: 'View upcoming events', href: 'https://www.the-anchor.pub' }}
      />
    )

    expect(screen.getAllByRole('link')).toHaveLength(2)
    expect(screen.getByRole('link', { name: 'View upcoming events' })).toHaveAttribute(
      'referrerpolicy',
      'no-referrer'
    )
  })

  it('never renders a main landmark, because GuestShell owns the only one', () => {
    const { container } = render(<GuestBlockedState {...baseProps} />)

    expect(container.querySelector('main')).toBeNull()
  })
})
