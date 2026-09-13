import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import BookingDetailClient, { type Booking } from '@/app/(authenticated)/table-bookings/[id]/BookingDetailClient'
import { MessageGuestsModal } from '@/app/(authenticated)/table-bookings/boh/MessageGuestsModal'

const requestTableBookingActionMock = vi.hoisted(() => vi.fn())
const hotToast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
const dsToast = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  info: vi.fn(),
  loading: vi.fn(),
  promise: vi.fn(),
  custom: vi.fn(),
  dismiss: vi.fn(),
  remove: vi.fn(),
}))
const previewMock = vi.hoisted(() => vi.fn())
const sendMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/table-bookings/client-actions', () => ({
  requestTableBookingAction: requestTableBookingActionMock,
}))

vi.mock('react-hot-toast', () => ({
  __esModule: true,
  default: hotToast,
}))

vi.mock('@/ds', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/ds')>()
  return { ...actual, toast: dsToast }
})

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

vi.mock('@/app/actions/table-booking-messages', () => ({
  previewTableBookingGuests: previewMock,
  messageTableBookingGuests: sendMock,
}))

const BOOKING_ID = '00000000-0000-4000-8000-000000000001'

function makeBooking(): Booking {
  return {
    id: BOOKING_ID,
    booking_reference: 'TB-6C6B6AD',
    booking_date: '2026-10-03',
    booking_time: '19:30:00',
    party_size: 4,
    committed_party_size: 4,
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
    start_datetime: '2026-10-03T18:30:00.000Z',
    end_datetime: '2026-10-03T20:00:00.000Z',
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
    customer: { id: 'customer-1', first_name: 'Pat', last_name: 'Guest', mobile_number: '+447700900000' },
    table_booking_tables: [],
    table_booking_items: [],
    audit_trail: [],
  }
}

describe('single-guest message card (P7)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true, data: { booking_id: BOOKING_ID, tables: [] } }) }))
    requestTableBookingActionMock.mockResolvedValue({ success: true })
  })

  it('defaults to email for a guest with a usable address and sends it to the email route', async () => {
    const user = userEvent.setup()
    render(<BookingDetailClient booking={makeBooking()} canEdit canManage canRefund={false} emailOption={{ enabled: true, usable: true }} />)

    expect(screen.getByText('Message guest')).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Email' })).toBeChecked()

    await user.type(screen.getByPlaceholderText('Type message...'), 'Your table is ready early.')
    await user.click(screen.getByRole('button', { name: 'Send email' }))

    await waitFor(() => {
      expect(requestTableBookingActionMock).toHaveBeenCalledWith(`/api/boh/table-bookings/${BOOKING_ID}/email`, {
        body: { subject: 'A message about your booking at The Anchor', message: 'Your table is ready early.' },
      })
    })
    expect(hotToast.success).toHaveBeenCalledWith('Email sent to guest')
  })

  it('shows the real failure from the email route', async () => {
    requestTableBookingActionMock.mockRejectedValue(new Error('This guest has no usable email address'))
    const user = userEvent.setup()
    render(<BookingDetailClient booking={makeBooking()} canEdit canManage canRefund={false} emailOption={{ enabled: true, usable: true }} />)

    await user.type(screen.getByPlaceholderText('Type message...'), 'Hello')
    await user.click(screen.getByRole('button', { name: 'Send email' }))

    await waitFor(() => {
      expect(hotToast.error).toHaveBeenCalledWith('This guest has no usable email address')
    })
  })

  it('a guest with no usable address defaults to a text, and email cannot be picked', () => {
    render(<BookingDetailClient booking={makeBooking()} canEdit canManage canRefund={false} emailOption={{ enabled: true, usable: false }} />)
    expect(screen.getByRole('radio', { name: 'Text' })).toBeChecked()
    expect(screen.getByRole('radio', { name: 'Email' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Send SMS' })).toBeInTheDocument()
  })

  it('with the option off the card is exactly today', () => {
    render(<BookingDetailClient booking={makeBooking()} canEdit canManage canRefund={false} />)
    expect(screen.getByText('Send SMS', { selector: 'h2, h3, h4, span, p, div' })).toBeInTheDocument()
    expect(screen.queryByRole('radio', { name: 'Email' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Send SMS' })).toBeInTheDocument()
  })
})

describe('BOH "Message guests" modal (P7)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    previewMock.mockResolvedValue({
      data: {
        availableTimes: [{ time: '19:00', count: 5 }],
        total: 5,
        eligible: 3,
        unreachable: 2,
        noName: 0,
        emailOption: { emailable: 2, textOnly: 2, reachable: 4, noName: 0 },
      },
    })
    sendMock.mockResolvedValue({ success: true, channel: 'email_first', emailed: 2, sent: 2, scheduled: 0, skipped: 0, failed: 0 })
  })

  it('offers email first by default, shows who gets what, and reports what went', async () => {
    const user = userEvent.setup()
    render(<MessageGuestsModal open onClose={vi.fn()} bookingDate="2026-10-03" />)

    expect(await screen.findByText(/will be emailed and/)).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Email where the guest has a usable address, text the rest' })).toBeChecked()
    expect(screen.getByLabelText('Email subject')).toHaveValue('A message about your booking at The Anchor')

    await user.click(screen.getByRole('button', { name: 'Send to 4 guests' }))

    await waitFor(() => {
      expect(sendMock).toHaveBeenCalledWith(
        expect.objectContaining({ channel: 'email_first', subject: 'A message about your booking at The Anchor' })
      )
    })
    expect(dsToast.success).toHaveBeenCalledWith('Emailed 2 guests, texted 2 guests')
  })

  it('"Text only" sends as before', async () => {
    sendMock.mockResolvedValue({ success: true, sent: 3, scheduled: 0, skipped: 0, failed: 0 })
    const user = userEvent.setup()
    render(<MessageGuestsModal open onClose={vi.fn()} bookingDate="2026-10-03" />)

    await screen.findByText(/will be emailed and/)
    await user.click(screen.getByRole('radio', { name: 'Text only' }))
    await user.click(screen.getByRole('button', { name: 'Send to 3 guests' }))

    await waitFor(() => {
      expect(sendMock).toHaveBeenCalledWith(expect.objectContaining({ channel: 'sms' }))
    })
    expect(dsToast.success).toHaveBeenCalledWith('Sent to 3 guests')
  })

  it('without the option the modal is exactly today', async () => {
    previewMock.mockResolvedValue({ data: { availableTimes: [], total: 5, eligible: 3, unreachable: 2, noName: 0 } })
    render(<MessageGuestsModal open onClose={vi.fn()} bookingDate="2026-10-03" />)

    expect(await screen.findByText(/will be texted/)).toBeInTheDocument()
    expect(screen.queryByRole('radio')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Email subject')).not.toBeInTheDocument()
  })
})
