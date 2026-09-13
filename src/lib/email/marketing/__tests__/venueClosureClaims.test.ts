import { describe, expect, it } from 'vitest'

import { BLOCK_REGISTRY } from '../registry'
import { findVenueClosureClaims } from '../venueClosureClaims'

/**
 * The sentence this guard exists for went out in a draft the owner read:
 *
 *   "We are open from midday every day except Monday"
 *
 * Every fact in it is true, so no amount of checking copy against the hours records would
 * have caught it. It is the grammar that misleads. These tests pin both halves: the phrasing
 * rule that needs no data, and the factual rule that does.
 */

/** The Anchor opens every day. Monday from 4pm, the rest from midday. */
const OPEN_EVERY_DAY = new Set([0, 1, 2, 3, 4, 5, 6])

describe('the sentence that started this', () => {
  it('is reported', () => {
    const claims = findVenueClosureClaims('We are open from midday every day except Monday.')
    expect(claims).toHaveLength(1)
    expect(claims[0].kind).toBe('exception-phrasing')
    expect(claims[0].weekday).toBe('Monday')
  })

  it('is still reported when a later clause in the same sentence mentions the kitchen', () => {
    // The original ran on into "and the kitchen times for each day are further down". Splitting
    // on full stops alone would let that word exempt the whole sentence, which is the one
    // failure mode that would make this guard worthless.
    const claims = findVenueClosureClaims(
      'We are open from midday every day except Monday, and the kitchen times for each day are further down this email.',
    )
    expect(claims.map((claim) => claim.kind)).toEqual(['exception-phrasing'])
  })

  it('passes once it is rewritten the way the message suggests', () => {
    const fixed =
      'We are open seven days a week, from midday Tuesday to Sunday and from 4pm on Mondays. The kitchen times for each day are further down this email.'
    expect(findVenueClosureClaims(fixed, OPEN_EVERY_DAY)).toEqual([])
  })
})

describe('the phrasing rule', () => {
  it.each([
    'Open every day except Monday',
    'We are here all week apart from Sundays',
    'Every day other than Tuesday',
    'Open all week but not Monday',
  ])('reports %s, because an exception hung off a day reads as a closure', (copy) => {
    expect(findVenueClosureClaims(copy)).toHaveLength(1)
  })

  it('needs no hours records, because the phrasing is wrong whatever they say', () => {
    // Deliberately no second argument. This is what the pure content lint can call.
    expect(findVenueClosureClaims('Open every day except Monday')).toHaveLength(1)
  })

  it('leaves an exception alone when it names something that is not a weekday', () => {
    expect(findVenueClosureClaims('Open every day except Christmas Day', OPEN_EVERY_DAY)).toEqual([])
  })
})

describe('the factual rule', () => {
  it('reports a plain closure claim that the hours records contradict', () => {
    const claims = findVenueClosureClaims('The pub is closed on Mondays.', OPEN_EVERY_DAY)
    expect(claims).toHaveLength(1)
    expect(claims[0].kind).toBe('contradicts-hours')
  })

  it('says nothing without the records, because a closure claim can be perfectly true', () => {
    expect(findVenueClosureClaims('The pub is closed on Mondays.')).toEqual([])
  })

  it('accepts a closure claim the records agree with', () => {
    const closedMondays = new Set([0, 2, 3, 4, 5, 6])
    expect(findVenueClosureClaims('The pub is closed on Mondays.', closedMondays)).toEqual([])
  })
})

describe('claims about the kitchen', () => {
  it.each([
    'The kitchen is closed on Mondays',
    'Food is served every day except Monday',
    'No roast on a Monday, the kitchen is shut',
  ])('leaves %s alone, because the kitchen really is shut then', (copy) => {
    expect(findVenueClosureClaims(copy, OPEN_EVERY_DAY)).toEqual([])
  })
})

describe('a dated closure', () => {
  it('is not treated as a claim about every Friday', () => {
    // opening_hours_dates writes exactly this for Christmas Day.
    expect(findVenueClosureClaims('Fri 25 Dec: Closed. Christmas Day.', OPEN_EVERY_DAY)).toEqual([])
  })

  it('still catches a bare weekday beside the same word', () => {
    expect(findVenueClosureClaims('We are closed Friday.', OPEN_EVERY_DAY)).toHaveLength(1)
  })
})

describe('every block in the library', () => {
  it('produces plain text this guard accepts, so it cannot fight our own markup', () => {
    // opening_hours_week legitimately writes "Monday: bar 4pm to 10pm; kitchen closed". A guard
    // that flagged the block drawn for this exact job would be switched off within a month.
    const offenders = Object.entries(BLOCK_REGISTRY).flatMap(([type, block]) =>
      findVenueClosureClaims(block.text(block.sample), OPEN_EVERY_DAY).map(
        (claim) => `${type}: ${claim.message}`,
      ),
    )
    expect(offenders).toEqual([])
  })
})
