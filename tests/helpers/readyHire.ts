import { vi } from 'vitest'
import type * as Readiness from '@/services/private-bookings/readiness'

/**
 * A private hire that passes the confirmation checks (owner decisions D24 and D25): one room that
 * holds its guests, a guest count, and a contract sent. For tests about something else, so that
 * confirming a booking still works as the test expects without modelling rooms and contracts.
 *
 *   vi.mock('@/services/private-bookings/readiness', async (importOriginal) =>
 *     (await import('../helpers/readyHire')).readyHireReadiness(importOriginal))
 *
 * The checks themselves are tested in tests/services/privateHireReadiness.test.ts.
 */
export const READY_ROOM = {
  id: 'space-ready-room',
  name: 'The Dining Room',
  capacity_seated: 26,
  capacity_standing: 50,
  blocks_all_spaces: false,
  active: true,
  display_order: 1,
}

export function readyHireFacts(bookingId: string): Readiness.HireReadinessFacts {
  return {
    bookingId,
    status: 'draft',
    guestCount: 40,
    layout: null,
    rooms: [READY_ROOM],
    override: null,
    contractSentAt: '2026-01-01T12:00:00.000Z',
    contractAcceptedAt: null,
    depositPaidDate: null,
    depositConfirmedAt: null,
    depositWaived: false,
    lastConfirmationBlock: null,
  }
}

export async function readyHireReadiness(importOriginal: () => Promise<unknown>): Promise<typeof Readiness> {
  const actual = (await importOriginal()) as typeof Readiness
  return {
    ...actual,
    loadOneHireReadiness: vi.fn(async (bookingId: string) => ({ facts: readyHireFacts(bookingId), rooms: [READY_ROOM] })),
    loadHireReadinessFacts: vi.fn(async (bookingIds: string[]) => ({
      facts: new Map(bookingIds.map((id) => [id, readyHireFacts(id)])),
      rooms: [READY_ROOM],
    })),
  }
}
