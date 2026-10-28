import { describe, expect, it } from 'vitest'
import { londonVisitAtIso } from '@/lib/dateUtils'

// BK-211: private visits store a date and a London clock time. A naive `${date}T${time}` was read
// in the server's zone (UTC live), an hour late in summer time.
describe('londonVisitAtIso', () => {
  it('reads a summer-time start as London time', () => {
    expect(londonVisitAtIso('2026-07-18', '19:00:00')).toBe('2026-07-18T18:00:00.000Z')
  })

  it('reads a winter start as London time', () => {
    expect(londonVisitAtIso('2026-12-05', '19:00')).toBe('2026-12-05T19:00:00.000Z')
  })

  it('uses London midnight when there is no time', () => {
    expect(londonVisitAtIso('2026-07-18', null)).toBe('2026-07-17T23:00:00.000Z')
  })

  it('returns null without a date', () => {
    expect(londonVisitAtIso(null, '19:00')).toBeNull()
  })
})
