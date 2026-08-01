import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expectedDepositForCreate, loadBookingPeriodContext } from './period-lookup'
import type { BookingPeriod } from './periods'

/**
 * THE KILL SWITCH, on both routes that create a booking.
 *
 * `booking_period_deposits_enabled` shipped reading in exactly one place: a website READ endpoint,
 * where it set a `collect` flag on a response. Switching it off left /api/table-bookings and
 * /api/foh/bookings creating pending_payment bookings and issuing payment links exactly as before,
 * while the settings screen said "no money is asked for". This pins both halves of the fix: the
 * lookup honours the switch, and the SQL that actually charges reads it in the resolver itself so
 * neither route can forget it.
 */

function christmasPeriod(overrides: Partial<BookingPeriod> = {}): BookingPeriod {
  return {
    id: 'p-christmas',
    code: 'christmas-2026',
    periodKind: 'christmas',
    name: 'Christmas dinner 2026',
    startsOn: '2026-11-10',
    endsOn: '2026-12-20',
    guestQuestion: 'Is this a Christmas dinner booking?',
    guestBlurb: null,
    requiresPreorder: true,
    preorderCutoffDays: 7,
    depositBasis: 'per_head',
    depositAmount: 10,
    refundCutoffDays: 7,
    minPartySize: 6,
    maxPartySize: 20,
    minNoticeHours: 24,
    legacyBookingType: 'christmas',
    isActive: true,
    archivedAt: null,
    menuReady: true,
    bookingCount: 0,
    menuItems: [],
    ...overrides,
  }
}

/** A Supabase stand-in that returns whatever the two reads are told to return. */
function fakeSupabase(options: {
  periodRow?: Record<string, unknown> | null
  settingValue?: unknown
  settingError?: boolean
}) {
  const from = vi.fn((table: string) => {
    if (table === 'system_settings') {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () =>
              options.settingError
                ? { data: null, error: new Error('unreadable') }
                : { data: { value: options.settingValue }, error: null },
          }),
        }),
      }
    }
    if (table === 'booking_periods') {
      return {
        select: () => ({
          eq: () => ({
            is: () => ({
              lte: () => ({
                gte: () => ({
                  maybeSingle: async () => ({ data: options.periodRow ?? null, error: null }),
                }),
              }),
            }),
          }),
        }),
      }
    }
    if (table === 'booking_period_menu_items') {
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              order: async () => ({ data: [{ id: 'm1', course: 'main', name: 'Turkey', description: null, price_gbp: null, allergens: null, sort_order: 0, is_active: true }], error: null }),
            }),
          }),
        }),
      }
    }
    throw new Error(`Unexpected table read: ${table}`)
  })

  return { from } as never
}

const PERIOD_ROW = {
  id: 'p-christmas',
  code: 'christmas-2026',
  period_kind: 'christmas',
  name: 'Christmas dinner 2026',
  starts_on: '2026-11-10',
  ends_on: '2026-12-20',
  guest_question: 'Is this a Christmas dinner booking?',
  guest_blurb: null,
  requires_preorder: true,
  preorder_cutoff_days: 7,
  deposit_basis: 'per_head',
  deposit_amount: '10.00',
  refund_cutoff_days: 7,
  min_party_size: 6,
  max_party_size: 20,
  min_notice_hours: 24,
  legacy_booking_type: 'christmas',
  is_active: true,
  archived_at: null,
}

describe('loadBookingPeriodContext reads the switch and the live period', () => {
  it('reports collection on when the setting is the stored wrapped shape', async () => {
    const context = await loadBookingPeriodContext(
      fakeSupabase({ periodRow: PERIOD_ROW, settingValue: { value: true } }),
      '2026-12-05',
    )
    expect(context.collectPeriodDeposits).toBe(true)
    expect(context.period?.code).toBe('christmas-2026')
  })

  it('reports collection OFF when a manager has switched it off', async () => {
    const context = await loadBookingPeriodContext(
      fakeSupabase({ periodRow: PERIOD_ROW, settingValue: { value: false } }),
      '2026-12-05',
    )
    expect(context.collectPeriodDeposits).toBe(false)
  })

  it('honours a bare boolean, so a switch turned off in an older shape stays off', async () => {
    const context = await loadBookingPeriodContext(
      fakeSupabase({ periodRow: null, settingValue: false }),
      '2026-12-05',
    )
    expect(context.collectPeriodDeposits).toBe(false)
  })

  it('defaults to ON when the setting has never been written, which is what the owner asked for', async () => {
    const context = await loadBookingPeriodContext(
      fakeSupabase({ periodRow: null, settingValue: null }),
      '2026-06-01',
    )
    expect(context.collectPeriodDeposits).toBe(true)
    expect(context.period).toBeNull()
  })

  it('fails safe to NOT collecting when the setting cannot be read at all', async () => {
    const context = await loadBookingPeriodContext(
      fakeSupabase({ periodRow: null, settingError: true }),
      '2026-06-01',
    )
    expect(context.collectPeriodDeposits).toBe(false)
  })
})

describe('what each create route will be told the deposit is', () => {
  const on = { period: christmasPeriod(), collectPeriodDeposits: true }
  const off = { period: christmasPeriod(), collectPeriodDeposits: false }

  it('with the switch ON, a party of 6 accepting Christmas owes GBP 60', () => {
    const deposit = expectedDepositForCreate({
      context: on,
      partySize: 6,
      bookingDate: '2026-12-05',
      periodAccepted: true,
      depositWaived: false,
    })
    expect(deposit?.required).toBe(true)
    expect(deposit?.amount).toBe(60)
  })

  it('with the switch OFF, that same booking owes nothing and needs no payment method', () => {
    const deposit = expectedDepositForCreate({
      context: off,
      partySize: 6,
      bookingDate: '2026-12-05',
      periodAccepted: true,
      depositWaived: false,
    })
    expect(deposit?.required).toBe(false)
    expect(deposit?.amount).toBe(0)
  })

  it('with the switch OFF, a party of 12 STILL owes the large-group deposit', () => {
    // The kill switch stops seasonal collection. It must never stop the deposit the pub has taken
    // from big parties for years, which is a different rule with nothing to do with seasons.
    const deposit = expectedDepositForCreate({
      context: off,
      partySize: 12,
      bookingDate: '2026-12-05',
      periodAccepted: true,
      depositWaived: false,
    })
    expect(deposit?.required).toBe(true)
    expect(deposit?.amount).toBe(120)
    expect(deposit?.rule).toBe('group')
  })

  it('a declined offer is priced as an ordinary booking, switch or no switch', () => {
    for (const context of [on, off]) {
      const deposit = expectedDepositForCreate({
        context,
        partySize: 4,
        bookingDate: '2026-12-05',
        periodAccepted: false,
        depositWaived: false,
      })
      expect(deposit?.required).toBe(false)
    }
  })

  it('a manager waiver still wins over everything', () => {
    const deposit = expectedDepositForCreate({
      context: on,
      partySize: 12,
      bookingDate: '2026-12-05',
      periodAccepted: true,
      depositWaived: true,
    })
    expect(deposit?.required).toBe(false)
    expect(deposit?.rule).toBe('waived')
  })
})

describe('both create routes forward the seasonal answer to the database', () => {
  /**
   * The routes cannot be executed end to end here without a database, so this asserts the wiring
   * that would otherwise be silently absent: a route that never sends the answer means the RPC can
   * never charge a seasonal deposit, no matter how correct the SQL is.
   */
  const publicRoute = readFileSync(
    join(process.cwd(), 'src/app/api/table-bookings/route.ts'),
    'utf8',
  )
  const fohRoute = readFileSync(join(process.cwd(), 'src/app/api/foh/bookings/route.ts'), 'utf8')

  it('the public route accepts and forwards the period and the answer', () => {
    expect(publicRoute).toContain('booking_period_id: z.string().uuid().optional()')
    expect(publicRoute).toContain('booking_period_answer: z.boolean().optional()')
    expect(publicRoute).toContain('p_booking_period_id: payload.booking_period_id ?? null')
    expect(publicRoute).toContain('p_booking_period_answer: payload.booking_period_answer ?? null')
  })

  it('the FOH route accepts and forwards them too', () => {
    expect(fohRoute).toContain('booking_period_id: z.string().uuid().optional()')
    expect(fohRoute).toContain('booking_period_answer: z.boolean().optional()')
    expect(fohRoute).toContain('p_booking_period_id: payload.booking_period_id ?? null')
    expect(fohRoute).toContain('p_booking_period_answer: payload.booking_period_answer ?? null')
  })

  it('neither route sends an amount, a basis or a rate', () => {
    // The client never names a price, and neither does the route. Only the database does.
    for (const route of [publicRoute, fohRoute]) {
      expect(route).not.toMatch(/p_deposit_amount:/)
      expect(route).not.toMatch(/p_deposit_basis:/)
      expect(route).not.toMatch(/p_deposit_rate:/)
    }
  })

  it('the FOH deposit-method gate asks the shared resolver rather than its own copy of the rule', () => {
    // The bug this prevents: the database charges a per-booking Mother's Day deposit, this screen
    // believes nothing is due, never asks cash or payment link, and leaves a pending_payment
    // booking with no way for the guest to pay it.
    expect(fohRoute).toContain('expectedDepositForCreate({')
    expect(fohRoute).toContain('const requiresDeposit = expectedDeposit')
  })

  it('the FOH cash amount is the figure the database charged, not a recomputation', () => {
    expect(fohRoute).toContain('const resolvedDepositAmount = Number(bookingResult.deposit_amount)')
  })

  it('the answer varies the idempotency key, so a changed answer cannot replay the old booking', () => {
    const idempotency = readFileSync(
      join(process.cwd(), 'src/lib/table-bookings/booking-idempotency.ts'),
      'utf8',
    )
    expect(idempotency).toContain('booking_period_answer')
    expect(publicRoute).toContain('booking_period_answer: payload.booking_period_answer')
  })
})
