import { describe, expect, it } from 'vitest'
import {
  buildPeriodTermsSnapshot,
  describeRefundPolicy,
  resolveTableBookingDeposit,
  type ResolveDepositInput,
} from './period-deposit'
import {
  describeDeposit,
  getPeriodOfferability,
  mapBookingPeriodRow,
  type BookingPeriod,
  type BookingPeriodRow,
} from './periods'

/**
 * The Christmas period exactly as seeded by
 * supabase/migrations/20260803000100_seasonal_booking_periods.sql, but switched ON, because the
 * seed ships inactive and an inactive period must produce nothing at all.
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
    guestBlurb: 'Our festive set menu.',
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

function mothersDayPeriod(overrides: Partial<BookingPeriod> = {}): BookingPeriod {
  return {
    id: 'p-mothers',
    code: 'mothers-day-2027',
    periodKind: 'mothers_day',
    name: "Mother's Day 2027",
    startsOn: '2027-03-14',
    endsOn: '2027-03-14',
    guestQuestion: "Is this a Mother's Day lunch?",
    guestBlurb: null,
    requiresPreorder: false,
    preorderCutoffDays: 7,
    depositBasis: 'per_booking',
    depositAmount: 25,
    refundCutoffDays: 7,
    minPartySize: null,
    maxPartySize: null,
    minNoticeHours: 0,
    legacyBookingType: null,
    isActive: true,
    archivedAt: null,
    menuReady: true,
    bookingCount: 0,
    menuItems: [],
    ...overrides,
  }
}

function resolve(input: Partial<ResolveDepositInput> & { partySize: number }) {
  return resolveTableBookingDeposit({ bookingDate: '2026-12-05', ...input })
}

function expectOk(result: ReturnType<typeof resolve>) {
  if (!result.ok) throw new Error(`Expected a resolved deposit, got rejection "${result.code}"`)
  return result.deposit
}

describe('resolveTableBookingDeposit: the party-size rule on its own', () => {
  it('charges nothing below the threshold when no period applies', () => {
    const deposit = expectOk(resolve({ partySize: 4 }))
    expect(deposit.required).toBe(false)
    expect(deposit.amount).toBe(0)
    expect(deposit.rule).toBe('none')
  })

  it('charges GBP 10 a head from 15 guests', () => {
    const deposit = expectOk(resolve({ partySize: 15 }))
    expect(deposit.amount).toBe(150)
    expect(deposit.rule).toBe('group')
    expect(deposit.basis).toBe('per_head')
  })

  it('charges nothing at fourteen, the guest immediately below the threshold', () => {
    // The boundary itself, pinned. Fourteen used to pay GBP 140 and now pays nothing;
    // an off-by-one here is a payment screen in front of an ordinary family Sunday.
    const deposit = expectOk(resolve({ partySize: 14 }))
    expect(deposit.required).toBe(false)
    expect(deposit.amount).toBe(0)
    expect(deposit.rule).toBe('none')
  })

  it('is unchanged by a period the guest declined', () => {
    const deposit = expectOk(resolve({ partySize: 16, period: christmasPeriod(), periodAccepted: false }))
    expect(deposit.amount).toBe(160)
    expect(deposit.rule).toBe('group')
    expect(deposit.periodId).toBeNull()
  })

  it('charges nothing for a small party who declined the seasonal offer', () => {
    // Owner decision: saying no in December gets the normal menu at normal terms.
    const deposit = expectOk(resolve({ partySize: 4, period: christmasPeriod(), periodAccepted: false }))
    expect(deposit.required).toBe(false)
    expect(deposit.amount).toBe(0)
    expect(deposit.rule).toBe('none')
  })
})

describe('resolveTableBookingDeposit: a manager waiver', () => {
  it('wins outright over both rules', () => {
    const deposit = expectOk(
      resolve({ partySize: 18, period: christmasPeriod(), periodAccepted: true, depositWaived: true }),
    )
    expect(deposit.required).toBe(false)
    expect(deposit.amount).toBe(0)
    expect(deposit.rule).toBe('waived')
  })

  it('wins even when the period id is stale, because nothing is priced', () => {
    const result = resolve({
      partySize: 12,
      period: christmasPeriod({ isActive: false }),
      periodAccepted: true,
      depositWaived: true,
    })
    expect(result.ok).toBe(true)
  })
})

describe('resolveTableBookingDeposit: largest wins, never stacks', () => {
  it('takes the period deposit when it is larger', () => {
    // Party of 6: Christmas GBP 60, party-size rule GBP 0.
    const deposit = expectOk(resolve({ partySize: 6, period: christmasPeriod(), periodAccepted: true }))
    expect(deposit.amount).toBe(60)
    expect(deposit.rule).toBe('period')
    expect(deposit.periodCode).toBe('christmas-2026')
  })

  it('takes the party-size deposit when it is larger', () => {
    // Party of 16 on Mother's Day: period GBP 25 flat, party-size rule GBP 160.
    const deposit = expectOk(
      resolve({
        partySize: 16,
        bookingDate: '2027-03-14',
        period: mothersDayPeriod(),
        periodAccepted: true,
      }),
    )
    expect(deposit.amount).toBe(160)
    expect(deposit.rule).toBe('group')
    // The period is still recorded on the booking even though its deposit did not win.
    expect(deposit.periodCode).toBe('mothers-day-2027')
  })

  it('carries the seasonal refund terms even when the party-size rule produced the amount', () => {
    // The defect this replaces: 15 guests accepting a GBP 5 per head Christmas resolved to
    // rule=group, GBP 150, refundPolicy null. The guest was shown a seven-day refund promise on the
    // way in and the booking row carried no evidence of it, so a dispute could not be settled and
    // the refund path had nothing to enforce. A deposit always travels with its refund terms.
    const deposit = expectOk(
      resolve({
        partySize: 15,
        period: christmasPeriod({ depositAmount: 5, maxPartySize: 30 }),
        periodAccepted: true,
      }),
    )
    expect(deposit.rule).toBe('group')
    expect(deposit.amount).toBe(150)
    expect(deposit.refundCutoffDays).toBe(7)
    expect(deposit.refundPolicy).toContain('Full refund up to 7 days')
  })

  it('leaves an ordinary large-group deposit on the terms it has always had', () => {
    // No period, so no seasonal promise was ever made. Inventing one here would change the refund
    // rule for every fifteen-plus booking in the pub, which is not what this feature is for.
    const deposit = expectOk(resolve({ partySize: 16, period: null }))
    expect(deposit.rule).toBe('group')
    expect(deposit.refundCutoffDays).toBeNull()
    expect(deposit.refundPolicy).toBeNull()
  })

  it('THE TIE: a party of 15 inside Christmas pays GBP 150 once, never GBP 300', () => {
    // Christmas is GBP 10 per head and the party-size rule is GBP 10 per head, so both routes
    // produce the identical number. That equality makes a double-charge bug invisible unless it is
    // tested for deliberately. This is that test.
    //
    // The tie sat at 12 until the group threshold moved to 15 on 2026-08-09. Below 15 the
    // party-size rule now yields nothing, so there is no longer anything for Christmas to tie
    // with; 15 is the smallest party where both rules fire and the double-charge is possible.
    const deposit = expectOk(resolve({ partySize: 15, period: christmasPeriod(), periodAccepted: true }))

    expect(deposit.amount).toBe(150)
    expect(deposit.amount).not.toBe(300)
    // A tie resolves to the period so the guest-facing wording names the season.
    expect(deposit.rule).toBe('period')
    expect(deposit.reason).toContain('matches the large-group deposit rather than adding to it')
  })

  it('never exceeds the larger of the two rules at any party size in range', () => {
    // A property check across the whole Christmas range, so a future edit cannot reintroduce
    // stacking at one awkward size.
    for (let partySize = 6; partySize <= 20; partySize += 1) {
      const deposit = expectOk(resolve({ partySize, period: christmasPeriod(), periodAccepted: true }))
      const periodAmount = partySize * 10
      const groupAmount = partySize >= 10 ? partySize * 10 : 0
      expect(deposit.amount).toBe(Math.max(periodAmount, groupAmount))
    }
  })

  it('handles a per-booking deposit larger than the party-size rule', () => {
    const deposit = expectOk(
      resolve({
        partySize: 2,
        bookingDate: '2027-03-14',
        period: mothersDayPeriod(),
        periodAccepted: true,
      }),
    )
    expect(deposit.amount).toBe(25)
    expect(deposit.basis).toBe('per_booking')
    expect(deposit.rate).toBe(25)
  })

  it('charges a per-head rate that is not GBP 10, which the old hardcoded rule could not', () => {
    // The failure this guards: a manager creates Mother's Day 2027 at GBP 15 a head, the settings
    // preview says "2 guests: GBP 30", and the booking path charges GBP 0 because it was still
    // running "party_size >= 10 OR christmas" at GBP 10 a head.
    const perHeadFifteen = mothersDayPeriod({ depositBasis: 'per_head', depositAmount: 15 })

    const two = expectOk(
      resolve({ partySize: 2, bookingDate: '2027-03-14', period: perHeadFifteen, periodAccepted: true }),
    )
    expect(two.amount).toBe(30)
    expect(two.rule).toBe('period')
    expect(two.rate).toBe(15)

    // And at 10 guests the seasonal rate beats the group rule, GBP 150 against GBP 100.
    const ten = expectOk(
      resolve({ partySize: 10, bookingDate: '2027-03-14', period: perHeadFifteen, periodAccepted: true }),
    )
    expect(ten.amount).toBe(150)
    expect(ten.rule).toBe('period')
  })

  it('rounds a per-head rate with pence to the penny, not to float noise', () => {
    const period = mothersDayPeriod({ depositBasis: 'per_head', depositAmount: 12.5 })
    const deposit = expectOk(
      resolve({ partySize: 3, bookingDate: '2027-03-14', period, periodAccepted: true }),
    )
    expect(deposit.amount).toBe(37.5)
  })
})

describe('resolveTableBookingDeposit: the kill switch', () => {
  /**
   * `booking_period_deposits_enabled` off means: stop taking seasonal money everywhere, right now,
   * without a deploy. It must NOT stop the large-group deposit, which has been collected for years
   * and has nothing to do with seasons.
   */
  it('takes no seasonal deposit when collection is switched off', () => {
    const deposit = expectOk(
      resolve({ partySize: 6, period: christmasPeriod(), periodAccepted: true, collectPeriodDeposits: false }),
    )
    expect(deposit.required).toBe(false)
    expect(deposit.amount).toBe(0)
    expect(deposit.rule).toBe('none')
    expect(deposit.reason).toContain('switched off')
  })

  it('still records which period the guest accepted, so the kitchen knows to expect a pre-order', () => {
    const deposit = expectOk(
      resolve({ partySize: 6, period: christmasPeriod(), periodAccepted: true, collectPeriodDeposits: false }),
    )
    expect(deposit.periodCode).toBe('christmas-2026')
    expect(deposit.periodName).toBe('Christmas dinner 2026')
  })

  it('leaves the large-group deposit completely alone', () => {
    const deposit = expectOk(
      resolve({ partySize: 16, period: christmasPeriod(), periodAccepted: true, collectPeriodDeposits: false }),
    )
    expect(deposit.required).toBe(true)
    expect(deposit.amount).toBe(160)
    expect(deposit.rule).toBe('group')
  })

  it('suppresses a per-booking deposit too, not only per-head', () => {
    const deposit = expectOk(
      resolve({
        partySize: 2,
        bookingDate: '2027-03-14',
        period: mothersDayPeriod(),
        periodAccepted: true,
        collectPeriodDeposits: false,
      }),
    )
    expect(deposit.amount).toBe(0)
  })

  it('still refuses a stale period id while collection is off', () => {
    // Switching collection off is not an excuse to stop validating what the browser sent.
    expect(
      resolve({
        partySize: 6,
        period: christmasPeriod({ isActive: false }),
        periodAccepted: true,
        collectPeriodDeposits: false,
      }),
    ).toMatchObject({ ok: false, code: 'period_inactive' })
  })

  it('defaults to collecting, so forgetting to pass the switch never silently stops the money', () => {
    const deposit = expectOk(resolve({ partySize: 6, period: christmasPeriod(), periodAccepted: true }))
    expect(deposit.amount).toBe(60)
  })
})

describe('resolveTableBookingDeposit: an untrusted period id is rejected, not silently priced', () => {
  it('rejects an inactive period', () => {
    const result = resolve({ partySize: 8, period: christmasPeriod({ isActive: false }), periodAccepted: true })
    expect(result).toMatchObject({ ok: false, code: 'period_inactive' })
  })

  it('rejects an archived period', () => {
    const result = resolve({
      partySize: 8,
      period: christmasPeriod({ isActive: false, archivedAt: '2026-12-21T00:00:00Z' }),
      periodAccepted: true,
    })
    expect(result).toMatchObject({ ok: false, code: 'period_archived' })
  })

  it('rejects a booking date outside the period window', () => {
    const result = resolve({
      partySize: 8,
      bookingDate: '2026-06-15',
      period: christmasPeriod(),
      periodAccepted: true,
    })
    expect(result).toMatchObject({ ok: false, code: 'period_date_mismatch' })
  })

  it('rejects a party below the period minimum', () => {
    const result = resolve({ partySize: 4, period: christmasPeriod(), periodAccepted: true })
    expect(result).toMatchObject({ ok: false, code: 'period_party_too_small' })
  })

  it('rejects a party above the period maximum', () => {
    const result = resolve({ partySize: 21, period: christmasPeriod(), periodAccepted: true })
    expect(result).toMatchObject({ ok: false, code: 'period_party_too_large' })
  })

  it('rejects a pre-order period whose menu is not published', () => {
    const result = resolve({
      partySize: 8,
      period: christmasPeriod({ menuReady: false }),
      periodAccepted: true,
    })
    expect(result).toMatchObject({ ok: false, code: 'period_menu_not_ready' })
  })

  it('rejects a party size below one', () => {
    expect(resolve({ partySize: 0 })).toMatchObject({ ok: false, code: 'invalid_party_size' })
  })
})

describe('resolveTableBookingDeposit: an inactive period is completely inert', () => {
  it('produces the ordinary outcome when the guest somehow accepts an inactive period', () => {
    // The rejection is the point: an inactive period can never quietly charge anyone.
    const result = resolve({ partySize: 12, period: christmasPeriod({ isActive: false }), periodAccepted: true })
    expect(result.ok).toBe(false)
  })

  it('refuses a declined booking that was handed an inactive period, rather than quietly pricing it', () => {
    // Changed 2026-08-02, closing a disagreement between this function and its SQL twin. The SQL
    // validates a period id that was SUPPLIED whatever the guest answered; this used to check it
    // only when they accepted, so the same inputs gave 'period_inactive' from the database and a
    // cheerful "no deposit" here. Handing over a stale period id is a caller bug either way, and a
    // caller bug near money must surface rather than resolve to a number.
    const result = resolve({
      partySize: 12,
      period: christmasPeriod({ isActive: false }),
      periodAccepted: false,
    })
    expect(result).toMatchObject({ ok: false, code: 'period_inactive' })
  })

  it('is genuinely inert when no period is passed at all, which is what an inactive period looks like', () => {
    // The lookup only ever returns LIVE periods, so an inactive Christmas reaches the resolver as
    // no period whatsoever. That is the path that proves the seeded, unpublished period is safe.
    const deposit = expectOk(resolve({ partySize: 16, period: null, periodAccepted: false }))
    expect(deposit.amount).toBe(160)
    expect(deposit.rule).toBe('group')
    expect(deposit.periodId).toBeNull()
  })
})

describe('resolveTableBookingDeposit: the SQL twin and this function agree on a supplied period', () => {
  /**
   * These four cases are the ones that used to differ. `resolve_table_booking_deposit` returns an
   * error code for each of them whatever `p_period_answer` is, so this does too.
   */
  const unconditional: Array<[string, Partial<BookingPeriod>, string, string]> = [
    ['inactive', { isActive: false }, 'period_inactive', '2026-12-05'],
    ['archived', { isActive: false, archivedAt: '2026-12-21T00:00:00Z' }, 'period_archived', '2026-12-05'],
    ['out of range', {}, 'period_date_mismatch', '2026-06-15'],
  ]

  for (const [label, overrides, code, bookingDate] of unconditional) {
    it(`rejects a ${label} period whether the guest accepted or declined`, () => {
      for (const periodAccepted of [true, false]) {
        expect(
          resolve({ partySize: 12, bookingDate, period: christmasPeriod(overrides), periodAccepted }),
        ).toMatchObject({ ok: false, code })
      }
    })
  }

  it('checks the menu and the party limits ONLY for a guest who accepted the offer', () => {
    // A guest declining a Christmas offer is booking the normal menu, so an unpublished festive
    // menu and the festive party limits are none of their business.
    const declined = expectOk(
      resolve({
        partySize: 2,
        period: christmasPeriod({ menuReady: false }),
        periodAccepted: false,
      }),
    )
    expect(declined.required).toBe(false)

    expect(
      resolve({ partySize: 2, period: christmasPeriod({ menuReady: false }), periodAccepted: true }),
    ).toMatchObject({ ok: false, code: 'period_party_too_small' })
  })
})

describe('refund policy wording', () => {
  it('states the seven-day line plainly', () => {
    const policy = describeRefundPolicy(7)
    expect(policy).toContain('Full refund up to 7 days before')
    expect(policy).toContain('Inside 7 days the deposit is not refunded')
    expect(policy).toContain('comes off the bill')
  })

  it('handles a zero-day cutoff without claiming a refund window', () => {
    expect(describeRefundPolicy(0)).toContain('not refundable')
  })

  it('is snapshotted onto the deposit when the period rule wins', () => {
    const deposit = expectOk(resolve({ partySize: 6, period: christmasPeriod(), periodAccepted: true }))
    expect(deposit.refundCutoffDays).toBe(7)
    expect(deposit.refundPolicy).toContain('7 days')
  })
})

describe('buildPeriodTermsSnapshot', () => {
  it('records everything a payment dispute needs from the booking row alone', () => {
    const period = christmasPeriod()
    const deposit = expectOk(resolve({ partySize: 8, period, periodAccepted: true }))
    const snapshot = buildPeriodTermsSnapshot(deposit, period, true)

    expect(snapshot).toMatchObject({
      booking_period_id: 'p-christmas',
      booking_period_code: 'christmas-2026',
      booking_period_name: 'Christmas dinner 2026',
      booking_period_answer: true,
      booking_period_requires_preorder: true,
      deposit_rule: 'period',
      deposit_basis: 'per_head',
      deposit_rate: 10,
      deposit_amount: 80,
      deposit_refund_cutoff_days: 7,
    })
    expect(snapshot.deposit_refund_policy).toContain('Full refund up to 7 days')
  })

  it('records a declined offer as an explicit no, not as an absence', () => {
    const period = christmasPeriod()
    const deposit = expectOk(resolve({ partySize: 4, period, periodAccepted: false }))
    const snapshot = buildPeriodTermsSnapshot(deposit, period, false)

    expect(snapshot.booking_period_answer).toBe(false)
    expect(snapshot.booking_period_code).toBe('christmas-2026')
    expect(snapshot.deposit_rule).toBe('none')
  })

  it('leaves the period fields null when no period applied', () => {
    const deposit = expectOk(resolve({ partySize: 16 }))
    const snapshot = buildPeriodTermsSnapshot(deposit, null, false)
    expect(snapshot.booking_period_id).toBeNull()
    expect(snapshot.booking_period_answer).toBeNull()
    expect(snapshot.deposit_amount).toBe(160)
  })
})

describe('period row mapping and offerability', () => {
  const row: BookingPeriodRow = {
    id: 'p-1',
    code: 'easter-2027',
    period_kind: 'easter',
    name: 'Easter feasting',
    starts_on: '2027-03-26',
    ends_on: '2027-03-29',
    guest_question: 'Is this an Easter lunch?',
    guest_blurb: null,
    requires_preorder: true,
    preorder_cutoff_days: 5,
    deposit_basis: 'per_head',
    deposit_amount: '7.50',
    refund_cutoff_days: 7,
    min_party_size: 2,
    max_party_size: 12,
    min_notice_hours: 48,
    legacy_booking_type: null,
    is_active: true,
    archived_at: null,
    menu_items: [
      {
        id: 'm-1',
        course: 'main',
        name: 'Roast lamb',
        description: null,
        price_gbp: '18.95',
        allergens: null,
        sort_order: 1,
        is_active: true,
      },
    ],
  }

  it('maps snake_case to camelCase and coerces numeric strings', () => {
    const period = mapBookingPeriodRow(row)
    expect(period.periodKind).toBe('easter')
    expect(period.depositAmount).toBe(7.5)
    expect(period.menuItems[0].priceGbp).toBe(18.95)
    expect(period.menuReady).toBe(true)
  })

  it('derives menuReady as false for a pre-order period with no live items', () => {
    const period = mapBookingPeriodRow({ ...row, menu_items: [] })
    expect(period.menuReady).toBe(false)
    const offerability = getPeriodOfferability(period, '2027-03-27')
    expect(offerability).toMatchObject({ offerable: false, reason: 'menu_not_ready' })
  })

  it('falls back to "other" for an unknown kind rather than throwing', () => {
    expect(mapBookingPeriodRow({ ...row, period_kind: 'halloween' }).periodKind).toBe('other')
  })

  it('never matches on the display name', () => {
    // A manager renaming Christmas must not change any behaviour. Kind is what machinery reads.
    const renamed = christmasPeriod({ name: 'Festive feasting' })
    const deposit = expectOk(resolve({ partySize: 6, period: renamed, periodAccepted: true }))
    expect(deposit.amount).toBe(60)
    expect(renamed.periodKind).toBe('christmas')
  })
})

describe('describeDeposit', () => {
  it('reads as a sentence for each basis', () => {
    expect(describeDeposit('per_head', 10)).toBe('GBP 10 per guest')
    expect(describeDeposit('per_booking', 25)).toBe('GBP 25 per booking')
    expect(describeDeposit('per_head', 7.5)).toBe('GBP 7.50 per guest')
    expect(describeDeposit('none', 0)).toBe('No deposit')
  })
})
