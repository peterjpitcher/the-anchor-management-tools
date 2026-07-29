import { describe, expect, it } from 'vitest'
import {
  buildVendorGroups,
  getValueHeatColour,
  getValueHeatLevel,
} from './receipt-list-groups'

describe('receipt vendor groups', () => {
  it('sorts vendor groups alphabetically instead of by changing totals', () => {
    const groups = buildVendorGroups([
      { vendor_name: 'Zulu', amount_out: 1, amount_total: 1 },
      { vendor_name: 'alpha', amount_out: 500, amount_total: 500 },
      { vendor_name: 'Bravo', amount_out: 1000, amount_total: 1000 },
      { vendor_name: null, amount_out: 2000, amount_total: 2000 },
    ])

    expect(groups.map((group) => group.vendorName)).toEqual([
      'alpha',
      'Bravo',
      'Missing vendor',
      'Zulu',
    ])
  })

  it('maps the lowest value to blue and the highest value to red', () => {
    expect(getValueHeatLevel(10, 10, 100)).toBe(0)
    expect(getValueHeatLevel(100, 10, 100)).toBe(1)
    expect(getValueHeatColour(10, 10, 100)).toBe('rgb(25 95 235)')
    expect(getValueHeatColour(100, 10, 100)).toBe('rgb(220 38 38)')
  })
})
