export const FOH_BOOKING_CLIENT_HEADER = 'x-foh-booking-client'
export const FOH_BOOKING_CLIENT_CONTRACT = '2026-08-14-v1'

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

