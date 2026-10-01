import { describe, expect, it } from 'vitest'
import {
  compareVendorNames,
  findSimilarVendors,
  groupPossibleDuplicateVendors,
  vendorIdentityKey,
  vendorMatchingKey,
} from './vendor-matching'

describe('vendorIdentityKey', () => {
  it('matches the database key: lower case, single spaces, nothing else changed', () => {
    expect(vendorIdentityKey('  Oak   Farm Gas Co. Ltd ')).toBe('oak farm gas co. ltd')
    expect(vendorIdentityKey('M&S')).toBe('m&s')
    expect(vendorIdentityKey('   ')).toBeNull()
    expect(vendorIdentityKey(null)).toBeNull()
  })
})

describe('vendorMatchingKey', () => {
  it.each([
    ['Oak Farm Gas Co Ltd', 'oak farm gas'],
    ['Oak Farm Gas Co.', 'oak farm gas'],
    ['Wix.com', 'wix'],
    ['Amazon.co.uk', 'amazon'],
    ['MARKS SPENCER PLC', 'marks spencer'],
    ['Marks & Spencer', 'marks spencer'],
    ["Sainsbury's", 'sainsburys'],
    ['Café Nero', 'cafe nero'],
    ['The Co', 'the co'],
  ])('%j becomes %j', (name, expected) => {
    expect(vendorMatchingKey(name)).toBe(expected)
  })

  it('is empty for nothing', () => {
    expect(vendorMatchingKey('')).toBe('')
    expect(vendorMatchingKey(null)).toBe('')
  })
})

describe('compareVendorNames', () => {
  // The pairs found in the live vendor list on 1 October 2026.
  it.each([
    ['Oak Farm Gas Co', 'Oak Farm Gas Co Ltd', 'same_key'],
    ['Marks & Spencer', 'MARKS SPENCER PLC', 'same_key'],
    ['Wix', 'Wix.com', 'same_key'],
    ['TK Maxx', 'TKMaxx', 'joined'],
    ['PPL PRS', 'PPLPRS', 'joined'],
    ['Spelthorne', 'Spelthorne Borough Council', 'starts_with'],
    ['Jensten Insurance', 'Jensten Insurance Brokers', 'starts_with'],
    ['Veolia', 'Veolia ES', 'starts_with'],
    ['Jacob William', 'Jacob Williams', 'close_spelling'],
  ])('%j and %j: %s', (a, b, expected) => {
    expect(compareVendorNames(a, b)).toBe(expected)
    expect(compareVendorNames(b, a)).toBe(expected)
  })

  it.each([
    ['Tesco', 'Asda'],
    ['Shell', 'Shelter'],
    // Short names are not paired on spelling: one letter apart is a different business.
    ['BP', 'BT'],
    ['Aldi', 'Lidl'],
    ['Tesco', 'Tesla'],
    // A short first word is not enough to call it the same vendor.
    ['BT', 'BT Sport Subscriptions'],
    ['M&S', 'Marks & Spencer'],
  ])('%j and %j are not paired', (a, b) => {
    expect(compareVendorNames(a, b)).toBeNull()
  })

  it('does not pair anything with an empty name', () => {
    expect(compareVendorNames('', 'Tesco')).toBeNull()
    expect(compareVendorNames('...', 'Tesco')).toBeNull()
  })
})

describe('findSimilarVendors', () => {
  const vendors = [
    { id: '1', name: 'Oak Farm Gas Co' },
    { id: '2', name: 'Veolia' },
    { id: '3', name: 'Veolia ES UK Ltd' },
    { id: '4', name: 'Tesco' },
  ]

  it('offers the existing vendors a typed name might be, closest first', () => {
    expect(findSimilarVendors('Oak Farm Gas Co Ltd', vendors).map((vendor) => vendor.name)).toEqual(['Oak Farm Gas Co'])
    expect(findSimilarVendors('Veolia ES', vendors).map((vendor) => [vendor.name, vendor.similarity])).toEqual([
      // "UK" and "Ltd" are dropped, so this is the same name; plain "Veolia" is a looser match.
      ['Veolia ES UK Ltd', 'same_key'],
      ['Veolia', 'starts_with'],
    ])
  })

  it('leaves out the vendor with exactly that name: it is the same vendor, not a similar one', () => {
    expect(findSimilarVendors('  tesco ', vendors)).toEqual([])
  })

  it('offers nothing for a name that is new', () => {
    expect(findSimilarVendors('Booker Wholesale', vendors)).toEqual([])
  })

  it('keeps to the limit', () => {
    const many = Array.from({ length: 12 }, (_, index) => ({ id: String(index), name: `Veolia Site ${index}` }))
    expect(findSimilarVendors('Veolia', many, 5)).toHaveLength(5)
  })
})

describe('groupPossibleDuplicateVendors', () => {
  it('groups vendors that look like one, joining through each other', () => {
    const groups = groupPossibleDuplicateVendors([
      { id: '1', name: 'Veolia' },
      { id: '2', name: 'Tesco' },
      { id: '3', name: 'Veolia ES UK Ltd' },
      { id: '4', name: 'Veolia ES' },
      { id: '5', name: 'Wix.com' },
      { id: '6', name: 'Wix' },
      { id: '7', name: 'Booker' },
    ])

    expect(groups.map((group) => group.map((vendor) => vendor.name))).toEqual([
      ['Veolia', 'Veolia ES', 'Veolia ES UK Ltd'],
      ['Wix', 'Wix.com'],
    ])
  })

  it('returns nothing when no two vendors look alike', () => {
    expect(groupPossibleDuplicateVendors([{ id: '1', name: 'Tesco' }, { id: '2', name: 'Booker' }])).toEqual([])
  })
})
