import { describe, expect, it } from 'vitest'
import { matchesPhoneSearch } from '../search-match'

describe('matchesPhoneSearch (BK-180)', () => {
  it('finds a +44 number typed as 07', () => {
    expect(matchesPhoneSearch('07700 900123', ['+447700900123'])).toBe(true)
  })

  it('finds part of a number typed as 07', () => {
    expect(matchesPhoneSearch('07700 900', ['+447700900123'])).toBe(true)
  })

  it('finds a 07 number typed as +44', () => {
    expect(matchesPhoneSearch('+44 7700 900123', ['07700900123'])).toBe(true)
  })

  it('ignores short terms, names and references', () => {
    expect(matchesPhoneSearch('0770', ['+447700900123'])).toBe(false)
    expect(matchesPhoneSearch('TB-1A2B3C4D', ['+447700900123'])).toBe(false)
  })

  it('does not match a different number', () => {
    expect(matchesPhoneSearch('07700 900999', ['+447700900123', null])).toBe(false)
  })
})
