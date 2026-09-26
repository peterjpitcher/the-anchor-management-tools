// SMS failure times on the London clock, in both test zones.
//
// This is a server component, so it only ever renders on the server, which runs in UTC. The
// failure time used toLocaleString('en-GB') with no zone, so it was an hour early during British
// Summer Time, and the day before just after midnight.
//
// 23:30 UTC on 1 October 2026 is 00:30 BST on 2 October in London.
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

const adminFromMock = vi.hoisted(() => vi.fn())

vi.mock('next/navigation', () => ({
  redirect: vi.fn(),
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/settings/sms-failures',
}))
vi.mock('@/app/actions/rbac', () => ({ checkUserPermission: vi.fn().mockResolvedValue(true) }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ from: adminFromMock }) }))
vi.mock('@/lib/notifications/undelivered', () => ({
  loadUndeliveredGuestMessages: vi.fn().mockResolvedValue({ rows: [], error: null }),
}))
vi.mock('@/app/(authenticated)/settings/sms-failures/actions', () => ({
  dismissSmsFailureFromForm: vi.fn(),
  retrySmsFailureFromForm: vi.fn(),
}))

import SmsFailuresPage from '@/app/(authenticated)/settings/sms-failures/page'

function messagesQuery(rows: unknown[]) {
  const limit = vi.fn().mockResolvedValue({ data: rows, error: null })
  const order = vi.fn().mockReturnValue({ limit })
  const gte = vi.fn().mockReturnValue({ order })
  const eq = vi.fn().mockReturnValue({ gte })
  return { select: vi.fn().mockReturnValue({ eq }) }
}

const failedMessage = {
  id: 'message-1',
  created_at: '2026-10-01T23:30:00Z',
  status: 'failed',
  twilio_status: 'undelivered',
  error_code: '30003',
  error_message: 'Unreachable destination handset',
  template_key: 'table_booking_confirmation',
  message_sid: 'SM123',
  twilio_message_sid: 'SM123',
  customer_id: 'customer-1',
  private_booking_id: null,
  table_booking_id: 'booking-1',
  event_booking_id: null,
  to_number: '+447700900123',
  body: 'Your table is booked.',
  customer: { first_name: 'Alex', last_name: 'Rowe' },
}

beforeEach(() => {
  vi.clearAllMocks()
  adminFromMock.mockReturnValue(messagesQuery([failedMessage]))
})

afterEach(() => {
  cleanup()
})

describe('SMS failures London times', () => {
  it('shows when each message failed on the London clock', async () => {
    render(await SmsFailuresPage({}))

    // Once in the phone card list and once in the desktop table.
    expect(screen.getAllByText('02/10/2026, 00:30:00')).toHaveLength(2)
  })
})
