import { describe, expect, it } from 'vitest'
import {
  sumKitchenCoversInWindow,
  resolveKitchenCeiling,
  isSundayDate,
  buildKitchenAvailabilitySlots,
  type KitchenBookingRow,
  type KitchenPacingSettings,
} from './kitchen-pacing'

const NOW = new Date('2026-07-05T10:00:00.000Z')

function row(partial: Partial<KitchenBookingRow>): KitchenBookingRow {
  return {
    booking_time: '19:00',
    booking_purpose: 'food',
    party_size: 4,
    committed_party_size: null,
    status: 'confirmed',
    left_at: null,
    hold_expires_at: null,
    payment_status: null,
    ...partial,
  }
}

const SETTINGS: KitchenPacingSettings = {
  enabled: true,
  windowMinutes: 30,
  paceCoversRegular: 25,
  paceCoversSunday: 20,
  walkInReserveRegular: 6,
  walkInReserveSunday: 6,
}

describe('sumKitchenCoversInWindow', () => {
  it('sums food covers inside the centered window and ignores those outside it', () => {
    const rows = [
      row({ booking_time: '19:00', party_size: 4 }), // center
      row({ booking_time: '19:10', party_size: 2 }), // +10 -> inside [18:45,19:15)
      row({ booking_time: '19:20', party_size: 5 }), // +20 -> outside
      row({ booking_time: '18:40', party_size: 3 }), // -20 -> outside
    ]
    expect(sumKitchenCoversInWindow(rows, 19 * 60, 30, NOW)).toBe(6)
  })

  it('excludes drinks-only covers', () => {
    const rows = [row({ booking_purpose: 'drinks', party_size: 8 })]
    expect(sumKitchenCoversInWindow(rows, 19 * 60, 30, NOW)).toBe(0)
  })

  it('prefers committed_party_size over party_size', () => {
    const rows = [row({ committed_party_size: 6, party_size: 2 })]
    expect(sumKitchenCoversInWindow(rows, 19 * 60, 30, NOW)).toBe(6)
  })

  it('excludes cancelled, no_show, left, and expired unpaid holds', () => {
    const rows = [
      row({ status: 'cancelled', party_size: 4 }),
      row({ status: 'no_show', party_size: 4 }),
      row({ left_at: '2026-07-05T19:30:00Z', party_size: 4 }),
      row({ status: 'pending_payment', hold_expires_at: '2026-07-05T09:00:00Z', payment_status: 'pending', party_size: 4 }),
    ]
    expect(sumKitchenCoversInWindow(rows, 19 * 60, 30, NOW)).toBe(0)
  })

  it('includes a live (unexpired) hold', () => {
    const rows = [row({ status: 'pending_payment', hold_expires_at: '2026-07-05T23:00:00Z', payment_status: 'pending', party_size: 4 })]
    expect(sumKitchenCoversInWindow(rows, 19 * 60, 30, NOW)).toBe(4)
  })
})

describe('resolveKitchenCeiling', () => {
  it('uses regular pace minus reserve on a weekday', () => {
    expect(resolveKitchenCeiling(SETTINGS, '2026-07-06', null)).toBe(25 - 6) // Monday
  })
  it('uses sunday pace minus reserve on a Sunday', () => {
    expect(resolveKitchenCeiling(SETTINGS, '2026-07-05', null)).toBe(20 - 6) // Sunday
  })
  it('applies a per-date override when present', () => {
    expect(resolveKitchenCeiling(SETTINGS, '2026-07-06', { paceCovers: 40, walkInReserve: 10 })).toBe(30)
  })
  it('never returns below zero', () => {
    expect(resolveKitchenCeiling({ ...SETTINGS, paceCoversRegular: 3, walkInReserveRegular: 10 }, '2026-07-06', null)).toBe(0)
  })
})

describe('isSundayDate', () => {
  it('detects Sunday from a YYYY-MM-DD string', () => {
    expect(isSundayDate('2026-07-05')).toBe(true)
    expect(isSundayDate('2026-07-06')).toBe(false)
  })
})

describe('buildKitchenAvailabilitySlots', () => {
  it('returns covers and remaining per grid slot', () => {
    const rows = [row({ booking_time: '19:00', party_size: 10 })]
    const slots = buildKitchenAvailabilitySlots(rows, SETTINGS, '2026-07-06', 18 * 60, 20 * 60, 30, null, NOW)
    // half-open [18:00, 20:00): grid 18:00, 18:30, 19:00, 19:30 ; ceiling weekday = 19
    const at1900 = slots.find((s) => s.time === '19:00')!
    expect(at1900.covers).toBe(10)
    expect(at1900.remaining).toBe(9)
    const at1800 = slots.find((s) => s.time === '18:00')!
    expect(at1800.covers).toBe(0)
    expect(at1800.remaining).toBe(19)
    // end is exclusive — no slot emitted at the close boundary
    expect(slots.some((s) => s.time === '20:00')).toBe(false)
  })
})
