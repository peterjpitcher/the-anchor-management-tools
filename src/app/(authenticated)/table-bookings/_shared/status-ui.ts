/**
 * Status colours for the table booking screens that the shared booking status map
 * (TABLE_BOOKING_STATUS_TONE in src/lib/table-bookings/ui.ts) does not cover.
 */

/** How much of a deposit has gone back: all of it reads as settled (info), part of it as open (warning). */
export const TABLE_BOOKING_REFUND_PROGRESS_TONE = {
  refunded: 'info',
  partial: 'warning',
} as const
