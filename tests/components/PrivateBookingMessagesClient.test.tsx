import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import PrivateBookingMessagesClient from '@/app/(authenticated)/private-bookings/[id]/messages/PrivateBookingMessagesClient'

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    refresh: vi.fn(),
    push: vi.fn(),
  }),
}))

const toast = vi.hoisted(() => ({
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

vi.mock('@/components/ui-v2/feedback/Toast', () => ({
  toast,
  Toaster: () => null,
}))

const mockGetPrivateBooking = vi.fn()
const mockSendSms = vi.fn()

vi.mock('@/app/actions/privateBookingActions', () => ({
  getPrivateBooking: (...args: unknown[]) => mockGetPrivateBooking(...args),
}))

vi.mock('@/app/actions/sms', () => ({
  sendSms: (...args: unknown[]) => mockSendSms(...args),
}))

describe('PrivateBookingMessagesClient', () => {
  const baseBooking = {
    id: 'booking-1',
    booking_reference: 'PB-001',
    status: 'confirmed',
    customer_name: 'Jane Doe',
    customer_full_name: 'Jane Doe',
    customer_first_name: 'Jane',
    contact_phone: '+441234567890',
    event_date: '2025-01-10',
    start_time: '18:00:00',
    guest_count: 25,
    deposit_amount: 100,
    total_amount: 500,
    calculated_total: 500,
    sms_queue: [],
  } as any

  beforeEach(() => {
    vi.clearAllMocks()
    mockGetPrivateBooking.mockResolvedValue({ data: baseBooking })
    mockSendSms.mockResolvedValue({ success: true })
  })

  it('renders in read-only mode when canSendSms is false', () => {
    render(
      <PrivateBookingMessagesClient
        bookingId="booking-1"
        initialBooking={baseBooking}
        canSendSms={false}
      />,
    )

    expect(screen.getByText('SMS sending disabled')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Type your message here...')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Send Message' })).toBeDisabled()
  })

  it('sends an SMS when permitted', async () => {
    render(
      <PrivateBookingMessagesClient
        bookingId="booking-1"
        initialBooking={baseBooking}
        canSendSms
      />,
    )

    const textarea = screen.getByPlaceholderText('Type your message here...')
    fireEvent.change(textarea, { target: { value: 'Hello from Anchor' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send Message' }))

    await waitFor(() => {
      expect(mockSendSms).toHaveBeenCalledWith({
        to: '+441234567890',
        body: 'Hello from Anchor',
        bookingId: 'booking-1',
      })
    })

    expect(toast.success).toHaveBeenCalledWith('Message sent successfully.')
    expect(mockGetPrivateBooking).toHaveBeenCalledWith('booking-1', 'messages')
  })

  it('shows an error toast when the SMS action fails', async () => {
    mockSendSms.mockResolvedValueOnce({ error: 'Twilio unreachable' })

    render(
      <PrivateBookingMessagesClient
        bookingId="booking-1"
        initialBooking={baseBooking}
        canSendSms
      />,
    )

    const textarea = screen.getByPlaceholderText('Type your message here...')
    fireEvent.change(textarea, { target: { value: 'Ping' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send Message' }))

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Twilio unreachable')
    })
  })
})
