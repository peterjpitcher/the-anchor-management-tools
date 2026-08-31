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
  it('keeps the four-sheet contract when the booking has no items', () => {
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
    // SOP pack §51: the annex is a "responsibility agreement", not a release/indemnity waiver
    expect(html).toContain('Self-catering and outside food responsibility agreement')
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

describe('access times', () => {
  it('prints the standard hour either side, and says it is the standard', () => {
    const html = generateContractHTML(
      baseData(makeBooking([], { start_time: '18:00:00', end_time: '23:00:00' } as Partial<PrivateBookingWithDetails>)),
    )
    expect(html).toContain('Setup access from')
    expect(html).toContain('Clear-down by')
    expect(html).toContain('5pm (standard hour)')
    expect(html).toContain('12am (+1 day) (standard hour)')
  })

  it('prints a bespoke setup time and does not call it standard', () => {
    const html = generateContractHTML(
      baseData(makeBooking([], {
        start_time: '18:00:00', end_time: '23:00:00', setup_time: '15:00:00',
      } as Partial<PrivateBookingWithDetails>)),
    )
    expect(html).toContain('3pm')
    expect(html).not.toContain('3pm (standard hour)')
  })

  it('no longer promises one hour in the terms, which a bespoke setup would contradict', () => {
    const html = generateContractHTML(
      baseData(makeBooking([], { start_time: '18:00:00', end_time: '23:00:00', setup_time: '15:00:00' } as Partial<PrivateBookingWithDetails>)),
    )
    expect(html).not.toContain('one hour of setup access before the booking')
    expect(html).toContain('setup and clear-down access shown in your booking details above')
  })
})

describe('signature block', () => {
  // Either side may be signed by someone other than the named booker or the
  // named manager, so the contract prints ruled lines and lets whoever signs
  // write their own name. A pre-filled name is worse than no name: it invites
  // a signature that does not match the printed one.
  it('leaves both name lines blank for whoever actually signs', () => {
    const html = generateContractHTML(baseData(makeBooking([], { deposit_amount: 100 })))

    expect(html).toContain('Signed by the Host')
    expect(html).toContain('For The Anchor')
    // The captions stay: it is the pre-filled values that go.
    expect(html).toContain('Host name')
    expect(html).toContain('Name &amp; position')

    expect(html).not.toContain('Billy Summers')
    expect(html).not.toContain('Tenant &amp; General Manager')
  })

  it('does not print the booker name onto the host signature line', () => {
    const html = generateContractHTML(
      baseData(makeBooking([], { deposit_amount: 100, customer_name: 'Wilhelmina Testcase' } as Partial<PrivateBookingWithDetails>)),
    )
    // The name still appears elsewhere (cover, schedule); what must not happen
    // is it being printed as the signatory on the ruled line.
    expect(html).not.toContain('<span class="sf-v">Wilhelmina Testcase</span>')
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

  it('says a paid deposit was received and when, and never also calls it payable', () => {
    const html = generateContractHTML(
      baseData(makeBooking([], { deposit_amount: 250, deposit_paid_date: '2026-07-01' } as Partial<PrivateBookingWithDetails>)),
    )
    expect(html).toContain('£250.00')
    expect(html).toContain('Received Wednesday, 1 July 2026')
    expect(html).toContain('nothing to pay to confirm the booking')
    // The old copy printed "Status: paid" and then "Payable to confirm the
    // booking" in the same breath, which reads as though the money never
    // arrived. Both halves must be gone for a deposit already received.
    expect(html).not.toContain('Status: due')
    expect(html).not.toContain('Payable to confirm the booking')
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

describe('balance due date', () => {
  // Base booking event date is 2026-07-19, so an invented event−14 fallback
  // would render 5 July 2026 — the assertions below prove it never appears.

  it('prints the stored balance_due_date verbatim', () => {
    const html = generateContractHTML(
      baseData(makeBooking([], { balance_due_date: '2026-07-12' } as Partial<PrivateBookingWithDetails>)),
    )
    expect(html).toMatch(/due no later than <b>[^<]*12 July 2026<\/b>/)
    expect(html).not.toMatch(/\b5 July 2026/)
  })

  it('prints the stored date even when a stale TBD marker is present', () => {
    const html = generateContractHTML(
      baseData(makeBooking([], { balance_due_date: '2026-07-12', date_tbd: true } as Partial<PrivateBookingWithDetails>)),
    )
    expect(html).toMatch(/due no later than <b>[^<]*12 July 2026<\/b>/)
    expect(html).not.toContain('To be confirmed (date TBD)')
  })

  it('renders "To be confirmed" when no date is stored and the booking is not TBD — never a computed fallback', () => {
    const html = generateContractHTML(baseData(makeBooking()))
    expect(html).toContain('due no later than <b>To be confirmed</b>')
    expect(html).not.toMatch(/\b5 July 2026/)
  })

  it('renders "To be confirmed (date TBD)" when the booking is date-TBD with no stored date', () => {
    const html = generateContractHTML(
      baseData(makeBooking([], { date_tbd: true } as Partial<PrivateBookingWithDetails>)),
    )
    expect(html).toContain('due no later than <b>To be confirmed (date TBD)</b>')
  })

  it('never asserts the printed date is 14 days before the event', () => {
    const html = generateContractHTML(
      baseData(makeBooking([], { balance_due_date: '2026-07-12' } as Partial<PrivateBookingWithDetails>)),
    )
    expect(html).not.toContain('being 14 calendar days')
  })

  it('states the 14-day policy in the T&Cs with the contract-override caveat', () => {
    const html = generateContractHTML(baseData(makeBooking()))
    expect(html).toContain(
      'no later than <b>14 calendar days</b> before the event unless otherwise stated in this contract',
    )
  })
})

describe('schedule of booked items', () => {
  // Fixture warning: makeItem defaults line_total to 0. Any test that sets
  // unit_price without also setting line_total will print £0.00 lines against a
  // non-zero page 1 original. That is a test-authoring trap, not a defect.
  const priced = (overrides: Partial<PrivateBookingItem>): PrivateBookingItem => {
    const item = makeItem(overrides)
    const qty = Number(item.quantity)
    const price = Number(item.unit_price)
    if (item.line_total === 0 && Number.isFinite(qty) && Number.isFinite(price)) {
      return { ...item, line_total: Math.round(qty * price * 100) / 100 }
    }
    return item
  }

  const sheetCount = (html: string) => (html.match(/data-doc="contract"/g) || []).length
  const countOf = (html: string, needle: string) => html.split(needle).length - 1

  const space = priced({ item_type: 'space', description: 'The Dining Room', quantity: 5, unit_price: 25 })

  it('renders a fifth contract sheet when the booking has items', () => {
    const html = generateContractHTML(baseData(makeBooking([space])))
    expect(sheetCount(html)).toBe(5)
    expect(html).toContain('Schedule of booked items')
  })

  it('omits the schedule entirely for a zero-item booking', () => {
    const html = generateContractHTML(baseData(makeBooking()))
    expect(html).not.toContain('Schedule of booked items')
    expect(sheetCount(html)).toBe(4)
  })

  it('prints a space line as hours at the hourly rate', () => {
    const html = generateContractHTML(baseData(makeBooking([space])))
    expect(html).toContain('5 hours')
    expect(html).toContain('per hour')
    expect(html).toContain('£125.00')
  })

  it('prints a catering per-head line as guests', () => {
    const item = priced({
      item_type: 'catering',
      description: 'Finger Buffet',
      quantity: 30,
      unit_price: 10.5,
      package: { name: 'Finger Buffet', pricing_model: 'per_head' } as never,
    })
    const html = generateContractHTML(baseData(makeBooking([item])))
    expect(html).toContain('30 guests')
    expect(html).toContain('per guest')
    expect(html).toContain('£315.00')
  })

  it('prints per-tray and per-jar catering with the right noun', () => {
    const tray = priced({
      item_type: 'catering', description: 'Goujons', quantity: 2, unit_price: 25,
      package: { name: 'Goujons', pricing_model: 'per_tray' } as never,
    })
    const jar = priced({
      item_type: 'catering', description: 'Pickles', quantity: 3, unit_price: 4,
      package: { name: 'Pickles', pricing_model: 'per_jar' } as never,
    })
    const html = generateContractHTML(baseData(makeBooking([tray, jar])))
    expect(html).toContain('2 trays')
    expect(html).toContain('per tray')
    expect(html).toContain('3 jars')
    expect(html).toContain('per jar')
  })

  it('prints a vendor line as services charged each, with the title-cased type', () => {
    const item = priced({
      item_type: 'vendor', description: "Nick's Disco (dj)", quantity: 1, unit_price: 350,
      vendor: { name: "Nick's Disco", service_type: 'dj' } as never,
    })
    const html = generateContractHTML(baseData(makeBooking([item])))
    expect(html).toContain('1 service')
    expect(html).toContain('each')
    expect(html).toContain('(DJ)')
    expect(html).toContain('£350.00')
  })

  it('prints an other line as items charged each', () => {
    const item = priced({ item_type: 'other', description: 'Additional Electricity Supply', quantity: 1, unit_price: 25 })
    const html = generateContractHTML(baseData(makeBooking([item])))
    expect(html).toContain('1 item')
    expect(html).toContain('each')
  })

  it('formats a string quantity without trailing zeros', () => {
    const item = makeItem({
      item_type: 'space', description: 'The Dining Room',
      quantity: '5.00' as never, unit_price: '25.00' as never, line_total: '125.00' as never,
    })
    const html = generateContractHTML(baseData(makeBooking([item])))
    expect(html).toContain('5 hours')
    expect(html).not.toContain('5.00 hours')
    expect(html).toContain('£125.00')
  })

  it('renders a fractional quantity', () => {
    const item = makeItem({
      item_type: 'space', description: 'The Dining Room',
      quantity: '2.50' as never, unit_price: '25.00' as never, line_total: '62.50' as never,
    })
    const html = generateContractHTML(baseData(makeBooking([item])))
    expect(html).toContain('2.5 hours')
  })

  it('survives a non-finite quantity and a non-finite unit price', () => {
    const item = makeItem({
      item_type: 'other', description: 'Mystery charge',
      quantity: undefined as never, unit_price: undefined as never, line_total: 0,
    })
    let html = ''
    expect(() => { html = generateContractHTML(baseData(makeBooking([item]))) }).not.toThrow()
    expect(html).toContain('Not recorded')
    expect(html).not.toContain('NaN')
  })

  it('prints a comped line at zero with a 100% discount note', () => {
    const item = makeItem({
      item_type: 'space', description: 'The Dining Room',
      quantity: 5, unit_price: 25, line_total: 0, discount_type: 'percent', discount_value: 100,
    })
    const html = generateContractHTML(baseData(makeBooking([item])))
    expect(html).toContain('100% discount applied (included at no charge)')
    expect(html).toContain('£0.00')
  })

  it('prints no discount when the type is set but the value is zero', () => {
    const item = priced({
      item_type: 'space', description: 'The Dining Room',
      quantity: 5, unit_price: 25, discount_type: 'percent', discount_value: 0,
    })
    const html = generateContractHTML(baseData(makeBooking([item])))
    expect(html).not.toContain('discount applied')
  })

  it('prints no discount when a value is stored without a type, matching the generated column', () => {
    const item = priced({
      item_type: 'space', description: 'The Dining Room',
      quantity: 5, unit_price: 25, discount_type: undefined, discount_value: 25,
    })
    const html = generateContractHTML(baseData(makeBooking([item])))
    expect(html).not.toContain('discount applied')
  })

  it('prints the clamped effective discount, never the stored value', () => {
    const item = makeItem({
      item_type: 'other', description: 'Small charge',
      quantity: 1, unit_price: 20, line_total: 0, discount_type: 'fixed', discount_value: 35,
    })
    const html = generateContractHTML(baseData(makeBooking([item])))
    expect(html).toContain('£20.00 discount applied')
    expect(html).not.toContain('£35.00 discount applied')
  })

  it('escapes ampersands and angle brackets in the description and note', () => {
    const item = priced({
      item_type: 'other', description: 'Fish & Chips <script>alert(1)</script>',
      quantity: 1, unit_price: 10, notes: 'Note with <b>markup</b> & an ampersand',
    })
    const html = generateContractHTML(baseData(makeBooking([item])))
    expect(html).toContain('Fish &amp; Chips')
    expect(html).toContain('&lt;script&gt;')
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('&lt;b&gt;markup&lt;/b&gt;')
  })

  it('prints a material note in full rather than cutting it mid-term', () => {
    // The real production note this guards: an 88-character cap severed it just
    // before the £200 figure, which is a false statement on a legal document.
    const realNote =
      'If the weather is bad on the day and the party needs to move inside, there will be an additional charge of £200 for the dining room and main pub area.'
    const item = priced({ item_type: 'space', description: 'Outdoor Terrace/Garden', quantity: 4, unit_price: 25, notes: realNote })
    const html = generateContractHTML(baseData(makeBooking([item])))
    expect(html).toContain('additional charge of £200 for the dining room and main pub area.')
    expect(html).not.toContain('…')
  })

  it('still truncates a note beyond the two-line cap', () => {
    const longNote = 'x'.repeat(400)
    const item = priced({ item_type: 'other', description: 'Charge', quantity: 1, unit_price: 10, notes: longNote })
    const html = generateContractHTML(baseData(makeBooking([item])))
    expect(html).toContain('…')
    expect(html).not.toContain(longNote)
    expect(html).toContain('x'.repeat(199))
    expect(html).not.toContain('x'.repeat(200))
  })

  it('orders rows by display_order then created_at', () => {
    const items = [
      priced({ item_type: 'other', description: 'Third', quantity: 1, unit_price: 3, display_order: 2 }),
      priced({ item_type: 'other', description: 'First', quantity: 1, unit_price: 1, display_order: 0 }),
      priced({ item_type: 'other', description: 'Second', quantity: 1, unit_price: 2, display_order: 1 }),
    ]
    const html = generateContractHTML(baseData(makeBooking(items)))
    expect(html.indexOf('First')).toBeLessThan(html.indexOf('Second'))
    expect(html.indexOf('Second')).toBeLessThan(html.indexOf('Third'))
  })

  it('groups rows under the four headings and omits empty groups', () => {
    const html = generateContractHTML(baseData(makeBooking([space])))
    expect(html).toContain('Venue hire')
    expect(html).not.toContain('Food and drink')
    expect(html).not.toContain('Suppliers and entertainment')
    expect(html).not.toContain('Other charges')
  })

  it('renders the three-row tie-out when there is no booking-level discount', () => {
    const html = generateContractHTML(baseData(makeBooking([space])))
    expect(html).toContain('Sum of items listed above (excl. VAT)')
    expect(html).toContain('Event price, excluding deposit')
    expect(html).not.toContain('Less discount applied to the booking as a whole')
  })

  it('renders the five-row tie-out when a booking-level discount applies', () => {
    const html = generateContractHTML(
      baseData(makeBooking([space], { discount_type: 'percent', discount_amount: 10 } as Partial<PrivateBookingWithDetails>)),
    )
    expect(html).toContain('Sum of items listed above (excl. VAT)')
    expect(html).toContain('Less discount applied to the booking as a whole (excl. VAT)')
    expect(html).toContain('Event price before VAT')
    expect(html).toContain('Event price, excluding deposit')
    expect(html).toContain('A discount of 10% has been agreed on the booking as a whole')
  })

  it('never prints the booking-level discount reason', () => {
    const html = generateContractHTML(
      baseData(makeBooking([space], {
        discount_type: 'percent', discount_amount: 10, discount_reason: 'reg',
      } as Partial<PrivateBookingWithDetails>)),
    )
    expect(html).not.toContain('Reason:')
    expect(html).not.toContain('reg</')
  })

  it('makes the five-row tie-out subtract exactly, in integer pence', () => {
    const html = generateContractHTML(
      baseData(makeBooking(
        [priced({ item_type: 'other', description: 'Odd amount', quantity: 1, unit_price: 100.12 })],
        { discount_type: 'percent', discount_amount: 12.5 } as Partial<PrivateBookingWithDetails>,
      )),
    )
    const pence = (label: string): number => {
      // The whole entity is optional, not just its semicolon: `&minus;?` would
      // require the literal "&minus" and only make the ";" optional.
      const match = html.match(new RegExp(`${label}</span><span class="fv">(?:&minus;)?£([0-9.]+)</span>`))
      if (!match) throw new Error(`row not found: ${label}`)
      return Math.round(Number(match[1]) * 100)
    }
    const subtotal = pence('Sum of items listed above \\(excl\\. VAT\\)')
    const discount = pence('Less discount applied to the booking as a whole \\(excl\\. VAT\\)')
    const net = pence('Event price before VAT')
    expect(subtotal - discount).toBe(net)
  })

  it('makes the printed line values sum to the printed sub-total', () => {
    const items = [
      makeItem({ item_type: 'space', description: 'Room', quantity: 5, unit_price: 25, line_total: 0, discount_type: 'percent', discount_value: 100 }),
      priced({ item_type: 'catering', description: 'Buffet', quantity: 30, unit_price: 10.5, package: { name: 'Buffet', pricing_model: 'per_head' } as never }),
      priced({ item_type: 'catering', description: 'Tea', quantity: 10, unit_price: 4.49, package: { name: 'Tea', pricing_model: 'per_head' } as never }),
      priced({ item_type: 'catering', description: 'Squash', quantity: 20, unit_price: 3.5, package: { name: 'Squash', pricing_model: 'per_head' } as never }),
      priced({ item_type: 'other', description: 'Electricity', quantity: 1, unit_price: 25, notes: 'tbc' }),
    ]
    const html = generateContractHTML(baseData(makeBooking(items)))
    const lineCells = [...html.matchAll(/<div class="sched-c num">£([0-9.]+)<\/div>/g)].map((m) =>
      Math.round(Number(m[1]) * 100),
    )
    const summed = lineCells.reduce((s, n) => s + n, 0)
    // 0 + 315.00 + 44.90 + 70.00 + 25.00
    expect(summed).toBe(45490)
    const subtotal = html.match(
      /Sum of items listed above \(excl\. VAT\)<\/span><span class="fv">£([0-9.]+)<\/span>/,
    )
    expect(subtotal).not.toBeNull()
    expect(Math.round(Number(subtotal![1]) * 100)).toBe(summed)
  })

  it('ends the tie-out at the same gross event price as page 1', () => {
    const html = generateContractHTML(baseData(makeBooking([space])))
    // Once in the page 1 financial summary, once as the schedule's final row.
    expect(countOf(html, 'Event price, excluding deposit')).toBe(2)
    // 5 x £25.00 net = £125.00, plus 20% VAT = £150.00. Both rows carry it, and
    // so does the agreement clause on the signature page, which is why this
    // asserts the labelled rows rather than a raw count of the figure.
    expect(
      countOf(html, 'Event price, excluding deposit</span><span class="fv">£150.00</span>'),
    ).toBe(2)
  })

  it('renders a zero-value schedule for an all-comped booking', () => {
    const item = makeItem({
      item_type: 'space', description: 'The Dining Room',
      quantity: 5, unit_price: 25, line_total: 0, discount_type: 'percent', discount_value: 100,
    })
    const html = generateContractHTML(baseData(makeBooking([item])))
    expect(html).not.toContain('NaN')
    expect(html).toContain('Sum of items listed above (excl. VAT)</span><span class="fv">£0.00</span>')
  })

  it('states the deposit is held separately and excluded from the schedule', () => {
    const html = generateContractHTML(baseData(makeBooking([space], { deposit_amount: 100 })))
    expect(html).toContain('is not part of the event price')
    expect(html).toContain('The booking and damage deposit of £100.00')
  })

  it('states that no deposit is payable when the booking has none', () => {
    const html = generateContractHTML(baseData(makeBooking([space], { deposit_amount: 0 })))
    expect(html).toContain('No booking and damage deposit is payable for this event.')
  })

  it('splits into a second schedule sheet above six items', () => {
    const items = Array.from({ length: 7 }, (_, i) =>
      priced({ item_type: 'other', description: `Charge ${i + 1}`, quantity: 1, unit_price: 10, display_order: i }),
    )
    const html = generateContractHTML(baseData(makeBooking(items)))
    expect(sheetCount(html)).toBe(6)
  })

  it('puts the tie-out on the last schedule sheet only', () => {
    const items = Array.from({ length: 7 }, (_, i) =>
      priced({ item_type: 'other', description: `Charge ${i + 1}`, quantity: 1, unit_price: 10, display_order: i }),
    )
    const html = generateContractHTML(baseData(makeBooking(items)))
    expect(countOf(html, 'Sum of items listed above (excl. VAT)')).toBe(1)
  })

  it('never emits the strings the existing near-miss assertions guard', () => {
    const html = generateContractHTML(baseData(makeBooking([space], { deposit_amount: 0 })))
    expect(html).not.toContain('Special requirements')
    expect(html).not.toContain('deposit of <b>£0.00</b>')
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
