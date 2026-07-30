// Voucher system constants (spec: tasks/voucher-system-spec-2026-07-30.md)

// Generation caps (spec 3.2)
export const MAX_PER_TYPE_PER_BATCH = 200
export const MAX_CARDS_PER_BATCH = 100

// Overview low-stock warning threshold per type (spec 3.1)
export const LOW_STOCK_THRESHOLD = 5

// FOH undo window after a redeem, in seconds (spec 2.5)
export const UNDO_WINDOW_SECONDS = 60

// Expiry presets offered at hand-out, in days from issue (spec 3.3)
export const EXPIRY_PRESET_DAYS = [30, 60, 90] as const

// FOH lookup guards (spec section 4, F32)
export const LOOKUP_MIN_CHARS = 4
export const LOOKUP_MAX_RESULTS = 10

// Reminder rules (spec 5.2, F17/F18). Two reminders per voucher, both counted
// back from the expiry date: 7 days before, then 3 days before. Order matters:
// the schedule derivation and the kind names (pre_expiry_7, pre_expiry_3) are
// both built from this list.
export const REMINDER_MAX_SENDS = 2
export const REMINDER_LEAD_DAYS = [7, 3] as const

// Print layout: front + inside per card (spec section 6)
export const PDF_PAGES_PER_CARD = 2

// "Redeemed today" style day counters roll over at 6am London (spec 3.1)
export const EVENT_DAY_CUTOVER_HOUR = 6
