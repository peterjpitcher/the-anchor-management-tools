import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}))

vi.mock('@/app/actions/audit', () => ({
  logAuditEvent: vi.fn(() => Promise.resolve()),
}))

vi.mock('@/services/sms-queue', () => ({
  SmsQueueService: {
    queueAndSend: vi.fn(),
  },
}))

vi.mock('@/lib/google-calendar', () => ({
  syncCalendarEvent: vi.fn(),
  deleteCalendarEvent: vi.fn(),
  isCalendarConfigured: vi.fn(() => false),
}))

vi.mock('@/services/private-bookings/financial', () => ({
  getPrivateBookingCancellationOutcome: vi.fn(),
}))

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { SmsQueueService } from '@/services/sms-queue'
import { PrivateBookingService } from '@/services/private-bookings'
import { getPrivateBookingCancellationOutcome } from '@/services/private-bookings/financial'

// The live columns of private_booking_sms_queue. There is no updated_at.
const QUEUE_COLUMNS = new Set([
  'approved_at', 'approved_by', 'booking_id', 'created_at', 'created_by', 'customer_name',
  'customer_phone', 'error_message', 'id', 'message_body', 'metadata', 'priority',
  'recipient_phone', 'scheduled_for', 'sent_at', 'skip_conditions', 'status', 'template_key',
  'trigger_type', 'twilio_message_sid',
])

type QueueRow = { id: string; booking_id: string; status: string }

/** Rejects an update naming a column the table lacks, the way PostgREST does. */
function queueTable(rows: QueueRow[]) {
  return {
    update: (payload: Record<string, unknown>) => {
      const filters: { bookingId?: string } = {}
      const builder = {
        eq: (column: string, value: string) => {
          if (column === 'booking_id') filters.bookingId = value
          return builder
        },
        in: (_column: string, statuses: string[]) => {
          const unknown = Object.keys(payload).filter((key) => !QUEUE_COLUMNS.has(key))
          if (unknown.length > 0) {
            return Promise.resolve({ error: { code: 'PGRST204', message: `no ${unknown[0]} column` } })
          }
          for (const row of rows) {
            if (row.booking_id === filters.bookingId && statuses.includes(row.status)) {
              row.status = String(payload.status)
            }
          }
          return Promise.resolve({ error: null })
        },
      }
      return builder
    },
  }
}

function staleQueue(): QueueRow[] {
  return [
    { id: 'reminder-3day', booking_id: 'booking-1', status: 'pending' },
    { id: 'balance-21day', booking_id: 'booking-1', status: 'approved' },
    { id: 'created-sms', booking_id: 'booking-1', status: 'sent' },
  ]
}

describe('cancelling a private booking cancels its waiting texts (step 0 regression)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(SmsQueueService.queueAndSend as unknown as Mock).mockResolvedValue({ success: true, sent: true, queueId: 'q-cancel' })
    ;(getPrivateBookingCancellationOutcome as unknown as Mock).mockResolvedValue({
      outcome: 'no_money',
      refund_amount: 0,
      retained_amount: 0,
      deposit_deduction: 0,
      max_retainable: 0,
    })
  })

  it('cancelBooking leaves no pending or approved text behind', async () => {
    const rows = staleQueue()
    const bookingRow = {
      id: 'booking-1',
      status: 'draft',
      event_date: '2026-10-03',
      event_type: 'Birthday',
      customer_first_name: 'Alex',
      customer_last_name: 'Smith',
      customer_name: 'Alex Smith',
      contact_phone: '+447700900123',
      contact_email: null,
      calendar_event_id: null,
      customer_id: 'customer-1',
      date_tbd: false,
      internal_notes: null,
    }
    ;(createClient as unknown as Mock).mockResolvedValue({
      from: vi.fn((table: string) => {
        if (table !== 'private_bookings') throw new Error(`Unexpected table ${table}`)
        return {
          select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: bookingRow, error: null }) }) }),
          update: () => ({
            eq: () => ({ select: () => ({ maybeSingle: () => Promise.resolve({ data: { id: 'booking-1' }, error: null }) }) }),
          }),
        }
      }),
    })
    ;(createAdminClient as unknown as Mock).mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'private_booking_sms_queue') return queueTable(rows)
        throw new Error(`Unexpected admin table ${table}`)
      }),
    })

    await PrivateBookingService.cancelBooking('booking-1', 'Customer asked', 'user-1')

    expect(rows.map((row) => [row.id, row.status])).toEqual([
      ['reminder-3day', 'cancelled'],
      ['balance-21day', 'cancelled'],
      ['created-sms', 'sent'],
    ])
    // The cancellation text itself still goes after the clean-up.
    expect(SmsQueueService.queueAndSend).toHaveBeenCalledWith(
      expect.objectContaining({ booking_id: 'booking-1', trigger_type: 'booking_cancelled_hold' })
    )
  })

  it('expireBooking leaves no pending or approved text behind', async () => {
    const rows = staleQueue()
    const bookingRow = {
      id: 'booking-1',
      status: 'draft',
      event_date: '2026-10-03',
      customer_first_name: 'Alex',
      customer_name: 'Alex Smith',
      contact_phone: '+447700900123',
      calendar_event_id: null,
      customer_id: 'customer-1',
      date_tbd: false,
      internal_notes: null,
    }
    ;(createAdminClient as unknown as Mock).mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'private_booking_sms_queue') return queueTable(rows)
        if (table === 'private_bookings') {
          return {
            select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: bookingRow, error: null }) }) }),
            update: () => ({
              eq: () => ({ select: () => ({ maybeSingle: () => Promise.resolve({ data: { id: 'booking-1' }, error: null }) }) }),
            }),
          }
        }
        throw new Error(`Unexpected admin table ${table}`)
      }),
    })

    await PrivateBookingService.expireBooking('booking-1', { asSystem: true })

    expect(rows.filter((row) => row.status === 'pending' || row.status === 'approved')).toEqual([])
    expect(rows.find((row) => row.id === 'created-sms')?.status).toBe('sent')
  })
})
