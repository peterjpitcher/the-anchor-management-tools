import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * The website-facing seasonal period endpoint.
 *
 * Two things here are worth more than the rest of the file put together:
 *
 *   1. THE TIE. The Christmas deposit is GBP 10 per head, which is exactly the existing
 *      10-or-more party rate. A party of 12 therefore comes to GBP 120 under BOTH rules, so a
 *      stacking bug would bill GBP 240 and look completely normal in casual testing, because
 *      every other figure on the page would still be right. It is asserted explicitly.
 *   2. AN INACTIVE PERIOD IS INERT. The seeded Christmas period ships switched off, so the
 *      endpoint must behave as though it does not exist: no question, no deposit, no menu.
 *      That is proved here at the HTTP boundary, not only in the resolver.
 */

type QueryResult = { data: unknown; error: unknown }

const state = {
  period: null as Record<string, unknown> | null,
  periodError: null as unknown,
  menu: [] as Record<string, unknown>[],
  menuError: null as unknown,
  /** The system_settings row as stored: the jsonb column wraps the value, {"value": true}. */
  settingsRow: { value: { value: true } } as Record<string, unknown> | null,
  settingsError: null as unknown,
}

/** Every filter the route applies, so the test can prove the live-only query was really built. */
const calls = {
  tables: [] as string[],
  periodFilters: [] as string[],
}

function chainFor(table: string, resolve: () => QueryResult) {
  const chain: Record<string, unknown> = {}
  const record = (name: string) => (...args: unknown[]) => {
    if (table === 'booking_periods') {
      calls.periodFilters.push(`${name}(${args.map((a) => String(a)).join(',')})`)
    }
    return chain
  }
  chain.eq = vi.fn(record('eq'))
  chain.is = vi.fn(record('is'))
  chain.lte = vi.fn(record('lte'))
  chain.gte = vi.fn(record('gte'))
  chain.order = vi.fn(record('order'))
  chain.maybeSingle = vi.fn(() => Promise.resolve(resolve()))
  // The menu query is awaited directly with no maybeSingle, so the chain must be thenable.
  chain.then = (onFulfilled: (v: QueryResult) => unknown) => Promise.resolve(resolve()).then(onFulfilled)
  return chain
}

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({
    from: vi.fn((table: string) => {
      calls.tables.push(table)
      return {
        select: vi.fn(() => {
          if (table === 'booking_periods') {
            return chainFor(table, () => ({ data: state.period, error: state.periodError }))
          }
          if (table === 'booking_period_menu_items') {
            return chainFor(table, () => ({ data: state.menu, error: state.menuError }))
          }
          return chainFor(table, () => ({ data: state.settingsRow, error: state.settingsError }))
        }),
      }
    }),
  })),
}))

// Keep createApiResponse and createErrorResponse real; only bypass the API-key layer.
vi.mock('@/lib/api/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/auth')>()
  return {
    ...actual,
    withApiAuth: vi.fn(
      (
        handler: (req: Request, apiKey: { id: string }) => Promise<Response>,
        _scopes: string[],
        req: Request,
      ) => handler(req, { id: 'test-key' }),
    ),
  }
})

import { GET } from './route'
import { withApiAuth } from '@/lib/api/auth'

/** The seeded Christmas period, as the database row the route actually reads. */
const CHRISTMAS_ROW = {
  id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  code: 'christmas-2026',
  period_kind: 'christmas',
  name: 'Christmas dinner 2026',
  starts_on: '2026-11-10',
  ends_on: '2026-12-20',
  guest_question: 'Is this a Christmas dinner booking?',
  guest_blurb: 'Our festive set menu, 10 November to 20 December.',
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

const TURKEY = {
  id: '11111111-2222-3333-4444-555555555555',
  course: 'main',
  name: 'Roast turkey',
  description: 'With all the trimmings',
  price_gbp: '24.95',
  allergens: 'Gluten',
  sort_order: 1,
  is_active: true,
}

function makeRequest(query: string) {
  return new NextRequest(`http://localhost/api/table-bookings/periods${query}`, {
    method: 'GET',
    headers: { 'X-API-Key': 'test-key' },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  calls.tables = []
  calls.periodFilters = []
  state.period = { ...CHRISTMAS_ROW }
  state.periodError = null
  state.menu = [{ ...TURKEY }]
  state.menuError = null
  state.settingsRow = { value: { value: true } }
  state.settingsError = null
})

describe('GET /api/table-bookings/periods', () => {
  it('is guarded by the same API key scope as the other website-facing routes', async () => {
    await GET(makeRequest('?date=2026-12-05'))
    expect(vi.mocked(withApiAuth)).toHaveBeenCalledWith(
      expect.any(Function),
      ['read:table_bookings'],
      expect.anything(),
    )
  })

  it('rejects a missing, malformed or impossible date', async () => {
    expect((await GET(makeRequest(''))).status).toBe(400)
    expect((await GET(makeRequest('?date=05-12-2026'))).status).toBe(400)
    expect((await GET(makeRequest('?date=2026-02-30'))).status).toBe(400)
  })

  it('rejects a party size outside the bookable range', async () => {
    expect((await GET(makeRequest('?date=2026-12-05&party_size=0'))).status).toBe(400)
    expect((await GET(makeRequest('?date=2026-12-05&party_size=201'))).status).toBe(400)
    expect((await GET(makeRequest('?date=2026-12-05&party_size=abc'))).status).toBe(400)
  })

  it('only ever looks at live, unarchived periods covering the date', async () => {
    await GET(makeRequest('?date=2026-12-05'))
    expect(calls.periodFilters).toEqual([
      'eq(is_active,true)',
      'is(archived_at,null)',
      'lte(starts_on,2026-12-05)',
      'gte(ends_on,2026-12-05)',
    ])
  })

  it('says there is no period when none is live for that date', async () => {
    state.period = null
    const res = await GET(makeRequest('?date=2026-06-15&party_size=12'))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.data.period).toBeNull()
    expect(json.data.deposit).toBeNull()
    // An inactive period looks exactly like no period at all: the guest is never told it exists.
    expect(calls.tables).not.toContain('booking_period_menu_items')
  })

  it('describes a live period without a deposit until a party size is supplied', async () => {
    const res = await GET(makeRequest('?date=2026-12-05'))
    const json = await res.json()

    expect(json.data.period.code).toBe('christmas-2026')
    expect(json.data.period.period_kind).toBe('christmas')
    expect(json.data.period.guest_question).toBe('Is this a Christmas dinner booking?')
    expect(json.data.period.bookable).toBe(true)
    expect(json.data.period.menu).toEqual([
      {
        id: TURKEY.id,
        course: 'main',
        name: 'Roast turkey',
        description: 'With all the trimmings',
        price_gbp: 24.95,
        allergens: 'Gluten',
      },
    ])
    expect(json.data.deposit).toBeNull()
  })

  it('THE TIE: a party of 12 is quoted GBP 120 once, never GBP 240', async () => {
    const res = await GET(makeRequest('?date=2026-12-05&party_size=12'))
    const json = await res.json()

    // GBP 10 per head across 12 guests is 120 by the period rule AND 120 by the 10-or-more rule.
    // One charge, not the sum of two.
    expect(json.data.deposit.if_accepted.amount).toBe(120)
    expect(json.data.deposit.if_accepted.amount).not.toBe(240)
    expect(json.data.deposit.if_accepted.rule).toBe('period')
    expect(json.data.deposit.if_accepted.required).toBe(true)
    expect(json.data.deposit.if_accepted.refund_cutoff_days).toBe(7)
    expect(json.data.deposit.if_accepted.refund_policy).toContain('Full refund up to 7 days')
  })

  it('gives a guest who says no the normal menu at normal terms', async () => {
    const res = await GET(makeRequest('?date=2026-12-05&party_size=12'))
    const json = await res.json()

    // Declining in December is a supported answer: the 10-or-more rule still applies, the
    // seasonal one does not, and the total is the same single 120.
    expect(json.data.deposit.if_declined.amount).toBe(120)
    expect(json.data.deposit.if_declined.rule).toBe('group')
  })

  it('charges a small festive party on the period rule alone', async () => {
    const res = await GET(makeRequest('?date=2026-12-05&party_size=8'))
    const json = await res.json()

    expect(json.data.deposit.if_accepted.amount).toBe(80)
    expect(json.data.deposit.if_accepted.rule).toBe('period')
    // The same eight guests owe nothing if they are not having the festive menu.
    expect(json.data.deposit.if_declined.amount).toBe(0)
    expect(json.data.deposit.if_declined.rule).toBe('none')
  })

  it('explains a party outside the period limits instead of pricing it', async () => {
    const res = await GET(makeRequest('?date=2026-12-05&party_size=4'))
    const json = await res.json()

    expect(json.data.deposit.if_accepted).toBeNull()
    expect(json.data.deposit.if_accepted_rejection.code).toBe('period_party_too_small')
    expect(json.data.deposit.if_declined.amount).toBe(0)
  })

  it('never shows an empty menu: a pre-order period with no dishes is not bookable', async () => {
    state.menu = []
    const res = await GET(makeRequest('?date=2026-12-05&party_size=12'))
    const json = await res.json()

    expect(json.data.period.bookable).toBe(false)
    expect(json.data.period.not_bookable_reason).toBe('menu_not_ready')
    expect(json.data.period.not_bookable_message).toContain('has not been published yet')
    expect(json.data.period.menu).toEqual([])
    // Nothing is quoted for an offer that cannot be accepted.
    expect(json.data.deposit.if_accepted).toBeNull()
    expect(json.data.deposit.if_accepted_rejection).toBeNull()
    // The ordinary terms still stand, because the guest can still book a normal table.
    expect(json.data.deposit.if_declined.amount).toBe(120)
  })

  it('quotes nothing when the kill switch is off, because nothing will be charged', async () => {
    // This used to assert the figure was "still worked out while collection is paused", priced for
    // a party of 12, where the large-group rule gives GBP 120 whatever the switch does. So it
    // passed while the endpoint quoted a seasonal deposit the create path would never take: switch
    // off, a party of 6 was shown GBP 60 and charged GBP 0. Six isolates the seasonal rule.
    state.settingsRow = { value: { value: false } }
    const res = await GET(makeRequest('?date=2026-12-05&party_size=6'))
    const json = await res.json()

    expect(json.data.deposit.collect).toBe(false)
    expect(json.data.deposit.if_accepted.required).toBe(false)
    expect(json.data.deposit.if_accepted.amount).toBe(0)
  })

  it('quotes the seasonal deposit when the switch is on', async () => {
    state.settingsRow = { value: { value: true } }
    const res = await GET(makeRequest('?date=2026-12-05&party_size=6'))
    const json = await res.json()

    expect(json.data.deposit.collect).toBe(true)
    expect(json.data.deposit.if_accepted.amount).toBe(60)
  })

  it('with the switch off, a large party still owes the large-group deposit', async () => {
    // The kill switch stops seasonal collection only. The deposit big parties have always paid is
    // a different rule and must be quoted exactly as before.
    state.settingsRow = { value: { value: false } }
    const res = await GET(makeRequest('?date=2026-12-05&party_size=12'))
    const json = await res.json()

    expect(json.data.deposit.if_accepted.amount).toBe(120)
    expect(json.data.deposit.if_accepted.rule).toBe('group')
  })

  it('an OFF switch stays off even if the row was written unwrapped', async () => {
    // A switch a manager turned off must never read back as on because of a storage shape.
    state.settingsRow = { value: false }
    const res = await GET(makeRequest('?date=2026-12-05&party_size=12'))
    const json = await res.json()
    expect(json.data.deposit.collect).toBe(false)
  })

  it('defaults to collecting when the switch has never been set', async () => {
    state.settingsRow = null
    const res = await GET(makeRequest('?date=2026-12-05&party_size=12'))
    const json = await res.json()
    expect(json.data.deposit.collect).toBe(true)
  })

  it('assumes collection is ON when the switch cannot be read, matching what the database assumes', async () => {
    // This used to report "not collecting" on an unreadable switch, on the reasoning that not
    // taking money is the safe side. It is not, because the layer that takes the money disagrees:
    // resolve_table_booking_deposit reads the same setting with a default of TRUE and charges. The
    // website would then hide the payment step from a guest the database had just put into
    // pending_payment, and their hold would expire with nobody having been asked for anything.
    state.settingsError = new Error('permission denied')
    const res = await GET(makeRequest('?date=2026-12-05&party_size=12'))
    const json = await res.json()
    expect(json.data.deposit.collect).toBe(true)
  })

  it('fails cleanly when the period lookup errors', async () => {
    state.periodError = new Error('connection reset')
    const res = await GET(makeRequest('?date=2026-12-05'))
    expect(res.status).toBe(500)
  })

  it('does not match on the word Christmas anywhere', async () => {
    // A manager may rename the period to anything. Nothing in the response contract may depend
    // on the display name, so a rename must change only the name.
    state.period = { ...CHRISTMAS_ROW, name: 'Festive feasting' }
    const res = await GET(makeRequest('?date=2026-12-05&party_size=12'))
    const json = await res.json()

    expect(json.data.period.name).toBe('Festive feasting')
    expect(json.data.period.period_kind).toBe('christmas')
    expect(json.data.period.code).toBe('christmas-2026')
    expect(json.data.deposit.if_accepted.amount).toBe(120)
  })
})
