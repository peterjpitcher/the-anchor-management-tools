import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveTableBookingDeposit } from './period-deposit'
import type { BookingPeriod, DepositBasis, PeriodKind } from './periods'

/**
 * The TypeScript deposit resolver gives the answers the database's resolve_table_booking_deposit
 * gives (BK-125, customer bookings review of 24 October 2026).
 *
 * Both read the same cases: scripts/testing/fixtures/table-booking-deposit-cases.json. The Postgres
 * harness scripts/testing/table-booking-deposit-postgres.py (run by `npm run test:pg` and in CI)
 * executes the live SQL resolver against them, and this runs the TypeScript one. A rule changed on
 * one side only fails one of the two, so the website's quote and the amount the booking is charged
 * cannot drift apart unnoticed.
 */

type CasePeriod = {
  id: string
  code: string
  name: string
  period_kind: string
  starts_on: string
  ends_on: string
  requires_preorder: boolean
  menu_ready: boolean
  deposit_basis: string
  deposit_amount: number
  refund_cutoff_days: number
  min_party_size: number | null
  max_party_size: number | null
  is_active: boolean
  archived: boolean
}

type DepositCase = {
  name: string
  party_size: number
  booking_date: string
  period: string | null
  accepted: boolean
  waived: boolean
  collect: boolean
  expect:
    | { ok: true; required: boolean; amount: number; rule: string; basis: string | null; rate: number | null }
    | { ok: false; code: string }
}

const fixture = JSON.parse(
  readFileSync(join(process.cwd(), 'scripts/testing/fixtures/table-booking-deposit-cases.json'), 'utf8')
) as { periods: Record<string, CasePeriod>; cases: DepositCase[] }

function toBookingPeriod(row: CasePeriod): BookingPeriod {
  return {
    id: row.id,
    code: row.code,
    periodKind: row.period_kind as PeriodKind,
    name: row.name,
    startsOn: row.starts_on,
    endsOn: row.ends_on,
    guestQuestion: 'Is this a seasonal booking?',
    guestBlurb: null,
    requiresPreorder: row.requires_preorder,
    preorderCutoffDays: 7,
    depositBasis: row.deposit_basis as DepositBasis,
    depositAmount: row.deposit_amount,
    refundCutoffDays: row.refund_cutoff_days,
    minPartySize: row.min_party_size,
    maxPartySize: row.max_party_size,
    minNoticeHours: 0,
    legacyBookingType: row.period_kind === 'christmas' ? 'christmas' : null,
    isActive: row.is_active,
    archivedAt: row.archived ? '2026-10-01T00:00:00Z' : null,
    menuReady: row.menu_ready,
    bookingCount: 0,
    menuItems: [],
  }
}

describe('the TypeScript deposit resolver matches the database cases', () => {
  it('has the cases the database harness runs', () => {
    expect(fixture.cases.length).toBeGreaterThanOrEqual(20)
  })

  it.each(fixture.cases.map((c) => [c.name, c] as const))('%s', (_name, testCase) => {
    const period = testCase.period ? toBookingPeriod(fixture.periods[testCase.period]) : null
    const result = resolveTableBookingDeposit({
      partySize: testCase.party_size,
      bookingDate: testCase.booking_date,
      period,
      periodAccepted: testCase.accepted,
      depositWaived: testCase.waived,
      collectPeriodDeposits: testCase.collect,
    })

    if (!testCase.expect.ok) {
      expect(result).toMatchObject({ ok: false, code: testCase.expect.code })
      return
    }

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect({
      required: result.deposit.required,
      amount: result.deposit.amount,
      rule: result.deposit.rule,
      basis: result.deposit.basis,
      rate: result.deposit.rate,
    }).toEqual({
      required: testCase.expect.required,
      amount: testCase.expect.amount,
      rule: testCase.expect.rule,
      basis: testCase.expect.basis,
      rate: testCase.expect.rate,
    })
  })
})
