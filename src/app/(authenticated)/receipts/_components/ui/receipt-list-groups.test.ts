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

  it('totals only the page when the server sent no totals', () => {
    const [group] = buildVendorGroups([
      { vendor_name: 'Tesco', amount_out: 10, amount_total: 10 },
      { vendor_name: 'TESCO', amount_in: 4, amount_total: 4 },
    ])

    expect(group).toMatchObject({ vendorName: 'Tesco', count: 2, totalIn: 4, totalOut: 10, totalAmount: 14 })
    expect(group.transactions).toHaveLength(2)
  })

  it('shows the whole group from the server totals, not the part that is on this page', () => {
    const groups = buildVendorGroups(
      [
        { vendor_name: 'Tesco', amount_out: 10, amount_total: 10 },
        { vendor_name: null, amount_out: 3, amount_total: 3 },
      ],
      {
        tesco: { count: 37, totalIn: 0, totalOut: 912.4, totalAmount: 912.4 },
        'missing vendor': { count: 5, totalIn: 20, totalOut: 3, totalAmount: 23 },
      },
    )

    expect(groups[0]).toMatchObject({ vendorName: 'Tesco', count: 37, totalOut: 912.4, totalAmount: 912.4 })
    // The rows drawn are still only the ones on the page.
    expect(groups[0].transactions).toHaveLength(1)
    expect(groups[1]).toMatchObject({ vendorName: 'Missing vendor', count: 5, totalIn: 20, totalAmount: 23 })
  })

  it('keeps the order the server sent the rows in when it has their totals', () => {
    const groups = buildVendorGroups(
      [
        { vendor_name: 'Zulu', amount_out: 1 },
        { vendor_name: 'alpha', amount_out: 2 },
        { vendor_name: 'Zulu', amount_out: 3 },
      ],
      {},
    )

    // Each vendor is kept together across pages by the server, so its order is the order.
    expect(groups.map((group) => group.vendorName)).toEqual(['Zulu', 'alpha'])
  })

  it('falls back to what the page adds up to for a group the server did not total', () => {
    const [group] = buildVendorGroups([{ vendor_name: 'New Vendor', amount_out: 8, amount_total: 8 }], {
      tesco: { count: 37, totalIn: 0, totalOut: 912.4, totalAmount: 912.4 },
    })

    expect(group).toMatchObject({ vendorName: 'New Vendor', count: 1, totalOut: 8, totalAmount: 8 })
  })

  it('maps the lowest value to the info blue and the highest value to the danger red', () => {
    expect(getValueHeatLevel(10, 10, 100)).toBe(0)
    expect(getValueHeatLevel(100, 10, 100)).toBe(1)
    // --color-info (#0284c7) and --color-danger (#dc2626), the ends of the legend's gradient.
    expect(getValueHeatColour(10, 10, 100)).toBe('rgb(2 132 199)')
    expect(getValueHeatColour(100, 10, 100)).toBe('rgb(220 38 38)')
  })
})
