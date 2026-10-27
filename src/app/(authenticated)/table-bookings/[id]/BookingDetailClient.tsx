'use client'

import { ChristmasCourseFields } from '@/components/features/table-bookings/ChristmasCourseFields'
import { StaffCancelChoice } from '@/components/features/table-bookings/StaffCancelChoice'
import { GuestNotToldPanel } from '@/components/features/table-bookings/GuestNotToldPanel'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Checkbox,
  ConfirmDialog,
  DescriptionList,
  Empty,
  Field,
  Fieldset,
  FormFooter,
  Input,
  Modal,
  PageLayout,
  Radio,
  Select,
  Stat,
  StatGrid,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
  toast,
} from '@/ds'
import {
  STAFF_BOOKING_EMAIL_DEFAULT_SUBJECT,
  defaultStaffMessageChannel,
  type StaffMessageChannel,
} from '@/lib/messaging/staff-email-defaults'
import CustomerSearchInput from '@/components/features/customers/CustomerSearchInput'
import { RefundDialog } from '@/components/features/invoices/RefundDialog'
import { RefundHistoryTable } from '@/components/features/invoices/RefundHistoryTable'
import { getCanonicalDeposit } from '@/lib/table-bookings/deposit'
import { formatChristmasCourseTally } from '@/lib/table-bookings/christmas'
import {
  formatGbp,
  getTableBookingDepositBadgeClasses,
  getTableBookingDepositState,
  getTableBookingStatusBadgeClasses,
  getTableBookingStatusLabel,
  getTableBookingVisualState,
} from '@/lib/table-bookings/ui'
import { requestTableBookingAction } from '@/lib/table-bookings/client-actions'
import { describePartySizeStaffNotice } from '@/lib/table-bookings/party-size-staff-notice'
import { londonLocalInputToUtcIso, utcIsoToLondonLocalInput } from '@/lib/dateUtils'
import { staffStatusActionsFor } from '@/lib/table-bookings/staff-status-actions'
import {
  describeGuestNotificationChannel,
  describeGuestNotificationProblem,
  readGuestNotificationOutcome,
} from '@/lib/table-bookings/guest-notification-outcome'
import { describeDepositRefundForStaff, readDepositRefundOutcome } from '@/lib/table-bookings/deposit-refund-outcome'
import {
  depositHeldGbp,
  initialStaffCancelForm,
  readStaffCancelForm,
  staffCancellationBody,
  type StaffCancelFormState,
} from '@/lib/table-bookings/staff-cancellation'
import { TABLE_BOOKING_REFUND_PROGRESS_TONE as REFUND_PROGRESS_TONE } from '../_shared/status-ui'
import type { BookingAuditTrailEntry } from '@/lib/table-bookings/audit-trail'

/**
 * Staff must know when a guest was not told their booking was cancelled. The cancellation notice
 * reports what reached the guest; with no outcome there is nothing to show.
 */
function warnIfCancellationNotReached(payload: unknown): void {
  const record = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : null
  // What happened to the deposit, said to the person who cancelled (BK-114). A refund that did
  // not go through used to look exactly like one that did.
  const depositRefund = describeDepositRefundForStaff(readDepositRefundOutcome(record?.deposit_refund))
  if (depositRefund?.tone === 'error') toast.error(depositRefund.message, { duration: 12000 })
  else if (depositRefund) toast.success(depositRefund.message)
  const outcome = readGuestNotificationOutcome(record?.guest_notification ?? null)
  const problem = describeGuestNotificationProblem(outcome, 'about the cancellation')
  if (problem) toast.error(problem, { duration: 10000 })
}

const londonDateTimeFormatter = new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'medium',
  timeStyle: 'short',
  hour12: false,
  timeZone: 'Europe/London',
})

const bookingDateFormatter = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short',
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
})

function formatLondonDateTime(iso?: string | null): string {
  if (!iso) return '-'
  const parsed = new Date(iso)
  if (!Number.isFinite(parsed.getTime())) return iso
  return londonDateTimeFormatter.format(parsed)
}

function formatBookingDate(date: string): string {
  const [year, month, day] = date.split('-').map((part) => Number.parseInt(part, 10))
  if (!year || !month || !day) return date
  return bookingDateFormatter.format(new Date(Date.UTC(year, month - 1, day)))
}

function formatLabel(value?: string | null): string {
  if (!value) return '-'
  return value
    .replace(/_/g, ' ')
    .split(' ')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

function formatDuration(minutes?: number | null): string {
  if (!minutes) return '-'
  const hours = Math.floor(minutes / 60)
  const remaining = minutes % 60
  if (hours === 0) return `${remaining} min`
  if (remaining === 0) return `${hours} hr${hours === 1 ? '' : 's'}`
  return `${hours} hr ${remaining} min`
}

function normaliseNote(value: string | string[] | null): string | null {
  if (Array.isArray(value)) {
    const joined = value.filter(Boolean).join(', ').trim()
    return joined.length > 0 ? joined : null
  }
  const trimmed = value?.trim()
  return trimmed && trimmed.length > 0 ? trimmed : null
}

function listToInput(value: string | string[] | null): string {
  if (Array.isArray(value)) return value.filter(Boolean).join('\n')
  return value ?? ''
}

function splitListInput(value: string): string[] {
  return value
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
}

function formatMetaValue(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'string') return value.trim().length > 0 ? value : null
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) {
    const rendered = value.map(formatMetaValue).filter(Boolean).join(', ')
    return rendered.length > 0 ? rendered : null
  }
  return null
}

function parseMeta(meta: unknown): Record<string, unknown> {
  if (!meta) return {}
  if (typeof meta === 'string') {
    try {
      const parsed = JSON.parse(meta)
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : {}
    } catch {
      return {}
    }
  }
  return typeof meta === 'object' && !Array.isArray(meta) ? meta as Record<string, unknown> : {}
}

function getAuditDetails(entry: BookingAuditEntry): string[] {
  const meta = parseMeta(entry.meta)
  const details: string[] = []

  if (entry.old_status || entry.new_status) {
    details.push(`Status: ${formatLabel(entry.old_status)} -> ${formatLabel(entry.new_status)}`)
  }

  const oldPartySize = formatMetaValue(meta.old_party_size)
  const newPartySize = formatMetaValue(meta.new_party_size ?? meta.party_size)
  if (oldPartySize && newPartySize && oldPartySize !== newPartySize) {
    details.push(`Party size: ${oldPartySize} -> ${newPartySize}`)
  } else if (newPartySize && !details.some((line) => line.startsWith('Party size:'))) {
    details.push(`Party size: ${newPartySize}`)
  }

  const fromTable = formatMetaValue(meta.from_table ?? meta.old_table_name)
  const toTable = formatMetaValue(meta.to_table ?? meta.table_name ?? meta.new_table_name)
  if (fromTable && toTable && fromTable !== toTable) {
    details.push(`Table: ${fromTable} -> ${toTable}`)
  } else if (toTable) {
    details.push(`Table: ${toTable}`)
  }

  const description = formatMetaValue(meta.description ?? meta.reason ?? meta.note)
  if (description) details.push(description)

  const message = formatMetaValue(meta.message ?? meta.message_body ?? meta.body)
  if (message) details.push(`Message: ${message}`)

  const amount = formatMetaValue(meta.amount ?? meta.deposit_amount ?? meta.refund_amount)
  if (amount) details.push(`Amount: ${amount}`)

  const error = formatMetaValue(meta.error)
  if (error) details.push(`Error: ${error}`)

  if (details.length > 0) return details

  return Object.entries(meta)
    // Ids and anything secret stay out of the card: they mean nothing to the reader.
    .filter(([key]) => !/(token|secret|signature|hash|url|_id$|^id$)/i.test(key))
    .map(([key, value]) => {
      const rendered = formatMetaValue(value)
      return rendered ? `${formatLabel(key)}: ${rendered}` : null
    })
    .filter((line): line is string => Boolean(line))
    .slice(0, 4)
}

/** The page's empty marker for a missing value, as the old detail rows showed it (0 and '' included). */
function orDash(value: string | number | null | undefined): string | number {
  return value || '-'
}

function StatusBadge({ booking }: { booking: Booking }) {
  const visualState = getTableBookingVisualState(booking)
  return (
    <Badge className={getTableBookingStatusBadgeClasses(visualState)}>
      {getTableBookingStatusLabel(visualState)}
    </Badge>
  )
}

interface BookingCustomer {
  id: string
  first_name: string | null
  last_name: string | null
  mobile_number: string | null
}

interface BookingTableInner {
  id: string
  name: string | null
  table_number: string | null
  capacity: number | null
}

interface BookingTable {
  id: string
  start_datetime: string | null
  end_datetime: string | null
  table: BookingTableInner | null
}

interface BookingItemDish {
  id: string
  name: string | null
}

interface BookingItem {
  id: string
  custom_item_name: string | null
  quantity: number
  item_type: string | null
  price_at_booking: number | null
  special_requests: string | null
  guest_name: string | null
  menu_dish_id: string | null
  menu_dish: BookingItemDish | null
}

/** One line of the Audit Trail card, built by buildBookingAuditTrail (BK-038). */
export type BookingAuditEntry = BookingAuditTrailEntry

export interface Booking {
  id: string
  booking_reference: string | null
  booking_date: string
  booking_time: string | null
  party_size: number | null
  committed_party_size: number | null
  booking_type: string | null
  /** Christmas only: the 1, 2 or 3 courses each guest is on, seat 1 first. Null when not recorded. */
  christmas_course_counts?: number[] | null
  booking_purpose: string | null
  status: string
  source: string | null
  special_requirements: string | null
  dietary_requirements: string | string[] | null
  allergies: string | string[] | null
  celebration_type: string | null
  internal_notes: string | null
  cancellation_reason: string | null
  created_at: string | null
  updated_at: string | null
  seated_at: string | null
  left_at: string | null
  no_show_at: string | null
  no_show_marked_at: string | null
  confirmed_at: string | null
  cancelled_at: string | null
  completed_at: string | null
  start_datetime: string | null
  end_datetime: string | null
  duration_minutes: number | null
  high_chair_count: number | null
  is_outside_seating: boolean | null
  /** Guest asked for a step-free (accessible) table; display only, allocation enforces it. */
  requires_accessible_table?: boolean | null
  /** Staff have committed this booking to its tables; nothing automatic may move it. */
  table_pinned?: boolean | null
  deposit_waived: boolean | null
  /** Set when the deposit was taken off because the booking is a pub event (BK-106). */
  is_venue_event?: boolean | null
  hold_expires_at: string | null
  reminder_sent: boolean | null
  review_sms_sent_at: string | null
  review_clicked_at: string | null
  sunday_preorder_completed_at: string | null
  sunday_preorder_cutoff_at: string | null
  payment_status: string | null
  payment_method: string | null
  paypal_deposit_capture_id: string | null
  deposit_amount: number | null
  deposit_amount_locked: number | null
  card_capture_completed_at: string | null
  /** Set while a party-size change has left the deposit for a manager to settle (BK-043, D20). */
  deposit_review_needed_at?: string | null
  deposit_review_note?: string | null
  customer: BookingCustomer | null
  table_booking_tables: BookingTable[]
  table_booking_items: BookingItem[]
  audit_trail: BookingAuditEntry[]
}

/** A refund recorded against the booking's deposit: a payment_refunds row, cut down to what this page needs. */
export type BookingDepositRefund = {
  id: string
  amount: number
  status: 'completed' | 'pending' | 'failed'
}

interface Props {
  booking: Booking
  canEdit: boolean
  canManage: boolean
  canRefund: boolean
  /**
   * Every refund recorded against the deposit, loaded by the page with the booking. Null when they
   * could not be read, in which case no refund is offered.
   */
  depositRefunds: BookingDepositRefund[] | null
  /** The seasonal pre-order block, rendered on the server and slotted in. Null when the booking has none. */
  seasonalPreorder?: ReactNode
  /**
   * P7: whether the guest message card may send an email (flag staff_message_email_option), and
   * whether this guest has a usable address, which makes email the default.
   */
  emailOption?: { enabled: boolean; usable: boolean }
}

type MoveTableOption = {
  id: string
  table_ids?: string[]
  name: string
  table_number?: string | null
  capacity?: number | null
}

type MoveTableAvailabilityResponse = {
  success?: boolean
  error?: string
  data?: {
    booking_id: string
    tables: MoveTableOption[]
  }
}

type BookingEditState = {
  booking_date: string
  booking_time: string
  duration_minutes: string
  customer_id: string | null
  special_requirements: string
  dietary_requirements: string
  allergies: string
  celebration_type: string
  internal_notes: string
}

type PreorderEditState = Record<string, { quantity: string; special_requests: string }>

export default function BookingDetailClient({ booking, canEdit, canManage, canRefund, depositRefunds, seasonalPreorder, emailOption }: Props) {
  const router = useRouter()
  const [actionLoadingKey, setActionLoadingKey] = useState<string | null>(null)
  // What staff must read after a party-size change, kept until dismissed rather than a toast that
  // vanishes in seconds (BK-043).
  const [partySizeNotice, setPartySizeNotice] = useState<string[] | null>(null)
  // A manager settling an owed deposit after booking: waive, taken at the bar, or longer to pay (BK-045).
  const [depositAction, setDepositAction] = useState<'waive' | 'cash' | 'extend' | null>(null)
  const [depositActionReason, setDepositActionReason] = useState('')
  const [depositActionUntil, setDepositActionUntil] = useState('')
  const [moveTableId, setMoveTableId] = useState<string>('')
  const [availableMoveTables, setAvailableMoveTables] = useState<MoveTableOption[]>([])
  const [loadingMoveTables, setLoadingMoveTables] = useState(false)
  const [noShowConfirmOpen, setNoShowConfirmOpen] = useState(false)
  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  // Who is cancelling, for the cancel and delete dialogs (BK-046). Reset each time one opens.
  const [cancelForm, setCancelForm] = useState<StaffCancelFormState>(() => initialStaffCancelForm(0))
  const [cancelFormProblem, setCancelFormProblem] = useState<string | null>(null)
  // Bumped after a cancellation so the "guest not told" warning looks again (BK-177).
  const [guestNotToldRefresh, setGuestNotToldRefresh] = useState(0)
  const [partySizeEditOpen, setPartySizeEditOpen] = useState(false)
  const [christmasCourseCounts, setChristmasCourseCounts] = useState<number[] | undefined>(undefined)
  const [partySizeEditValue, setPartySizeEditValue] = useState('')
  const [partySizeEditSendSms, setPartySizeEditSendSms] = useState(true)
  const [partySizeMoveTableId, setPartySizeMoveTableId] = useState('')
  const [bookingEditOpen, setBookingEditOpen] = useState(false)
  const [bookingEdit, setBookingEdit] = useState<BookingEditState | null>(null)
  const [preorderEditOpen, setPreorderEditOpen] = useState(false)
  const [preorderEdit, setPreorderEdit] = useState<PreorderEditState>({})
  const [smsBody, setSmsBody] = useState('')
  const [messageChannel, setMessageChannel] = useState<StaffMessageChannel>(() => defaultStaffMessageChannel(emailOption))
  const [emailSubject, setEmailSubject] = useState(STAFF_BOOKING_EMAIL_DEFAULT_SUBJECT)
  const [showRefundDialog, setShowRefundDialog] = useState(false)

  // From the server-loaded refunds, so the badge, the Process Refund button, the dialog's balance
  // and the Refund History card all change together when router.refresh() follows a refund. These
  // were fetched once into client state, and only while payment_status was 'completed', which a
  // completed refund itself moves to 'refunded' or 'partial_refund'.
  const refundTotals = useMemo(
    () => ({
      totalRefunded: (depositRefunds ?? [])
        .filter((refund) => refund.status === 'completed')
        .reduce((sum, refund) => sum + refund.amount, 0),
      totalPending: (depositRefunds ?? [])
        .filter((refund) => refund.status === 'pending')
        .reduce((sum, refund) => sum + refund.amount, 0),
    }),
    [depositRefunds],
  )

  // The status buttons that apply to the booking as it stands (BK-048).
  const statusActions = staffStatusActionsFor(booking)
  const bookingClosed = booking.status === 'cancelled' || booking.status === 'completed' || booking.status === 'no_show'

  // What the guest paid and still has with us: where a manager's chosen refund starts (D7).
  const depositHeld = depositHeldGbp(booking, refundTotals.totalRefunded + refundTotals.totalPending)

  const assignedTables = useMemo(
    () => booking.table_booking_tables.map((assignment) => assignment.table).filter((table): table is BookingTableInner => Boolean(table)),
    [booking.table_booking_tables],
  )
  const assignedTableLabel =
    assignedTables.length > 0
      ? assignedTables
          .map((table) => table.name || table.table_number || 'Unnamed table')
          .join(' + ')
      : null
  const assignedCapacity = assignedTables.reduce((sum, table) => sum + Number(table.capacity ?? 0), 0)
  const partySizeEditNumber = Number.parseInt(partySizeEditValue, 10)
  const partySizeNeedsLargerTable =
    Number.isFinite(partySizeEditNumber) &&
    assignedCapacity > 0 &&
    partySizeEditNumber > assignedCapacity
  const partySizeMoveTableOptions = useMemo(
    () =>
      Number.isFinite(partySizeEditNumber)
        ? availableMoveTables.filter((table) => Number(table.capacity ?? 0) >= partySizeEditNumber)
        : [],
    [availableMoveTables, partySizeEditNumber],
  )
  const partySizeSelectedMoveTable =
    partySizeMoveTableOptions.find((table) => table.id === partySizeMoveTableId) ?? null

  // Auto-pick the smallest sufficient table setup when the new party size outgrows the
  // current table, so staff never have to hand-pick one for a routine increase (this is
  // what made 6->9 feel "stuck"). Staff can still override via the dropdown; when nothing
  // fits, we leave the selection empty and let the server auto-move report why on save.
  useEffect(() => {
    if (!partySizeEditOpen || !partySizeNeedsLargerTable) return
    if (partySizeMoveTableOptions.length === 0) return
    const alreadyValid = partySizeMoveTableOptions.some((table) => table.id === partySizeMoveTableId)
    if (!alreadyValid) {
      setPartySizeMoveTableId(partySizeMoveTableOptions[0].id)
    }
  }, [partySizeEditOpen, partySizeNeedsLargerTable, partySizeMoveTableOptions, partySizeMoveTableId])

  const customerName = [booking.customer?.first_name, booking.customer?.last_name].filter(Boolean).join(' ')
  const guestName = customerName || 'Unknown guest'
  const depositState = getTableBookingDepositState(booking)
  const canonicalDepositAmount = getCanonicalDeposit(
    {
      party_size: booking.party_size ?? 0,
      deposit_amount: booking.deposit_amount,
      deposit_amount_locked: booking.deposit_amount_locked,
      status: booking.status,
      payment_status: booking.payment_status,
      deposit_waived: booking.deposit_waived,
      // Christmas bookings owe a deposit at any party size.
      booking_type: booking.booking_type,
    },
    booking.party_size ?? 0,
  )
  // A deposit that was taken and has not all gone back: staff may refund it, or the rest of it.
  const depositCanBeRefunded = booking.payment_status === 'completed' || booking.payment_status === 'partial_refund'
  const refundableDepositAmount =
    booking.payment_status === 'completed'
      ? Math.max(0, canonicalDepositAmount)
      : booking.payment_status === 'partial_refund'
        ? // The ceiling the refund actions enforce: the locked amount is what PayPal captured, and
          // deposit_amount can move after capture (a party size change).
          Math.max(0, Number(booking.deposit_amount_locked ?? booking.deposit_amount ?? 0))
        : Math.max(0, Number(booking.deposit_amount ?? canonicalDepositAmount ?? 0))

  const notes = [
    { label: 'Special requirements', value: normaliseNote(booking.special_requirements) },
    { label: 'Dietary requirements', value: normaliseNote(booking.dietary_requirements) },
    { label: 'Allergies', value: normaliseNote(booking.allergies) },
    { label: 'Celebration', value: normaliseNote(booking.celebration_type) },
    { label: 'Internal notes', value: normaliseNote(booking.internal_notes) },
    { label: 'Cancellation reason', value: normaliseNote(booking.cancellation_reason) },
  ].filter((note) => note.value)

  const lifecycleEvents = [
    { label: 'Created', at: booking.created_at },
    { label: 'Confirmed', at: booking.confirmed_at },
    { label: 'Seated', at: booking.seated_at },
    { label: 'Left', at: booking.left_at },
    { label: 'No-show marked', at: booking.no_show_marked_at ?? booking.no_show_at },
    { label: 'Cancelled', at: booking.cancelled_at },
    { label: 'Completed', at: booking.completed_at },
    { label: 'Deposit captured', at: booking.card_capture_completed_at },
    { label: 'Reminder sent', at: booking.reminder_sent ? booking.updated_at : null },
    { label: 'Review SMS sent', at: booking.review_sms_sent_at },
    { label: 'Review clicked', at: booking.review_clicked_at },
    { label: 'Sunday pre-order completed', at: booking.sunday_preorder_completed_at },
  ].filter((event): event is { label: string; at: string } => Boolean(event.at))

  const operationalFlags = [
    depositState.kind === 'pending'
      ? `Deposit still pending${depositState.amount != null ? ` (${formatGbp(depositState.amount)})` : ''}`
      : null,
    // Who and why (BK-106): a pub event, or a manager's waiver.
    booking.is_venue_event ? 'No deposit: pub event' : booking.deposit_waived ? 'Deposit waived by a manager' : null,
    assignedTables.length === 0 ? 'No table assigned' : null,
    !booking.customer?.mobile_number ? 'No mobile number on this customer' : null,
    notes.some((note) => note.label === 'Allergies' || note.label === 'Dietary requirements')
      ? 'Dietary or allergy notes present'
      : null,
    booking.hold_expires_at
      ? booking.status === 'confirmed'
        // A confirmed booking that owes a deposit holds nothing that runs out (D20).
        ? `Deposit to pay by ${formatLondonDateTime(booking.hold_expires_at)}`
        : `Payment hold expires ${formatLondonDateTime(booking.hold_expires_at)}`
      : null,
    booking.sunday_preorder_cutoff_at ? `Sunday pre-order cutoff ${formatLondonDateTime(booking.sunday_preorder_cutoff_at)}` : null,
  ].filter((flag): flag is string => Boolean(flag))

  const auditTrail = useMemo(
    () =>
      [...(booking.audit_trail ?? [])].sort((a, b) => {
        const left = new Date(a.created_at).getTime()
        const right = new Date(b.created_at).getTime()
        return (Number.isFinite(right) ? right : 0) - (Number.isFinite(left) ? left : 0)
      }),
    [booking.audit_trail],
  )
  // The latest party-size change, and whether the guest made it through their manage link (BK-091).
  const latestPartySizeChange = auditTrail.find(
    (entry) => entry.event === 'table_booking.party_size_changed' || entry.event === 'table_booking.party_size_changed_by_guest'
  )
  const partySizeChangedByGuest = latestPartySizeChange?.event === 'table_booking.party_size_changed_by_guest'
  const preorderItems = booking.table_booking_items ?? []
  const canEditPreorder =
    canEdit &&
    preorderItems.length > 0 &&
    (!booking.sunday_preorder_cutoff_at || new Date(booking.sunday_preorder_cutoff_at).getTime() > Date.now())

  async function runAction<T>(
    key: string,
    fn: () => Promise<T>,
    successMsg: string | ((result: T) => string)
  ) {
    setActionLoadingKey(key)
    try {
      const result = await fn()
      toast.success(typeof successMsg === 'function' ? successMsg(result) : successMsg)
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setActionLoadingKey(null)
    }
  }

  async function handleStatusAction(
    action: 'seated' | 'left' | 'no_show' | 'cancelled' | 'confirmed' | 'completed',
    extra: Record<string, unknown> = {}
  ) {
    await runAction(
      `status:${action}`,
      async () => {
        const payload = await requestTableBookingAction(`/api/boh/table-bookings/${booking.id}/status`, {
          body: { ...extra, action },
        })
        warnIfCancellationNotReached(payload)
        if (action === 'cancelled') setGuestNotToldRefresh((count) => count + 1)
      },
      'Booking updated'
    )
  }

  function openPartySizeEdit() {
    setPartySizeEditValue(String(booking.party_size ?? ''))
    setPartySizeMoveTableId('')
    setPartySizeEditOpen(true)
  }

  function openBookingEdit() {
    setBookingEdit({
      booking_date: booking.booking_date,
      booking_time: booking.booking_time ? booking.booking_time.slice(0, 5) : '',
      duration_minutes: String(booking.duration_minutes ?? 90),
      customer_id: booking.customer?.id ?? null,
      special_requirements: booking.special_requirements ?? '',
      dietary_requirements: listToInput(booking.dietary_requirements),
      allergies: listToInput(booking.allergies),
      celebration_type: booking.celebration_type ?? '',
      internal_notes: booking.internal_notes ?? '',
    })
    setBookingEditOpen(true)
  }

  function openPreorderEdit() {
    setPreorderEdit(
      Object.fromEntries(
        preorderItems.map((item) => [
          item.id,
          {
            quantity: String(item.quantity ?? 1),
            special_requests: item.special_requests ?? '',
          },
        ])
      )
    )
    setPreorderEditOpen(true)
  }

  async function handleSubmitBookingEdit() {
    if (!bookingEdit) return

    const duration = Number.parseInt(bookingEdit.duration_minutes, 10)
    if (!bookingEdit.booking_date || !bookingEdit.booking_time) {
      toast.error('Enter a booking date and time')
      return
    }
    if (!Number.isFinite(duration) || duration < 30 || duration > 360) {
      toast.error('Enter a duration between 30 and 360 minutes')
      return
    }

    await runAction(
      'booking-edit',
      async () => {
        await requestTableBookingAction(`/api/boh/table-bookings/${booking.id}`, {
          method: 'PATCH',
          body: {
            booking_date: bookingEdit.booking_date,
            booking_time: bookingEdit.booking_time,
            duration_minutes: duration,
            customer_id: bookingEdit.customer_id,
            special_requirements: bookingEdit.special_requirements.trim() || null,
            dietary_requirements: splitListInput(bookingEdit.dietary_requirements),
            allergies: splitListInput(bookingEdit.allergies),
            celebration_type: bookingEdit.celebration_type.trim() || null,
            internal_notes: bookingEdit.internal_notes.trim() || null,
          },
        })
        setBookingEditOpen(false)
      },
      'Booking details updated'
    )
  }

  async function handleSubmitPreorderEdit() {
    const items = preorderItems.map((item) => ({
      id: item.id,
      quantity: Number.parseInt(preorderEdit[item.id]?.quantity ?? String(item.quantity ?? 1), 10),
      special_requests: preorderEdit[item.id]?.special_requests?.trim() || null,
    }))

    if (items.some((item) => !Number.isFinite(item.quantity) || item.quantity < 1 || item.quantity > 99)) {
      toast.error('Enter item quantities between 1 and 99')
      return
    }

    await runAction(
      'preorder-edit',
      async () => {
        await requestTableBookingAction(`/api/boh/table-bookings/${booking.id}/preorder`, {
          method: 'PATCH',
          body: { items },
        })
        setPreorderEditOpen(false)
      },
      'Pre-order updated'
    )
  }

  async function handleMoveTable() {
    if (!moveTableId) {
      toast.error('Select a table to move this booking')
      return
    }
    await runAction(
      'move-table',
      async () => {
        const target = availableMoveTables.find((table) => table.id === moveTableId)
        if (!target) throw new Error('Select a table to move this booking')
        await requestTableBookingAction(`/api/boh/table-bookings/${booking.id}/move-table`, {
          body: { table_ids: target.table_ids?.length ? target.table_ids : [target.id] },
        })
      },
      'Table assignment updated'
    )
  }

  /**
   * Pin or unpin the tables.
   *
   * Pinning is how "I have told them they are on Big Bay" stops being a hope. Nothing
   * automatic will move a pinned booking: not the drinks bump, not a retry. Staff can still
   * move it by hand, and it stays pinned to wherever it lands.
   */
  async function handleTogglePin(nextPinned: boolean) {
    await runAction(
      'pin',
      async () => {
        await requestTableBookingAction(`/api/boh/table-bookings/${booking.id}/pin`, {
          body: { pinned: nextPinned },
        })
      },
      nextPinned ? 'Table pinned' : 'Pin removed'
    )
  }

  async function handleSubmitPartySize() {
    const nextSize = Number.parseInt(partySizeEditValue, 10)
    if (!Number.isFinite(nextSize) || nextSize < 1 || nextSize > 20) {
      toast.error('Enter a party size between 1 and 20')
      return
    }
    // Grow+move is a single server-side step: the party-size endpoint auto-moves
    // the booking when it outgrows the current table (honouring the selected
    // setup below when one is picked) and reverts the move if the size change
    // fails — so the two can never end up out of step.
    const selectedMoveTable = partySizeNeedsLargerTable ? partySizeSelectedMoveTable : null
    await runAction(
      'party-size',
      async () => {
        const payload = await requestTableBookingAction<{
          depositRequired?: boolean
          depositUrl?: string | null
          smsSent?: boolean
          warning?: string | null
          depositNote?: string | null
          preorderRemoved?: unknown
          depositNotification?: unknown
          partySizeNotification?: unknown
          data?: { auto_moved_table_name?: string | null }
        }>(`/api/boh/table-bookings/${booking.id}/party-size`, {
          body: {
            party_size: nextSize,
            christmas_course_counts: christmasCourseCounts,
            send_sms: partySizeEditSendSms,
            ...(selectedMoveTable
              ? {
                  move_table_ids: selectedMoveTable.table_ids?.length
                    ? selectedMoveTable.table_ids
                    : [selectedMoveTable.id],
                }
              : {}),
          },
        })
        setPartySizeEditOpen(false)
        setPartySizeMoveTableId('')
        const notice = describePartySizeStaffNotice(payload)
        setPartySizeNotice(notice.length > 0 ? notice : null)
        // If the deposit link reached nobody, staff must send it themselves.
        const depositProblem = describeGuestNotificationProblem(
          readGuestNotificationOutcome(payload.depositNotification),
          'about the deposit'
        )
        if (depositProblem) {
          toast.error(`${depositProblem} Copy the deposit link from this booking to send it.`, { duration: 10000 })
        }
        // The new party size, when the guest could not be told about it (BK-091).
        const noticeProblem = describeGuestNotificationProblem(
          readGuestNotificationOutcome(payload.partySizeNotification),
          'about the new party size'
        )
        if (noticeProblem) {
          toast.error(noticeProblem, { duration: 10000 })
        }
        return payload
      },
      (payload) => {
        const movedTableName = payload.data?.auto_moved_table_name
        const prefix = movedTableName ? `Moved to ${movedTableName}. ` : ''
        // A deposit left for a manager is in the notice that stays on screen.
        if (payload.warning) {
          return `${prefix}Party size updated. Check the note on this booking.`
        }
        if (payload.depositNote) {
          return `${prefix}Party size updated. ${payload.depositNote}`
        }
        if (payload.depositRequired) {
          const notification = readGuestNotificationOutcome(payload.depositNotification)
          if (notification) {
            const channel = describeGuestNotificationChannel(notification)
            return channel
              ? `${prefix}Party size updated. Deposit link sent ${channel}.`
              : `${prefix}Party size updated. Deposit link created.`
          }
          return payload.smsSent
            ? `${prefix}Party size updated. Deposit link sent by SMS.`
            : `${prefix}Party size updated. Deposit link created.`
        }
        return `${prefix}Party size updated`
      }
    )
  }

  /** A manager has checked a deposit a party-size change left to settle on the bill (BK-043). */
  async function handleClearDepositReview() {
    await runAction(
      'deposit-review',
      async () => {
        await requestTableBookingAction(`/api/boh/table-bookings/${booking.id}/deposit-review`, { body: {} })
      },
      'Marked as checked'
    )
  }

  function openDepositAction(action: 'waive' | 'cash' | 'extend') {
    setDepositAction(action)
    setDepositActionReason('')
    // Offer the booking start as the latest time the guest can pay by.
    setDepositActionUntil(booking.start_datetime ? utcIsoToLondonLocalInput(booking.start_datetime) : '')
  }

  async function handleSubmitDepositAction() {
    if (!depositAction) return
    const reason = depositActionReason.trim()
    if (reason.length < 3) {
      toast.error('Say why, so the next person can see it')
      return
    }
    const holdUntil = depositAction === 'extend' ? londonLocalInputToUtcIso(depositActionUntil) : null
    if (depositAction === 'extend' && !holdUntil) {
      toast.error('Choose when the guest must pay by')
      return
    }
    await runAction(
      'deposit-action',
      async () => {
        const payload = await requestTableBookingAction<{ message?: string; warning?: string | null }>(
          `/api/boh/table-bookings/${booking.id}/deposit`,
          { body: { action: depositAction, reason, ...(holdUntil ? { hold_until: holdUntil } : {}) } },
        )
        setDepositAction(null)
        if (payload.warning) toast.error(payload.warning, { duration: 10000 })
        return payload
      },
      (payload) => payload.message || 'Deposit updated'
    )
  }

  async function handleCopyDepositLink() {
    await runAction(
      'deposit-link',
      async () => {
        const payload = await requestTableBookingAction<{ url?: string }>(
          `/api/boh/table-bookings/${booking.id}/deposit-link`,
          { method: 'GET' },
        )
        if (!payload.url) throw new Error('No deposit link returned')
        await navigator.clipboard.writeText(payload.url)
      },
      'Deposit link copied to clipboard'
    )
  }

  async function handleDeleteBooking(cancellation?: Record<string, unknown>) {
    await runAction(
      'delete',
      async () => {
        const payload = await requestTableBookingAction(`/api/boh/table-bookings/${booking.id}`, {
          method: 'DELETE',
          ...(cancellation ? { body: cancellation } : {}),
        })
        warnIfCancellationNotReached(payload)
        router.push('/table-bookings/boh')
      },
      'Booking deleted'
    )
  }

  async function handleSendSms() {
    const trimmed = smsBody.trim()
    if (!trimmed) {
      toast.error('Enter an SMS message before sending')
      return
    }
    await runAction(
      'send-sms',
      async () => {
        await requestTableBookingAction(`/api/boh/table-bookings/${booking.id}/sms`, {
          body: { message: trimmed },
        })
        setSmsBody('')
      },
      'SMS sent to guest'
    )
  }

  async function handleSendEmail() {
    const trimmed = smsBody.trim()
    const subject = emailSubject.trim()
    if (!trimmed || !subject) {
      toast.error('Enter a subject and a message before sending')
      return
    }
    await runAction(
      'send-sms',
      async () => {
        await requestTableBookingAction(`/api/boh/table-bookings/${booking.id}/email`, {
          body: { subject, message: trimmed },
        })
        setSmsBody('')
      },
      'Email sent to guest'
    )
  }

  const emailChosen = Boolean(emailOption?.enabled) && messageChannel === 'email'

  useEffect(() => {
    let cancelled = false

    async function loadAvailableTables() {
      if (!canEdit) {
        setAvailableMoveTables([])
        setMoveTableId('')
        setLoadingMoveTables(false)
        return
      }
      setLoadingMoveTables(true)
      try {
        const response = await fetch(`/api/boh/table-bookings/${booking.id}/move-table`, {
          cache: 'no-store',
        })
        const payload = (await response.json()) as MoveTableAvailabilityResponse
        if (!response.ok || !payload.success || !payload.data) {
          throw new Error(payload.error ?? 'Failed to load available tables')
        }
        if (cancelled) return
        const options = Array.isArray(payload.data.tables) ? payload.data.tables : []
        setAvailableMoveTables(
          options.map((t) => ({
            id: t.id,
            table_ids: t.table_ids,
            name: t.name,
            table_number: t.table_number ?? null,
            capacity: t.capacity ?? null,
          }))
        )
        setMoveTableId((current) =>
          current && options.some((t) => t.id === current) ? current : ''
        )
      } catch (error) {
        if (cancelled) return
        setAvailableMoveTables([])
        setMoveTableId('')
        toast.error(error instanceof Error ? error.message : 'Failed to load available tables')
      } finally {
        if (!cancelled) setLoadingMoveTables(false)
      }
    }

    void loadAvailableTables()
    return () => {
      cancelled = true
    }
  }, [booking.id, canEdit])

  // The destructive actions sit in the page header, as on every other detail page. Mark No-Show
  // is secondary: Mark Confirmed puts it back, so it is not destructive.
  // data-touch-targets: the page is reached from BOH on a tablet, so these buttons get the 44px
  // floor on a touch screen, like the rest of the page. See the note in FohScheduleClient.
  const headerActions = canManage ? (
    <div className="flex flex-wrap items-center justify-end gap-2" data-touch-targets>
      {!bookingClosed && (
        <Button
          size="sm"
          variant="secondary"
          onClick={() => setNoShowConfirmOpen(true)}
          disabled={Boolean(actionLoadingKey)}
        >
          Mark No-Show
        </Button>
      )}
      {!bookingClosed && (
        <Button
          size="sm"
          variant="danger"
          onClick={() => {
            setCancelForm(initialStaffCancelForm(depositHeld))
            setCancelFormProblem(null)
            setCancelConfirmOpen(true)
          }}
          disabled={Boolean(actionLoadingKey)}
        >
          Cancel Booking
        </Button>
      )}
      <Button
        size="sm"
        variant="danger"
        onClick={() => {
          setCancelForm(initialStaffCancelForm(depositHeld))
          setCancelFormProblem(null)
          setDeleteConfirmOpen(true)
        }}
        disabled={Boolean(actionLoadingKey)}
      >
        Delete
      </Button>
    </div>
  ) : undefined

  // A child page: the back button, not the section's tab row. Its parent, Back of House, is
  // titled "Table Bookings".
  return (
    <PageLayout
      title={customerName || booking.booking_reference || 'Booking'}
      subtitle={`${booking.booking_reference ?? ''} · ${booking.booking_date} · ${booking.booking_time ?? ''}`}
      backButton={{ label: 'Back to Table Bookings', href: '/table-bookings/boh' }}
      headerActions={headerActions}
    >
      {/* data-touch-targets: reached from BOH on a tablet. The wrapper carries that attribute and
          keeps the page's own 24px rhythm between blocks. */}
      <div className="space-y-6" data-touch-targets>
        {/* A guest staff cancelled on who was not told stays here until someone rings (BK-177). */}
        <GuestNotToldPanel bookingId={booking.id} refreshKey={guestNotToldRefresh} canEdit={canEdit} />

        {/* The guest's name is the page title, so this card carries the status and the when. */}
        <Card>
          <CardBody className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge booking={booking} />
              {depositState.kind !== 'none' && (
                <Badge className={getTableBookingDepositBadgeClasses(depositState.kind)}>
                  {depositState.label}
                  {depositState.amount != null ? ` · ${formatGbp(depositState.amount)}` : ''}
                </Badge>
              )}
              {booking.booking_type && (
                <Badge tone="neutral">{formatLabel(booking.booking_type)}</Badge>
              )}
              {booking.requires_accessible_table && (
                <Badge tone="warning">Step-free table</Badge>
              )}
              {(booking.high_chair_count ?? 0) > 0 && (
                <Badge tone="neutral">High chair ×{booking.high_chair_count}</Badge>
              )}
            </div>
            <p className="text-sm text-text-muted">
              {formatBookingDate(booking.booking_date)}
              {booking.booking_time ? ` at ${booking.booking_time.slice(0, 5)}` : ''}
              {booking.party_size != null ? ` · ${booking.party_size} covers` : ''}
              {booking.is_outside_seating ? ' · Outside' : assignedTableLabel ? ` · ${assignedTableLabel}` : ''}
            </p>
          </CardBody>
        </Card>

        <StatGrid columns={4}>
          <Stat label="Covers" value={booking.party_size ?? '-'} />
          <Stat label="Tables" value={booking.is_outside_seating ? 'Outside' : assignedTables.length || '-'} />
          <Stat label="Capacity" value={booking.is_outside_seating ? 'Outside' : assignedCapacity || '-'} />
          <Stat label="Audit" value={auditTrail.length} />
        </StatGrid>

        {partySizeNotice && (
          <Alert tone="warning" title="Check this booking" closable onClose={() => setPartySizeNotice(null)}>
            <ul className="list-disc space-y-1 pl-4">
              {partySizeNotice.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </Alert>
        )}

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
          <div className="space-y-6">
            <Card>
              <CardHeader title="Booking Details" />
              <CardBody>
                <DescriptionList
                  columns={3}
                  items={[
                    { key: 'reference', label: 'Reference', value: orDash(booking.booking_reference) },
                    { key: 'guest', label: 'Guest', value: guestName },
                    {
                      key: 'mobile',
                      label: 'Mobile',
                      value: booking.customer?.mobile_number ? (
                        <a
                          href={`tel:${booking.customer.mobile_number}`}
                          className="rounded-sm text-primary hover:underline focus-visible:outline-hidden focus-visible:shadow-ring"
                        >
                          {booking.customer.mobile_number}
                        </a>
                      ) : '-',
                    },
                    { key: 'date', label: 'Date', value: formatBookingDate(booking.booking_date) },
                    { key: 'time', label: 'Time', value: booking.booking_time ? booking.booking_time.slice(0, 5) : '-' },
                    { key: 'duration', label: 'Duration', value: formatDuration(booking.duration_minutes) },
                    {
                      key: 'party-size',
                      label: 'Party size',
                      value: partySizeChangedByGuest ? (
                        <span className="inline-flex flex-wrap items-center gap-2">
                          {orDash(booking.party_size)}
                          <Badge tone="info">Changed by guest</Badge>
                        </span>
                      ) : orDash(booking.party_size),
                    },
                    { key: 'committed-size', label: 'Committed size', value: orDash(booking.committed_party_size) },
                    {
                      key: 'assigned-tables',
                      label: 'Assigned tables',
                      value: booking.is_outside_seating ? 'Outside' : assignedTableLabel ?? '-',
                    },
                    { key: 'seating', label: 'Seating', value: booking.is_outside_seating ? 'Outside' : 'Indoor' },
                    {
                      key: 'step-free',
                      label: 'Step-free table',
                      value: booking.requires_accessible_table ? 'Requested' : 'Not requested',
                    },
                    { key: 'high-chairs', label: 'High chairs', value: String(booking.high_chair_count ?? 0) },
                    { key: 'booking-type', label: 'Booking type', value: formatLabel(booking.booking_type) },
                    ...(booking.booking_type === 'christmas'
                      ? [
                          {
                            key: 'christmas-courses',
                            label: 'Christmas courses',
                            // BK-057: staff need to see who is paying for what, and a booking with
                            // none recorded is told where to set them.
                            value:
                              formatChristmasCourseTally(booking.christmas_course_counts) ||
                              'Not recorded. Set them with Change party size.',
                          },
                        ]
                      : []),
                    { key: 'purpose', label: 'Purpose', value: formatLabel(booking.booking_purpose) },
                    { key: 'source', label: 'Source', value: formatLabel(booking.source) },
                  ]}
                />
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="Notes and Requirements" />
              {notes.length > 0 ? (
                <CardBody>
                  <DescriptionList
                    columns={1}
                    items={notes.map((note) => ({
                      key: note.label,
                      label: note.label,
                      // Notes keep the line breaks staff typed.
                      value: <span className="whitespace-pre-wrap">{note.value}</span>,
                    }))}
                  />
                </CardBody>
              ) : (
                <Empty
                  size="sm"
                  title="No notes yet"
                  description="Special requirements, dietary needs, allergies and internal notes show here once added."
                />
              )}
            </Card>

            {/* High up on purpose: staff take these orders on the telephone while the guest waits. */}
            {seasonalPreorder}

            <Card>
              <CardHeader
                title="Sunday Pre-Order"
                action={
                  canEditPreorder ? (
                    <Button size="sm" variant="secondary" onClick={openPreorderEdit}>
                      Edit Pre-Order
                    </Button>
                  ) : undefined
                }
              />
              {preorderItems.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Item</TableHead>
                      <TableHead>Qty</TableHead>
                      <TableHead>Guest</TableHead>
                      <TableHead>Requests</TableHead>
                      <TableHead align="right">Price</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {preorderItems.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell className="whitespace-normal font-medium">
                          {item.menu_dish?.name || item.custom_item_name || 'Unnamed item'}
                          {item.item_type ? <span className="ml-2 text-xs font-normal text-text-muted">{formatLabel(item.item_type)}</span> : null}
                        </TableCell>
                        <TableCell>{item.quantity}</TableCell>
                        <TableCell className="whitespace-normal">{item.guest_name || '-'}</TableCell>
                        <TableCell className="whitespace-normal">{item.special_requests || '-'}</TableCell>
                        <TableCell align="right">
                          {item.price_at_booking != null ? formatGbp(Number(item.price_at_booking) * Number(item.quantity || 1)) : '-'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <Empty size="sm" title="No saved pre-order items" />
              )}
            </Card>

            <Card>
              <CardHeader title="Lifecycle" />
              {lifecycleEvents.length > 0 ? (
                <CardBody>
                  <DescriptionList
                    items={lifecycleEvents.map((event) => ({
                      key: `${event.label}-${event.at}`,
                      label: event.label,
                      value: formatLondonDateTime(event.at),
                    }))}
                  />
                </CardBody>
              ) : (
                <Empty size="sm" title="No lifecycle timestamps recorded yet" />
              )}
            </Card>
          </div>

          <aside className="space-y-6">
            {canEdit && (
              <Card>
                <CardHeader title="Actions" />
                <CardBody className="space-y-4">
                  <div className="flex flex-wrap gap-2">
                    {/* Only the status changes that apply now (BK-048): Mark Confirmed no longer
                        shows on a cancelled or completed booking, which it used to bring back. */}
                    {statusActions.includes('seated') && (
                      <Button
                        size="sm"
                        onClick={() => void handleStatusAction('seated')}
                        loading={actionLoadingKey === 'status:seated'}
                        disabled={Boolean(actionLoadingKey)}
                      >
                        Seat Guests
                      </Button>
                    )}
                    {statusActions.includes('left') && (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => void handleStatusAction('left')}
                        loading={actionLoadingKey === 'status:left'}
                        disabled={Boolean(actionLoadingKey)}
                      >
                        Mark Left
                      </Button>
                    )}
                    {statusActions.includes('confirmed') && (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => void handleStatusAction('confirmed')}
                        loading={actionLoadingKey === 'status:confirmed'}
                        disabled={Boolean(actionLoadingKey)}
                      >
                        Mark Confirmed
                      </Button>
                    )}
                    {statusActions.includes('completed') && (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => void handleStatusAction('completed')}
                        loading={actionLoadingKey === 'status:completed'}
                        disabled={Boolean(actionLoadingKey)}
                      >
                        Mark Completed
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={openBookingEdit}
                      disabled={Boolean(actionLoadingKey)}
                    >
                      Edit Booking
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={openPartySizeEdit}
                      disabled={Boolean(actionLoadingKey)}
                    >
                      Edit Party Size
                    </Button>
                    {depositState.kind === 'pending' && (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => void handleCopyDepositLink()}
                        loading={actionLoadingKey === 'deposit-link'}
                        disabled={Boolean(actionLoadingKey)}
                      >
                        Copy Deposit Link
                      </Button>
                    )}
                  </div>

                  {/* Pin. Shown next to Move table because the two are the same decision from
                      opposite ends: move it deliberately, then stop anything else moving it. */}
                  {!booking.is_outside_seating && (
                    // A Fieldset, so its legend matches the Move table label below and names the
                    // Pin button's group for a screen reader. The rule sits on a wrapper: a legend
                    // is drawn across its fieldset's own top border.
                    <div className="border-t border-border pt-4">
                      <Fieldset legend="Pin to this table">
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-sm text-text-muted">
                            {booking.table_pinned
                              ? 'Pinned. Nothing automatic will move this booking.'
                              : 'Not pinned. This booking may be moved to make room for another.'}
                          </p>
                          <Button
                            size="sm"
                            variant={booking.table_pinned ? 'secondary' : 'primary'}
                            onClick={() => void handleTogglePin(!booking.table_pinned)}
                            loading={actionLoadingKey === 'pin'}
                            disabled={Boolean(actionLoadingKey)}
                          >
                            {booking.table_pinned ? 'Unpin' : 'Pin'}
                          </Button>
                        </div>
                      </Fieldset>
                    </div>
                  )}

                  <div className="flex flex-col gap-2 border-t border-border pt-4 sm:flex-row sm:items-end xl:flex-col xl:items-stretch 2xl:flex-row 2xl:items-end">
                    <div className="min-w-0 grow">
                      <Select
                        id="move-table-select"
                        label="Move table"
                        value={moveTableId}
                        onChange={(e) => setMoveTableId(e.target.value)}
                        disabled={loadingMoveTables || availableMoveTables.length === 0}
                      >
                        <option value="">
                          {loadingMoveTables
                            ? 'Loading available tables…'
                            : availableMoveTables.length === 0
                              ? 'No available tables'
                              : 'Select table to move booking'}
                        </option>
                        {availableMoveTables.map((table) => (
                          <option key={table.id} value={table.id}>
                            {table.name}
                            {table.table_number ? ` (${table.table_number})` : ''}
                            {table.capacity ? ` - cap ${table.capacity}` : ''}
                          </option>
                        ))}
                      </Select>
                    </div>
                    <Button
                      size="sm"
                      variant="secondary"
                      loading={actionLoadingKey === 'move-table'}
                      disabled={loadingMoveTables || availableMoveTables.length === 0 || Boolean(actionLoadingKey)}
                      onClick={() => void handleMoveTable()}
                    >
                      Move
                    </Button>
                  </div>
                </CardBody>
              </Card>
            )}

            <Card>
              <CardHeader title="Payment and Deposit" />
              <CardBody className="space-y-4">
                <div className="flex flex-wrap items-center gap-2">
                  {depositState.kind !== 'none' ? (
                    <Badge className={getTableBookingDepositBadgeClasses(depositState.kind)}>
                      {depositState.label}
                      {depositState.amount != null ? ` · ${formatGbp(depositState.amount)}` : ''}
                    </Badge>
                  ) : (
                    <Badge tone="neutral">No deposit required</Badge>
                  )}
                  {booking.payment_status && <Badge tone="neutral">{formatLabel(booking.payment_status)}</Badge>}
                </div>

                {canManage && depositState.kind === 'pending' && (
                  // BK-045 (owner decision D18): a manager can settle an owed deposit after booking.
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="secondary" disabled={Boolean(actionLoadingKey)} onClick={() => openDepositAction('cash')}>
                      Deposit taken at the bar
                    </Button>
                    <Button size="sm" variant="secondary" disabled={Boolean(actionLoadingKey)} onClick={() => openDepositAction('extend')}>
                      Give longer to pay
                    </Button>
                    <Button size="sm" variant="secondary" disabled={Boolean(actionLoadingKey)} onClick={() => openDepositAction('waive')}>
                      Waive deposit
                    </Button>
                  </div>
                )}

                {booking.deposit_review_needed_at && (
                  // BK-043: a party-size change left the deposit for a manager to settle on the bill.
                  <Alert tone="warning" title="Deposit to check">
                    <p>{booking.deposit_review_note || 'The party size changed after the deposit was set.'}</p>
                    {canManage ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        className="mt-2"
                        loading={actionLoadingKey === 'deposit-review'}
                        disabled={Boolean(actionLoadingKey)}
                        onClick={() => void handleClearDepositReview()}
                      >
                        Mark as checked
                      </Button>
                    ) : (
                      <p className="mt-1 text-xs">A manager marks this as checked.</p>
                    )}
                  </Alert>
                )}

                {/* One column at xl, where this card sits in the 420px side column. */}
                <DescriptionList
                  columns={2}
                  className="xl:grid-cols-1 2xl:grid-cols-2"
                  items={[
                    { key: 'method', label: 'Method', value: formatLabel(booking.payment_method) },
                    {
                      key: 'refundable',
                      label: 'Refundable',
                      value: refundableDepositAmount > 0 ? formatGbp(refundableDepositAmount) : '-',
                    },
                    {
                      key: 'locked-amount',
                      label: 'Locked amount',
                      value: booking.deposit_amount_locked != null ? formatGbp(Number(booking.deposit_amount_locked)) : '-',
                    },
                    { key: 'captured', label: 'Captured', value: formatLondonDateTime(booking.card_capture_completed_at) },
                  ]}
                />

                {booking.paypal_deposit_capture_id && (
                  <p className="break-all text-xs text-text-muted">Capture ID: {booking.paypal_deposit_capture_id}</p>
                )}

                {refundTotals.totalRefunded > 0 && (
                  <Badge
                    tone={refundTotals.totalRefunded >= refundableDepositAmount ? REFUND_PROGRESS_TONE.refunded : REFUND_PROGRESS_TONE.partial}
                    size="sm"
                  >
                    {refundTotals.totalRefunded >= refundableDepositAmount ? 'Refunded' : 'Partially refunded'}
                  </Badge>
                )}

                {depositRefunds === null && (
                  <Alert tone="warning">
                    The refunds on this booking could not be loaded, so this card may not show money already returned.
                    Reload the page before refunding the deposit.
                  </Alert>
                )}

                {/* A cancelled booking still holding a cash deposit (BK-041): it goes back across
                    the bar, so it stays on screen until the refund is recorded. */}
                {booking.status === 'cancelled' &&
                  booking.payment_method === 'cash' &&
                  depositCanBeRefunded &&
                  depositRefunds !== null &&
                  refundTotals.totalRefunded + refundTotals.totalPending < refundableDepositAmount && (
                  <Alert tone="warning" title="Return the cash deposit">
                    This booking was cancelled while its deposit, paid in cash, is still held. Hand back
                    what is owed at the bar (the cancellation email to the manager has the amount), then
                    record it here with Process Refund, method cash.
                  </Alert>
                )}

                {canRefund && depositRefunds !== null && depositCanBeRefunded && refundTotals.totalRefunded < refundableDepositAmount && (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setShowRefundDialog(true)}
                  >
                    Process Refund
                  </Button>
                )}
              </CardBody>
            </Card>

            {/* Its own card, titled Refund History, beside the payment card rather than nested in it.
                Shown whenever there is a refund to list, whatever the payment status has become. It
                fetches its own rows once, so the key remounts it when a refund is added or settles. */}
            {depositRefunds !== null && depositRefunds.length > 0 && (
              <RefundHistoryTable
                key={depositRefunds.map((refund) => `${refund.id}:${refund.status}`).join('|')}
                sourceType="table_booking"
                sourceId={booking.id}
              />
            )}

            <Card>
              <CardHeader title={emailOption?.enabled ? 'Message Guest' : 'Send SMS'} />
              <CardBody>
                {canEdit ? (
                  <div className="space-y-3">
                    {emailOption?.enabled && (
                      <Fieldset legend="Send by">
                        <Radio
                          name="guest-message-channel"
                          value="email"
                          label="Email"
                          description={emailOption.usable ? undefined : 'No usable email address on file for this guest.'}
                          checked={messageChannel === 'email'}
                          onChange={() => setMessageChannel('email')}
                          disabled={!emailOption.usable || Boolean(actionLoadingKey)}
                        />
                        <Radio
                          name="guest-message-channel"
                          value="sms"
                          label="Text"
                          checked={messageChannel === 'sms'}
                          onChange={() => setMessageChannel('sms')}
                          disabled={Boolean(actionLoadingKey)}
                        />
                      </Fieldset>
                    )}
                    {emailChosen && (
                      <Input
                        label="Subject"
                        value={emailSubject}
                        maxLength={200}
                        onChange={(e) => setEmailSubject(e.target.value)}
                      />
                    )}
                    <Textarea
                      label="Message"
                      value={smsBody}
                      onChange={(e) => setSmsBody(e.target.value)}
                      rows={5}
                      maxLength={emailChosen ? 2000 : 640}
                      placeholder="Type message..."
                    />
                    <FormFooter start={<span className="text-xs">{smsBody.length}/{emailChosen ? 2000 : 640}</span>}>
                      <Button
                        size="sm"
                        variant="secondary"
                        loading={actionLoadingKey === 'send-sms'}
                        disabled={Boolean(actionLoadingKey)}
                        onClick={() => void (emailChosen ? handleSendEmail() : handleSendSms())}
                      >
                        {emailChosen ? 'Send Email' : 'Send SMS'}
                      </Button>
                    </FormFooter>
                  </div>
                ) : (
                  <p className="text-sm text-text-muted">You do not have permission to send SMS messages.</p>
                )}
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="Operational Flags" />
              {operationalFlags.length > 0 ? (
                <CardBody>
                  <ul className="space-y-2">
                    {operationalFlags.map((flag) => (
                      <li key={flag}>
                        <Alert tone="warning" size="sm" role="status">
                          {flag}
                        </Alert>
                      </li>
                    ))}
                  </ul>
                </CardBody>
              ) : (
                <Empty size="sm" title="No operational flags for this booking" />
              )}
            </Card>

          </aside>
        </div>

        <Card>
          <CardHeader title="Audit Trail" subtitle="Every recorded booking audit event, newest first" />
          {auditTrail.length === 0 ? (
            <Empty size="sm" title="No audit events yet" />
          ) : (
            <CardBody>
              <ol className="divide-y divide-border">
                {auditTrail.map((entry) => {
                  const details = getAuditDetails(entry)
                  return (
                    <li key={entry.id} className="grid grid-cols-1 gap-3 py-4 first:pt-0 last:pb-0 lg:grid-cols-[220px_minmax(0,1fr)_180px]">
                      <div>
                        <p className="text-sm font-medium text-text">{formatLondonDateTime(entry.created_at)}</p>
                        <p className="mt-0.5 text-xs text-text-muted">{entry.actor}</p>
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-text">{entry.label}</p>
                        {details.length > 0 && (
                          <ul className="mt-2 space-y-1">
                            {details.map((detail) => (
                              <li key={detail} className="whitespace-pre-wrap text-sm text-text-muted">
                                {detail}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                      <div className="lg:text-right">
                        {entry.new_status ? (
                          // The booking status colour map, as on every other status badge.
                          <Badge className={getTableBookingStatusBadgeClasses(entry.new_status)}>
                            {formatLabel(entry.new_status)}
                          </Badge>
                        ) : (
                          <span className="text-xs text-text-soft">No status change</span>
                        )}
                      </div>
                    </li>
                  )
                })}
              </ol>
            </CardBody>
          )}
        </Card>

        <ConfirmDialog
          open={noShowConfirmOpen}
          onClose={() => setNoShowConfirmOpen(false)}
          onConfirm={async () => {
            setNoShowConfirmOpen(false)
            await handleStatusAction('no_show')
          }}
          // Primary: a no-show can be put back with Mark Confirmed, so it is not destructive.
          tone="primary"
          title="Mark as No-Show"
          message="Mark this booking as a no-show? It comes off the active covers. Mark Confirmed puts it back."
          confirmLabel="Mark No-Show"
          closeOnConfirm={false}
        />

        {/* Who is cancelling decides the refund and the words the guest gets (BK-046, D7). */}
        <Modal
          open={cancelConfirmOpen}
          onClose={() => setCancelConfirmOpen(false)}
          title="Cancel Booking"
          width="md"
          footer={
            <>
              <Button variant="secondary" onClick={() => setCancelConfirmOpen(false)}>
                Keep Booking
              </Button>
              <Button
                variant="danger"
                loading={actionLoadingKey === 'status:cancelled'}
                disabled={Boolean(actionLoadingKey)}
                onClick={() => {
                  const read = readStaffCancelForm(cancelForm, depositHeld)
                  if (!read.ok) {
                    setCancelFormProblem(read.error)
                    return
                  }
                  setCancelConfirmOpen(false)
                  void handleStatusAction('cancelled', staffCancellationBody(read.choice))
                }}
              >
                Cancel Booking
              </Button>
            </>
          }
        >
          <div className="space-y-3">
            <p className="text-sm text-text">Cancel this booking? The customer will be notified.</p>
            <StaffCancelChoice
              name="detail-cancelled-by"
              value={cancelForm}
              onChange={(next) => {
                setCancelForm(next)
                setCancelFormProblem(null)
              }}
              heldGbp={depositHeld}
              canChooseAmount={canManage}
              disabled={Boolean(actionLoadingKey)}
            />
            {cancelFormProblem ? <Alert tone="danger" size="sm">{cancelFormProblem}</Alert> : null}
          </div>
        </Modal>

        {booking.status === 'cancelled' ? (
          <ConfirmDialog
            open={deleteConfirmOpen}
            onClose={() => setDeleteConfirmOpen(false)}
            onConfirm={() => void handleDeleteBooking()}
            tone="danger"
            title="Delete Booking"
            message={`Delete booking ${booking.booking_reference ?? ''} permanently? This cannot be undone.`}
            confirmLabel="Delete"
          />
        ) : (
          // Deleting a live booking cancels it, refunds and tells the guest, so it asks who is
          // cancelling as the cancel does (BK-046).
          <Modal
            open={deleteConfirmOpen}
            onClose={() => setDeleteConfirmOpen(false)}
            title="Delete Booking"
            width="md"
            footer={
              <>
                <Button variant="secondary" onClick={() => setDeleteConfirmOpen(false)}>
                  Keep Booking
                </Button>
                <Button
                  variant="danger"
                  loading={actionLoadingKey === 'delete'}
                  disabled={Boolean(actionLoadingKey)}
                  onClick={() => {
                    const read = readStaffCancelForm(cancelForm, depositHeld)
                    if (!read.ok) {
                      setCancelFormProblem(read.error)
                      return
                    }
                    setDeleteConfirmOpen(false)
                    void handleDeleteBooking(staffCancellationBody(read.choice))
                  }}
                >
                  Delete
                </Button>
              </>
            }
          >
            <div className="space-y-3">
              <p className="text-sm text-text">
                {`Delete booking ${booking.booking_reference ?? ''}? It is cancelled first, so the customer is notified and any deposit refunded.`}
              </p>
              <StaffCancelChoice
                name="detail-delete-cancelled-by"
                value={cancelForm}
                onChange={(next) => {
                  setCancelForm(next)
                  setCancelFormProblem(null)
                }}
                heldGbp={depositHeld}
                canChooseAmount={canManage}
                disabled={Boolean(actionLoadingKey)}
              />
              {cancelFormProblem ? <Alert tone="danger" size="sm">{cancelFormProblem}</Alert> : null}
            </div>
          </Modal>
        )}

        {/* The DS Modal panel carries data-touch-targets, so on a touch screen (BOH on the bar iPad)
            each dialog's controls get the 44px floor (D6). */}
        <Modal
          open={depositAction !== null}
          onClose={() => setDepositAction(null)}
          title={
            depositAction === 'waive'
              ? 'Waive the deposit'
              : depositAction === 'cash'
                ? 'Deposit taken at the bar'
                : 'Give the guest longer to pay'
          }
          width="md"
          footer={
            <>
              <Button variant="secondary" onClick={() => setDepositAction(null)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={() => void handleSubmitDepositAction()}
                loading={actionLoadingKey === 'deposit-action'}
                disabled={Boolean(actionLoadingKey)}
              >
                {depositAction === 'waive' ? 'Waive deposit' : depositAction === 'cash' ? 'Record payment' : 'Save new time'}
              </Button>
            </>
          }
        >
          <div className="space-y-4">
            <p className="text-sm text-text-muted">
              {depositAction === 'waive'
                ? 'The booking is confirmed with no deposit, and the guest\'s payment link stops working.'
                : depositAction === 'cash'
                  ? `Records ${depositState.amount != null ? formatGbp(depositState.amount) : 'the deposit'} as paid at the bar and confirms the booking.`
                  : 'The guest\'s payment link keeps working until the new time. It can be no later than the booking start.'}
            </p>
            {depositAction === 'extend' && (
              <Input
                label="Pay by"
                type="datetime-local"
                value={depositActionUntil}
                max={booking.start_datetime ? utcIsoToLondonLocalInput(booking.start_datetime) : undefined}
                onChange={(event) => setDepositActionUntil(event.target.value)}
              />
            )}
            <Textarea
              label="Why"
              value={depositActionReason}
              onChange={(event) => setDepositActionReason(event.target.value)}
              rows={3}
              maxLength={500}
              placeholder={depositAction === 'cash' ? 'Who took it, and card or cash' : 'Recorded on the booking'}
            />
          </div>
        </Modal>

        <Modal
          open={bookingEditOpen}
          onClose={() => setBookingEditOpen(false)}
          title="Edit Booking"
          width="xl"
          footer={
            <>
              <Button variant="secondary" onClick={() => setBookingEditOpen(false)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={() => void handleSubmitBookingEdit()}
                loading={actionLoadingKey === 'booking-edit'}
                disabled={Boolean(actionLoadingKey) || !bookingEdit}
              >
                Save Changes
              </Button>
            </>
          }
        >
          {bookingEdit && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <Input
                  label="Date"
                  type="date"
                  value={bookingEdit.booking_date}
                  onChange={(event) => setBookingEdit((prev) => prev ? { ...prev, booking_date: event.target.value } : prev)}
                />
                <Input
                  label="Time"
                  type="time"
                  value={bookingEdit.booking_time}
                  onChange={(event) => setBookingEdit((prev) => prev ? { ...prev, booking_time: event.target.value } : prev)}
                />
                <Input
                  label="Duration"
                  type="number"
                  min={30}
                  max={360}
                  step={15}
                  value={bookingEdit.duration_minutes}
                  onChange={(event) => setBookingEdit((prev) => prev ? { ...prev, duration_minutes: event.target.value } : prev)}
                />
              </div>

              <Field label="Customer">
                <CustomerSearchInput
                  selectedCustomerId={bookingEdit.customer_id}
                  placeholder="Search customers..."
                  onCustomerSelect={(customer) =>
                    setBookingEdit((prev) => prev ? { ...prev, customer_id: customer?.id ?? null } : prev)
                  }
                />
              </Field>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Textarea
                  label="Dietary requirements"
                  value={bookingEdit.dietary_requirements}
                  onChange={(event) => setBookingEdit((prev) => prev ? { ...prev, dietary_requirements: event.target.value } : prev)}
                  rows={3}
                />
                <Textarea
                  label="Allergies"
                  value={bookingEdit.allergies}
                  onChange={(event) => setBookingEdit((prev) => prev ? { ...prev, allergies: event.target.value } : prev)}
                  rows={3}
                />
              </div>

              <Input
                label="Celebration"
                value={bookingEdit.celebration_type}
                onChange={(event) => setBookingEdit((prev) => prev ? { ...prev, celebration_type: event.target.value } : prev)}
              />
              <Textarea
                label="Special requirements"
                value={bookingEdit.special_requirements}
                onChange={(event) => setBookingEdit((prev) => prev ? { ...prev, special_requirements: event.target.value } : prev)}
                rows={3}
              />
              <Textarea
                label="Internal notes"
                value={bookingEdit.internal_notes}
                onChange={(event) => setBookingEdit((prev) => prev ? { ...prev, internal_notes: event.target.value } : prev)}
                rows={4}
              />
            </div>
          )}
        </Modal>

        <Modal
          open={preorderEditOpen}
          onClose={() => setPreorderEditOpen(false)}
          title="Edit Pre-Order"
          width="lg"
          footer={
            <>
              <Button variant="secondary" onClick={() => setPreorderEditOpen(false)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={() => void handleSubmitPreorderEdit()}
                loading={actionLoadingKey === 'preorder-edit'}
                disabled={Boolean(actionLoadingKey)}
              >
                Save Changes
              </Button>
            </>
          }
        >
          <ul className="divide-y divide-border">
            {preorderItems.map((item) => (
              <li key={item.id} className="py-4 first:pt-0 last:pb-0">
                <p className="text-sm font-medium text-text">
                  {item.menu_dish?.name || item.custom_item_name || 'Unnamed item'}
                </p>
                <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-[120px_minmax(0,1fr)]">
                  <Input
                    label="Qty"
                    type="number"
                    min={1}
                    max={99}
                    value={preorderEdit[item.id]?.quantity ?? String(item.quantity ?? 1)}
                    onChange={(event) =>
                      setPreorderEdit((prev) => ({
                        ...prev,
                        [item.id]: {
                          quantity: event.target.value,
                          special_requests: prev[item.id]?.special_requests ?? item.special_requests ?? '',
                        },
                      }))
                    }
                  />
                  <Input
                    label="Requests"
                    value={preorderEdit[item.id]?.special_requests ?? item.special_requests ?? ''}
                    onChange={(event) =>
                      setPreorderEdit((prev) => ({
                        ...prev,
                        [item.id]: {
                          quantity: prev[item.id]?.quantity ?? String(item.quantity ?? 1),
                          special_requests: event.target.value,
                        },
                      }))
                    }
                  />
                </div>
              </li>
            ))}
          </ul>
        </Modal>

        <Modal
          open={partySizeEditOpen}
          onClose={() => setPartySizeEditOpen(false)}
          title="Edit Party Size"
          width="sm"
          footer={
            <>
              <Button variant="secondary" onClick={() => setPartySizeEditOpen(false)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={() => void handleSubmitPartySize()}
                loading={actionLoadingKey === 'party-size'}
                disabled={
                  Boolean(actionLoadingKey) ||
                  !partySizeEditValue ||
                  Number.parseInt(partySizeEditValue, 10) < 1
                }
              >
                Save Changes
              </Button>
            </>
          }
        >
          <div className="space-y-4">
            <Input
              id="party-size-input"
              label="New party size"
              type="number"
              min={1}
              max={20}
              value={partySizeEditValue}
              onChange={(e) => setPartySizeEditValue(e.target.value)}
            />
            <ChristmasCourseFields bookingId={booking.id} partySize={Number(partySizeEditValue)} onChange={setChristmasCourseCounts} />
            {partySizeNeedsLargerTable && (
              <>
                <Alert tone="warning" role="status">
                  This party is larger than the current {assignedCapacity} seats. Saving will move it
                  to a larger table setup automatically. Pick specific tables below if you&rsquo;d prefer.
                </Alert>
                <Select
                  id="party-size-move-table"
                  label="Larger table"
                  value={partySizeMoveTableId}
                  onChange={(event) => setPartySizeMoveTableId(event.target.value)}
                  disabled={loadingMoveTables || partySizeMoveTableOptions.length === 0}
                >
                  <option value="">
                    {loadingMoveTables
                      ? 'Loading tables…'
                      : partySizeMoveTableOptions.length === 0
                        ? 'No larger table available'
                        : 'Select larger table'}
                  </option>
                  {partySizeMoveTableOptions.map((table) => (
                    <option key={table.id} value={table.id}>
                      {table.name}
                      {table.table_number ? ` (${table.table_number})` : ''}
                      {table.capacity ? ` - cap ${table.capacity}` : ''}
                    </option>
                  ))}
                </Select>
              </>
            )}
            {/* The request goes by email first, with a text as the fallback. */}
            <Checkbox
              label="Notify guest"
              checked={partySizeEditSendSms}
              onChange={(checked) => setPartySizeEditSendSms(checked)}
            />
          </div>
        </Modal>

        {canRefund && depositRefunds !== null && depositCanBeRefunded && (
          <RefundDialog
            open={showRefundDialog}
            onOpenChange={setShowRefundDialog}
            sourceType="table_booking"
            sourceId={booking.id}
            originalAmount={refundableDepositAmount}
            totalRefunded={refundTotals.totalRefunded}
            totalPending={refundTotals.totalPending}
            hasPayPalCapture={!!booking.paypal_deposit_capture_id}
            captureExpired={
              booking.card_capture_completed_at
                ? (new Date().getTime() - new Date(booking.card_capture_completed_at).getTime()) / (1000 * 60 * 60 * 24) > 180
                : false
            }
          />
        )}
      </div>
    </PageLayout>
  )
}
