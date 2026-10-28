/**
 * Plain-words reading of what merge_customers reports (BK-164, customer bookings review of 24
 * October 2026). Shared by the server action and the merge dialog, so the preview staff read and
 * the result they are told about use the same words.
 */

export type MergeCounts = Record<string, number>

export type MergeCustomersOutcome =
  | { state: 'blocked'; reason: string; count?: number }
  | {
      state: 'merged'
      preview: boolean
      keep_id: string
      merge_id: string
      moved: MergeCounts
      duplicates_dropped: MergeCounts
      left_behind: MergeCounts
      email_moved: boolean
      sms_opted_out: boolean
      whatsapp_opted_out: boolean
    }

const TABLE_WORDS: Record<string, [singular: string, plural: string]> = {
  bookings: ['event booking', 'event bookings'],
  table_bookings: ['table booking', 'table bookings'],
  private_bookings: ['private booking', 'private bookings'],
  parking_bookings: ['parking booking', 'parking bookings'],
  messages: ['text message', 'text messages'],
  email_messages: ['email', 'emails'],
  customer_consents: ['consent record', 'consent records'],
  customer_label_assignments: ['label', 'labels'],
  event_check_ins: ['event check-in', 'event check-ins'],
  waitlist_entries: ['waitlist entry', 'waitlist entries'],
  waitlist_offers: ['waitlist offer', 'waitlist offers'],
  guest_tokens: ['guest link', 'guest links'],
  vouchers: ['voucher', 'vouchers'],
  voucher_reminders: ['voucher reminder', 'voucher reminders'],
  loyalty_members: ['loyalty membership', 'loyalty memberships'],
  invoice_vendors: ['invoice vendor link', 'invoice vendor links'],
  signing_parties: ['document for signing', 'documents for signing'],
  marketing_campaign_recipients: ['marketing email send', 'marketing email sends'],
  promo_sequence: ['event promotion', 'event promotions'],
  sms_promo_context: ['promotion text', 'promotion texts'],
  analytics_events: ['activity record', 'activity records'],
  customer_category_stats: ['event category tally', 'event category tallies'],
  customer_scores: ['engagement score', 'engagement scores'],
  email_unsubscribe_tokens: ['unsubscribe link', 'unsubscribe links'],
  event_interest_manual_recipients: ['event interest list place', 'event interest list places'],
  unmatched_communications: ['holding queue message', 'holding queue messages'],
  notification_deliveries: ['notification', 'notifications'],
  reminder_processing_logs: ['reminder log', 'reminder logs'],
  pending_bookings: ['old pending booking', 'old pending bookings'],
  webhook_logs: ['delivery log', 'delivery logs'],
  private_booking_complaints: ['private booking complaint', 'private booking complaints'],
}

function words(table: string, count: number): string {
  const known = TABLE_WORDS[table]
  if (known) return `${count} ${count === 1 ? known[0] : known[1]}`
  return `${count} ${table.replace(/_/g, ' ')}`
}

/** "3 text messages", "2 table bookings", ... largest first, for a list. */
export function describeMergeCounts(counts: MergeCounts | null | undefined): string[] {
  return Object.entries(counts ?? {})
    .filter(([, count]) => Number(count) > 0)
    .sort(([tableA, a], [tableB, b]) => Number(b) - Number(a) || tableA.localeCompare(tableB))
    .map(([table, count]) => words(table, Number(count)))
}

/** Why a merge was refused, in words staff can act on. */
export function describeMergeBlock(reason: string): string {
  switch (reason) {
    case 'same_customer':
      return 'Choose a different customer to merge into.'
    case 'keep_not_found':
    case 'merge_not_found':
      return 'One of the two customers could not be found. Refresh the page and try again.'
    case 'keep_anonymised':
      return 'That customer has already been deleted or merged. Choose another one.'
    case 'merge_anonymised':
      return 'This customer has already been deleted or merged.'
    case 'both_booked_same_event':
      return 'Both records are booked on the same event. Cancel one of those bookings first.'
    case 'both_invoice_vendors':
      return 'Both records are linked to an invoice vendor. Unlink one of them first.'
    case 'both_loyalty_members':
      return 'Both records are in the same loyalty programme. Remove one of the memberships first.'
    default:
      return 'These two customers cannot be merged.'
  }
}
