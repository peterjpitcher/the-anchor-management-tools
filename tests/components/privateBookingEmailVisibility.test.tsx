import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { createFakeSupabase } from '../helpers/fakeSupabase'

const state = vi.hoisted(() => ({ db: null as any }))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => state.db),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}))

import { CommunicationsTab } from '@/components/private-bookings/CommunicationsTab'
import { loadPrivateBookingEmailTimeline } from '@/lib/private-bookings/email-timeline'

describe('private booking emails for staff', () => {
  beforeEach(() => {
    state.db = createFakeSupabase({
      email_messages: [
        {
          id: 'email-1',
          private_booking_id: 'booking-1',
          direction: 'outbound',
          created_at: '2026-09-20T09:00:00.000Z',
          sent_at: '2026-09-20T09:00:01.000Z',
          comm_type: 'private_booking_deposit_reminder_7day',
          subject: 'Your hold at The Anchor expires in 6 days',
          status: 'delivered',
          to_address: 'host@example.com',
          error: null,
        },
        {
          id: 'email-2',
          private_booking_id: 'booking-1',
          direction: 'outbound',
          created_at: '2026-09-18T09:00:00.000Z',
          sent_at: '2026-09-18T09:00:01.000Z',
          comm_type: 'private_booking_provisional_hold',
          subject: 'Provisional Booking Hold',
          status: 'bounced',
          to_address: 'old@example.com',
          error: 'mailbox does not exist',
        },
        {
          id: 'email-3',
          private_booking_id: 'booking-2',
          direction: 'outbound',
          created_at: '2026-09-18T09:00:00.000Z',
          sent_at: null,
          comm_type: 'private_booking_created',
          subject: 'Another booking',
          status: 'sent',
          to_address: 'someone@example.com',
          error: null,
        },
      ],
    })
  })

  it('the timeline gains the booking emails, without repeating one the messenger already recorded', async () => {
    const entries = await loadPrivateBookingEmailTimeline('booking-1', [
      {
        id: 'audit-1',
        booking_id: 'booking-1',
        action: 'email_sent',
        metadata: { email_message_id: 'email-1' },
        performed_at: '2026-09-20T09:00:01.000Z',
      },
    ])

    expect(entries).toEqual([
      expect.objectContaining({
        id: 'email:email-2',
        action: 'email_not_delivered',
        new_value: 'private_booking_provisional_hold',
        metadata: expect.objectContaining({
          description: 'Email "Provisional Booking Hold" to old@example.com, not delivered (bounced: mailbox does not exist).',
        }),
      }),
    ])
  })

  it('the Communications tab lists emails with their delivery status and marks texts sent by email', () => {
    render(
      <CommunicationsTab
        history={[
          {
            id: 'queue-1',
            created_at: '2026-09-18T10:00:00.000Z',
            trigger_type: 'deposit_reminder_3day',
            template_key: 'private_booking_deposit_reminder_3day',
            status: 'sent',
            message_body: 'Your hold expires on 25 September 2026.',
            twilio_sid: null,
            scheduled_for: null,
            delivered_by: 'email',
          },
        ]}
        scheduled={[]}
        isDateTbd={false}
        emails={[
          {
            id: 'email-2',
            created_at: '2026-09-18T09:00:01.000Z',
            comm_type: 'private_booking_provisional_hold',
            subject: 'Provisional Booking Hold',
            status: 'bounced',
            to_address: 'old@example.com',
            error: 'mailbox does not exist',
          },
        ]}
      />
    )

    const history = screen.getByRole('list', { name: 'SMS message history' })
    expect(within(history).getByText('Sent by email')).toBeInTheDocument()
    const emails = screen.getByRole('list', { name: 'Email history' })
    expect(within(emails).getByText('Provisional Booking Hold')).toBeInTheDocument()
    expect(within(emails).getByText('Bounced')).toBeInTheDocument()
    expect(within(emails).getByText('mailbox does not exist')).toBeInTheDocument()
  })

  it('says so when emails cannot be loaded, rather than showing none', () => {
    render(<CommunicationsTab history={[]} scheduled={[]} isDateTbd={false} emails={[]} emailsError="permission denied" />)
    expect(screen.getByText('Emails could not be loaded: permission denied')).toBeInTheDocument()
  })
})
