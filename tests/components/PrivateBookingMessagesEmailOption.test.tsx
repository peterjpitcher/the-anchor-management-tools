import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import PrivateBookingMessagesClient from '@/app/(authenticated)/private-bookings/[id]/messages/PrivateBookingMessagesClient'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => '/private-bookings/booking-1/messages',
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

vi.mock('@/ds', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/ds')>()
  return { ...actual, toast }
})

const mockGetPrivateBooking = vi.fn()
const mockSendSms = vi.fn()
const mockSendEmail = vi.fn()

vi.mock('@/app/actions/privateBookingActions', () => ({
  getPrivateBooking: (...args: unknown[]) => mockGetPrivateBooking(...args),
  sendPrivateBookingSms: (...args: unknown[]) => mockSendSms(...args),
  sendPrivateBookingEmail: (...args: unknown[]) => mockSendEmail(...args),
}))

const booking = {
  id: 'booking-1',
  status: 'confirmed',
  customer_name: 'Jane Doe',
  customer_full_name: 'Jane Doe',
  customer_first_name: 'Jane',
  contact_phone: '+441234567890',
  contact_email: 'jane@example.com',
  event_date: '2026-10-03',
  start_time: '18:00:00',
  guest_count: 25,
  deposit_amount: 250,
  total_amount: 500,
  calculated_total: 500,
  sms_queue: [],
} as any

describe('Private booking Messages tab, email option (P7)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetPrivateBooking.mockResolvedValue({ data: booking })
    mockSendSms.mockResolvedValue({ success: true })
    mockSendEmail.mockResolvedValue({ success: true })
  })

  it('defaults to email for a booking with a usable address and sends it with a subject', async () => {
    render(<PrivateBookingMessagesClient bookingId="booking-1" initialBooking={booking} canSendSms emailOption={{ enabled: true, usable: true }} />)

    expect(screen.getByRole('radio', { name: 'Email' })).toBeChecked()
    expect(screen.getByLabelText('Email subject')).toHaveValue('A message about your booking at The Anchor')

    fireEvent.change(screen.getByPlaceholderText('Type your message here...'), { target: { value: 'Your menu choices are in.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send Message' }))

    await waitFor(() => {
      expect(mockSendEmail).toHaveBeenCalledWith('booking-1', 'A message about your booking at The Anchor', 'Your menu choices are in.')
    })
    expect(mockSendSms).not.toHaveBeenCalled()
    expect(toast.success).toHaveBeenCalledWith('Email sent to the customer.')
  })

  it('staff can still choose a text', async () => {
    render(<PrivateBookingMessagesClient bookingId="booking-1" initialBooking={booking} canSendSms emailOption={{ enabled: true, usable: true }} />)

    fireEvent.click(screen.getByRole('radio', { name: 'Text' }))
    fireEvent.change(screen.getByPlaceholderText('Type your message here...'), { target: { value: 'See you Saturday' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send Message' }))

    await waitFor(() => {
      expect(mockSendSms).toHaveBeenCalledWith('booking-1', 'See you Saturday')
    })
    expect(mockSendEmail).not.toHaveBeenCalled()
  })

  it('with no usable address the text is the default and email cannot be chosen', () => {
    render(<PrivateBookingMessagesClient bookingId="booking-1" initialBooking={booking} canSendSms emailOption={{ enabled: true, usable: false }} />)

    expect(screen.getByRole('radio', { name: 'Text' })).toBeChecked()
    expect(screen.getByRole('radio', { name: 'Email' })).toBeDisabled()
    expect(screen.getByText('No usable email address for this booking.')).toBeInTheDocument()
  })

  it('shows the real failure when the email does not go', async () => {
    mockSendEmail.mockResolvedValue({ error: 'Recipient email address is suppressed' })
    render(<PrivateBookingMessagesClient bookingId="booking-1" initialBooking={booking} canSendSms emailOption={{ enabled: true, usable: true }} />)

    fireEvent.change(screen.getByPlaceholderText('Type your message here...'), { target: { value: 'Hello' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send Message' }))

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Recipient email address is suppressed')
    })
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('with the option off the screen is exactly today: no channel choice', () => {
    render(<PrivateBookingMessagesClient bookingId="booking-1" initialBooking={booking} canSendSms />)
    expect(screen.queryByRole('radio', { name: 'Email' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Email subject')).not.toBeInTheDocument()
  })
})
