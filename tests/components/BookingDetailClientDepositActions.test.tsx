import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import BookingDetailClient, { type Booking } from '@/app/(authenticated)/table-bookings/[id]/BookingDetailClient'

const requestTableBookingActionMock = vi.hoisted(() => vi.fn())
const toast = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
}))

vi.mock('@/lib/table-bookings/client-actions', () => ({
  requestTableBookingAction: requestTableBookingActionMock,
}))

vi.mock('@/ds/primitives/Toast', () => ({
  toast: toast,
}))

vi.mock('@/components/features/customers/CustomerSearchInput', () => ({
  __esModule: true,
  default: () => <input aria-label="Customer" />,
}))

vi.mock('@/components/features/invoices/RefundDialog', () => ({
  RefundDialog: () => null,
}))

vi.mock('@/components/features/invoices/RefundHistoryTable', () => ({
  RefundHistoryTable: () => null,
}))

const BOOKING_ID = '00000000-0000-4000-8000-000000000001'
const LARGE_TABLE_ID = '11111111-1111-4111-8111-111111111111'

function makeBooking(): Booking {
  return {
    id: BOOKING_ID,
    booking_reference: 'TB-6C6B6AD',
    booking_date: '2026-07-01',
    booking_time: '19:30:00',
    party_size: 6,
    committed_party_size: 6,
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
    payment_status: null,
    payment_method: null,
    paypal_deposit_capture_id: null,
    deposit_amount: null,
    deposit_amount_locked: null,
    card_capture_completed_at: null,
    customer: {
      id: 'customer-1',
      first_name: 'Benjamin',
      last_name: 'Ledoux',
      mobile_number: '+447700900000',
    },
    table_booking_tables: [
      {
        id: 'assignment-1',
        start_datetime: null,
        end_datetime: null,
        table: {
          id: 'small-table',
          name: 'Big Bay',
          table_number: null,
          capacity: 6,
        },
      },
    ],
    table_booking_items: [],
    audit_trail: [],
  }
}


/**
 * BK-045 (owner decision D18) and BK-043 on the booking page: a manager can settle a deposit the
 * booking still owes, and a deposit a party-size change left to settle on the bill shows as
 * "Deposit to check" until a manager marks it checked.
 */

function owingBooking(overrides: Partial<Booking> = {}): Booking {
  return {
    ...makeBooking(),
    party_size: 16,
    committed_party_size: 16,
    status: 'pending_payment',
    payment_status: 'pending',
    deposit_amount: 160,
    hold_expires_at: '2026-06-30T12:00:00.000Z',
    ...overrides,
  }
}

function renderPage(booking: Booking, canManage: boolean) {
  return render(
    <BookingDetailClient booking={booking} canEdit canManage={canManage} canRefund={false} depositRefunds={[]} />
  )
}

describe('settling an owed deposit from the booking page', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true, data: { tables: [] } }) }))
    requestTableBookingActionMock.mockResolvedValue({ success: true, message: 'Deposit of £160.00 waived.', warning: null })
  })

  it('offers a manager the three actions, and asks why before waiving', async () => {
    const user = userEvent.setup()
    renderPage(owingBooking(), true)

    expect(screen.getByRole('button', { name: 'Deposit taken at the bar' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Give longer to pay' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Waive deposit' }))

    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Waive deposit' }))
    expect(requestTableBookingActionMock).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith('Say why, so the next person can see it')

    await user.type(within(dialog).getByLabelText('Why'), 'Pub event for the darts team')
    await user.click(within(dialog).getByRole('button', { name: 'Waive deposit' }))

    await waitFor(() => {
      expect(requestTableBookingActionMock).toHaveBeenCalledWith(`/api/boh/table-bookings/${BOOKING_ID}/deposit`, {
        body: { action: 'waive', reason: 'Pub event for the darts team' },
      })
    })
    expect(toast.success).toHaveBeenCalledWith('Deposit of £160.00 waived.')
  })

  it('shows the actions to nobody without manage', () => {
    renderPage(owingBooking(), false)

    expect(screen.queryByRole('button', { name: 'Waive deposit' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Deposit taken at the bar' })).not.toBeInTheDocument()
  })

  it('shows a deposit to check, and lets a manager mark it checked', async () => {
    const user = userEvent.setup()
    renderPage(
      owingBooking({
        status: 'confirmed',
        payment_status: 'completed',
        deposit_amount_locked: 160,
        deposit_review_needed_at: '2026-06-28T10:00:00.000Z',
        deposit_review_note: 'Party size 16 to 20. The £160.00 deposit is paid; for 20 people it would be £200.00. Settle the difference on the bill.',
      }),
      true
    )

    expect(screen.getByText(/for 20 people it would be £200.00/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Mark as checked' }))

    await waitFor(() => {
      expect(requestTableBookingActionMock).toHaveBeenCalledWith(`/api/boh/table-bookings/${BOOKING_ID}/deposit-review`, { body: {} })
    })
  })
})
