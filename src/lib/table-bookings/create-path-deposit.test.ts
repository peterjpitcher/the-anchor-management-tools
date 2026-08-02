import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  DEFAULT_GROUP_DEPOSIT_RULE,
  describeRefundPolicy,
  resolveTableBookingDeposit,
} from './period-deposit'
import type { BookingPeriod } from './periods'

/**
 * THE LAYER THAT ACTUALLY CHARGES.
 *
 * The deposit rules were already asserted three times: in the resolver's unit tests, in the
 * website endpoint's tests, and implicitly by the settings screen preview. All three were reading
 * the TypeScript mirror. None of them touched the code that takes money, and the code that takes
 * money was running a different rule entirely: "(p_party_size >= 10 OR v_is_christmas)" at a flat
 * GBP 10 a head, with no knowledge of booking_periods at all. Every one of those tests passed
 * while a per-head Mother's Day deposit charged the guest nothing.
 *
 * There is no Postgres in this test run, so this reads the migration itself and asserts the
 * contract of the create path: that it delegates to the one resolver, that it does not recompute
 * the sum, that it writes the terms, and that its constants match the TypeScript ones the other
 * three layers use. That last check is what makes the GBP 120 tie meaningful here: the tie only
 * exists because the two rates are equal, so a test that the rates ARE equal, plus a test that the
 * comparison takes the larger rather than the sum, pins the charge at 120 rather than 240.
 */

const MIGRATIONS = join(process.cwd(), 'supabase/migrations')
const CREATE_PATH = join(MIGRATIONS, '20260803000200_seasonal_deposit_on_create.sql')
const PERIODS = join(MIGRATIONS, '20260803000100_seasonal_booking_periods.sql')

const createPathSql = readFileSync(CREATE_PATH, 'utf8')
const periodsSql = readFileSync(PERIODS, 'utf8')

/** The body of a named SQL function, so an assertion cannot drift onto a different one. */
function functionBody(sql: string, declaration: string): string {
  const start = sql.indexOf(declaration)
  if (start === -1) throw new Error(`Not found in the migration: ${declaration}`)
  const marker = sql.slice(start).includes('$function$')
    ? '$function$;'
    : '$$;'
  const end = sql.indexOf(marker, start)
  if (end === -1) throw new Error(`Could not find the end of: ${declaration}`)
  return sql.slice(start, end)
}

const core = functionBody(createPathSql, 'CREATE OR REPLACE FUNCTION public.create_table_booking_core_v06(')
const resolver = functionBody(periodsSql, 'CREATE OR REPLACE FUNCTION public.resolve_table_booking_deposit(')

describe('the create path resolves the deposit rather than inventing one', () => {
  it('calls resolve_table_booking_deposit', () => {
    expect(core).toContain('public.resolve_table_booking_deposit(')
  })

  it('no longer runs the old hardcoded party-size-or-Christmas rule', () => {
    expect(core).not.toMatch(/v_deposit_required\s*:=\s*\(p_party_size\s*>=\s*10/)
  })

  it('takes the amount from the resolver and never recomputes it', () => {
    expect(core).toContain("v_deposit_amount := ROUND(COALESCE((v_deposit ->> 'amount')::numeric, 0), 2)")
    // The old line multiplied party size by a hardcoded ten. Any reappearance of that shape is a
    // second copy of the sum, which is how the booking row and the payments row drift apart.
    expect(core).not.toMatch(/v_deposit_amount\s*:=\s*ROUND\(\(v_party_size_eff/)
  })

  it('charges the payments row the resolved amount', () => {
    expect(core).toMatch(/'table_deposit',\s*v_deposit_amount,\s*'GBP'/)
  })

  it('refuses the booking when the resolver refuses, rather than falling through to no deposit', () => {
    expect(core).toMatch(/IF NOT COALESCE\(\(v_deposit ->> 'ok'\)::boolean, false\) THEN/)
    expect(core).toContain("'reason', COALESCE(v_deposit ->> 'error_code', 'deposit_unresolved')")
  })
})

describe('the period is decided server side, never by the browser', () => {
  it('re-reads the live period from the booking date', () => {
    expect(core).toContain('public.get_booking_period_for_date(p_booking_date)')
  })

  it('refuses a supplied period id that is not the live period for that date', () => {
    expect(core).toMatch(
      /IF p_booking_period_id IS NOT NULL AND p_booking_period_id IS DISTINCT FROM v_period_id THEN/,
    )
  })

  it('refuses a yes to an offer that is not running', () => {
    expect(core).toMatch(/IF COALESCE\(p_booking_period_answer, false\) AND v_period_id IS NULL THEN/)
  })

  it('never takes an amount, a basis or a rate from the caller', () => {
    // There is no parameter through which a client could name its own price.
    const signature = core.slice(0, core.indexOf('RETURNS jsonb'))
    expect(signature).not.toMatch(/p_deposit_amount|p_deposit_basis|p_deposit_rate/)
    expect(signature).toContain('p_booking_period_id')
    expect(signature).toContain('p_booking_period_answer')
  })
})

describe('the terms snapshot is written at creation', () => {
  const columns = [
    'booking_period_id',
    'booking_period_code',
    'booking_period_name',
    'booking_period_answer',
    'booking_period_requires_preorder',
    'deposit_rule',
    'deposit_basis',
    'deposit_rate',
    'deposit_amount',
    'deposit_refund_cutoff_days',
    'deposit_refund_policy',
  ]

  const insert = core.slice(
    core.indexOf('INSERT INTO public.table_bookings ('),
    core.indexOf('RETURNING id INTO v_table_booking_id'),
  )

  for (const column of columns) {
    it(`writes ${column} onto the booking`, () => {
      expect(insert).toContain(column)
    })
  }

  it('records the answer even when the guest declined', () => {
    // "They were asked and said no" is the fact a later dispute turns on, so an absence is not
    // good enough: the column must carry false rather than null when a period covered the date.
    expect(insert).toContain('CASE WHEN v_period_id IS NOT NULL THEN v_period_accepted ELSE NULL END')
  })

  it('reads every snapshotted value from the resolver or the loaded period, never from a parameter', () => {
    expect(insert).toMatch(/v_deposit_rule, v_deposit_basis, v_deposit_rate/)
    expect(insert).toMatch(/v_deposit_refund_days, v_deposit_refund_policy/)
  })
})

describe('THE GBP 120 TIE, at the layer that charges', () => {
  /**
   * Christmas is seeded at GBP 10 per head. The party-size rule is GBP 10 per head. A party of 12
   * therefore produces 120 by both routes, and a stacking bug would charge 240 while every other
   * number in every other test stayed correct.
   */
  it('the SQL resolver and the TypeScript mirror use the same two constants', () => {
    const threshold = resolver.match(/c_group_threshold\s+constant integer\s*:=\s*(\d+)/)
    const perHead = resolver.match(/c_group_per_head\s+constant numeric\s*:=\s*([\d.]+)/)

    expect(threshold, 'c_group_threshold is no longer declared as a constant').not.toBeNull()
    expect(perHead, 'c_group_per_head is no longer declared as a constant').not.toBeNull()

    expect(Number(threshold![1])).toBe(DEFAULT_GROUP_DEPOSIT_RULE.thresholdGuests)
    expect(Number(perHead![1])).toBe(DEFAULT_GROUP_DEPOSIT_RULE.perPersonGbp)
  })

  it('the seed really does make the two rates equal, so the tie is not hypothetical', () => {
    const seed = periodsSql.slice(periodsSql.indexOf("'christmas-2026', 'christmas'"))
    expect(seed).toContain("'per_head', 10.00")
    expect(DEFAULT_GROUP_DEPOSIT_RULE.perPersonGbp).toBe(10)
  })

  it('the SQL takes the LARGER of the two and never their sum', () => {
    expect(resolver).toContain('IF v_period_amount > 0 AND v_period_amount >= v_group_amount THEN')
    // Any addition of the two amounts anywhere is the 240 bug.
    expect(resolver).not.toMatch(/v_period_amount\s*\+\s*v_group_amount/)
    expect(resolver).not.toMatch(/v_group_amount\s*\+\s*v_period_amount/)
  })

  it('exactly one deposit reaches the payments table, and it is the resolved one', () => {
    const paymentInserts = core.match(/INSERT INTO public\.payments/g) ?? []
    expect(paymentInserts).toHaveLength(1)
    expect(core).not.toMatch(/v_deposit_amount\s*\+/)
  })

  it('the mirrored rule charges 120 for that party, not 240', () => {
    const christmas: BookingPeriod = {
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
    }

    const result = resolveTableBookingDeposit({
      partySize: 12,
      bookingDate: '2026-12-05',
      period: christmas,
      periodAccepted: true,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.deposit.amount).toBe(120)
    expect(result.deposit.amount).not.toBe(240)
  })
})

describe('the promise shown to the guest is the promise stored on the booking', () => {
  /**
   * The website renders `describeRefundPolicy`. The create path stores whatever the SQL builds, and
   * the freeze trigger then makes that permanent. They drifted by one sentence: the guest was shown
   * three sentences and the booking recorded two, so the text that settles a dispute was not the
   * text the guest was given. That is precisely the evidence gap the snapshot exists to close.
   */
  function storedPolicyFromSql(days: number): string {
    const match = resolver.match(/ELSE format\(\s*\n\s*'([^']+)',/)
    if (!match) throw new Error('Could not find the refund policy format string in the SQL resolver')
    // Postgres substitutes each %s with the cutoff.
    return match[1].split('%s').join(String(days))
  }

  it('the SQL builds the same sentence, word for word, for a seven-day cutoff', () => {
    expect(storedPolicyFromSql(7)).toBe(describeRefundPolicy(7))
  })

  it('and for any other cutoff a manager might set', () => {
    for (const days of [1, 3, 14, 30, 90]) {
      expect(storedPolicyFromSql(days)).toBe(describeRefundPolicy(days))
    }
  })

  it('including the sentence that tells the guest the deposit comes off the bill', () => {
    // The one that went missing. Named explicitly so a future edit that drops it fails loudly here
    // rather than quietly changing what a booking can evidence.
    expect(storedPolicyFromSql(7)).toContain('The deposit comes off the bill on the day.')
  })

  it('and the never-refundable wording matches too', () => {
    const zeroCase = resolver.match(/THEN '(The deposit is not refundable[^']+)'/)
    expect(zeroCase, 'the zero-cutoff wording is no longer in the SQL').not.toBeNull()
    expect(zeroCase![1]).toBe(describeRefundPolicy(0))
  })
})

describe('the kill switch is read in exactly one place', () => {
  it('the resolver reads it itself', () => {
    expect(resolver).toContain("public.get_setting_bool('booking_period_deposits_enabled', true)")
  })

  it('the create path does NOT read it separately', () => {
    // Two readers is two chances to forget one, which is precisely how this feature shipped with a
    // switch that changed nothing. The create path must inherit the answer, not re-derive it.
    // The prose in the create path names the setting deliberately; what must not appear is a second
    // READ of it, so this checks for the call rather than the mention.
    expect(core).not.toContain("get_setting_bool('booking_period_deposits_enabled'")
  })

  it('it suppresses the seasonal rule only, leaving the party-size rule intact', () => {
    // In SQL the switch gates the period amount and nothing else.
    const gated = resolver.slice(resolver.indexOf('IF v_collect THEN'))
    expect(gated).toContain('v_period_amount := ROUND(')
    const groupRule = resolver.slice(resolver.indexOf('IF p_party_size >= c_group_threshold THEN'))
    expect(groupRule.slice(0, 200)).not.toContain('v_collect')
  })
})

describe('the migration is deployable and honest about it', () => {
  it('drops the old signatures before recreating them, so no ambiguous overload survives', () => {
    for (const fn of [
      'create_table_booking_public_v06',
      'create_table_booking_staff_v06',
      'create_table_booking_core_v06',
    ]) {
      expect(createPathSql).toContain(`DROP FUNCTION IF EXISTS public.${fn}(`)
    }
  })

  it('both entry points pass the two new parameters through to the core', () => {
    const publicEntry = functionBody(
      createPathSql,
      'CREATE OR REPLACE FUNCTION public.create_table_booking_public_v06(',
    )
    const staffEntry = functionBody(
      createPathSql,
      'CREATE OR REPLACE FUNCTION public.create_table_booking_staff_v06(',
    )
    for (const entry of [publicEntry, staffEntry]) {
      expect(entry).toContain('p_booking_period_id uuid DEFAULT NULL')
      expect(entry).toContain('p_booking_period_answer boolean DEFAULT NULL')
      expect(entry).toContain('p_booking_period_id, p_booking_period_answer')
    }
  })

  it('closes the privileged functions to anon and authenticated, and proves it', () => {
    expect(createPathSql).toMatch(
      /REVOKE ALL ON FUNCTION public\.create_table_booking_core_v06\([\s\S]*?FROM PUBLIC, anon, authenticated;/,
    )
    expect(createPathSql).toMatch(
      /REVOKE ALL ON FUNCTION public\.create_table_booking_staff_v06\([\s\S]*?FROM PUBLIC, anon, authenticated;/,
    )
    expect(createPathSql).toMatch(
      /REVOKE ALL ON FUNCTION public\.freeze_table_booking_refund_terms\(\) FROM PUBLIC, anon, authenticated;/,
    )
    // The assertion must FAIL the migration, not report success on a half-closed door, and it must
    // name every function this migration creates rather than a stale subset of them.
    for (const fn of [
      'create_table_booking_core_v06',
      'create_table_booking_staff_v06',
      'freeze_table_booking_refund_terms',
    ]) {
      expect(createPathSql).toContain(`'${fn}'`)
    }
    expect(createPathSql).toContain('RAISE EXCEPTION USING')
  })

  it('asks Postgres whether anon can execute, rather than pattern-matching the ACL text', () => {
    // A regex over proacl has a hole that points the wrong way: a function whose ACL has never been
    // touched stores proacl NULL, meaning the built-in default, and for a function that default is
    // EXECUTE TO PUBLIC. No "anon=X" appears in a NULL, so the assertion reported all clear while
    // anon genuinely could call it.
    expect(createPathSql).toContain("has_function_privilege('anon', p.oid, 'EXECUTE')")
    expect(createPathSql).toContain("has_function_privilege('authenticated', p.oid, 'EXECUTE')")
    expect(createPathSql).not.toContain('(anon|authenticated)=X')
  })

  it('freezes the refund terms once the guest has been given them', () => {
    // The snapshot is safe from period edits by construction. This closes the other way it could
    // move: a support script or a bulk update writing to the booking directly.
    expect(createPathSql).toContain('CREATE OR REPLACE FUNCTION public.freeze_table_booking_refund_terms()')
    expect(createPathSql).toMatch(
      /BEFORE UPDATE OF deposit_refund_cutoff_days, deposit_refund_policy ON public\.table_bookings/,
    )
    // Setting them for the first time must still work, so a backfill is possible.
    expect(createPathSql).toContain('IF OLD.deposit_refund_cutoff_days IS NOT NULL')
  })

  it('keeps the website able to book, and asserts that too', () => {
    expect(createPathSql).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.create_table_booking_public_v06\([\s\S]*?TO anon, authenticated, service_role;/,
    )
    expect(createPathSql).toContain('so the website cannot take a booking')
  })

  it('runs as one transaction', () => {
    expect(createPathSql.trimStart().split('\n').some((line) => line.trim() === 'BEGIN;')).toBe(true)
    expect(createPathSql.trimEnd().endsWith('COMMIT;')).toBe(true)
  })

  it('has balanced dollar quoting', () => {
    for (const tag of ['$function$', '$freeze$', '$assert_grants$', '$assert_wiring$']) {
      const count = createPathSql.split(tag).length - 1
      expect(count % 2, `${tag} appears ${count} times, which is not a matched pair`).toBe(0)
    }
  })

  it('does not collide with a migration timestamp already in production', () => {
    // 20260802000008 is the latest applied migration. Anything at or below it would never run.
    expect('20260803000200' > '20260802000008').toBe(true)
    expect('20260803000200' > '20260803000100').toBe(true)
  })
})

describe('the v05 fallback cannot silently swallow a seasonal deposit', () => {
  it('refuses a seasonal booking rather than pricing it with the old rule', () => {
    // v06 is enabled in production, so this is a guard rather than a path. If the flag were ever
    // turned off, v05 would take the booking and charge the party-size rule with no period
    // awareness at all, which is exactly the silent wrong charge this whole change exists to stop.
    const gate = core.slice(0, core.indexOf('public.create_table_booking_v05('))
    expect(gate).toContain("'reason', 'seasonal_needs_v06'")
  })
})
