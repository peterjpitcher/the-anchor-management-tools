import { Badge } from '@/ds'
import type {
  VoucherStatus,
  VoucherEventAction,
  ReminderKind,
  ReminderChannel,
  ReminderStatus,
} from '@/types/vouchers'

// Shared presentation helpers for the Vouchers management section.
// Pure module: safe to import from both server and client components.

export const VOUCHER_STATUS_LABELS: Record<VoucherStatus, string> = {
  generated: 'In stock',
  issued: 'Issued',
  redeemed: 'Redeemed',
  expired: 'Expired',
  cancelled: 'Cancelled',
  replaced: 'Replaced',
}

type BadgeTone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'info'

const STATUS_TONES: Record<VoucherStatus, BadgeTone> = {
  generated: 'neutral',
  issued: 'info',
  redeemed: 'success',
  expired: 'warning',
  cancelled: 'danger',
  replaced: 'neutral',
}

export function VoucherStatusBadge({ status }: { status: VoucherStatus }) {
  return <Badge tone={STATUS_TONES[status]}>{VOUCHER_STATUS_LABELS[status]}</Badge>
}

export const VOUCHER_EVENT_ACTION_LABELS: Record<VoucherEventAction, string> = {
  generated: 'Generated',
  issued: 'Handed out',
  redeemed: 'Redeemed',
  undo_redeem: 'Redemption undone',
  expired: 'Expired',
  cancelled: 'Cancelled',
  replaced: 'Replaced',
  reprinted: 'Reprinted',
  customer_assigned: 'Customer assigned',
  customer_removed: 'Customer removed',
  reminder_sent: 'Reminder sent',
  edited: 'Hand-out details edited',
  override_redeemed: 'Redeemed despite expiry',
  note: 'Note',
}

export const REMINDER_KIND_LABELS: Record<ReminderKind, string> = {
  pre_expiry_7: '7 days before expiry',
  pre_expiry_3: '3 days before expiry',
}

// Email is preferred; SMS is the fallback for customers with no email address.
// A reminder's channel is only written when a send is finalised, so it stays
// null for every pending and cancelled row and usually for skipped ones too.
// Callers must keep handling a null channel: that is a permanent live state,
// not legacy data waiting to be backfilled.
export const REMINDER_CHANNEL_LABELS: Record<ReminderChannel, string> = {
  email: 'email',
  sms: 'text message',
}

export const REMINDER_STATUS_TONES: Record<ReminderStatus, BadgeTone> = {
  pending: 'info',
  sent: 'success',
  skipped: 'neutral',
  failed: 'danger',
  cancelled: 'neutral',
}

export function formatPence(pence: number | null | undefined): string {
  if (pence === null || pence === undefined) return ''
  const pounds = pence / 100
  return pence % 100 === 0 ? `£${pounds}` : `£${pounds.toFixed(2)}`
}

export function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `idem-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`
}

export interface VoucherNavItem {
  label: string
  href: string
}

export const VOUCHER_SECTION_NAV: VoucherNavItem[] = [
  { label: 'Overview', href: '/vouchers' },
  { label: 'Hand-out mode', href: '/vouchers/handout' },
  { label: 'All vouchers', href: '/vouchers/all' },
  { label: 'Generate', href: '/vouchers/generate' },
  { label: 'Types & terms', href: '/vouchers/types' },
]

// Builds an /vouchers/all href with the exact filters that reproduce a metric
// (spec 3.1, F40: every overview number deep-links to its ledger definition).
export function ledgerHref(params: Record<string, string | number | boolean | undefined>): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === '' || value === false) continue
    search.set(key, String(value))
  }
  const qs = search.toString()
  return qs ? `/vouchers/all?${qs}` : '/vouchers/all'
}
