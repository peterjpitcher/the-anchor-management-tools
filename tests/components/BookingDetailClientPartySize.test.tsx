import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
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

vi.mock('react-hot-toast', () => ({
  __esModule: true,
  default: toast,
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

describe('BookingDetailClient party size changes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            booking_id: BOOKING_ID,
            tables: [
              {
                id: LARGE_TABLE_ID,
                table_ids: [LARGE_TABLE_ID],
                name: 'High Table',
                table_number: '9',
                capacity: 10,
              },
            ],
          },
        }),
      })
    )
    requestTableBookingActionMock.mockResolvedValue({ success: true })
  })

  it('auto-picks a larger table setup and saves an oversized party size without manual selection', async () => {
    const user = userEvent.setup()

    render(
      <BookingDetailClient
        booking={makeBooking()}
        canEdit
        canManage
        canRefund={false}
      />
    )

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        `/api/boh/table-bookings/${BOOKING_ID}/move-table`,
        { cache: 'no-store' }
      )
    })

    await user.click(screen.getByRole('button', { name: 'Edit party size' }))
    await user.clear(screen.getByLabelText('New party size'))
    await user.type(screen.getByLabelText('New party size'), '9')

    // The larger table is auto-selected, so Save is enabled with no manual pick required.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
    })
    await user.click(screen.getByRole('button', { name: 'Save' }))

    // Single-step grow+move: one party-size call carrying the auto-picked
    // setup — the server performs the move and reverts it if the size fails.
    await waitFor(() => {
      expect(requestTableBookingActionMock).toHaveBeenCalledTimes(1)
    })
    expect(requestTableBookingActionMock).toHaveBeenCalledWith(
      `/api/boh/table-bookings/${BOOKING_ID}/party-size`,
      { body: { party_size: 9, send_sms: true, move_table_ids: [LARGE_TABLE_ID] } }
    )
  })

  it('still saves (letting the server auto-move) when no larger table setup is offered', async () => {
    // Availability returns no options — Save must remain usable so the server can try the
    // auto-move and surface a clear reason, rather than dead-ending on a disabled button.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, data: { booking_id: BOOKING_ID, tables: [] } }),
      })
    )

    const user = userEvent.setup()

    render(
      <BookingDetailClient
        booking={makeBooking()}
        canEdit
        canManage
        canRefund={false}
      />
    )

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        `/api/boh/table-bookings/${BOOKING_ID}/move-table`,
        { cache: 'no-store' }
      )
    })

    await user.click(screen.getByRole('button', { name: 'Edit party size' }))
    await user.clear(screen.getByLabelText('New party size'))
    await user.type(screen.getByLabelText('New party size'), '9')

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
    })
    await user.click(screen.getByRole('button', { name: 'Save' }))

    // Only the party-size call is made; the server handles (or rejects) the move.
    await waitFor(() => {
      expect(requestTableBookingActionMock).toHaveBeenCalledTimes(1)
    })
    expect(requestTableBookingActionMock).toHaveBeenCalledWith(
      `/api/boh/table-bookings/${BOOKING_ID}/party-size`,
      { body: { party_size: 9, send_sms: true } }
    )
  })
})
