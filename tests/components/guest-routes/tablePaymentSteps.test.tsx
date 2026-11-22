import { act, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TablePaymentClient } from '@/app/g/[token]/table-payment/TablePaymentClient'

/**
 * The deposit pay page tells the server each step the guest reaches (owner decision,
 * 22 November 2026), so a hold that lapses can be explained. The report is sent and forgotten: it
 * must never change, delay or break the payment.
 */

type CapturedPayPalProps = {
  onInit: () => void
  createOrder: () => Promise<string>
  onApprove: () => Promise<void>
  onCancel: () => void
  onError: (error?: unknown) => void
}

const paypal = vi.hoisted(() => ({ props: null as CapturedPayPalProps | null }))

vi.mock('@paypal/react-paypal-js', () => ({
  PayPalScriptProvider: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PayPalButtons: (props: CapturedPayPalProps) => {
    paypal.props = props
    return <div data-testid="paypal-buttons" />
  },
}))

const STEP_URL = '/g/raw-token/table-payment/step'

const props = {
  orderId: 'ORDER-1',
  bookingReference: 'TB-2026-0042',
  depositAmount: 150,
  currency: 'GBP',
  partySize: 15,
  holdExpiresAt: '2099-01-01T18:00:00.000Z',
  showCancelledMessage: false,
  paypalClientId: 'client-id',
  paypalEnvironment: 'sandbox',
  greeting: 'Hi Sam, your booking and deposit details are below.',
  success: { guestFirstName: 'Sam', christmas: null },
  stepUrl: STEP_URL,
}

const fetchMock = vi.fn()

/** The steps reported so far, in order, as the route will read them. */
function sentSteps(): Array<{ step: string; detail?: Record<string, unknown> }> {
  return fetchMock.mock.calls.map(([, init]) => JSON.parse((init as RequestInit).body as string))
}

beforeEach(() => {
  paypal.props = null
  fetchMock.mockReset()
  fetchMock.mockResolvedValue(new Response(null, { status: 204 }))
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('deposit pay page step reporting', () => {
  it('reports the buttons once, however often PayPal sets them up', async () => {
    render(<TablePaymentClient {...props} captureAction={vi.fn()} />)

    act(() => {
      paypal.props?.onInit()
      paypal.props?.onInit()
    })

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(fetchMock).toHaveBeenCalledWith(
      STEP_URL,
      expect.objectContaining({ method: 'POST', keepalive: true, body: JSON.stringify({ step: 'buttons_shown' }) }),
    )
  })

  it('reports PayPal opening, and still hands PayPal the order', async () => {
    render(<TablePaymentClient {...props} captureAction={vi.fn()} />)

    let orderId: string | undefined
    await act(async () => {
      orderId = await paypal.props?.createOrder()
    })

    expect(orderId).toBe('ORDER-1')
    await waitFor(() => expect(sentSteps()).toEqual([{ step: 'paypal_opened' }]))
  })

  it('reports the guest closing PayPal without paying', async () => {
    render(<TablePaymentClient {...props} captureAction={vi.fn()} />)

    act(() => paypal.props?.onCancel())

    await waitFor(() => expect(sentSteps()).toEqual([{ step: 'cancelled' }]))
  })

  it("reports a PayPal error with PayPal's own code and message, read field by field", async () => {
    render(<TablePaymentClient {...props} captureAction={vi.fn()} />)

    const paypalError = Object.assign(new Error(`Detected popup close ${'x'.repeat(400)}`), {
      code: 'popup_blocked',
      debug_id: 'f00dcafe',
    })
    act(() => paypal.props?.onError(paypalError))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const [sent] = sentSteps()
    expect(sent.step).toBe('paypal_error')
    expect(sent.detail).toEqual({
      name: 'Error',
      code: 'popup_blocked',
      message: paypalError.message.slice(0, 300),
      debugId: 'f00dcafe',
    })
    expect(await screen.findByRole('alert')).toHaveTextContent("PayPal couldn't take the payment.")
  })

  it('reports the approval, and nothing more from the browser when the capture answers', async () => {
    const captureAction = vi.fn().mockResolvedValue({ success: false, error: 'PayPal did not take this payment.' })
    render(<TablePaymentClient {...props} captureAction={captureAction} />)

    await act(async () => {
      await paypal.props?.onApprove()
    })

    // Paid and refused are recorded by the server, which knows the reason.
    await waitFor(() => expect(sentSteps()).toEqual([{ step: 'approved' }]))
    expect(captureAction).toHaveBeenCalledWith('ORDER-1')
  })

  it('reports a capture call that never answered', async () => {
    const captureAction = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    render(<TablePaymentClient {...props} captureAction={captureAction} />)

    await act(async () => {
      await paypal.props?.onApprove()
    })

    await waitFor(() =>
      expect(sentSteps()).toEqual([
        { step: 'approved' },
        { step: 'capture_call_failed', detail: { name: 'TypeError', message: 'Failed to fetch' } },
      ]),
    )
    expect(await screen.findByRole('alert')).toHaveTextContent(/please don't pay again yet/)
  })

  it.each([
    ['is refused', () => fetchMock.mockRejectedValue(new Error('offline'))],
    ['throws outright', () => fetchMock.mockImplementation(() => { throw new Error('blocked') })],
  ])('carries on paying when the report %s', async (_name, arrange) => {
    arrange()
    const captureAction = vi.fn().mockResolvedValue({ success: true, confirmation: 'email' })
    render(<TablePaymentClient {...props} captureAction={captureAction} />)

    let orderId: string | undefined
    await act(async () => {
      paypal.props?.onInit()
      orderId = await paypal.props?.createOrder()
      await paypal.props?.onApprove()
    })

    expect(orderId).toBe('ORDER-1')
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent('Deposit received')
  })

  it('reports nothing when the page was given nowhere to report to', async () => {
    render(<TablePaymentClient {...props} stepUrl={undefined} captureAction={vi.fn()} />)

    await act(async () => {
      paypal.props?.onInit()
      await paypal.props?.createOrder()
      paypal.props?.onCancel()
    })

    expect(fetchMock).not.toHaveBeenCalled()
  })
})
