import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'
import { createFakeSupabase } from '../helpers/fakeSupabase'

/**
 * The daily check on upcoming private hires (review BK-005 and BK-007): every morning the monitor
 * emails the manager each live hire whose deposit is paid while it is still a draft, or that has
 * no room, no guest count, or more guests than its rooms hold. The only trace of a paid draft
 * used to be one 'confirmation_blocked' row in its audit trail, and booking 36d51953 sat like
 * that for 15 days.
 */

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/env', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/env')>()),
  getAppUrl: () => 'https://management.example.test',
}))
vi.mock('@/lib/email/emailService', () => ({ sendEmail: vi.fn() }))
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { sendEmail } from '@/lib/email/emailService'
import {
  buildHireAttentionEmail,
  findHiresNeedingAttention,
  runHireAttentionCheck,
} from '@/services/private-bookings/attention'

const mockedSendEmail = sendEmail as unknown as Mock

const NOW = new Date('2026-10-24T09:00:00.000Z')
const TODAY = '2026-10-24'

const DINING = { id: 'space-dining', name: 'The Dining Room', capacity_seated: 26, capacity_standing: 50, blocks_all_spaces: false, active: true, display_order: 1 }
const MAIN = { id: 'space-main', name: 'The Main Area', capacity_seated: 29, capacity_standing: 150, blocks_all_spaces: false, active: true, display_order: 3 }

function hire(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    status: 'confirmed',
    event_date: '2026-11-14',
    event_type: 'Birthday party',
    guest_count: 30,
    layout: null,
    hold_expiry: null,
    deposit_paid_date: '2026-09-26T10:00:00.000Z',
    deposit_confirmed_at: '2026-09-20T10:00:00.000Z',
    deposit_waived: false,
    contract_sent_at: null,
    contract_accepted_at: null,
    date_tbd: false,
    internal_notes: null,
    customer_name: 'Jamie Guest',
    contact_phone: '+447700900999',
    contact_email: 'jamie@example.com',
    ...overrides,
  }
}

function seed() {
  return createFakeSupabase({
    venue_spaces: [DINING, MAIN],
    private_bookings: [
      // Confirmed, paid, no room: a4bbe2f9's state on 24 October.
      hire('aaaaaaaa-0000-0000-0000-000000000001'),
      // Paid but still a draft, over capacity: 36d51953's state.
      hire('bbbbbbbb-0000-0000-0000-000000000002', { status: 'draft', event_date: '2026-11-27', guest_count: 70 }),
      // A draft holding its date with no guest count yet.
      hire('cccccccc-0000-0000-0000-000000000003', { status: 'draft', deposit_paid_date: null, hold_expiry: '2026-11-01T23:59:59.000Z', guest_count: null }),
      // Not listed: a fresh enquiry with no hold, a date still to be confirmed, a hire that is
      // fine, one already past, and a cancelled one.
      hire('dddddddd-0000-0000-0000-000000000004', { status: 'draft', deposit_paid_date: null, hold_expiry: null }),
      hire('eeeeeeee-0000-0000-0000-000000000005', { date_tbd: true }),
      hire('ffffffff-0000-0000-0000-000000000006'),
      hire('99999999-0000-0000-0000-000000000007', { event_date: '2026-10-20' }),
      hire('88888888-0000-0000-0000-000000000008', { status: 'cancelled' }),
    ],
    private_booking_items: [
      { id: 'i2', booking_id: 'bbbbbbbb-0000-0000-0000-000000000002', item_type: 'space', space_id: DINING.id },
      { id: 'i3', booking_id: 'cccccccc-0000-0000-0000-000000000003', item_type: 'space', space_id: DINING.id },
      { id: 'i6', booking_id: 'ffffffff-0000-0000-0000-000000000006', item_type: 'space', space_id: MAIN.id },
    ],
    private_booking_audit: [
      {
        id: 'a2',
        booking_id: 'bbbbbbbb-0000-0000-0000-000000000002',
        action: 'confirmation_blocked',
        performed_at: '2026-10-09T19:26:13.000Z',
        metadata: { reasons: ['Guest count 70 exceeds the maximum capacity of 50 for The Dining Room'] },
      },
    ],
  })
}

describe('finding the hires that need attention', () => {
  it('lists each live hire with what is wrong, soonest first', async () => {
    const items = await findHiresNeedingAttention({ todayIso: TODAY, now: NOW, db: seed() })

    expect(items.map((item) => [item.reference, item.issues])).toEqual([
      ['PB-AAAAAAAA', ['No room booked.']],
      ['PB-CCCCCCCC', ['No guest count set.']],
      [
        'PB-BBBBBBBB',
        [
          'Deposit paid, not confirmed: Guest count 70 exceeds the maximum capacity of 50 for The Dining Room.',
          'Guest count 70 exceeds the maximum capacity of 50 for The Dining Room. Add The Main Area so the guests fit, or ask a manager to allow it.',
        ],
      ],
    ])
  })

  it('throws when the bookings cannot be read, rather than reporting nothing wrong', async () => {
    const db = seed()
    db.failures.push({ table: 'private_bookings', op: 'select', error: { message: 'timeout' } })

    await expect(findHiresNeedingAttention({ todayIso: TODAY, now: NOW, db })).rejects.toThrow('timeout')
  })
})

describe('the manager email', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedSendEmail.mockResolvedValue({ success: true })
  })

  it('goes to the manager, with links and no customer details', async () => {
    const result = await runHireAttentionCheck({ todayIso: TODAY, now: NOW, db: seed() })

    expect(result).toEqual({ listed: 3, emailed: true })
    expect(mockedSendEmail).toHaveBeenCalledTimes(1)
    const email = mockedSendEmail.mock.calls[0][0]
    expect(email.to).toBe('manager@the-anchor.pub')
    expect(email.subject).toBe('Private hires needing attention: 3 bookings')
    expect(email.text).toContain('PB-AAAAAAAA: Sat, 14 Nov 2026, 30 guests, Birthday party (confirmed)')
    expect(email.text).toContain('Open the booking: https://management.example.test/private-bookings/aaaaaaaa-0000-0000-0000-000000000001')
    for (const body of [email.text, email.html]) {
      expect(body).not.toContain('Jamie')
      expect(body).not.toContain('07700')
      expect(body).not.toContain('+447700900999')
      expect(body).not.toContain('jamie@example.com')
    }
  })

  it('sends nothing when every hire is in order', async () => {
    const db = createFakeSupabase({ venue_spaces: [DINING], private_bookings: [], private_booking_items: [], private_booking_audit: [] })

    const result = await runHireAttentionCheck({ todayIso: TODAY, now: NOW, db })

    expect(result).toEqual({ listed: 0, emailed: false })
    expect(mockedSendEmail).not.toHaveBeenCalled()
  })

  it('reports a failed send instead of throwing', async () => {
    mockedSendEmail.mockResolvedValue({ success: false, error: 'Resend 500' })

    const result = await runHireAttentionCheck({ todayIso: TODAY, now: NOW, db: seed() })

    expect(result).toEqual({ listed: 3, emailed: false, error: 'Resend 500' })
  })

  it('says one booking in the subject when there is one', () => {
    const email = buildHireAttentionEmail(
      [{ bookingId: 'x', reference: 'PB-X', eventDate: '2026-11-14', status: 'draft', guestCount: null, eventType: null, issues: ['No room booked.'] }],
      'https://app.test',
    )
    expect(email.subject).toBe('Private hires needing attention: 1 booking')
    expect(email.text).toContain('PB-X: Sat, 14 Nov 2026, guest count not set (draft)')
  })
})
