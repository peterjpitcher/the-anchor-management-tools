import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { UndeliveredGuestMessagesSection } from '@/app/(authenticated)/settings/sms-failures/UndeliveredGuestMessagesSection'

describe('Undelivered guest messages list', () => {
  it('shows who, what, why and a link to the booking', () => {
    render(
      <UndeliveredGuestMessagesSection
        error={null}
        rows={[
          {
            id: 'delivery-1',
            failedAt: '2026-09-20T10:00:00.000Z',
            templateKey: 'private_booking_deposit_reminder_7day',
            customerId: 'customer-1',
            customerName: 'Alex Smith',
            booking: { href: '/private-bookings/booking-1', label: 'Private booking' },
            reason: 'Email bounced; no mobile number to text',
            attempts: [{ channel: 'email', error: null }],
          },
        ]}
      />
    )

    expect(screen.getByRole('link', { name: 'Alex Smith' })).toHaveAttribute('href', '/customers/customer-1')
    expect(screen.getByText('private_booking_deposit_reminder_7day')).toBeInTheDocument()
    expect(screen.getByText('Email bounced; no mobile number to text')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Private booking' })).toHaveAttribute('href', '/private-bookings/booking-1')
    expect(screen.getByText('Email: sent, then undelivered')).toBeInTheDocument()
  })

  it('says so when there is nothing undelivered', () => {
    render(<UndeliveredGuestMessagesSection rows={[]} error={null} />)
    expect(screen.getByText('No undelivered guest messages for this window.')).toBeInTheDocument()
  })

  it('shows a load error instead of an empty list', () => {
    render(<UndeliveredGuestMessagesSection rows={[]} error="permission denied" />)
    expect(screen.getByText('Failed to load undelivered guest messages: permission denied')).toBeInTheDocument()
  })
})
