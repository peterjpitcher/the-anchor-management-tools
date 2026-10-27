import { describe, expect, it } from 'vitest'
import { requiresGuestDetails } from '@/lib/events/booking-questions'

// BK-014 and owner decision D4: one setting on each event says whether every ticket needs a name
// and the event's answers. Unset follows the default: events paid online in advance.
describe('requiresGuestDetails', () => {
  it('asks by default only on events paid online in advance', () => {
    expect(requiresGuestDetails({ payment_mode: 'prepaid' })).toBe(true)
    expect(requiresGuestDetails({ payment_mode: 'prepaid', collect_guest_details: null })).toBe(true)
    expect(requiresGuestDetails({ payment_mode: 'cash_only' })).toBe(false)
    expect(requiresGuestDetails({ payment_mode: 'free' })).toBe(false)
    expect(requiresGuestDetails({ payment_mode: null })).toBe(false)
  })

  it('follows the event setting when a manager has chosen', () => {
    expect(requiresGuestDetails({ payment_mode: 'cash_only', collect_guest_details: true })).toBe(true)
    expect(requiresGuestDetails({ payment_mode: 'prepaid', collect_guest_details: false })).toBe(false)
  })
})
