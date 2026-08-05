import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import PublicParkingClient, {
  type PublicParkingBooking,
} from '@/app/parking/guest/[id]/_components/PublicParkingClient'
import ParkingPaymentErrorPage from '@/app/parking/payment-error/page'
import ParkingNotFound from '@/app/parking/not-found'
import { GUEST_CONTACT } from '@/lib/guest-contact'
import type { ParkingPaymentNotice } from '@/app/parking/guest/[id]/paymentNotice'

const BOOKING: PublicParkingBooking = {
  id: '5f2f0a1e-0000-4000-8000-000000000001',
  reference: 'PK-2026-0042',
  status: 'pending_payment',
  payment_status: 'pending',
  start_at: '2026-08-10T09:00:00.000Z',
  end_at: '2026-08-12T17:00:00.000Z',
  calculated_price: 45,
  override_price: null,
  vehicle_registration: 'AB12 CDE',
  vehicle_make: 'Ford',
  vehicle_model: 'Focus',
  customer_first_name: 'Sam',
  customer_last_name: 'Doe',
}

const PENDING_NOTICE: ParkingPaymentNotice = {
  tone: 'warning',
  title: 'Payment needed',
  message: 'We have received your booking, but payment is still needed to confirm the space.',
}

const FAILED_NOTICE: ParkingPaymentNotice = {
  tone: 'error',
  title: 'Payment failed',
  message: 'We were unable to confirm your payment.',
}

/** Nothing on these four surfaces may keep a class from the retired `.public__*` block. */
function assertNoLegacyPublicClasses(container: HTMLElement): void {
  expect(container.querySelector('[class*="public__"]')).toBeNull()
}

describe('parking guest booking page', () => {
  it('renders inside the guest shell with a single main landmark', () => {
    const { container } = render(
      <PublicParkingClient
        booking={BOOKING}
        paymentNotice={PENDING_NOTICE}
        canRetryPayment
        customerFirstName="Sam"
      />
    )

    expect(container.querySelectorAll('main')).toHaveLength(1)
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'Parking booking awaiting payment'
    )
    expect(screen.getByText('Guest parking')).toBeInTheDocument()
    expect(
      screen.getByText('Sam, your parking booking details are below.')
    ).toBeInTheDocument()
    assertNoLegacyPublicClasses(container)
  })

  it('puts the retry submit and the trust line inside the payment alert', () => {
    render(
      <PublicParkingClient
        booking={BOOKING}
        paymentNotice={PENDING_NOTICE}
        canRetryPayment
        customerFirstName="Sam"
      />
    )

    const notice = screen.getByRole('status')
    expect(within(notice).getByText('Payment needed')).toBeInTheDocument()

    const submit = within(notice).getByRole('button', { name: 'Pay now' })
    expect(submit).toHaveAttribute('type', 'submit')

    const form = submit.closest('form')
    expect(form).toHaveAttribute('action', '/api/parking/payment/retry')
    expect(form).toHaveAttribute('method', 'post')
    expect(form?.querySelector('input[name="booking_id"]')).toHaveValue(BOOKING.id)

    expect(within(notice).getByText('Secure payment via PayPal')).toBeInTheDocument()
  })

  it('keeps role="alert" for a failed payment and offers the retry wording', () => {
    render(
      <PublicParkingClient
        booking={{ ...BOOKING, payment_status: 'failed' }}
        paymentNotice={FAILED_NOTICE}
        canRetryPayment
        customerFirstName={null}
      />
    )

    const notice = screen.getByRole('alert')
    expect(within(notice).getByRole('button', { name: 'Try payment again' })).toBeInTheDocument()
    expect(
      screen.getByText('Your parking booking details are below.')
    ).toBeInTheDocument()
  })

  it('hides the retry form when the booking cannot be paid again', () => {
    render(
      <PublicParkingClient
        booking={{ ...BOOKING, status: 'confirmed', payment_status: 'paid' }}
        paymentNotice={null}
        canRetryPayment={false}
        customerFirstName="Sam"
      />
    )

    expect(screen.queryByRole('button', { name: /pay/i })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'Parking booking confirmed'
    )
  })

  it('renders both statuses as tone-mapped badges, not plain text', () => {
    render(
      <PublicParkingClient
        booking={{ ...BOOKING, status: 'confirmed', payment_status: 'paid' }}
        paymentNotice={null}
        canRetryPayment={false}
        customerFirstName="Sam"
      />
    )

    // `confirmed` and `paid` both map to the success tone.
    expect(screen.getByText('confirmed').className).toContain('anchor-success')
    expect(screen.getByText('paid').className).toContain('anchor-success')
  })

  it('falls back to the outline badge for a status the tone map does not know', () => {
    render(
      <PublicParkingClient
        booking={BOOKING}
        paymentNotice={null}
        canRetryPayment={false}
        customerFirstName="Sam"
      />
    )

    // `pending_payment` is humanised the same way it always was, and shows as
    // the neutral outline pill rather than being mis-coloured.
    const parkingStatus = screen.getByText('pending payment')
    expect(parkingStatus.className).toContain('border-guest-border-strong')

    // `pending` payment status is a known outstanding value.
    expect(screen.getByText('pending').className).toContain('guest-accent-text')
  })

  it('sets the reference and registration in the mono face and keeps the help line', () => {
    render(
      <PublicParkingClient
        booking={BOOKING}
        paymentNotice={null}
        canRetryPayment={false}
        customerFirstName="Sam"
      />
    )

    expect(screen.getByText('PK-2026-0042').className).toContain('font-mono')
    expect(screen.getByText('AB12 CDE').className).toContain('font-mono')

    // Contact facts come from GUEST_CONTACT, never a literal.
    expect(screen.getAllByText(GUEST_CONTACT.phoneDisplay).length).toBeGreaterThan(0)

    const websiteLink = screen.getByRole('link', { name: 'Return to The Anchor website' })
    expect(websiteLink).toHaveAttribute('href', GUEST_CONTACT.website)
    expect(websiteLink).toHaveAttribute('referrerpolicy', 'no-referrer')
  })

  it('keeps all three assurance rows', () => {
    render(
      <PublicParkingClient
        booking={BOOKING}
        paymentNotice={null}
        canRetryPayment={false}
        customerFirstName="Sam"
      />
    )

    expect(screen.getByText('Secure Booking')).toBeInTheDocument()
    expect(screen.getByText('Your details are stored securely')).toBeInTheDocument()
    expect(screen.getByText('Confirmation')).toBeInTheDocument()
    expect(screen.getByText('You will receive email confirmation')).toBeInTheDocument()
    expect(screen.getByText('Support')).toBeInTheDocument()
    expect(screen.getByText('Contact us anytime')).toBeInTheDocument()
  })
})

describe('parking payment error page', () => {
  it('uses the mapped copy and shows the booking id in the mono face', async () => {
    const { container } = render(
      await ParkingPaymentErrorPage({
        searchParams: Promise.resolve({ reason: 'not_found', booking_id: 'abc-123' }),
      })
    )

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'Payment could not be matched'
    )
    expect(
      screen.getByText('We could not match that PayPal payment to a parking booking.')
    ).toBeInTheDocument()
    expect(screen.getByText('abc-123').className).toContain('font-mono')
    expect(container.querySelectorAll('main')).toHaveLength(1)
    assertNoLegacyPublicClasses(container)
  })

  it('falls back to the generic copy and omits the booking id row', async () => {
    render(await ParkingPaymentErrorPage({ searchParams: Promise.resolve({}) }))

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Parking payment issue')
    expect(screen.getByText('We could not confirm this parking payment.')).toBeInTheDocument()
    expect(screen.queryByText(/Booking ID:/)).not.toBeInTheDocument()
  })

  it('offers the outline return action against the shared website URL', async () => {
    render(
      await ParkingPaymentErrorPage({
        searchParams: Promise.resolve({ reason: 'missing_parameters' }),
      })
    )

    const action = screen.getByRole('link', { name: 'Return to The Anchor website' })
    expect(action).toHaveAttribute('href', GUEST_CONTACT.website)
    expect(action).toHaveAttribute('referrerpolicy', 'no-referrer')
  })
})

describe('parking not-found boundary', () => {
  it('renders the shared blocked state with its existing copy', () => {
    const { container } = render(<ParkingNotFound />)

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Booking link not found')
    expect(screen.getByText('We could not find that parking booking.')).toBeInTheDocument()
    expect(
      screen.getByText(
        'Please check the link, or contact the team and quote your parking reference if you have one.'
      )
    ).toBeInTheDocument()
    expect(
      screen.getByText(`Please call ${GUEST_CONTACT.phoneDisplay} for help.`)
    ).toBeInTheDocument()
    expect(container.querySelectorAll('main')).toHaveLength(1)
    assertNoLegacyPublicClasses(container)
  })
})
