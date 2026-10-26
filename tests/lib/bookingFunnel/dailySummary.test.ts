import { describe, expect, it } from 'vitest'
import { createFakeDb } from '../../helpers/fakeSupabaseDb'
import {
  buildDailyFunnelEmail,
  loadDailyFunnelSummary,
  summaryNeedsSending,
  type DailyFunnelSummary,
} from '@/lib/booking-funnel/daily-summary'

/**
 * BK-101 (customer bookings review of 24 October 2026), owner decision D17: website refusals go
 * to the manager inbox as one summary a day. The summary counts one London day of
 * booking_funnel_events, leaves out keys that cannot make bookings (test and preview traffic,
 * BK-193), and is sent only when something was turned away.
 */

const WEBSITE_KEY = '00000000-0000-4000-8000-0000000000a1'
const TEST_KEY = '00000000-0000-4000-8000-0000000000b2'
const KEYS = [
  { id: WEBSITE_KEY, permissions: ['create:bookings', 'read:table_bookings'] },
  { id: TEST_KEY, permissions: ['read:table_bookings'] },
]

// Sunday 25 October 2026: the clocks went back at 02:00 BST, so the London day runs from
// 2026-10-24T23:00Z to 2026-10-26T00:00Z (25 hours).
function event(at: string, fields: Record<string, unknown>) {
  return { id: `e-${Math.random().toString(16).slice(2)}`, occurred_at: at, source: 'website', api_key_id: WEBSITE_KEY, ...fields }
}

const EVENTS = [
  event('2026-10-24T22:59:59.000Z', { stage: 'refused', route: 'api/table-bookings', reason_code: 'OUTSIDE_HOURS' }),
  event('2026-10-24T23:00:00.000Z', { stage: 'refused', route: 'api/table-bookings', reason_code: 'OUTSIDE_HOURS' }),
  event('2026-10-25T09:00:00.000Z', { stage: 'refused', route: 'api/table-bookings', reason_code: 'OUTSIDE_HOURS' }),
  event('2026-10-25T10:00:00.000Z', { stage: 'refused', route: 'api/table-bookings', reason_code: 'SECURITY_CHECK_MISSING', http_status: 403 }),
  event('2026-10-25T11:00:00.000Z', { stage: 'failed', route: 'api/event-bookings', reason_code: 'CONTRACT_DRIFT', upstream_code: 'PRICE_CHANGED' }),
  event('2026-10-25T23:30:00.000Z', { stage: 'refused', route: 'api/event-waitlist', reason_code: 'VALIDATION_FAILED' }),
  event('2026-10-26T00:00:00.000Z', { stage: 'refused', route: 'api/table-bookings', reason_code: 'OUTSIDE_HOURS' }),
  event('2026-10-25T12:00:00.000Z', { stage: 'refused', route: 'api/table-bookings', reason_code: 'OUTSIDE_HOURS', api_key_id: TEST_KEY }),
  event('2026-10-25T12:00:00.000Z', { stage: 'form', route: 'event_booking', reason_code: 'opened' }),
  event('2026-10-25T12:01:00.000Z', { stage: 'form', route: 'event_booking', reason_code: 'opened' }),
  event('2026-10-25T12:02:00.000Z', { stage: 'form', route: 'event_booking', reason_code: 'submit_pressed' }),
  event('2026-10-25T12:02:01.000Z', { stage: 'form', route: 'event_booking', reason_code: 'blocked', upstream_code: 'no_security_token' }),
  event('2026-10-25T13:00:00.000Z', { source: 'ams', stage: 'availability', route: 'table-bookings/load', purpose: 'drinks', calculation_state: 'complete', slots_offered: 6 }),
  event('2026-10-25T13:00:00.000Z', { source: 'ams', stage: 'availability', route: 'table-bookings/load', purpose: 'food', calculation_state: 'complete', slots_offered: 0 }),
  event('2026-10-25T13:05:00.000Z', { source: 'ams', stage: 'availability', route: 'table-bookings/load', purpose: 'drinks', calculation_state: 'complete', slots_offered: 0 }),
  event('2026-10-25T13:10:00.000Z', { source: 'ams', stage: 'availability', route: 'table-bookings/load', purpose: 'drinks', calculation_state: 'unknown', slots_offered: 0 }),
  event('2026-10-25T13:15:00.000Z', { source: 'ams', stage: 'availability', route: 'table-bookings/load', purpose: 'drinks', calculation_state: 'unknown', slots_offered: 0, api_key_id: TEST_KEY }),
]

describe('loadDailyFunnelSummary', () => {
  it('counts one London day, across the clocks going back, and leaves out the test key', async () => {
    const db = createFakeDb({ api_keys: KEYS, booking_funnel_events: EVENTS })

    const summary = await loadDailyFunnelSummary(db.client as never, '2026-10-25')

    expect(summary.refusedTotal).toBe(4)
    expect(summary.failedTotal).toBe(1)
    expect(summary.availability).toEqual({ searches: 3, noTables: 1, couldNotCheck: 1 })
    expect(summary.refusals).toEqual([
      { route: 'api/event-bookings', stage: 'failed', reason: 'CONTRACT_DRIFT', upstreamCode: 'PRICE_CHANGED', count: 1 },
      { route: 'api/table-bookings', stage: 'refused', reason: 'OUTSIDE_HOURS', upstreamCode: null, count: 2 },
      { route: 'api/event-waitlist', stage: 'refused', reason: 'VALIDATION_FAILED', upstreamCode: null, count: 1 },
      { route: 'api/table-bookings', stage: 'refused', reason: 'SECURITY_CHECK_MISSING', upstreamCode: null, count: 1 },
    ])
    expect(summary.forms).toEqual([
      { form: 'event_booking', step: 'blocked', reason: 'no_security_token', count: 1 },
      { form: 'event_booking', step: 'opened', reason: null, count: 2 },
      { form: 'event_booking', step: 'submit_pressed', reason: null, count: 1 },
    ])
    expect(summaryNeedsSending(summary)).toBe(true)
  })

  it('has nothing to send on a quiet day', async () => {
    const db = createFakeDb({
      api_keys: KEYS,
      booking_funnel_events: [EVENTS[12], EVENTS[8]],
    })
    const summary = await loadDailyFunnelSummary(db.client as never, '2026-10-25')

    expect(summary.availability.searches).toBe(1)
    expect(summaryNeedsSending(summary)).toBe(false)
  })

  it('says it cannot count when no key can make bookings', async () => {
    const db = createFakeDb({ api_keys: [KEYS[1]], booking_funnel_events: EVENTS })
    const summary = await loadDailyFunnelSummary(db.client as never, '2026-10-25')

    expect(summary.readError).toMatch(/No API key that can make bookings/)
    expect(summaryNeedsSending(summary)).toBe(true)
  })
})

describe('buildDailyFunnelEmail', () => {
  it('renders fixture data in plain English with no undefined, NaN, Invalid Date or long dash', async () => {
    const db = createFakeDb({ api_keys: KEYS, booking_funnel_events: EVENTS })
    const summary = await loadDailyFunnelSummary(db.client as never, '2026-10-25')
    const email = buildDailyFunnelEmail(summary, 'https://management.example/table-bookings/reports')

    expect(email.subject).toBe('Website bookings turned away on Sunday 25 October: 4 refused, 1 failed, 1 availability check failed')
    for (const part of [email.subject, email.html, email.text]) {
      expect(part).not.toMatch(/undefined|NaN|Invalid Date|null/)
      expect(part).not.toContain(String.fromCharCode(8212))
    }
    expect(email.text).toContain(
      '- Event bookings: Failed, the management app refused something the website had accepted, so the two disagree about the rules (code PRICE_CHANGED). 1 time.',
    )
    expect(email.text).toContain('- Table bookings: Refused, a time outside online booking hours. 2 times.')
    expect(email.text).toContain('- Table bookings: Refused, no security check token: the check never loaded or was not finished. 1 time.')
    expect(email.text).toContain('- Table searches: 3.')
    expect(email.text).toContain('- Could not check (the guest was asked to try again or ring): 1.')
    expect(email.text).toContain(
      '- Event booking form: opened 2, submit pressed 1, blocked before sending 1 (no security token 1), sent 0.',
    )
    expect(email.text).toContain('https://management.example/table-bookings/reports')
  })

  it('escapes what it prints', () => {
    const summary: DailyFunnelSummary = {
      date: '2026-10-25',
      refusals: [{ route: 'api/<x>', stage: 'refused', reason: 'A<b', upstreamCode: null, count: 1 }],
      refusedTotal: 1,
      failedTotal: 0,
      availability: { searches: 0, noTables: 0, couldNotCheck: 0 },
      forms: [],
      truncated: false,
      readError: null,
    }
    const email = buildDailyFunnelEmail(summary, null)

    expect(email.html).not.toContain('<x>')
    expect(email.html).toContain('api/&lt;x&gt;')
    expect(email.text).toContain('The weekly funnel is on Table Bookings, Reports.')
  })
})
