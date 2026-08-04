/**
 * The pre-order cutoff, pinned.
 *
 * The rule is "noon London, N days before the booking", and both halves are easy to get subtly
 * wrong: subtracting days in UTC milliseconds slides the wall time by an hour across a clock change,
 * and reading the result on a London laptop hides it. The tests below use bookings either side of
 * the October change for exactly that reason. See vitest.config.ts, which pins the test timezone.
 */

import { describe, expect, it } from 'vitest'
import { resolvePreorderCutoff } from '../preorder-data'

describe('resolvePreorderCutoff', () => {
  it('is noon London seven days before a booking in GMT', () => {
    expect(resolvePreorderCutoff('2026-12-24', 7).at?.toISOString()).toBe('2026-12-17T12:00:00.000Z')
  })

  it('is noon London seven days before a booking in BST', () => {
    expect(resolvePreorderCutoff('2026-07-20', 7).at?.toISOString()).toBe('2026-07-13T11:00:00.000Z')
  })

  it('does not slide when the seven days span the clocks going back', () => {
    expect(resolvePreorderCutoff('2026-11-01', 7).at?.toISOString()).toBe('2026-10-25T12:00:00.000Z')
  })

  it('closes the form the moment the cutoff passes', () => {
    expect(resolvePreorderCutoff('2026-12-24', 7, new Date('2026-12-17T11:59:00Z')).editable).toBe(true)
    expect(resolvePreorderCutoff('2026-12-24', 7, new Date('2026-12-17T12:00:01Z')).editable).toBe(false)
  })

  it('is noon on the day itself when the cutoff is zero days', () => {
    expect(resolvePreorderCutoff('2026-12-24', 0).at?.toISOString()).toBe('2026-12-24T12:00:00.000Z')
  })

  it('leaves the form open when the period has gone, rather than locking the guest out', () => {
    const resolved = resolvePreorderCutoff('2026-12-24', null)
    expect(resolved.at).toBeNull()
    expect(resolved.editable).toBe(true)
  })
})
