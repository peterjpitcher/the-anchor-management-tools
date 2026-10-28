import { describe, expect, it } from 'vitest'
import { describeMergeBlock, describeMergeCounts } from '@/lib/customers/merge-summary'

/** The merge preview and result in staff words (BK-164). */
describe('describeMergeCounts', () => {
  it('lists what moves in plain words, largest first', () => {
    expect(describeMergeCounts({ table_bookings: 2, messages: 3, guest_tokens: 1, customer_consents: 0 })).toEqual([
      '3 text messages',
      '2 table bookings',
      '1 guest link',
    ])
  })

  it('falls back to the table name for a table added later, and copes with nothing', () => {
    expect(describeMergeCounts({ zz_added_later: 1 })).toEqual(['1 zz added later'])
    expect(describeMergeCounts(undefined)).toEqual([])
    expect(describeMergeCounts({})).toEqual([])
  })
})

describe('describeMergeBlock', () => {
  it('says what staff need to do for each refusal', () => {
    expect(describeMergeBlock('both_booked_same_event')).toBe(
      'Both records are booked on the same event. Cancel one of those bookings first.',
    )
    expect(describeMergeBlock('merge_anonymised')).toBe('This customer has already been deleted or merged.')
    expect(describeMergeBlock('same_customer')).toBe('Choose a different customer to merge into.')
    expect(describeMergeBlock('something_new')).toBe('These two customers cannot be merged.')
  })
})
