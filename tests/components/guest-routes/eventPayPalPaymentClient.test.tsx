import { act, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EVENT_PAYMENT_CAPTURE_FALLBACK, EVENT_PAYMENT_START_FALLBACK } from '@/lib/events/event-payment-reasons'

/**
 * The guest payment-link page (BK-029, customer bookings review of 24 October 2026) showed the
 * routes' bare reason codes ("hold_expired") and offered "Try again" after any failure, even
 * when PayPal may already have taken the money.
 */

type CapturedProps = {
  disabled: boolean
  onCancel: () => void
  createOrder: () => Promise<string>
  onApprove: (data: { orderID?: string }) => Promise<void>
  onError: (error: unknown) => void
}
const paypal = vi.hoisted(() => ({ props: null as CapturedProps | null }))

vi.mock('@paypal/react-paypal-js', () => ({
  PayPalScriptProvider: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PayPalButtons: (props: CapturedProps) => {
    paypal.props = props
    return <div data-testid="paypal-buttons" />
  },
}))

import { EventPayPalPaymentClient } from '@/app/g/[token]/event-payment/EventPayPalPaymentClient'

const fetchMock = vi.fn()

function renderClient() {
  return render(
    <EventPayPalPaymentClient token="tok-1" paypalClientId="client-id" paypalEnvironment="sandbox" currency="GBP" fallbackUrl="/g/tok-1/event-payment" />,
  )
}

function answer(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body }
}

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

describe('the guest event payment page', () => {
  it('shows the sentence the route sent when a payment cannot start, and offers to try again', async () => {
    fetchMock.mockResolvedValueOnce(answer(410, { success: false, error: 'hold_expired', code: 'hold_expired', message: 'The time to pay for these places has run out. Please start your booking again, or call 01753 682707.' }))
    renderClient()

    await act(async () => {
      await paypal.props!.createOrder().catch(() => undefined)
      paypal.props!.onError(new Error('createOrder failed'))
    })

    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('The time to pay for these places has run out.')
    expect(alert).not.toHaveTextContent('hold_expired')
    expect(within(alert).getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })

  it('uses the start sentence when the route sent none', async () => {
    fetchMock.mockResolvedValueOnce(answer(500, null))
    renderClient()

    await act(async () => {
      await paypal.props!.createOrder().catch(() => undefined)
    })

    expect(screen.getByRole('alert')).toHaveTextContent(EVENT_PAYMENT_START_FALLBACK)
  })

  it('after approval, shows the cautious sentence and the phone number instead of "Try again"', async () => {
    fetchMock.mockResolvedValueOnce(answer(409, { success: false, error: 'amount_or_reference_mismatch', code: 'amount_or_reference_mismatch', message: EVENT_PAYMENT_CAPTURE_FALLBACK }))
    renderClient()

    await act(async () => {
      await paypal.props!.onApprove({ orderID: 'ORDER-1' })
    })

    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('before paying again')
    expect(alert).not.toHaveTextContent('amount_or_reference_mismatch')
    expect(within(alert).queryByRole('button', { name: 'Try again' })).toBeNull()
    expect(within(alert).getByRole('link', { name: 'Call 01753 682707' })).toHaveAttribute('href', 'tel:+441753682707')
  })

  it.each([
    ['a crash with no readable answer', () => fetchMock.mockResolvedValueOnce(answer(500, null))],
    ['no connection at all', () => fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))],
  ])('after approval, %s still gets the cautious sentence and the phone number', async (_label, arrange) => {
    arrange()
    renderClient()

    await act(async () => {
      await paypal.props!.onApprove({ orderID: 'ORDER-1' })
    })

    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent(EVENT_PAYMENT_CAPTURE_FALLBACK)
    expect(within(alert).queryByRole('button', { name: 'Try again' })).toBeNull()
  })

  it('tells the guest staff will check when the payment needs a person', async () => {
    fetchMock.mockResolvedValueOnce(answer(202, { success: false, state: 'manual_review' }))
    renderClient()

    await act(async () => {
      await paypal.props!.onApprove({ orderID: 'ORDER-1' })
    })

    expect(screen.getByRole('status')).toHaveTextContent('Staff need to check your booking before confirming.')
    expect(screen.queryByTestId('paypal-buttons')).toBeNull()
  })

  it('confirms the booking after a successful capture', async () => {
    fetchMock.mockResolvedValueOnce(answer(200, { success: true, state: 'confirmed' }))
    renderClient()

    await act(async () => {
      await paypal.props!.onApprove({ orderID: 'ORDER-1' })
    })

    expect(screen.getByRole('status')).toHaveTextContent('Your booking is confirmed')
  })

  // PayPal's inline card form opens inside its buttons. The page disabled them (38% opacity) and
  // blocked pointer events from the first click, so a card payer saw a faded form they could not
  // type in (a tasting night guest, 10 and 11 November 2026). Only the capture may lock them.
  it('keeps the card form usable until PayPal approves, and locks the buttons only during capture', async () => {
    fetchMock.mockResolvedValueOnce(answer(200, { orderId: 'ORDER-1' }))
    renderClient()
    const wrapper = screen.getByTestId('paypal-buttons').parentElement!.parentElement!

    await act(async () => {
      await expect(paypal.props!.createOrder()).resolves.toBe('ORDER-1')
    })
    expect(paypal.props!.disabled).toBe(false)
    expect(wrapper).not.toHaveClass('pointer-events-none')
    expect(screen.queryByText('Processing payment, please wait.')).toBeNull()

    let finishCapture: (value: unknown) => void = () => undefined
    fetchMock.mockReturnValueOnce(new Promise((resolve) => { finishCapture = resolve }))
    let approval: Promise<void> | undefined
    await act(async () => {
      approval = paypal.props!.onApprove({ orderID: 'ORDER-1' })
    })
    expect(paypal.props!.disabled).toBe(true)
    expect(wrapper).toHaveClass('pointer-events-none')
    expect(screen.getByText('Processing payment, please wait.')).toBeInTheDocument()

    await act(async () => {
      finishCapture(answer(200, { success: true, state: 'confirmed' }))
      await approval
    })
    expect(screen.getByRole('status')).toHaveTextContent('Your booking is confirmed')
  })

  it('leaves the buttons usable when the guest closes PayPal without paying', async () => {
    fetchMock.mockResolvedValueOnce(answer(200, { orderId: 'ORDER-1' }))
    renderClient()

    await act(async () => {
      await paypal.props!.createOrder()
      paypal.props!.onCancel()
    })
    expect(paypal.props!.disabled).toBe(false)
  })
})
