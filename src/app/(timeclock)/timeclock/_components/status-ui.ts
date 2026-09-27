/**
 * Clocked in or not, on the timeclock kiosk tiles. Clocked-in staff get the soft primary
 * highlight so a glance across the grid shows who is on.
 */
export type KioskClockState = 'in' | 'out'

export const KIOSK_TILE_CLASSES: Record<KioskClockState, string> = {
  in: 'border-primary bg-primary-soft',
  out: 'border-border bg-surface hover:bg-surface-hover',
}

export const KIOSK_DOT_CLASSES: Record<KioskClockState, string> = {
  in: 'bg-primary',
  out: 'bg-text-subtle',
}
