import { describe, expect, it, vi, beforeEach } from 'vitest'

/**
 * AMENDING A PARTY SIZE MUST NEVER SILENTLY CHANGE WHAT A GUEST OWES.
 *
 * This function re-resolves the deposit whenever staff change a party size, and it did so with
 * `requiresDeposit`, which knows exactly one rule: ten guests or more, at GBP 10 a head. Seasonal
 * bookings obey the terms snapshotted on them instead, and every season except Christmas carries
 * booking_type 'regular', so the Christmas escape hatch never fired for them either.
 *
 * The result: twelve guests on a per-head GBP 25 period, charged GBP 300, amended to eight, and the
 * "deposit no longer required" branch wrote deposit_amount NULL and status 'confirmed'. GBP 300
 * owed became GBP 0, with nothing logged and nobody told. The reverse kept a stale figure far too
 * small. Both party-size routes reach it.
 */

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn(() => ({})) }))
vi.mock('@/lib/twilio', () => ({ sendSMS: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/sms/bulk', () => ({ getSmartFirstName: vi.fn((n: string) => n) }))
vi.mock('@/lib/sms/support', () => ({ ensureReplyInstruction: vi.fn((b: string) => b) }))
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }))

const createTablePaymentToken = vi.fn().mockResolvedValue({
  url: 'https://example.test/pay',
  expiresAt: '2026-12-04T18:00:00.000Z',
})
vi.mock('@/lib/table-bookings/bookings', () => ({
  createTablePaymentToken: (...args: unknown[]) => createTablePaymentToken(...args),
}))

const { applyPartySizeDepositTransition } = await import('./staff-deposit-transitions')

type UpdateCall = Record<string, unknown>

/** Captures every write, because the whole point is what does and does not get written. */
function fakeSupabase(updates: UpdateCall[]) {
  return {
    from: vi.fn(() => ({
      update: vi.fn((values: UpdateCall) => {
        updates.push(values)
        return { eq: vi.fn(async () => ({ error: null })) }
      }),
      select: vi.fn(() => ({
        eq: vi.fn(() => ({ maybeSingle: async () => ({ data: null, error: null }) })),
      })),
    })),
  } as never
}

function seasonalBooking(overrides: Record<string, unknown> = {}) {
  return {
    id: 'b-1',
    customer_id: 'c-1',
    party_size: 12,
    status: 'pending_payment',
    payment_status: 'pending',
    // Every season other than Christmas is booking_type 'regular'. That is exactly why the old
    // isChristmas escape hatch never protected them.
    booking_type: 'regular',
    start_datetime: '2027-03-14T12:00:00.000Z',
    deposit_amount: 300,
    deposit_amount_locked: null,
    deposit_waived: false,
    booking_period_id: 'p-mothers',
    booking_period_name: "Mother's Day 2027",
    ...overrides,
  }
}

function ordinaryBooking(overrides: Record<string, unknown> = {}) {
  return {
    id: 'b-2',
    customer_id: 'c-2',
    party_size: 12,
    status: 'pending_payment',
    payment_status: 'pending',
    booking_type: 'regular',
    start_datetime: '2027-05-01T12:00:00.000Z',
    deposit_amount: 120,
    deposit_amount_locked: null,
    deposit_waived: false,
    booking_period_id: null,
    booking_period_name: null,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('a seasonal booking is never silently re-priced', () => {
  it('SHRINKING below ten guests does not wipe the deposit', async () => {
    // The exact defect: 12 to 8 on a per-head GBP 25 period turned GBP 300 owed into GBP 0.
    const updates: UpdateCall[] = []
    const result = await applyPartySizeDepositTransition(fakeSupabase(updates), {
      booking: seasonalBooking(),
      previousPartySize: 12,
      newPartySize: 8,
      sendSms: false,
      appBaseUrl: 'https://example.test',
    })

    expect(result.state).toBe('manual_review')
    // Nothing was written at all. The deposit stands exactly as it was.
    expect(updates).toHaveLength(0)
    if (result.state !== 'manual_review') return
    expect(result.depositAmount).toBe(300)
    expect(result.message).toContain("Mother's Day 2027")
    expect(result.message).toContain('manually')
  })

  it('never writes deposit_amount null or status confirmed for a seasonal booking', async () => {
    const updates: UpdateCall[] = []
    await applyPartySizeDepositTransition(fakeSupabase(updates), {
      booking: seasonalBooking(),
      previousPartySize: 12,
      newPartySize: 2,
      sendSms: false,
      appBaseUrl: 'https://example.test',
    })

    for (const write of updates) {
      expect(write.deposit_amount).not.toBeNull()
      expect(write.status).not.toBe('confirmed')
    }
    expect(updates).toHaveLength(0)
  })

  it('GROWING past ten guests does not leave a stale, too-small deposit in place', async () => {
    // 4 to 12 on a GBP 15 per-head period used to keep GBP 60 instead of GBP 180, because the
    // ten-guest rule priced it. It is now left alone and flagged rather than priced wrongly.
    const updates: UpdateCall[] = []
    const result = await applyPartySizeDepositTransition(fakeSupabase(updates), {
      booking: seasonalBooking({ party_size: 4, deposit_amount: 60, status: 'confirmed', payment_status: null }),
      previousPartySize: 4,
      newPartySize: 12,
      sendSms: false,
      appBaseUrl: 'https://example.test',
    })

    expect(result.state).toBe('manual_review')
    expect(updates).toHaveLength(0)
    // Crucially it did NOT quietly write the ten-guest figure of GBP 120 over a GBP 180 debt.
    expect(createTablePaymentToken).not.toHaveBeenCalled()
  })

  it('says so in words a member of staff can act on', async () => {
    const result = await applyPartySizeDepositTransition(fakeSupabase([]), {
      booking: seasonalBooking(),
      previousPartySize: 12,
      newPartySize: 6,
      sendSms: false,
      appBaseUrl: 'https://example.test',
    })
    if (result.state !== 'manual_review') throw new Error('expected manual_review')
    expect(result.message).toMatch(/left as it is/i)
  })

  it('falls back to a plain label when the period name was not selected', async () => {
    const result = await applyPartySizeDepositTransition(fakeSupabase([]), {
      booking: seasonalBooking({ booking_period_name: null }),
      previousPartySize: 12,
      newPartySize: 6,
      sendSms: false,
      appBaseUrl: 'https://example.test',
    })
    if (result.state !== 'manual_review') throw new Error('expected manual_review')
    expect(result.message).toContain('seasonal')
  })
})

describe('an ordinary booking behaves exactly as it always has', () => {
  it('clears the pending deposit when the party drops below fifteen', async () => {
    const updates: UpdateCall[] = []
    const result = await applyPartySizeDepositTransition(fakeSupabase(updates), {
      booking: ordinaryBooking(),
      previousPartySize: 16,
      newPartySize: 8,
      sendSms: false,
      appBaseUrl: 'https://example.test',
    })

    expect(result.state).toBe('deposit_cleared')
    expect(updates).toHaveLength(1)
    expect(updates[0]).toMatchObject({ status: 'confirmed', deposit_amount: null })
  })

  it('asks for a deposit when the party grows past fifteen', async () => {
    const updates: UpdateCall[] = []
    const result = await applyPartySizeDepositTransition(fakeSupabase(updates), {
      booking: ordinaryBooking({ party_size: 4, status: 'confirmed', payment_status: null, deposit_amount: null }),
      previousPartySize: 4,
      newPartySize: 16,
      sendSms: false,
      appBaseUrl: 'https://example.test',
    })

    expect(result.state).toBe('deposit_required')
    if (result.state !== 'deposit_required') return
    expect(result.depositAmount).toBe(160)
    expect(updates[0]).toMatchObject({ status: 'pending_payment', deposit_amount: 160 })
  })

  it('leaves a party of fourteen alone that would once have owed GBP 140', async () => {
    // The boundary at the layer that actually rewrites the booking. Growing from 4 to 14 used
    // to flip the booking into pending_payment and text the guest a payment link; after the
    // 2026-08-09 threshold change it must do nothing at all.
    const updates: UpdateCall[] = []
    const result = await applyPartySizeDepositTransition(fakeSupabase(updates), {
      booking: ordinaryBooking({ party_size: 4, status: 'confirmed', payment_status: null, deposit_amount: null }),
      previousPartySize: 4,
      newPartySize: 14,
      sendSms: false,
      appBaseUrl: 'https://example.test',
    })

    expect(result.state).toBe('unchanged')
    expect(updates).toHaveLength(0)
  })

  it('does nothing when the party stays on the same side of the threshold', async () => {
    const updates: UpdateCall[] = []
    const result = await applyPartySizeDepositTransition(fakeSupabase(updates), {
      booking: ordinaryBooking({ party_size: 12 }),
      previousPartySize: 12,
      newPartySize: 14,
      sendSms: false,
      appBaseUrl: 'https://example.test',
    })

    expect(result.state).toBe('unchanged')
    expect(updates).toHaveLength(0)
  })
})

describe('both party-size routes hand the seasonal columns in', () => {
  /**
   * The guard is only reachable if the routes actually SELECT booking_period_id. Without it the
   * field is undefined, the guard never fires, and the deposit is zeroed exactly as before, with
   * every test above still passing.
   */
  it('selects booking_period_id on the FOH and BOH routes', async () => {
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const routes = [
      'src/app/api/foh/bookings/[id]/party-size/route.ts',
      'src/app/api/boh/table-bookings/[id]/party-size/route.ts',
    ]
    for (const route of routes) {
      const source = readFileSync(join(process.cwd(), route), 'utf8')
      expect(source).toContain('booking_period_id')
      expect(source).toContain('booking_period_name')
      // And the message reaches the person who made the change.
      expect(source).toContain("depositTransition?.state === 'manual_review'")
    }
  })
})
