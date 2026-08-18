import { describe, expect, it } from 'vitest'
import { COUNTING_SHIFT_STATUS, countsTowardCost, countsTowardHours } from '@/lib/rota/shift-counting'

describe('countsTowardHours', () => {
  it('counts a scheduled shift', () => {
    expect(countsTowardHours({ status: 'scheduled' })).toBe(true)
    expect(COUNTING_SHIFT_STATUS).toBe('scheduled')
  })

  it('does not count an absence marker', () => {
    // Stored as a 00:00:00 row with status 'sick'. The old
    // status !== 'cancelled' filters added 24 phantom hours for each one.
    expect(countsTowardHours({ status: 'sick' })).toBe(false)
  })

  it('does not count a cancelled shift', () => {
    expect(countsTowardHours({ status: 'cancelled' })).toBe(false)
  })

  it('does not count a status it has never seen, because the rule is positive', () => {
    expect(countsTowardHours({ status: 'no_show' })).toBe(false)
    expect(countsTowardHours({ status: '' })).toBe(false)
    expect(countsTowardHours({ status: null })).toBe(false)
    expect(countsTowardHours({ status: undefined })).toBe(false)
  })
})

describe('countsTowardCost', () => {
  it('agrees with countsTowardHours on every status', () => {
    for (const status of ['scheduled', 'sick', 'cancelled', 'no_show', null, undefined]) {
      expect(countsTowardCost({ status })).toBe(countsTowardHours({ status }))
    }
  })

  it('costs only scheduled shifts', () => {
    expect(countsTowardCost({ status: 'scheduled' })).toBe(true)
    expect(countsTowardCost({ status: 'sick' })).toBe(false)
    expect(countsTowardCost({ status: 'cancelled' })).toBe(false)
  })
})
