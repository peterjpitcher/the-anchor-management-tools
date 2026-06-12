import { describe, expect, it } from 'vitest'
import { generateEventBookingSheetsHTML } from './event-booking-sheet-template'

const baseSheet = {
  bookingRef: 'TB-123',
  eventName: 'Music Bingo',
  eventDate: 'Friday, 12 June 2026',
  startTime: '8:00pm',
  host: 'Nikki',
  customerName: 'Test Guest',
  seats: '2',
  seatingType: 'Seated',
  tableNumber: 'Big Bay',
  price: '£6.00',
  priceNote: 'Event price: £3.00 per person · 2 guests',
  paymentMethod: 'Cash on arrival',
  bookingNotes: null,
}

describe('booking sheet template', () => {
  it('renders Sunday roast items from provided menu data', () => {
    const html = generateEventBookingSheetsHTML([baseSheet], {
      logoDataUrl: 'data:image/png;base64,logo',
      sundayRoastQrDataUrl: 'data:image/png;base64,qr',
      sundayRoastItems: [
        { name: 'Roasted Beef', price: '19' },
        { name: 'Vegan Wellington', price: '18.50', badge: 'VG' },
      ],
    })

    expect(html).toContain('Roasted Beef')
    expect(html).toContain('19')
    expect(html).toContain('Vegan Wellington')
    expect(html).toContain('18.50')
    expect(html).not.toContain('Roasted Pork')
  })
})
