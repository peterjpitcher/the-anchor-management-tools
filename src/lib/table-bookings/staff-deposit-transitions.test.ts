import { describe, expect, it, vi, beforeEach } from 'vitest'

/**
 * A TABLE BOOKING'S DEPOSIT FOLLOWS ITS PARTY SIZE (owner decision D20; BK-042, BK-043, BK-044).
 *
 *  - An unpaid deposit follows the new size, or is cleared when the new size owes nothing.
 *  - A paid deposit is never touched: it is settled on the bill and the booking is flagged for a
 *    manager until one has checked it.
 *  - A confirmed booking that grows into owing a deposit stays confirmed with the deposit owed. It
 *    used to become a 24-hour unpaid hold that the timeout cron cancelled.
 *  - A booking that declined the Christmas menu follows the ordinary 15-or-more rule. Every booking
 *    in the Christmas window carries the period id, and keying on it skipped the group deposit.
 *
 * And, as before: nothing is ever silently zeroed. Twelve guests on a per-head GBP 25 period,
 * amended to eight, once had GBP 300 owed written down to GBP 0 with nothing logged.
 */

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn(() => ({})) }))
vi.mock('@/lib/twilio', () => ({ sendSMS: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/sms/bulk', () => ({ getSmartFirstName: vi.fn((n: string) => n) }))
vi.mock('@/lib/sms/support', () => ({ ensureReplyInstruction: vi.fn((b: string) => b) }))
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }))
const logAuditEvent = vi.fn(async () => undefined)
vi.mock('@/services/audit', () => ({ AuditService: { logAuditEvent: (...args: unknown[]) => logAuditEvent(...(args as [])) } }))

const START = '2026-12-05T19:00:00.000Z'
const createTablePaymentToken = vi.fn(async (_db: unknown, input: { holdExpiresAt: string }) => ({
  url: 'https://example.test/pay',
  expiresAt: input.holdExpiresAt,
}))
vi.mock('@/lib/table-bookings/bookings', () => ({
  createTablePaymentToken: (...args: unknown[]) => createTablePaymentToken(...(args as [unknown, { holdExpiresAt: string }])),
}))

const { applyPartySizeDepositTransition, PARTY_SIZE_DEPOSIT_COLUMNS } = await import('./staff-deposit-transitions')

type UpdateCall = Record<string, unknown>

/** Captures every write, because the whole point is what does and does not get written. */
function fakeSupabase(updates: UpdateCall[], resolver?: (args: Record<string, unknown>) => unknown) {
  const rpc = vi.fn(async (fn: string, args: Record<string, unknown>) => {
    if (fn !== 'resolve_table_booking_deposit') return { data: null, error: { message: `unexpected rpc ${fn}` } }
    return resolver ? { data: resolver(args), error: null } : { data: null, error: { message: 'no resolver' } }
  })
  const chain = () => {
    const builder: Record<string, unknown> = {}
    for (const method of ['eq', 'is', 'neq']) builder[method] = vi.fn(() => builder)
    builder.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ error: null }).then(resolve)
    return builder
  }
  return {
    client: {
      rpc,
      from: vi.fn(() => ({
        update: vi.fn((values: UpdateCall) => {
          updates.push(values)
          return chain()
        }),
      })),
    } as never,
    rpc,
  }
}

function booking(overrides: Record<string, unknown> = {}) {
  return {
    id: 'b-1',
    customer_id: 'c-1',
    party_size: 12,
    status: 'confirmed',
    payment_status: null,
    booking_type: 'regular',
    booking_date: '2026-12-05',
    start_datetime: START,
    deposit_amount: null,
    deposit_amount_locked: null,
    deposit_waived: false,
    deposit_rule: 'none',
    paypal_deposit_capture_id: null,
    booking_period_id: null,
    booking_period_name: null,
    booking_period_answer: null,
    ...overrides,
  }
}

const christmasPeriod = {
  booking_type: 'christmas',
  booking_period_id: 'p-christmas',
  booking_period_name: 'Christmas dinner 2026',
  booking_period_answer: true,
}

/** resolve_table_booking_deposit for the Christmas 2026 period: GBP 10 a head, 4 to 20 guests. */
function christmasResolver(args: Record<string, unknown>) {
  const size = Number(args.p_party_size)
  if (size < 4) return { ok: false, error_code: 'period_party_too_small' }
  return { ok: true, required: true, amount: size * 10, rule: 'period', basis: 'per_head', rate: 10 }
}

async function change(
  supabase: ReturnType<typeof fakeSupabase>,
  bookingRow: Record<string, unknown>,
  previousPartySize: number,
  newPartySize: number
) {
  return applyPartySizeDepositTransition(supabase.client, {
    booking: bookingRow as never,
    previousPartySize,
    newPartySize,
    sendSms: false,
    appBaseUrl: 'https://example.test',
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-01T10:00:00.000Z'))
})

describe('a confirmed booking that grows into owing a deposit stays confirmed (BK-044)', () => {
  it('asks for the group deposit and keeps the booking confirmed, with no hold to lapse', async () => {
    const updates: UpdateCall[] = []
    const result = await change(fakeSupabase(updates), booking(), 12, 16)

    expect(result).toMatchObject({ state: 'deposit_required', depositAmount: 160, stillConfirmed: true })
    expect(updates).toHaveLength(1)
    expect(updates[0]).toMatchObject({ payment_status: 'pending', deposit_amount: 160, deposit_rule: 'group', paypal_deposit_order_id: null })
    // Never set to pending_payment, so the timeout cron has nothing to cancel.
    expect(updates[0]).not.toHaveProperty('status')
    // The link works until the booking starts, not for 24 hours.
    expect(createTablePaymentToken).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ holdExpiresAt: START }))
    expect(updates[0].hold_expires_at).toBe(START)
  })

  it('leaves a party of fourteen alone', async () => {
    const updates: UpdateCall[] = []
    expect((await change(fakeSupabase(updates), booking({ party_size: 4 }), 4, 14)).state).toBe('unchanged')
    expect(updates).toHaveLength(0)
  })
})

describe('a booking that declined the Christmas menu follows the ordinary rule (BK-042)', () => {
  it('owes the group deposit when a declined party of 11 grows to 16', async () => {
    const updates: UpdateCall[] = []
    const supabase = fakeSupabase(updates, christmasResolver)
    const result = await change(
      supabase,
      booking({ booking_period_id: 'p-christmas', booking_period_name: 'Christmas dinner 2026', booking_period_answer: false }),
      11,
      16
    )

    expect(result).toMatchObject({ state: 'deposit_required', depositAmount: 160 })
    expect(updates[0]).toMatchObject({ deposit_amount: 160, deposit_rule: 'group' })
    // Priced by the group rule; the period's terms never applied to this booking.
    expect(supabase.rpc).not.toHaveBeenCalled()
  })
})

describe('an unpaid deposit follows the new size (D20)', () => {
  it('re-prices an unpaid Christmas deposit when the party shrinks from 16 to 12', async () => {
    const updates: UpdateCall[] = []
    const supabase = fakeSupabase(updates, christmasResolver)
    const result = await change(
      supabase,
      booking({ ...christmasPeriod, party_size: 16, status: 'pending_payment', payment_status: 'pending', deposit_amount: 160, deposit_rule: 'period' }),
      16,
      12
    )

    expect(result).toMatchObject({ state: 'deposit_repriced', previousAmount: 160, depositAmount: 120 })
    expect(supabase.rpc).toHaveBeenCalledWith('resolve_table_booking_deposit', {
      p_party_size: 12,
      p_booking_date: '2026-12-05',
      p_period_id: 'p-christmas',
      p_period_answer: true,
      p_deposit_waived: false,
    })
    // The new figure, and a new PayPal order for it. The booking still waits for its deposit.
    expect(updates).toEqual([
      { deposit_amount: 120, deposit_rule: 'period', deposit_basis: 'per_head', deposit_rate: 10, paypal_deposit_order_id: null },
    ])
    if (result.state === 'deposit_repriced') expect(result.message).toBe('The deposit now follows the party size: £120.00 (was £160.00).')
  })

  it('re-prices a confirmed booking that already owes a group deposit', async () => {
    const updates: UpdateCall[] = []
    const result = await change(
      fakeSupabase(updates),
      booking({ party_size: 16, payment_status: 'pending', deposit_amount: 160, deposit_rule: 'group' }),
      16,
      18
    )

    expect(result).toMatchObject({ state: 'deposit_repriced', depositAmount: 180 })
    expect(updates[0]).not.toHaveProperty('status')
  })

  it('clears an unpaid group deposit when the party drops below fifteen', async () => {
    const updates: UpdateCall[] = []
    const result = await change(
      fakeSupabase(updates),
      booking({ party_size: 16, status: 'pending_payment', payment_status: 'pending', deposit_amount: 160, deposit_rule: 'group' }),
      16,
      12
    )

    expect(result.state).toBe('deposit_cleared')
    expect(updates[0]).toMatchObject({ status: 'confirmed', payment_status: null, hold_expires_at: null, deposit_amount: null, deposit_rule: 'none' })
  })
})

describe('a paid deposit is settled on the bill and flagged for a manager (BK-043)', () => {
  it('never re-prices a paid deposit when the party grows, and flags it with what the new size owes', async () => {
    const updates: UpdateCall[] = []
    const result = await change(
      fakeSupabase(updates),
      booking({ party_size: 16, payment_status: 'completed', deposit_amount_locked: 160, paypal_deposit_capture_id: 'CAP-1' }),
      16,
      20
    )

    expect(result.state).toBe('manual_review')
    expect(updates).toHaveLength(1)
    expect(Object.keys(updates[0]).sort()).toEqual(['deposit_review_needed_at', 'deposit_review_note'])
    expect(updates[0].deposit_review_note).toBe(
      'Party size 16 to 20. The £160.00 deposit is paid; for 20 people it would be £200.00. Settle the difference on the bill.'
    )
    expect(createTablePaymentToken).not.toHaveBeenCalled()
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ operation_type: 'table_booking.deposit_review_needed', resource_id: 'b-1' }))
  })

  it('flags a paid deposit when the party shrinks below fifteen, and keeps every penny', async () => {
    const updates: UpdateCall[] = []
    const result = await change(fakeSupabase(updates), booking({ party_size: 16, payment_status: 'completed', deposit_amount_locked: 160 }), 16, 12)

    expect(result.state).toBe('manual_review')
    expect(updates[0].deposit_review_note).toBe(
      'Party size 16 to 12. The £160.00 deposit is paid; a party of 12 would owe no deposit. Settle the difference on the bill.'
    )
    for (const write of updates) {
      expect(write).not.toHaveProperty('deposit_amount')
      expect(write).not.toHaveProperty('payment_status')
    }
  })

  it('flags a paid Christmas deposit rather than charging or refunding the difference', async () => {
    const updates: UpdateCall[] = []
    const result = await change(
      fakeSupabase(updates, christmasResolver),
      booking({ ...christmasPeriod, party_size: 16, payment_status: 'completed', deposit_amount_locked: 160 }),
      16,
      18
    )

    expect(result.state).toBe('manual_review')
    if (result.state === 'manual_review') expect(result.message).toContain('flagged for a manager')
  })
})

describe('nothing is ever silently zeroed', () => {
  it('leaves a seasonal deposit as it is, and flags it, when its new figure cannot be worked out', async () => {
    const updates: UpdateCall[] = []
    const result = await change(
      fakeSupabase(updates, () => ({ ok: false, error_code: 'period_inactive' })),
      booking({ booking_period_id: 'p-mothers', booking_period_name: "Mother's Day 2027", booking_period_answer: true, party_size: 12, status: 'pending_payment', payment_status: 'pending', deposit_amount: 300 }),
      12,
      8
    )

    expect(result).toMatchObject({ state: 'manual_review', depositAmount: 300 })
    expect(updates).toHaveLength(1)
    expect(Object.keys(updates[0]).sort()).toEqual(['deposit_review_needed_at', 'deposit_review_note'])
    expect(updates[0].deposit_review_note).toContain('so it stays at £300.00')
  })

  it('never prices a Christmas booking that carries no period by the group rule', async () => {
    const updates: UpdateCall[] = []
    const result = await change(
      fakeSupabase(updates),
      booking({ booking_type: 'christmas', party_size: 6, status: 'pending_payment', payment_status: 'pending', deposit_amount: 60 }),
      6,
      8
    )

    expect(result.state).toBe('manual_review')
    for (const write of updates) expect(write).not.toHaveProperty('deposit_amount')
  })

  it('leaves a waived deposit waived', async () => {
    const updates: UpdateCall[] = []
    expect((await change(fakeSupabase(updates), booking({ deposit_waived: true }), 12, 20)).state).toBe('unchanged')
    expect(updates).toHaveLength(0)
  })

  it('asks a manager rather than a guest when an unconfirmed booking grows into a deposit', async () => {
    const updates: UpdateCall[] = []
    const result = await change(fakeSupabase(updates), booking({ status: 'visited_waiting_for_review' }), 12, 16)

    expect(result.state).toBe('manual_review')
    expect(createTablePaymentToken).not.toHaveBeenCalled()
  })
})

describe('both party-size routes hand the deposit columns in', () => {
  /**
   * The rules above are only reachable if the change actually SELECTs the period answer and the
   * payment state. Without booking_period_answer a declined Christmas booking cannot be told from
   * an accepted one, and without the capture id a paid deposit could be re-priced.
   */
  it('reads the transition columns, before the change, in the one handler both staff routes call', async () => {
    for (const column of ['booking_period_answer', 'booking_period_id', 'booking_date', 'paypal_deposit_capture_id', 'deposit_amount_locked', 'deposit_rule']) {
      expect(PARTY_SIZE_DEPOSIT_COLUMNS).toContain(column)
    }
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const handler = readFileSync(join(process.cwd(), 'src/lib/table-bookings/party-size-change.ts'), 'utf8')
    expect(handler).toContain('PARTY_SIZE_DEPOSIT_COLUMNS')
    // And a deposit left for a manager reaches the person who made the change.
    expect(handler).toContain("depositTransition?.state === 'manual_review'")
    const guestPath = readFileSync(join(process.cwd(), 'src/lib/table-bookings/manage-booking.ts'), 'utf8')
    expect(guestPath).toContain('.select(`booking_reference, ${PARTY_SIZE_DEPOSIT_COLUMNS}`)')

    const routes: Array<[string, string]> = [
      ['src/app/api/foh/bookings/[id]/party-size/route.ts', "'foh'"],
      ['src/app/api/boh/table-bookings/[id]/party-size/route.ts', "'boh'"],
    ]
    for (const [route, surface] of routes) {
      const source = readFileSync(join(process.cwd(), route), 'utf8')
      expect(source, route).toContain(`changeTableBookingPartySize(request, context, ${surface})`)
      expect(source, route).not.toContain('applyPartySizeDepositTransition')
    }
  })
})
