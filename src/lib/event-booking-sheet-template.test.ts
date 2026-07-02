import { describe, expect, it } from 'vitest'
import { generateEventBookingSheetsHTML } from './event-booking-sheet-template'

import type { EventBookingSheetData } from './event-booking-sheet-template'

const baseSheet: EventBookingSheetData = {
  bookingRef: 'TB-123',
  eventName: 'Music Bingo',
  eventDate: 'Friday, 12 June 2026',
  startTime: '8:00pm',
  host: 'Nikki',
  customerName: 'Test Guest',
  seats: '2',
  seatingType: 'Seated',
  attendeeNames: [],
  tableNumber: 'Big Bay',
  price: '£6.00',
  priceNote: 'Event price: £3.00 per person · 2 guests',
  paymentMethod: 'Cash on arrival',
  bookingNotes: null,
}

const options = {
  logoDataUrl: 'data:image/png;base64,logo',
  sundayRoastQrDataUrl: 'data:image/png;base64,qr',
  sundayRoastItems: [
    { name: 'Roasted Beef', price: '19' },
    { name: 'Vegan Wellington', price: '18.50', badge: 'VG' },
  ],
}

describe('booking sheet template', () => {
  it('renders Sunday roast items from provided menu data', () => {
    const html = generateEventBookingSheetsHTML([baseSheet], options)

    expect(html).toContain('Roasted Beef')
    expect(html).toContain('19')
    expect(html).toContain('Vegan Wellington')
    expect(html).toContain('18.50')
    expect(html).not.toContain('Roasted Pork')
  })

  it('lists per-ticket attendee names when provided', () => {
    const html = generateEventBookingSheetsHTML(
      [{ ...baseSheet, attendeeNames: ['Alice Booker', 'Bob Guest'] }],
      options,
    )

    expect(html).toContain('Guests')
    expect(html).toContain('1. Alice Booker')
    expect(html).toContain('2. Bob Guest')
  })

  it('omits the guests block when there are no attendee names', () => {
    const html = generateEventBookingSheetsHTML([baseSheet], options)
    expect(html).not.toContain('>Guests<')
  })
})
