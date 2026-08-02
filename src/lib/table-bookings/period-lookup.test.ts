import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expectedDepositForCreate, loadBookingPeriodContext } from './period-lookup'
import { chargedDepositAmount } from './bookings'
import { computeDepositAmount } from './deposit'
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

  it('assumes collection is ON when the setting cannot be read, matching what the database assumes', async () => {
    // This used to return false, on the reasoning that not taking money is the safe side. It is
    // not, because the layer that takes the money disagrees: resolve_table_booking_deposit calls
    // get_setting_bool with a default of TRUE and charges. Front of house would then never be asked
    // for cash or a payment link, neither payment branch would run, and the booking would sit in
    // pending_payment until its 24-hour hold quietly expired and the table went back.
    const context = await loadBookingPeriodContext(
      fakeSupabase({ periodRow: null, settingError: true }),
      '2026-06-01',
    )
    expect(context.collectPeriodDeposits).toBe(true)
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

describe('the figure quoted to the guest is the figure charged', () => {
  /**
   * The public route built its response and its analytics from computeDepositAmount(party_size),
   * which is the old party-size rule. Mother's Day at GBP 15 a head, party of two, accepted: the
   * database charged GBP 30 and put the booking into pending_payment, and the response told the
   * guest the deposit was GBP 0. Both numbers came from the same request.
   */
  it('quotes what the RPC charged, where the old rule quoted zero', () => {
    const rpcResult = { deposit_amount: 30 }
    expect(computeDepositAmount(2, { isChristmas: false })).toBe(0)
    expect(chargedDepositAmount(rpcResult, () => computeDepositAmount(2, { isChristmas: false }))).toBe(30)
  })

  it('quotes 90 for a Christmas period at GBP 15 a head, where the old rule quoted 60', () => {
    expect(computeDepositAmount(6, { isChristmas: true })).toBe(60)
    expect(chargedDepositAmount({ deposit_amount: 90 }, () => computeDepositAmount(6, { isChristmas: true }))).toBe(90)
  })

  it('agrees with the old rule when the old rule was right, so nothing else moves', () => {
    // A party of 12 with no period: both routes give GBP 120 and always did.
    expect(chargedDepositAmount({ deposit_amount: 120 }, () => computeDepositAmount(12, {}))).toBe(120)
  })

  it('falls back to the party-size rule only when the RPC sent no figure at all', () => {
    expect(chargedDepositAmount({}, () => computeDepositAmount(12, {}))).toBe(120)
    expect(chargedDepositAmount({ deposit_amount: 0 }, () => computeDepositAmount(12, {}))).toBe(120)
  })

  it('rounds to the penny', () => {
    expect(chargedDepositAmount({ deposit_amount: 37.499 }, () => 0)).toBe(37.5)
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

  it('every create surface quotes the figure the database charged, not a recomputation', () => {
    // The fault this pins: the public route built its response and its analytics from
    // computeDepositAmount(party_size), the old party-size rule, so a per-head GBP 15 Mother's Day
    // booking for two was charged GBP 30 and told the guest GBP 0. Both routes now go through the
    // one helper that reads the RPC's own answer.
    for (const route of [publicRoute, fohRoute]) {
      expect(route).toContain('chargedDepositAmount(bookingResult,')
    }
    // And the response field itself is the charged figure.
    expect(publicRoute).toContain('deposit_amount: canonicalDeposit')
    expect(publicRoute).not.toMatch(/canonicalDeposit\s*=\s*\n?\s*responseState === 'pending_payment'\s*\n?\s*\?\s*computeDepositAmount/)
  })

  it('analytics no longer hardcodes GBP 10 a head', () => {
    // "deposit_per_person: 10" became a lie the moment a period charged anything else, and every
    // seasonal deposit landed in the numbers at the wrong rate.
    const analytics = publicRoute.slice(
      publicRoute.indexOf("eventType: 'table_deposit_started'"),
      publicRoute.indexOf('await Promise.all(analyticsPromises)'),
    )
    expect(analytics).toContain('deposit_rule: bookingResult.deposit_rule')
    expect(analytics).toContain('bookingResult.deposit_rate')
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
