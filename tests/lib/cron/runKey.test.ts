import { describe, expect, it } from 'vitest'
import { utcBucketRunKey } from '@/lib/cron/run-key'

// BK-208: on 25 October 2026 the clocks went back at 02:00 BST. 00:15 UTC and 01:15 UTC both read
// 01:15 on a London clock, so the London-built key repeated and the second hour of runs skipped.
describe('utcBucketRunKey', () => {
  it('gives the repeated London hour two different keys', () => {
    const first = utcBucketRunKey(new Date('2026-10-25T00:15:00Z'), 15)
    const second = utcBucketRunKey(new Date('2026-10-25T01:15:00Z'), 15)

    expect(first).toBe('utc:2026-10-25T00:15')
    expect(second).toBe('utc:2026-10-25T01:15')
    expect(first).not.toBe(second)
  })

  it('buckets to the interval', () => {
    expect(utcBucketRunKey(new Date('2026-10-27T09:44:59Z'), 15)).toBe('utc:2026-10-27T09:30')
  })

  it('cannot match an old London-clock key', () => {
    // In summer time the old key for the 10:00 London run was '2026-07-01T10:00'. The prefix keeps
    // the new 10:00 UTC key distinct from it.
    expect(utcBucketRunKey(new Date('2026-07-01T10:00:00Z'), 15)).not.toBe('2026-07-01T10:00')
  })
})
