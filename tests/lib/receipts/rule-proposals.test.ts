import { describe, expect, it } from 'vitest'
import {
  countKeywordMatches,
  findSharedKeyword,
  proposeVendorRule,
  type ProposalPayment,
} from '@/lib/receipts/rule-proposals'

function payment(id: string, details: string, vendorId: string | null, direction: 'in' | 'out' = 'out'): ProposalPayment {
  return { id, details, direction, vendorId }
}

describe('findSharedKeyword', () => {
  it('takes the longest run of whole words every description contains', () => {
    expect(
      findSharedKeyword([
        'CARD PURCHASE BOOKER WHOLESALE STAINES 0412',
        'CARD PURCHASE BOOKER WHOLESALE STAINES 0915',
        'BOOKER WHOLESALE STAINES REFUND',
      ])
    ).toBe('booker wholesale staines')
  })

  it('needs two descriptions', () => {
    expect(findSharedKeyword(['BOOKER WHOLESALE'])).toBeNull()
    expect(findSharedKeyword([])).toBeNull()
  })

  it('refuses text that only says how the payment was made', () => {
    expect(findSharedKeyword(['CARD PURCHASE 0412', 'CARD PURCHASE 0915'])).toBeNull()
    expect(findSharedKeyword(['DIRECT DEBIT PAYMENT TO 1', 'DIRECT DEBIT PAYMENT TO 2'])).toBeNull()
  })

  it('refuses a shared number, and a shared word of under four characters', () => {
    expect(findSharedKeyword(['ACME 20261001', 'ZENITH 20261001'])).toBeNull()
    expect(findSharedKeyword(['BT 1', 'BT 2'])).toBeNull()
  })

  it('only counts a word that stands alone: "range" inside "orange" is not shared', () => {
    expect(findSharedKeyword(['THE RANGE STAINES', 'ORANGE MOBILE'])).toBeNull()
  })

  it('returns null when nothing is shared', () => {
    expect(findSharedKeyword(['BOOKER WHOLESALE', 'TESCO STORES'])).toBeNull()
  })
})

describe('countKeywordMatches', () => {
  const all = [
    payment('1', 'BOOKER WHOLESALE 1', 'v-booker'),
    payment('2', 'BOOKER WHOLESALE 2', 'v-booker'),
    payment('3', 'BOOKER PRIZE DINNER', 'v-other'),
    payment('4', 'BOOKER UNKNOWN', null),
    payment('5', 'TESCO', 'v-tesco'),
  ]

  it('counts every match, and as a collision only a match belonging to another vendor', () => {
    // A payment with no vendor yet is a match and not a collision: the rule would name it.
    expect(countKeywordMatches('booker', 'v-booker', all, 'substring')).toEqual({ matchCount: 4, collisions: 1 })
    expect(countKeywordMatches('booker wholesale', 'v-booker', all, 'substring')).toEqual({ matchCount: 2, collisions: 0 })
  })

  it('counts nothing for a keyword that matches nothing', () => {
    expect(countKeywordMatches('waitrose', 'v-booker', all, 'substring')).toEqual({ matchCount: 0, collisions: 0 })
  })
})

describe('proposeVendorRule', () => {
  it('proposes a keyword that is in every payment it was raised from', () => {
    const evidence = [payment('1', 'CARD PURCHASE HEATHROW CASH & CARRY 01', 'v1'), payment('2', 'HEATHROW CASH & CARRY 02', 'v1')]
    const proposal = proposeVendorRule('v1', evidence, [...evidence, payment('3', 'TESCO', 'v2')])

    expect(proposal).toMatchObject({
      keyword: 'heathrow cash & carry',
      direction: 'out',
      evidenceIds: ['1', '2'],
      matchCount: 2,
      collisions: 0,
    })
    for (const item of evidence) {
      expect(item.details.toLowerCase()).toContain(proposal?.keyword)
    }
  })

  it('reports the payments of other vendors the keyword would also catch', () => {
    const evidence = [payment('1', 'AMAZON MARKETPLACE 1', 'v-amazon'), payment('2', 'AMAZON MARKETPLACE 2', 'v-amazon')]
    const all = [...evidence, payment('3', 'AMAZON MARKETPLACE SELLER FEES', 'v-fees'), payment('4', 'AMAZON MARKETPLACE 3', null)]

    expect(proposeVendorRule('v-amazon', evidence, all)).toMatchObject({ matchCount: 4, collisions: 1 })
  })

  it('escapes a comma, so the keyword stays one keyword in the rule', () => {
    const evidence = [payment('1', 'SMITH, JONES & CO 1', 'v1'), payment('2', 'SMITH, JONES & CO 2', 'v1')]
    const proposal = proposeVendorRule('v1', evidence, evidence)

    expect(proposal?.keyword).toContain('\\,')
    expect(proposal?.matchCount).toBe(2)
  })

  it('says "both" when the payments go in and out', () => {
    const evidence = [payment('1', 'SUMUP PAYMENTS LTD X', 'v1', 'in'), payment('2', 'SUMUP PAYMENTS LTD Y', 'v1', 'out')]
    // "sumup", "payments" and "ltd" are all words that say how, not who, so nothing is proposed.
    expect(proposeVendorRule('v1', evidence, evidence)).toBeNull()

    const named = [payment('1', 'BREWERY ACCOUNT IN', 'v1', 'in'), payment('2', 'BREWERY ACCOUNT OUT', 'v1', 'out')]
    expect(proposeVendorRule('v1', named, named)?.direction).toBe('both')
  })

  it('proposes nothing from one payment, or from payments that share nothing', () => {
    expect(proposeVendorRule('v1', [payment('1', 'BOOKER', 'v1')], [])).toBeNull()
    expect(proposeVendorRule('v1', [payment('1', 'BOOKER', 'v1'), payment('2', 'TESCO', 'v1')], [])).toBeNull()
  })

  it('keeps at most twenty evidence ids and three sample descriptions', () => {
    const evidence = Array.from({ length: 30 }, (_, index) => payment(String(index), `BOOKER WHOLESALE ${index}`, 'v1'))
    const proposal = proposeVendorRule('v1', evidence, evidence)

    expect(proposal?.evidenceIds).toHaveLength(20)
    expect(proposal?.samples).toHaveLength(3)
    expect(proposal?.matchCount).toBe(30)
  })

  it('under whole-word matching, proposes nothing it would not then match', () => {
    const evidence = [payment('1', 'BOOKER WHOLESALE 1', 'v1'), payment('2', 'BOOKER WHOLESALE 2', 'v1')]
    const proposal = proposeVendorRule('v1', evidence, [...evidence, payment('3', 'FACEBOOKER WHOLESALE', 'v2')], 'word')

    // "booker wholesale" inside "facebooker wholesale" is not a whole-word match.
    expect(proposal).toMatchObject({ matchCount: 2, collisions: 0 })
  })
})
