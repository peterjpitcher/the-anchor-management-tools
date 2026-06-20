import { describe, expect, it } from 'vitest'
import {
  buildBookingLoad,
  normalizePacingSettings,
  validatePacingSettings,
} from '@/lib/table-bookings/load'

const now = new Date('2026-06-20T12:00:00.000Z')

function row(overrides: Record<string, unknown>) {
  return {
    booking_time: '13:00:00',
    party_size: 2,
    committed_party_size: null,
    status: 'confirmed',
    left_at: null,
    hold_expires_at: null,
    payment_status: null,
    ...overrides,
  } as any
}

describe('table booking load helpers', () => {
  it('aggregates non-PII covers by booking time and prefers committed party size', () => {
    expect(buildBookingLoad([
      row({ booking_time: '13:00:00', party_size: 2, committed_party_size: 4 }),
      row({ booking_time: '13:00', party_size: 3 }),
      row({ booking_time: '13:30:00', party_size: 5 }),
    ], now)).toEqual([
      { time: '13:00', covers: 7 },
      { time: '13:30', covers: 5 },
    ])
  })

  it('ignores cancelled, no-show, left, and expired unpaid holds', () => {
    expect(buildBookingLoad([
      row({ status: 'cancelled', party_size: 10 }),
      row({ status: 'no_show', party_size: 10 }),
      row({ left_at: '2026-06-20T11:00:00.000Z', party_size: 10 }),
      row({
        status: 'pending_payment',
        hold_expires_at: '2026-06-20T11:59:00.000Z',
        payment_status: 'pending',
        party_size: 10,
      }),
      row({
        status: 'pending_card_capture',
        hold_expires_at: '2026-06-20T11:59:00.000Z',
        payment_status: 'pending',
        party_size: 10,
      }),
      row({
        status: 'pending_payment',
        hold_expires_at: '2026-06-20T11:59:00.000Z',
        payment_status: 'completed',
        party_size: 6,
      }),
    ], now)).toEqual([
      { time: '13:00', covers: 6 },
    ])
  })

  it('normalizes invalid pacing settings to safe defaults', () => {
    expect(normalizePacingSettings({
      busyThresholdCovers: '30',
      fillingThresholdCovers: { value: '20' },
      windowMinutes: { minutes: '60' },
    })).toEqual({
      busyThresholdCovers: 30,
      fillingThresholdCovers: 20,
      windowMinutes: 60,
    })
  })

  it('rejects invalid pacing updates', () => {
    expect(validatePacingSettings({
      busyThresholdCovers: 20,
      fillingThresholdCovers: 20,
      windowMinutes: 60,
    })).toEqual({
      ok: false,
      error: 'Filling threshold must be lower than busy threshold',
    })
  })
})
