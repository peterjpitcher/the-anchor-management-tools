import { describe, it, expect, vi, beforeEach } from 'vitest'
import { generateContractHTML, matchesSelfCateringPackageName, type ContractData } from '@/lib/contract-template'
import { logger } from '@/lib/logger'
import type { PrivateBookingWithDetails, PrivateBookingItem } from '@/types/private-bookings'

vi.mock('@/lib/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

beforeEach(() => {
  vi.clearAllMocks()
})

const BYO_FOOD_PACKAGE_ID = '9fdbf82b-6717-4bff-8af6-8865cb5bfe21'

function makeItem(overrides: Partial<PrivateBookingItem>): PrivateBookingItem {
  return {
    item_type: 'catering',
    quantity: 30,
    unit_price: 0,
    line_total: 0,
    discount_value: 0,
    discount_type: null,
    description: 'Catering',
    ...overrides,
  } as unknown as PrivateBookingItem
}

function makeBooking(
  items: PrivateBookingItem[] = [],
  extra: Partial<PrivateBookingWithDetails> = {},
): PrivateBookingWithDetails {
  return {
    id: '11fd3680-95a4-4292-be2c-c90da3b1564e',
    customer_full_name: 'Paula Campbell',
    contact_phone: '+44 7802 484790',
    contact_email: 'paulac1988@hotmail.co.uk',
    event_date: '2026-07-19',
    start_time: '15:00',
    end_time: '19:00',
    end_time_next_day: false,
    event_type: 'Double gender reveal',
    guest_count: 30,
    deposit_amount: 100,
    deposit_paid_date: null,
    balance_due_date: null,
    final_payment_date: null,
    discount_amount: 0,
    discount_type: null,
    date_tbd: false,
    internal_notes: null,
    items,
    payments: [],
    ...extra,
  } as unknown as PrivateBookingWithDetails
}

const baseData = (booking: PrivateBookingWithDetails): ContractData => ({
  booking,
  logoUrl: '/logo-black.png',
})

describe('generateContractHTML', () => {
  it('renders the four-page contract with the customer name and reference', () => {
    const html = generateContractHTML(baseData(makeBooking()))
    expect(html).toContain('Private booking contract')
    expect(html).toContain('Paula Campbell')
    expect(html).toContain('Ref <b>PB-11FD3680</b>')
    const contractSheets = html.match(/data-doc="contract"/g) || []
    expect(contractSheets).toHaveLength(4)
  })

  it('omits the self-catering waiver when no bring-your-own-food package is present', () => {
    const html = generateContractHTML(baseData(makeBooking([makeItem({ item_type: 'space' })])))
    expect(html).not.toContain('data-doc="waiver"')
    expect(html).not.toContain('Self-catering food release')
  })

  it('appends the waiver annex when the BYO food package id is present', () => {
    const html = generateContractHTML(
      baseData(makeBooking([makeItem({ package: { id: BYO_FOOD_PACKAGE_ID, name: 'Bring Your Own Food' } as never })])),
    )
    const waiverSheets = html.match(/data-doc="waiver"/g) || []
    expect(waiverSheets).toHaveLength(1)
    expect(html).toContain('Self-catering food release &amp; indemnity waiver')
    // Signature block is data-driven from the booking
    expect(html).toContain('Double gender reveal &middot; approx. 30 guests')
    expect(html).toContain('This signature is separate from, and additional to')
  })

  it('appends the waiver via the package-name fallback when the id differs, and warns about id drift', () => {
    const html = generateContractHTML(
      baseData(makeBooking([makeItem({ package: { id: 'some-other-uuid', name: 'BRING YOUR OWN Food (client supplied)' } as never })])),
    )
    expect(html).toContain('data-doc="waiver"')
    expect(logger.warn).toHaveBeenCalledTimes(1)
    expect(vi.mocked(logger.warn).mock.calls[0][0]).toContain('not by known package id')
  })

  it('appends the waiver for re-seeded packages named self-catering or BYO', () => {
    for (const name of ['Self-Catering', 'Self catered buffet', 'BYO Buffet']) {
      const html = generateContractHTML(
        baseData(makeBooking([makeItem({ package: { id: 'reseeded-uuid', name } as never })])),
      )
      expect(html, `expected waiver for package named "${name}"`).toContain('data-doc="waiver"')
    }
  })

  it('does not warn when the waiver is matched by the known package id', () => {
    generateContractHTML(
      baseData(makeBooking([makeItem({ package: { id: BYO_FOOD_PACKAGE_ID, name: 'Bring Your Own Food' } as never })])),
    )
    expect(logger.warn).not.toHaveBeenCalled()
  })

  it('does not treat a non-catering item named similarly as self-catered', () => {
    const html = generateContractHTML(
      baseData(makeBooking([makeItem({ item_type: 'space', package: { id: 'x', name: 'Bring your own decorations' } as never })])),
    )
    expect(html).not.toContain('data-doc="waiver"')
  })

  it('renders special requirements, accessibility and note rows when present', () => {
    const html = generateContractHTML(
      baseData(
        makeBooking([], {
          special_requirements: 'Nut allergy on table 3',
          accessibility_needs: 'Step-free access required',
          contract_note: 'Balance to be paid in two instalments',
        } as Partial<PrivateBookingWithDetails>),
      ),
    )
    expect(html).toContain('Special requirements')
    expect(html).toContain('Nut allergy on table 3')
    expect(html).toContain('Accessibility')
    expect(html).toContain('Step-free access required')
    expect(html).toContain('Balance to be paid in two instalments')
  })

  it('omits those rows when the booking has none', () => {
    const html = generateContractHTML(baseData(makeBooking()))
    expect(html).not.toContain('Special requirements')
    expect(html).not.toContain('>Accessibility<')
  })

  it('produces no leaked undefined / NaN / object placeholders', () => {
    const html = generateContractHTML(
      baseData(makeBooking([makeItem({ package: { id: BYO_FOOD_PACKAGE_ID, name: 'Bring Your Own Food' } as never })])),
    )
    expect(html).not.toContain('undefined')
    expect(html).not.toContain('NaN')
    expect(html).not.toContain('[object Object]')
  })
})

describe('deposit rendering', () => {
  it('renders the stored deposit amount with a due status', () => {
    const html = generateContractHTML(baseData(makeBooking([], { deposit_amount: 100 })))
    expect(html).toContain('£100.00')
    expect(html).toContain('Status: due')
    expect(html).toContain('booking and damage deposit of <b>£100.00</b>')
    expect(html).not.toContain('No deposit required')
  })

  it('renders a paid status when the deposit has a paid date', () => {
    const html = generateContractHTML(
      baseData(makeBooking([], { deposit_amount: 250, deposit_paid_date: '2026-07-01' } as Partial<PrivateBookingWithDetails>)),
    )
    expect(html).toContain('£250.00')
    expect(html).toContain('Status: paid')
    expect(html).not.toContain('Status: due')
  })

  it('renders "No deposit required" when deposit_amount is null — never a fabricated £250', () => {
    const html = generateContractHTML(
      baseData(makeBooking([], { deposit_amount: null } as unknown as Partial<PrivateBookingWithDetails>)),
    )
    expect(html).toContain('No deposit required')
    expect(html).toContain('No booking deposit is required for this event')
    expect(html).not.toContain('£250.00')
    expect(html).not.toContain('Status: due')
    expect(html).not.toContain('deposit of <b>£0.00</b>')
    expect(html).not.toContain('forfeiture of the deposit')
  })

  it('renders "No deposit required" when deposit_amount is 0', () => {
    const html = generateContractHTML(baseData(makeBooking([], { deposit_amount: 0 })))
    expect(html).toContain('No deposit required')
    expect(html).not.toContain('Status: due')
    expect(html).not.toContain('deposit of <b>£0.00</b>')
  })

  it('notes a recorded deposit payment calmly when no deposit amount is stored', () => {
    const html = generateContractHTML(
      baseData(
        makeBooking([], { deposit_amount: null, deposit_paid_date: '2026-07-01' } as unknown as Partial<PrivateBookingWithDetails>),
      ),
    )
    expect(html).toContain('No deposit required')
    expect(html).toContain('A deposit payment was recorded on')
  })
})

describe('matchesSelfCateringPackageName', () => {
  it('matches bring your own, self-catering and BYO variants case-insensitively', () => {
    expect(matchesSelfCateringPackageName('Bring Your Own Food')).toBe(true)
    expect(matchesSelfCateringPackageName('bring your own buffet')).toBe(true)
    expect(matchesSelfCateringPackageName('Self-Catering')).toBe(true)
    expect(matchesSelfCateringPackageName('Self catered spread')).toBe(true)
    expect(matchesSelfCateringPackageName('BYO Buffet')).toBe(true)
    expect(matchesSelfCateringPackageName('byo')).toBe(true)
  })

  it('does not match ordinary catering names or byo inside another word', () => {
    expect(matchesSelfCateringPackageName('Hot Buffet')).toBe(false)
    expect(matchesSelfCateringPackageName('Classic Sunday Lunch')).toBe(false)
    expect(matchesSelfCateringPackageName('Abyorm Platter')).toBe(false)
  })

  it('handles empty and missing names', () => {
    expect(matchesSelfCateringPackageName('')).toBe(false)
    expect(matchesSelfCateringPackageName('   ')).toBe(false)
    expect(matchesSelfCateringPackageName(null)).toBe(false)
    expect(matchesSelfCateringPackageName(undefined)).toBe(false)
  })
})
