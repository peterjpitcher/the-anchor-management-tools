export const FOH_BOOKING_CLIENT_HEADER = 'x-foh-booking-client'
// Bumped on 6 November 2026 when the create form stopped asking for Christmas courses (owner decision
// D1), so an open FOH screen still showing the course picker reloads before it books.
export const FOH_BOOKING_CLIENT_CONTRACT = '2026-11-06-v1'

export const FOH_CLIENT_OUTDATED_CODE = 'FOH_CLIENT_OUTDATED'

export type FohBookingCustomerMode = 'selected' | 'phone' | 'anonymous'

export function isCurrentFohBookingClient(value: string | null): boolean {
  return value === FOH_BOOKING_CLIENT_CONTRACT
}

export function getFohBookingClientHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    [FOH_BOOKING_CLIENT_HEADER]: FOH_BOOKING_CLIENT_CONTRACT,
  }
}

