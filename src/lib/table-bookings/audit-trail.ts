/**
 * The Audit Trail card on a table booking (BK-038, customer bookings review of 24 October 2026).
 *
 * The card read booking_audit, which nothing has written since 8 June 2026, so every booking since
 * showed "No audit events yet" while moves, seatings, departures, messages and payments were being
 * recorded in audit_logs all along. It now reads audit_logs (resource_type 'table_booking',
 * resource_id the booking id), and keeps the legacy booking_audit rows readable beside them.
 *
 * Pure: both lists come in as rows, one sorted list comes out.
 */

export type BookingAuditTrailEntry = {
  id: string
  /** The recorded event, e.g. 'move_table' or 'table_booking.seated'. */
  event: string
  /** What staff read: "Table moved", "Seated". */
  label: string
  old_status: string | null
  new_status: string | null
  /** The event's own details, shown under the label. */
  meta: Record<string, unknown>
  created_at: string
  /** Who did it: a member of staff's email, "Team member" when only an id was recorded, or "System". */
  actor: string
}

export type AuditLogRow = {
  id: string
  operation_type: string
  user_id: string | null
  user_email: string | null
  additional_info: unknown
  new_values: unknown
  old_values: unknown
  created_at: string
}

export type LegacyBookingAuditRow = {
  id: number | string
  event: string
  old_status: string | null
  new_status: string | null
  meta: unknown
  created_at: string
  created_by: string | null
}

const LABELS: Record<string, string> = {
  // audit_logs
  create: 'Booking created',
  update: 'Booking updated',
  cancel: 'Cancelled',
  delete: 'Deleted',
  refund: 'Refund',
  email_sent: 'Email sent',
  move_table: 'Table moved',
  change_time: 'Time changed',
  'table_booking.seated': 'Seated',
  'table_booking.left': 'Marked as left',
  'table_booking.no_show': 'Marked as no-show',
  'table_booking.cancelled': 'Cancelled',
  'table_booking.auto_cancelled': 'Cancelled: deposit not paid in time',
  'table_booking.party_size_changed': 'Party size changed',
  'table_booking.party_size_changed_by_guest': 'Party size changed by the guest',
  'table_booking.deposit_waived': 'Deposit waived',
  'table_booking.deposit_repriced': 'Deposit changed with the party size',
  'table_booking.deposit_owed': 'Deposit now owed',
  'table_booking.deposit_review_needed': 'Deposit flagged for a manager',
  'table_booking.deposit_review_cleared': 'Deposit checked by a manager',
  'table_booking.notification_sent': 'Guest message sent',
  'table_booking.notification_failed': 'Guest message not delivered',
  'table_booking.sms_sent': 'Text sent',
  'table_booking.sms_failed': 'Text not sent',
  'table_booking.preorder_staff_override': 'Pre-order changed by staff',
  'payment.order_created': 'PayPal payment started',
  'payment.captured': 'Deposit paid',
  'payment.capture_pending': 'Deposit held by PayPal for review',
  'payment.capture_declined': 'Deposit refused by PayPal',
  'payment.capture_failed': 'Deposit payment failed',
  'payment.capture_amount_mismatch': 'Deposit amount did not match',
  'payment.capture_local_update_failed': 'Deposit taken but not recorded',
  // booking_audit (legacy, written until 8 June 2026)
  booking_created: 'Booking created',
  status_changed: 'Status changed',
  status_updated: 'Status updated',
  party_size_updated: 'Party size updated',
  table_moved: 'Table moved',
  table_assigned: 'Table assigned',
  sms_sent: 'Text sent',
  sms_failed: 'Text not sent',
  deposit_paid: 'Deposit paid',
  deposit_link_created: 'Deposit link created',
  refund_created: 'Refund created',
  payment_completed: 'Payment completed',
}

/** "move_table" -> "Move table", for an event this list has no words for yet. */
function fallbackLabel(event: string): string {
  const words = event.replace(/^table_booking\./, '').replace(/[._]+/g, ' ').trim()
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : 'Event'
}

export function auditEventLabel(event: string): string {
  return LABELS[event] ?? fallbackLabel(event)
}

function asObject(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') {
    try {
      return asObject(JSON.parse(value))
    } catch {
      return {}
    }
  }
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

export function buildBookingAuditTrail(
  auditLogs: AuditLogRow[],
  legacy: LegacyBookingAuditRow[] = [],
): BookingAuditTrailEntry[] {
  const fromLogs = auditLogs.map((row): BookingAuditTrailEntry => {
    const info = asObject(row.additional_info)
    const newValues = asObject(row.new_values)
    const oldValues = asObject(row.old_values)
    return {
      id: `log:${row.id}`,
      event: row.operation_type,
      label: auditEventLabel(row.operation_type),
      old_status: text(oldValues.status) ?? text(info.status_from) ?? text(info.previous_status),
      new_status: text(newValues.status) ?? text(info.status_to) ?? text(info.new_status),
      meta: { ...newValues, ...info },
      created_at: row.created_at,
      // A guest's own change through their manage link has no staff user behind it (BK-091).
      actor: text(row.user_email) ?? (row.user_id ? 'Team member' : info.source === 'guest_manage_link' ? 'Guest' : 'System'),
    }
  })

  const fromLegacy = legacy.map((row): BookingAuditTrailEntry => {
    const meta = asObject(row.meta)
    return {
      id: `legacy:${row.id}`,
      event: row.event,
      label: auditEventLabel(row.event),
      old_status: row.old_status,
      new_status: row.new_status,
      meta,
      created_at: row.created_at,
      actor: text(meta.actor_name) ?? text(meta.user_email) ?? text(meta.performed_by) ?? (row.created_by ? 'Team member' : 'System'),
    }
  })

  return [...fromLogs, ...fromLegacy].sort((a, b) => {
    const left = Date.parse(a.created_at)
    const right = Date.parse(b.created_at)
    return (Number.isFinite(right) ? right : 0) - (Number.isFinite(left) ? left : 0)
  })
}
