import { describe, expect, it } from 'vitest'
import { generateEventSheetHTML, type EventSheetData } from '@/lib/private-bookings/event-sheet'
import { effectiveWaiverStatus } from '@/lib/private-bookings/waiver-status'

const DATA: EventSheetData = {
  bookingId: '3f1c2a9e-0000-4000-8000-000000000001',
  bookingStatus: 'confirmed',
  hostName: 'Jane <Smith>',
  contactPhone: '07700 900123',
  eventType: 'Birthday party',
  eventDate: '2026-11-14',
  startTime: '18:00',
  endTime: '23:00',
  endTimeNextDay: false,
  setupDate: null,
  setupTime: null,
  cleardownTime: null,
  guestCount: 40,
  guestCountAdults: 40,
  guestCountUnder18: 0,
  layout: null,
  items: [],
  barTabRequired: false,
  barTabLimit: null,
  barTabPrepaidAmount: null,
  barTabPreauthReference: null,
  accessibilityNotes: null,
  dietaryNotes: null,
  outsideFood: false,
  waiverStatus: 'not_required',
  supplierStatus: 'none',
  suppliers: [],
  highPowerEquipment: false,
  highPowerEquipmentApprovedAt: null,
  decorationsPlan: null,
  dogsExpected: false,
  riskStatus: 'normal',
  specialRiskNotes: null,
}

const LOGO = 'data:image/png;base64,AAAA'

describe('generateEventSheetHTML', () => {
  it('prints The Anchor logo in the header when one is given', () => {
    const html = generateEventSheetHTML(DATA, { logoUrl: LOGO })

    expect(html).toContain(`<img class="sheet-logo" src="${LOGO}" alt="The Anchor" />`)
    expect(html).toContain('<div class="sheet-header">')
  })

  it('renders without an image when no logo is given', () => {
    const html = generateEventSheetHTML(DATA)

    expect(html).not.toContain('<img')
    expect(html).toContain('Staff Event Sheet')
  })

  it('escapes the host name', () => {
    const html = generateEventSheetHTML(DATA, { logoUrl: LOGO })

    expect(html).toContain('Jane &lt;Smith&gt;')
    expect(html).not.toContain('Jane <Smith>')
  })
})

describe('the unsigned food agreement blocker on the event sheet', () => {
  // The sheet tells staff on the night whether outside food may be served.
  const BLOCKER = 'Self-catering waiver is NOT signed'
  const BANNER = '<div class="banner">'

  it.each(['required', 'sent', 'overdue'])('blocks while the agreement is %s', (waiverStatus) => {
    const html = generateEventSheetHTML({ ...DATA, outsideFood: true, waiverStatus })

    expect(html).toContain(BANNER)
    expect(html).toContain(BLOCKER)
    expect(html).toContain('outside food must not be served until it is')
    expect(html).toContain(`Outside food IS involved. Waiver status: ${waiverStatus.toUpperCase()}.`)
  })

  it.each(['signed', 'not_required'])('does not block when the agreement is %s', (waiverStatus) => {
    const html = generateEventSheetHTML({ ...DATA, outsideFood: waiverStatus === 'signed', waiverStatus })

    expect(html).not.toContain(BLOCKER)
    // Nothing else on this booking blocks, so there is no banner at all.
    expect(html).not.toContain(BANNER)
  })

  it('blocks a booking stored as not required with "Outside food" ticked, given the effective status', () => {
    // The stored status is out of date for a tick made before the tick counted (13 October 2026).
    const waiverStatus = effectiveWaiverStatus({ outside_food: true, waiver_status: 'not_required' })
    const html = generateEventSheetHTML({ ...DATA, outsideFood: true, waiverStatus })

    expect(waiverStatus).toBe('required')
    expect(html).toContain(BLOCKER)
    expect(html).toContain('Outside food IS involved. Waiver status: REQUIRED.')
    expect(html).not.toContain('NOT_REQUIRED')
  })

  it('lists it beside the other blockers, not instead of them', () => {
    const html = generateEventSheetHTML({ ...DATA, outsideFood: true, waiverStatus: 'overdue', supplierStatus: 'incomplete', riskStatus: 'high' })

    expect(html).toContain(BLOCKER)
    expect(html).toContain('Supplier documents incomplete')
    expect(html).toContain('Risk review required')
  })
})
