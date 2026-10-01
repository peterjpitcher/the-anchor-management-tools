import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import BookingDetailClient, {
  type Booking,
  type BookingDepositRefund,
} from '@/app/(authenticated)/table-bookings/[id]/BookingDetailClient'

/**
 * RefundDialog calls router.refresh() after a refund. That re-runs the page on the server and hands
 * this component new props; it keeps its state and re-runs no fetch of its own. Each test renders
 * the page as it was, then re-renders it with what the server would send after the refund.
 *
 * RefundHistoryTable is the real one, reading a mocked getRefundHistory, so "the new row is on
 * screen" means the card really asked again.
 */
const getRefundHistoryMock = vi.hoisted(() => vi.fn())
const refundDialog = vi.hoisted(() => ({ props: null as Record<string, unknown> | null }))

vi.mock('@/app/actions/refundActions', () => ({
  getRefundHistory: getRefundHistoryMock,
  processPayPalRefund: vi.fn(),
  processManualRefund: vi.fn(),
}))

vi.mock('@/lib/table-bookings/client-actions', () => ({
  requestTableBookingAction: vi.fn(),
}))

vi.mock('@/components/features/customers/CustomerSearchInput', () => ({
  __esModule: true,
  default: () => <input aria-label="Customer" />,
}))

vi.mock('@/components/features/invoices/RefundDialog', () => ({
  RefundDialog: (props: Record<string, unknown>) => {
    refundDialog.props = props
    return null
  },
}))

const BOOKING_ID = '00000000-0000-4000-8000-000000000001'

function makeBooking(overrides: Partial<Booking> = {}): Booking {
  return {
    id: BOOKING_ID,
    booking_reference: 'TB-6C6B6AD',
    booking_date: '2026-07-01',
    booking_time: '19:30:00',
    party_size: 15,
    committed_party_size: 15,
    high_chair_count: null,
    is_outside_seating: null,
    booking_type: 'regular',
    booking_purpose: 'food',
    status: 'confirmed',
    source: null,
    special_requirements: null,
    dietary_requirements: null,
    allergies: null,
    celebration_type: null,
    internal_notes: null,
    cancellation_reason: null,
    created_at: null,
    updated_at: null,
    seated_at: null,
    left_at: null,
    no_show_at: null,
    no_show_marked_at: null,
    confirmed_at: null,
    cancelled_at: null,
    completed_at: null,
    start_datetime: '2026-07-01T18:30:00.000Z',
    end_datetime: '2026-07-01T20:00:00.000Z',
    duration_minutes: 90,
    deposit_waived: false,
    hold_expires_at: null,
    reminder_sent: false,
    review_sms_sent_at: null,
    review_clicked_at: null,
    sunday_preorder_completed_at: null,
    sunday_preorder_cutoff_at: null,
    payment_status: 'completed',
    payment_method: 'paypal',
    paypal_deposit_capture_id: 'CAPTURE-1',
    deposit_amount: 150,
    deposit_amount_locked: 150,
    card_capture_completed_at: '2026-06-20T10:00:00.000Z',
    customer: {
      id: 'customer-1',
      first_name: 'Benjamin',
      last_name: 'Ledoux',
      mobile_number: '+447700900000',
    },
    table_booking_tables: [],
    table_booking_items: [],
    audit_trail: [],
    ...overrides,
  }
}

/** A payment_refunds row as getRefundHistory returns it to the Refund History card. */
function historyRow(refund: BookingDepositRefund) {
  return {
    id: refund.id,
    amount: refund.amount,
    refund_method: 'paypal',
    status: refund.status,
    reason: 'Guest cancelled',
    paypal_refund_id: null,
    initiated_by_type: 'staff',
    created_at: '2026-06-25T10:00:00.000Z',
    completed_at: null,
    failure_message: null,
  }
}

function page(booking: Booking, depositRefunds: BookingDepositRefund[] | null) {
  // The server holds whatever the page was just given, so the card's own read agrees with it.
  getRefundHistoryMock.mockResolvedValue({ data: (depositRefunds ?? []).map(historyRow) })
  return <BookingDetailClient booking={booking} canEdit canManage canRefund depositRefunds={depositRefunds} />
}

describe('BookingDetailClient after a deposit refund', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    refundDialog.props = null
  })

  it('shows a full refund as soon as the page reloads its data', async () => {
    const { rerender } = render(page(makeBooking(), []))
    expect(screen.getByRole('button', { name: 'Process Refund' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Refund History' })).not.toBeInTheDocument()

    // A completed refund also moves payment_status off 'completed' (updateRefundStatus).
    rerender(
      page(makeBooking({ payment_status: 'refunded' }), [{ id: 'refund-1', amount: 150, status: 'completed' }]),
    )

    expect(await screen.findByRole('heading', { name: 'Refund History' })).toBeInTheDocument()
    expect(screen.getByText('Refunded: £150.00')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Process Refund' })).not.toBeInTheDocument()
    // The payment card says so twice: the payment status badge, and the refund progress badge.
    expect(screen.getAllByText('Refunded')).toHaveLength(2)
  })

  it('shows a part refund as part refunded', async () => {
    const { rerender } = render(page(makeBooking(), []))
    expect(screen.queryByText('Partially refunded')).not.toBeInTheDocument()

    rerender(
      page(makeBooking({ payment_status: 'partial_refund' }), [{ id: 'refund-1', amount: 50, status: 'completed' }]),
    )

    expect(screen.getByText('Partially refunded')).toBeInTheDocument()
    expect(await screen.findByText('Refunded: £50.00')).toBeInTheDocument()
  })

  it('counts a refund that is still pending at PayPal, when the payment status has not moved', async () => {
    const { rerender } = render(page(makeBooking(), []))
    expect(refundDialog.props).toMatchObject({ totalRefunded: 0, totalPending: 0 })

    rerender(page(makeBooking(), [{ id: 'refund-1', amount: 150, status: 'pending' }]))

    // The dialog must not offer the same £150 again, and the pending refund is listed.
    expect(refundDialog.props).toMatchObject({ totalRefunded: 0, totalPending: 150 })
    expect(await screen.findByText('Pending: £150.00')).toBeInTheDocument()
  })

  it('lists a pending refund again once PayPal settles it', async () => {
    const { rerender } = render(page(makeBooking(), [{ id: 'refund-1', amount: 150, status: 'pending' }]))
    expect(await screen.findByText('Pending: £150.00')).toBeInTheDocument()

    rerender(
      page(makeBooking({ payment_status: 'refunded' }), [{ id: 'refund-1', amount: 150, status: 'completed' }]),
    )

    expect(await screen.findByText('Refunded: £150.00')).toBeInTheDocument()
    expect(screen.queryByText('Pending: £150.00')).not.toBeInTheDocument()
  })

  it('keeps the refund history on a booking refunded before refunds moved the payment status', async () => {
    // One live booking is in this state: a completed refund row, payment_status still 'completed'.
    render(page(makeBooking(), [{ id: 'refund-1', amount: 50, status: 'completed' }]))

    expect(screen.getByText('Partially refunded')).toBeInTheDocument()
    expect(await screen.findByText('Refunded: £50.00')).toBeInTheDocument()
    expect(refundDialog.props).toMatchObject({ totalRefunded: 50, totalPending: 0 })
    expect(screen.getByRole('button', { name: 'Process Refund' })).toBeInTheDocument()
  })

  it('does not offer a refund when the refunds could not be read', () => {
    render(page(makeBooking(), null))

    const alert = screen.getByRole('alert')
    expect(within(alert).getByText(/could not be loaded/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Process Refund' })).not.toBeInTheDocument()
  })
})
