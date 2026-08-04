import { describe, it, expect } from 'vitest'
import {
  VENDOR_SERVICE_TYPE_LABELS,
  GROUP_LABELS,
  NOT_RECORDED,
  toNum,
  formatQuantityNumber,
  quantityWording,
  unitPriceSuffix,
  itemDisplayName,
  cateringZeroPriceQualifier,
  discountPhrase,
  itemGroup,
} from '@/lib/private-bookings/item-labels'
import type { PrivateBookingItem, PricingModel } from '@/types/private-bookings'

function makeItem(overrides: Partial<PrivateBookingItem> = {}): PrivateBookingItem {
  return {
    item_type: 'other',
    description: 'Something',
    quantity: 1,
    unit_price: 10,
    line_total: 10,
    ...overrides,
  } as unknown as PrivateBookingItem
}

const catering = (pricing_model: PricingModel | undefined, overrides: Partial<PrivateBookingItem> = {}) =>
  makeItem({
    item_type: 'catering',
    package: pricing_model ? ({ name: 'A package', pricing_model } as never) : undefined,
    ...overrides,
  })

describe('toNum', () => {
  it('coerces the string numerics PostgREST returns for numeric(10,2)', () => {
    expect(toNum('5.00')).toBe(5)
    expect(toNum('2.50')).toBe(2.5)
    expect(toNum(7)).toBe(7)
  })

  it('returns null rather than NaN for unusable input', () => {
    expect(toNum(undefined)).toBeNull()
    expect(toNum(null)).toBeNull()
    expect(toNum('')).toBeNull()
    expect(toNum('not a number')).toBeNull()
    expect(toNum(Infinity)).toBeNull()
  })
})

describe('formatQuantityNumber', () => {
  it('strips trailing zeros from a string quantity', () => {
    expect(formatQuantityNumber('5.00')).toBe('5')
    expect(formatQuantityNumber('2.50')).toBe('2.5')
    expect(formatQuantityNumber('0.50')).toBe('0.5')
  })

  it('returns null for a non-finite quantity', () => {
    expect(formatQuantityNumber('rubbish')).toBeNull()
  })
})

describe('quantityWording', () => {
  const cases: Array<{
    label: string
    item: PrivateBookingItem
    text: string
    unitSuffix: string
  }> = [
    { label: 'space', item: makeItem({ item_type: 'space', quantity: 5 }), text: '5 hours', unitSuffix: 'per hour' },
    { label: 'catering per_head', item: catering('per_head', { quantity: 30 }), text: '30 guests', unitSuffix: 'per guest' },
    { label: 'catering per_tray', item: catering('per_tray', { quantity: 2 }), text: '2 trays', unitSuffix: 'per tray' },
    { label: 'catering per_jar', item: catering('per_jar', { quantity: 3 }), text: '3 jars', unitSuffix: 'per jar' },
    { label: 'catering free', item: catering('free', { quantity: 20 }), text: '20 guests', unitSuffix: 'per guest' },
    { label: 'catering menu_priced', item: catering('menu_priced', { quantity: 12 }), text: '12 guests', unitSuffix: 'per guest' },
    { label: 'catering variable', item: catering('variable', { quantity: 8 }), text: '8 guests', unitSuffix: 'per guest' },
    { label: 'catering total_value qty 1', item: catering('total_value', { quantity: 1 }), text: '1 package', unitSuffix: 'for the package' },
    { label: 'catering total_value qty 2', item: catering('total_value', { quantity: 2 }), text: '2 packages', unitSuffix: 'per package' },
    { label: 'catering no package join', item: catering(undefined, { quantity: 4 }), text: '4 guests', unitSuffix: 'per guest' },
    { label: 'vendor', item: makeItem({ item_type: 'vendor', quantity: 1 }), text: '1 service', unitSuffix: 'each' },
    { label: 'other', item: makeItem({ item_type: 'other', quantity: 1 }), text: '1 item', unitSuffix: 'each' },
  ]

  it('maps every item_type and pricing_model to a quantity noun and a unit suffix', () => {
    for (const c of cases) {
      const result = quantityWording(c.item)
      expect(result.text, c.label).toBe(c.text)
      expect(result.unitSuffix, c.label).toBe(c.unitSuffix)
      expect(result.text, c.label).not.toContain('undefined')
      expect(result.unitSuffix, c.label).not.toContain('undefined')
    }
  })

  it('uses the singular noun only when the rounded quantity is exactly 1', () => {
    expect(quantityWording(makeItem({ item_type: 'space', quantity: 1 })).noun).toBe('hour')
    expect(quantityWording(makeItem({ item_type: 'space', quantity: 1.5 })).noun).toBe('hours')
    expect(quantityWording(makeItem({ item_type: 'space', quantity: 0 })).noun).toBe('hours')
  })

  it('renders a fractional quantity, which occurs in production', () => {
    expect(quantityWording(makeItem({ item_type: 'space', quantity: '4.50' as never })).text).toBe('4.5 hours')
  })

  it('returns "Not recorded" for a non-finite quantity and omits the noun', () => {
    const result = quantityWording(makeItem({ quantity: undefined as never }))
    expect(result.text).toBe(NOT_RECORDED)
    expect(result.noun).toBeNull()
    expect(result.text).not.toContain('NaN')
    // The suffix survives so the unit-price column stays uniform.
    expect(result.unitSuffix).toBe('each')
  })

  it('falls back to per-guest wording for an unknown pricing model', () => {
    const result = quantityWording(catering('nonsense' as PricingModel, { quantity: 2 }))
    expect(result.text).toBe('2 guests')
    expect(result.unitSuffix).toBe('per guest')
  })
})

describe('unitPriceSuffix', () => {
  it('returns just the suffix', () => {
    expect(unitPriceSuffix(makeItem({ item_type: 'space' }))).toBe('per hour')
  })
})

describe('itemDisplayName', () => {
  it('prefers the joined record name over the stored description', () => {
    const item = makeItem({
      item_type: 'space',
      description: 'Old Room Name',
      space: { name: 'The Dining Room' } as never,
    })
    expect(itemDisplayName(item)).toBe('The Dining Room')
  })

  it('falls back to the stored description when the join is absent', () => {
    expect(itemDisplayName(makeItem({ item_type: 'space', description: 'The Dining Room' }))).toBe('The Dining Room')
    expect(itemDisplayName(makeItem({ item_type: 'catering', description: 'Finger Buffet' }))).toBe('Finger Buffet')
    expect(itemDisplayName(makeItem({ item_type: 'vendor', description: "Nick's Disco (dj)" }))).toBe("Nick's Disco (dj)")
  })

  it('title-cases the vendor service type from the shared map', () => {
    const item = makeItem({
      item_type: 'vendor',
      description: 'Some Kit (equipment)',
      vendor: { name: 'Some Kit', service_type: 'equipment' } as never,
    })
    expect(itemDisplayName(item)).toBe('Some Kit (Equipment Rental)')
  })

  it('prints no bracketed qualifier for the "other" vendor service type', () => {
    const item = makeItem({
      item_type: 'vendor',
      vendor: { name: 'A Supplier', service_type: 'other' } as never,
    })
    expect(itemDisplayName(item)).toBe('A Supplier')
  })

  it('never returns undefined', () => {
    expect(itemDisplayName(makeItem({ description: undefined as never }))).toBe('')
  })
})

describe('cateringZeroPriceQualifier', () => {
  it('adds the qualifier only when the unit price is zero', () => {
    expect(cateringZeroPriceQualifier(catering('free', { unit_price: 0 }))).toBe('included at no charge')
    expect(cateringZeroPriceQualifier(catering('menu_priced', { unit_price: 0 }))).toBe('priced from the menu')
    expect(cateringZeroPriceQualifier(catering('variable', { unit_price: 0 }))).toBe('price to be confirmed')
    expect(cateringZeroPriceQualifier(catering('free', { unit_price: 5 }))).toBeNull()
  })

  it('never applies to a non-catering item', () => {
    expect(cateringZeroPriceQualifier(makeItem({ item_type: 'space', unit_price: 0 }))).toBeNull()
  })

  it('returns null for a per-head package at nil', () => {
    expect(cateringZeroPriceQualifier(catering('per_head', { unit_price: 0 }))).toBeNull()
  })
})

describe('discountPhrase', () => {
  it('prints a discount only when the value is above zero and the type is percent or fixed', () => {
    // value 0, type percent: the production case, 18 items marked vs 16 discounted
    expect(discountPhrase(makeItem({ discount_value: 0, discount_type: 'percent' }), 100, 100)).toBeNull()
    // value 25, type null: the generated column's ELSE arm charges in full
    expect(discountPhrase(makeItem({ discount_value: 25, discount_type: undefined }), 100, 100)).toBeNull()
    // value 0, type null
    expect(discountPhrase(makeItem({ discount_value: 0 }), 100, 100)).toBeNull()
    // value 25, type percent
    expect(discountPhrase(makeItem({ discount_value: 25, discount_type: 'percent' }), 100, 75)).toBe('25% discount applied')
  })

  it('words a full comp distinctly', () => {
    expect(discountPhrase(makeItem({ discount_value: 100, discount_type: 'percent' }), 125, 0)).toBe(
      '100% discount applied (included at no charge)'
    )
  })

  it('prints the clamped effective discount for a fixed discount larger than the line', () => {
    expect(discountPhrase(makeItem({ discount_value: 35, discount_type: 'fixed' }), 20, 0)).toBe(
      '£20.00 discount applied'
    )
  })

  it('prints no discount when the base is zero or negative', () => {
    expect(discountPhrase(makeItem({ discount_value: 10, discount_type: 'percent' }), 0, 0)).toBeNull()
    expect(discountPhrase(makeItem({ discount_value: 10, discount_type: 'percent' }), -50, 0)).toBeNull()
  })

  it('prints nothing when the effective discount rounds away', () => {
    expect(discountPhrase(makeItem({ discount_value: 0.001, discount_type: 'percent' }), 100, 100)).toBeNull()
  })

  it('coerces a string discount value', () => {
    expect(discountPhrase(makeItem({ discount_value: '10.00' as never, discount_type: 'percent' }), 100, 90)).toBe(
      '10% discount applied'
    )
  })
})

describe('itemGroup', () => {
  it('assigns each item_type to its group heading', () => {
    expect(GROUP_LABELS[itemGroup(makeItem({ item_type: 'space' }))]).toBe('Venue hire')
    expect(GROUP_LABELS[itemGroup(makeItem({ item_type: 'catering' }))]).toBe('Food and drink')
    expect(GROUP_LABELS[itemGroup(makeItem({ item_type: 'vendor' }))]).toBe('Suppliers and entertainment')
    expect(GROUP_LABELS[itemGroup(makeItem({ item_type: 'other' }))]).toBe('Other charges')
  })

  it('falls back to "other" for an unrecognised type', () => {
    expect(itemGroup(makeItem({ item_type: 'mystery' as never }))).toBe('other')
  })
})

describe('VENDOR_SERVICE_TYPE_LABELS', () => {
  it('keeps "Equipment Rental" rather than "Equipment"', () => {
    expect(VENDOR_SERVICE_TYPE_LABELS.equipment).toBe('Equipment Rental')
  })

  it('covers all ten service types', () => {
    expect(Object.keys(VENDOR_SERVICE_TYPE_LABELS)).toHaveLength(10)
  })
})
