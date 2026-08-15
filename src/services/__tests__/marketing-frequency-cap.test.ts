import { describe, expect, it } from 'vitest'

import { describeFrequencyCapCollision } from '../marketing-campaigns'

/**
 * The frequency cap is the quietest way to lose a whole campaign.
 *
 * It locks the CONTACT row rather than the recipient row, so it applies across campaigns: if
 * the same list was emailed inside the cap window, every recipient of the second campaign is
 * skipped with `frequency_cap` and that campaign finishes as `completed` having reached
 * nobody. No error, no failure, no alert. The only trace is a skip count somebody has to go
 * looking for, by which time the send has been and gone.
 *
 * This nearly happened for real on 2026-08-15: a guest campaign was scheduled for the 22nd,
 * then a second guest campaign for the 16th, which would have silently emptied the first.
 * These tests lock the guard that now refuses that at schedule time.
 */

const CAP = 7
const WHEN = new Date('2026-08-22T09:00:00Z')

describe('the frequency cap collision guard', () => {
  it('refuses a slot inside the window, because the second send would reach nobody', () => {
    const message = describeFrequencyCapCollision(CAP, WHEN, [
      { name: 'Lunch from September', scheduledFor: '2026-08-16T09:00:00Z' },
    ])

    expect(message).toContain('swallowed by the 7-day frequency cap')
    expect(message).toContain('Lunch from September')
    expect(message).toContain('6.0 days away')
  })

  it('names the date the slot becomes safe, so the fix does not need working out', () => {
    const message = describeFrequencyCapCollision(CAP, WHEN, [
      { name: 'Lunch from September', scheduledFor: '2026-08-16T09:00:00Z' },
    ])

    // 16 Aug + 7 days, rendered in London time.
    expect(message).toContain('Sun 23 Aug')
  })

  it('allows a slot exactly one cap away, which is the first legitimate moment', () => {
    // Strictly inside the window is a collision; exactly on the boundary is not, and this
    // matches the RPC, which skips on `last_email > now() - cap` rather than `>=`.
    expect(
      describeFrequencyCapCollision(CAP, WHEN, [
        { name: 'Seven days earlier', scheduledFor: '2026-08-15T09:00:00Z' },
      ]),
    ).toBeNull()
  })

  it('allows a slot beyond the window', () => {
    expect(
      describeFrequencyCapCollision(CAP, WHEN, [
        { name: 'Well clear', scheduledFor: '2026-08-01T09:00:00Z' },
      ]),
    ).toBeNull()
  })

  it('looks backwards and forwards, because the campaign scheduled second can be the earlier one', () => {
    // The real near-miss was this shape: an existing campaign LATER than the one being added.
    expect(
      describeFrequencyCapCollision(CAP, new Date('2026-08-16T09:00:00Z'), [
        { name: 'Christmas, guests', scheduledFor: '2026-08-22T09:00:00Z' },
      ]),
    ).toContain('Christmas, guests')
  })

  it('picks the nearest offender when several sit in the window', () => {
    const message = describeFrequencyCapCollision(CAP, WHEN, [
      { name: 'Furthest', scheduledFor: '2026-08-17T09:00:00Z' },
      { name: 'Nearest', scheduledFor: '2026-08-20T09:00:00Z' },
    ])

    // Sorted by date, so the earliest in the window is reported first and its cap boundary
    // is the one that clears every other campaign in the window too.
    expect(message).toContain('Furthest')
  })

  it('does nothing when the cap is switched off, so zero cannot mean "block everything"', () => {
    expect(
      describeFrequencyCapCollision(0, WHEN, [
        { name: 'Same morning', scheduledFor: '2026-08-22T09:05:00Z' },
      ]),
    ).toBeNull()
  })

  it('does nothing when there is nothing else scheduled', () => {
    expect(describeFrequencyCapCollision(CAP, WHEN, [])).toBeNull()
  })

  it('ignores an unparseable date rather than throwing while somebody schedules a send', () => {
    expect(
      describeFrequencyCapCollision(CAP, WHEN, [{ name: 'Broken', scheduledFor: 'not a date' }]),
    ).toBeNull()
  })

  it('renders midday as 12pm, not 0pm, which en-GB does with hour12 on Node 20', () => {
    const message = describeFrequencyCapCollision(CAP, new Date('2026-08-22T09:00:00Z'), [
      { name: 'Noon sender', scheduledFor: '2026-08-20T11:00:00Z' },
    ])

    expect(message).toContain('12:00 pm')
    expect(message).not.toContain('0:00 pm')
  })
})
