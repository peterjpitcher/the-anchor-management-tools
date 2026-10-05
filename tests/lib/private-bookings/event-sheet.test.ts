import { describe, expect, it } from 'vitest'
import { generateEventSheetHTML, type EventSheetData } from '@/lib/private-bookings/event-sheet'

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
