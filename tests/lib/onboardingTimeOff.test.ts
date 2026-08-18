import { describe, expect, it } from 'vitest'
import {
  getTimeOffDateBounds,
  MAX_BLOCKS,
  validateTimeOffBlocks,
} from '@/lib/leave/onboarding-time-off'

const TODAY = '2026-08-18'
const allowedTypes = new Set(['holiday', 'unavailable'])
const opts = { allowedTypes, today: TODAY }

const block = (startDate: string, endDate: string, leaveType = 'holiday', note?: string) => ({
  startDate,
  endDate,
  leaveType,
  note,
})

describe('getTimeOffDateBounds', () => {
  it('accepts today through to twelve months ahead', () => {
    expect(getTimeOffDateBounds(TODAY)).toEqual({
      minDate: '2026-08-18',
      maxDate: '2027-08-18',
    })
  })
})

describe('validateTimeOffBlocks', () => {
  it('accepts a normal booking', () => {
    expect(validateTimeOffBlocks([block('2026-09-01', '2026-09-07')], opts)).toBeNull()
  })

  it('accepts an empty submission, which is what "nothing booked" sends', () => {
    expect(validateTimeOffBlocks([], opts)).toBeNull()
  })

  it('rejects an end date before the start date', () => {
    expect(validateTimeOffBlocks([block('2026-09-07', '2026-09-01')], opts))
      .toEqual({ code: 'TIME_OFF_INVALID_RANGE', blockIndex: 0 })
  })

  it('rejects dates that have already passed', () => {
    expect(validateTimeOffBlocks([block('2026-08-17', '2026-08-19')], opts))
      .toEqual({ code: 'TIME_OFF_IN_PAST', blockIndex: 0 })
  })

  it('accepts today itself', () => {
    expect(validateTimeOffBlocks([block(TODAY, TODAY)], opts)).toBeNull()
  })

  it('rejects dates beyond the twelve month horizon', () => {
    expect(validateTimeOffBlocks([block('2027-08-01', '2027-08-20')], opts))
      .toEqual({ code: 'TIME_OFF_TOO_FAR_AHEAD', blockIndex: 0 })
  })

  it('rejects a single block longer than sixty days', () => {
    expect(validateTimeOffBlocks([block('2026-09-01', '2026-11-05')], opts))
      .toEqual({ code: 'TIME_OFF_TOO_LONG', blockIndex: 0 })
  })

  it('rejects an unknown leave type', () => {
    expect(validateTimeOffBlocks([block('2026-09-01', '2026-09-02', 'sabbatical')], opts))
      .toEqual({ code: 'TIME_OFF_UNKNOWN_TYPE', blockIndex: 0 })
  })

  it('rejects overlapping blocks and names the offending one', () => {
    const problem = validateTimeOffBlocks(
      [block('2026-09-01', '2026-09-10'), block('2026-09-08', '2026-09-12')],
      opts,
    )
    expect(problem).toEqual({ code: 'TIME_OFF_OVERLAP', blockIndex: 1 })
  })

  it('allows two blocks that touch without overlapping', () => {
    expect(validateTimeOffBlocks(
      [block('2026-09-01', '2026-09-05'), block('2026-09-06', '2026-09-10')],
      opts,
    )).toBeNull()
  })

  it('rejects more blocks than the form allows', () => {
    const many = Array.from({ length: MAX_BLOCKS + 1 }, (_, i) => {
      const day = String(i * 2 + 1).padStart(2, '0')
      return block(`2026-10-${day}`, `2026-10-${day}`)
    })
    expect(validateTimeOffBlocks(many, opts)?.code).toBe('TIME_OFF_TOO_MANY')
  })

  it('rejects a note longer than the limit', () => {
    expect(validateTimeOffBlocks([block('2026-09-01', '2026-09-02', 'holiday', 'x'.repeat(201))], opts))
      .toEqual({ code: 'TIME_OFF_NOTE_TOO_LONG', blockIndex: 0 })
  })

  it('rejects a submission whose blocks add up past the total cap', () => {
    // Four blocks of 55 days each is 220, over the 200 day total.
    const blocks = [
      block('2026-09-01', '2026-10-25'),
      block('2026-10-26', '2026-12-19'),
      block('2026-12-20', '2027-02-12'),
      block('2027-02-13', '2027-04-08'),
    ]
    expect(validateTimeOffBlocks(blocks, opts)?.code).toBe('TIME_OFF_TOTAL_TOO_LONG')
  })
})
