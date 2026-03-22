/**
 * Weekly digest tier classification for private bookings.
 *
 * Pure function — no external dependencies. Takes a booking row and
 * context (dates, SMS counts) and returns an urgency tier (1-3) with
 * human-readable labels explaining why.
 */

export type WeeklyDigestBookingRow = {
  id: string
  customer_name: string | null
  customer_first_name: string | null
  customer_last_name: string | null
  status: string | null
  event_date: string | null
  start_time: string | null
  hold_expiry: string | null
  updated_at: string | null
  guest_count: number | null
  event_type: string | null
  contact_email: string | null
  contact_phone: string | null
  balance_due_date: string | null
  balance_remaining: number | null
  final_payment_date: string | null
  internal_notes: string | null
}

export type TierClassification = {
  tier: 1 | 2 | 3
  labels: string[]
}

export type ClassificationContext = {
  now: Date
  todayDateKey: string // YYYY-MM-DD (London)
  endOfWeekDateKey: string // Sunday YYYY-MM-DD (London)
  pendingSmsCount: number // from SMS queue lookup
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** A booking has outstanding balance when balance_remaining > 0 AND final_payment_date is null. */
export function hasOutstandingBalance(row: WeeklyDigestBookingRow): boolean {
  return (row.balance_remaining ?? 0) > 0 && row.final_payment_date === null
}

/** Days between two YYYY-MM-DD date strings. Positive if `b` is after `a`. */
function daysBetween(a: string, b: string): number {
  const msPerDay = 86_400_000
  const dateA = new Date(a + 'T00:00:00Z')
  const dateB = new Date(b + 'T00:00:00Z')
  return Math.round((dateB.getTime() - dateA.getTime()) / msPerDay)
}

/** Format a currency amount as £X.XX */
function formatGBP(amount: number): string {
  return `£${amount.toFixed(2)}`
}

/** Format a hold_expiry ISO string as "YYYY-MM-DD HH:MM" */
function formatHoldExpiry(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number): string => String(n).padStart(2, '0')
  const date = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
  const time = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
  return `${date} ${time}`
}

// ---------------------------------------------------------------------------
// Tier 1 checks
// ---------------------------------------------------------------------------

function collectTier1Labels(
  row: WeeklyDigestBookingRow,
  ctx: ClassificationContext,
): string[] {
  const labels: string[] = []
  const isDraft = row.status === 'draft'
  const outstanding = hasOutstandingBalance(row)

  // Draft hold expired
  if (isDraft && row.hold_expiry !== null) {
    const expiry = new Date(row.hold_expiry)
    if (expiry <= ctx.now) {
      labels.push('Hold expired')
    }
  }

  // Draft event approaching (within 14 days)
  if (isDraft && row.event_date !== null) {
    const daysUntil = daysBetween(ctx.todayDateKey, row.event_date)
    if (daysUntil >= 0 && daysUntil <= 14) {
      labels.push(`Event in ${daysUntil} days — still draft`)
    }
  }

  // Balance overdue
  if (outstanding && row.balance_due_date !== null && row.balance_due_date < ctx.todayDateKey) {
    labels.push(`Balance overdue: ${formatGBP(row.balance_remaining!)}`)
  }

  // Stale draft (not updated in 7+ days)
  if (isDraft && row.updated_at !== null) {
    const updatedDate = row.updated_at.slice(0, 10) // YYYY-MM-DD
    const staleDays = daysBetween(updatedDate, ctx.todayDateKey)
    if (staleDays >= 7) {
      labels.push(`Not touched in ${staleDays} days`)
    }
  }

  // Missing details
  const missingFields: string[] = []
  if (row.guest_count === null) missingFields.push('guest count')
  if (row.event_type === null) missingFields.push('event type')
  if (row.contact_email === null && row.contact_phone === null) missingFields.push('contact info')
  if (missingFields.length > 0) {
    labels.push(`Missing: ${missingFields.join(', ')}`)
  }

  // Balance due this week
  if (
    outstanding &&
    row.balance_due_date !== null &&
    row.balance_due_date >= ctx.todayDateKey &&
    row.balance_due_date <= ctx.endOfWeekDateKey
  ) {
    labels.push(`Balance due: ${formatGBP(row.balance_remaining!)} by ${row.balance_due_date}`)
  }

  return labels
}

// ---------------------------------------------------------------------------
// Tier 2 checks
// ---------------------------------------------------------------------------

function collectTier2Labels(
  row: WeeklyDigestBookingRow,
  ctx: ClassificationContext,
): string[] {
  const labels: string[] = []
  const isDraft = row.status === 'draft'
  const outstanding = hasOutstandingBalance(row)

  // Hold expiring soon (within 48h, not yet expired)
  if (isDraft && row.hold_expiry !== null) {
    const expiry = new Date(row.hold_expiry)
    const msUntilExpiry = expiry.getTime() - ctx.now.getTime()
    const hoursUntilExpiry = msUntilExpiry / (1000 * 60 * 60)
    if (hoursUntilExpiry > 0 && hoursUntilExpiry <= 48) {
      labels.push(`Hold expires ${formatHoldExpiry(row.hold_expiry)}`)
    }
  }

  // Pending SMS
  if (ctx.pendingSmsCount > 0) {
    labels.push(`${ctx.pendingSmsCount} SMS pending approval`)
  }

  // Date/time unconfirmed
  if (row.internal_notes !== null && row.internal_notes.includes('Event date/time to be confirmed')) {
    labels.push('Date/time TBC')
  }

  // Confirmed but unpaid (balance_due_date in the future, not this week)
  if (
    row.status === 'confirmed' &&
    outstanding &&
    row.balance_due_date !== null &&
    row.balance_due_date >= ctx.todayDateKey
  ) {
    labels.push(`Outstanding: ${formatGBP(row.balance_remaining!)}`)
  }

  return labels
}

// ---------------------------------------------------------------------------
// Main classifier
// ---------------------------------------------------------------------------

export function classifyBookingTier(
  row: WeeklyDigestBookingRow,
  ctx: ClassificationContext,
): TierClassification {
  const tier1Labels = collectTier1Labels(row, ctx)
  if (tier1Labels.length > 0) {
    return { tier: 1, labels: tier1Labels }
  }

  const tier2Labels = collectTier2Labels(row, ctx)
  if (tier2Labels.length > 0) {
    return { tier: 2, labels: tier2Labels }
  }

  return { tier: 3, labels: [] }
}
