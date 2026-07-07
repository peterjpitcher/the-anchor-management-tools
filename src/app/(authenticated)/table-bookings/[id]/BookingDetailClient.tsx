'use client'

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import toast from 'react-hot-toast'
import { Badge, Button, ConfirmDialog, Input, Modal, Textarea } from '@/ds'
import CustomerSearchInput from '@/components/features/customers/CustomerSearchInput'
import { RefundDialog } from '@/components/features/invoices/RefundDialog'
import { RefundHistoryTable } from '@/components/features/invoices/RefundHistoryTable'
import { getCanonicalDeposit } from '@/lib/table-bookings/deposit'
import {
  formatGbp,
  getTableBookingDepositBadgeClasses,
  getTableBookingDepositState,
  getTableBookingStatusBadgeClasses,
  getTableBookingStatusLabel,
  getTableBookingVisualState,
} from '@/lib/table-bookings/ui'
import { requestTableBookingAction } from '@/lib/table-bookings/client-actions'

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

function formatAuditEvent(event: string): string {
  const labels: Record<string, string> = {
    booking_created: 'Booking created',
    status_changed: 'Status changed',
    status_updated: 'Status updated',
    party_size_updated: 'Party size updated',
    table_moved: 'Table moved',
    table_assigned: 'Table assigned',
    sms_sent: 'SMS sent',
    sms_failed: 'SMS failed',
    deposit_paid: 'Deposit paid',
    deposit_link_created: 'Deposit link created',
    refund_created: 'Refund created',
    payment_completed: 'Payment completed',
  }

  return labels[event] ?? formatLabel(event)
}

function getAuditActor(entry: BookingAuditEntry): string {
  const meta = parseMeta(entry.meta)
  const actor = formatMetaValue(meta.actor_name) ?? formatMetaValue(meta.user_email) ?? formatMetaValue(meta.performed_by)
  if (actor) return actor
  return entry.created_by ? 'Team member' : 'System'
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
    .filter(([key]) => !/(token|secret|signature|hash|url)/i.test(key))
    .map(([key, value]) => {
      const rendered = formatMetaValue(value)
      return rendered ? `${formatLabel(key)}: ${rendered}` : null
    })
    .filter((line): line is string => Boolean(line))
    .slice(0, 4)
}

function SectionCard({
  title,
  description,
  action,
  children,
  className = '',
}: {
  title: string
  description?: string
  action?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={`rounded-lg border border-gray-200 bg-white ${className}`}>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-gray-100 px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
          {description && <p className="mt-0.5 text-xs text-gray-500">{description}</p>}
        </div>
        {action}
      </div>
      <div className="p-4">{children}</div>
    </section>
  )
}

function DetailItem({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-gray-500">{label}</dt>
      <dd className="mt-1 text-sm text-gray-900">{value || '-'}</dd>
    </div>
  )
}

function StatusBadge({ booking }: { booking: Booking }) {
  const visualState = getTableBookingVisualState(booking)
  return (
    <span
      className={`text-xs font-semibold uppercase tracking-wide px-2 py-0.5 rounded border ${getTableBookingStatusBadgeClasses(visualState)}`}
    >
      {getTableBookingStatusLabel(visualState)}
    </span>
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

export interface BookingAuditEntry {
  id: number
  event: string
  old_status: string | null
  new_status: string | null
  meta: unknown
  created_at: string
  created_by: string | null
}

export interface Booking {
  id: string
  booking_reference: string | null
  booking_date: string
  booking_time: string | null
  party_size: number | null
  committed_party_size: number | null
  booking_type: string | null
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
  deposit_waived: boolean | null
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
  customer: BookingCustomer | null
  table_booking_tables: BookingTable[]
  table_booking_items: BookingItem[]
  audit_trail: BookingAuditEntry[]
}

interface Props {
  booking: Booking
  canEdit: boolean
  canManage: boolean
  canRefund: boolean
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

export default function BookingDetailClient({ booking, canEdit, canManage, canRefund }: Props) {
  const router = useRouter()
  const [actionLoadingKey, setActionLoadingKey] = useState<string | null>(null)
  const [moveTableId, setMoveTableId] = useState<string>('')
  const [availableMoveTables, setAvailableMoveTables] = useState<MoveTableOption[]>([])
  const [loadingMoveTables, setLoadingMoveTables] = useState(false)
  const [noShowConfirmOpen, setNoShowConfirmOpen] = useState(false)
  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [partySizeEditOpen, setPartySizeEditOpen] = useState(false)
  const [partySizeEditValue, setPartySizeEditValue] = useState('')
  const [partySizeEditSendSms, setPartySizeEditSendSms] = useState(true)
  const [partySizeMoveTableId, setPartySizeMoveTableId] = useState('')
  const [bookingEditOpen, setBookingEditOpen] = useState(false)
  const [bookingEdit, setBookingEdit] = useState<BookingEditState | null>(null)
  const [preorderEditOpen, setPreorderEditOpen] = useState(false)
  const [preorderEdit, setPreorderEdit] = useState<PreorderEditState>({})
  const [smsBody, setSmsBody] = useState('')
  const [showRefundDialog, setShowRefundDialog] = useState(false)
  const [refundTotals, setRefundTotals] = useState({ totalRefunded: 0, totalPending: 0 })

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

  const guestName = [booking.customer?.first_name, booking.customer?.last_name].filter(Boolean).join(' ') || 'Unknown guest'
  const depositState = getTableBookingDepositState(booking)
  const canonicalDepositAmount = getCanonicalDeposit(
    {
      party_size: booking.party_size ?? 0,
      deposit_amount: booking.deposit_amount,
      deposit_amount_locked: booking.deposit_amount_locked,
      status: booking.status,
      payment_status: booking.payment_status,
      deposit_waived: booking.deposit_waived,
    },
    booking.party_size ?? 0,
  )
  const refundableDepositAmount =
    booking.payment_status === 'completed'
      ? Math.max(0, canonicalDepositAmount)
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
    booking.deposit_waived ? 'Deposit waived' : null,
    assignedTables.length === 0 ? 'No table assigned' : null,
    !booking.customer?.mobile_number ? 'No mobile number on this customer' : null,
    notes.some((note) => note.label === 'Allergies' || note.label === 'Dietary requirements')
      ? 'Dietary or allergy notes present'
      : null,
    booking.hold_expires_at ? `Payment hold expires ${formatLondonDateTime(booking.hold_expires_at)}` : null,
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
  const preorderItems = booking.table_booking_items ?? []
  const canEditPreorder =
    canEdit &&
    preorderItems.length > 0 &&
    (!booking.sunday_preorder_cutoff_at || new Date(booking.sunday_preorder_cutoff_at).getTime() > Date.now())

  useEffect(() => {
    if (!booking.id || booking.payment_status !== 'completed') return
    let cancelled = false
    import('@/app/actions/refundActions').then(({ getRefundHistory }) =>
      getRefundHistory('table_booking', booking.id).then((result) => {
        if (cancelled || !result.data) return
        const completed = result.data
          .filter((r: any) => r.status === 'completed')
          .reduce((sum: number, r: any) => sum + Number(r.amount), 0)
        const pending = result.data
          .filter((r: any) => r.status === 'pending')
          .reduce((sum: number, r: any) => sum + Number(r.amount), 0)
        setRefundTotals({ totalRefunded: completed, totalPending: pending })
      })
    )
    return () => {
      cancelled = true
    }
  }, [booking.id, booking.payment_status])

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
    action: 'seated' | 'left' | 'no_show' | 'cancelled' | 'confirmed' | 'completed'
  ) {
    await runAction(
      `status:${action}`,
      async () => {
        await requestTableBookingAction(`/api/boh/table-bookings/${booking.id}/status`, {
          body: { action },
        })
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
          data?: { auto_moved_table_name?: string | null }
        }>(`/api/boh/table-bookings/${booking.id}/party-size`, {
          body: {
            party_size: nextSize,
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
        return payload
      },
      (payload) => {
        const movedTableName = payload.data?.auto_moved_table_name
        const prefix = movedTableName ? `Moved to ${movedTableName}. ` : ''
        if (payload.warning) {
          return `${prefix}${payload.warning}`
        }
        if (payload.depositRequired) {
          return payload.smsSent
            ? `${prefix}Party size updated. Deposit link sent by SMS.`
            : `${prefix}Party size updated. Deposit link created.`
        }
        return `${prefix}Party size updated`
      }
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

  async function handleDeleteBooking() {
    await runAction(
      'delete',
      async () => {
        await requestTableBookingAction(`/api/boh/table-bookings/${booking.id}`, {
          method: 'DELETE',
        })
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

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-gray-200 bg-white p-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge booking={booking} />
              {depositState.kind !== 'none' && (
                <span className={`text-xs font-medium px-2 py-0.5 rounded border ${getTableBookingDepositBadgeClasses(depositState.kind)}`}>
                  {depositState.label}
                  {depositState.amount != null ? ` · ${formatGbp(depositState.amount)}` : ''}
                </span>
              )}
              {booking.booking_type && (
                <Badge tone="neutral">{formatLabel(booking.booking_type)}</Badge>
              )}
            </div>
            <div>
              <p className="text-xl font-semibold text-gray-900">{guestName}</p>
              <p className="text-sm text-gray-500">
                {formatBookingDate(booking.booking_date)}
                {booking.booking_time ? ` at ${booking.booking_time.slice(0, 5)}` : ''}
                {booking.party_size != null ? ` · ${booking.party_size} covers` : ''}
                {booking.is_outside_seating ? ' · Outside' : assignedTableLabel ? ` · ${assignedTableLabel}` : ''}
              </p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:min-w-[520px]">
            <div className="rounded-md bg-gray-50 px-3 py-2">
              <p className="text-xs text-gray-500">Covers</p>
              <p className="text-lg font-semibold text-gray-900">{booking.party_size ?? '-'}</p>
            </div>
            <div className="rounded-md bg-gray-50 px-3 py-2">
              <p className="text-xs text-gray-500">Tables</p>
              <p className="text-lg font-semibold text-gray-900">{booking.is_outside_seating ? 'Outside' : assignedTables.length || '-'}</p>
            </div>
            <div className="rounded-md bg-gray-50 px-3 py-2">
              <p className="text-xs text-gray-500">Capacity</p>
              <p className="text-lg font-semibold text-gray-900">{booking.is_outside_seating ? 'Outside' : assignedCapacity || '-'}</p>
            </div>
            <div className="rounded-md bg-gray-50 px-3 py-2">
              <p className="text-xs text-gray-500">Audit</p>
              <p className="text-lg font-semibold text-gray-900">{auditTrail.length}</p>
            </div>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="space-y-6">
          <SectionCard title="Booking Details">
            <dl className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
              <DetailItem label="Reference" value={booking.booking_reference} />
              <DetailItem label="Guest" value={guestName} />
              <DetailItem
                label="Mobile"
                value={
                  booking.customer?.mobile_number ? (
                    <a href={`tel:${booking.customer.mobile_number}`} className="text-blue-600 hover:underline">
                      {booking.customer.mobile_number}
                    </a>
                  ) : '-'
                }
              />
              <DetailItem label="Date" value={formatBookingDate(booking.booking_date)} />
              <DetailItem label="Time" value={booking.booking_time ? booking.booking_time.slice(0, 5) : '-'} />
              <DetailItem label="Duration" value={formatDuration(booking.duration_minutes)} />
              <DetailItem label="Party size" value={booking.party_size ?? '-'} />
              <DetailItem label="Committed size" value={booking.committed_party_size ?? '-'} />
              <DetailItem label="Assigned tables" value={booking.is_outside_seating ? 'Outside' : assignedTableLabel ?? '-'} />
              <DetailItem label="Seating" value={booking.is_outside_seating ? 'Outside' : 'Indoor'} />
              <DetailItem label="High chairs" value={String(booking.high_chair_count ?? 0)} />
              <DetailItem label="Booking type" value={formatLabel(booking.booking_type)} />
              <DetailItem label="Purpose" value={formatLabel(booking.booking_purpose)} />
              <DetailItem label="Source" value={formatLabel(booking.source)} />
            </dl>
          </SectionCard>

          <SectionCard title="Notes And Requirements">
            {notes.length > 0 ? (
              <dl className="space-y-4">
                {notes.map((note) => (
                  <div key={note.label}>
                    <dt className="text-xs font-semibold uppercase tracking-wide text-gray-500">{note.label}</dt>
                    <dd className="mt-1 whitespace-pre-wrap text-sm text-gray-900">{note.value}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="text-sm text-gray-500">No notes, dietary requirements, allergies, or internal notes recorded.</p>
            )}
          </SectionCard>

          <SectionCard
            title="Sunday Pre-Order"
            action={
              canEditPreorder ? (
                <Button size="sm" variant="secondary" onClick={openPreorderEdit}>
                  Edit pre-order
                </Button>
              ) : undefined
            }
          >
            {preorderItems.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200 text-sm">
                  <thead>
                    <tr>
                      <th scope="col" className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                        Item
                      </th>
                      <th scope="col" className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                        Qty
                      </th>
                      <th scope="col" className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                        Guest
                      </th>
                      <th scope="col" className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                        Requests
                      </th>
                      <th scope="col" className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wide text-gray-500">
                        Price
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {preorderItems.map((item) => (
                      <tr key={item.id}>
                        <td className="px-3 py-2 font-medium text-gray-900">
                          {item.menu_dish?.name || item.custom_item_name || 'Unnamed item'}
                          {item.item_type ? <span className="ml-2 text-xs text-gray-500">{formatLabel(item.item_type)}</span> : null}
                        </td>
                        <td className="px-3 py-2 text-gray-700">{item.quantity}</td>
                        <td className="px-3 py-2 text-gray-700">{item.guest_name || '-'}</td>
                        <td className="px-3 py-2 text-gray-700">{item.special_requests || '-'}</td>
                        <td className="px-3 py-2 text-right text-gray-700">
                          {item.price_at_booking != null ? formatGbp(Number(item.price_at_booking) * Number(item.quantity || 1)) : '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-gray-500">No saved pre-order items.</p>
            )}
          </SectionCard>

          <SectionCard title="Lifecycle">
            {lifecycleEvents.length > 0 ? (
              <ol className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {lifecycleEvents.map((event) => (
                  <li key={`${event.label}-${event.at}`} className="rounded-md border border-gray-100 bg-gray-50 px-3 py-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{event.label}</p>
                    <p className="mt-1 text-sm text-gray-900">{formatLondonDateTime(event.at)}</p>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-sm text-gray-500">No lifecycle timestamps recorded yet.</p>
            )}
          </SectionCard>
        </div>

        <aside className="space-y-6">
          {canEdit && (
            <SectionCard title="Actions">
              <div className="space-y-4">
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    onClick={() => void handleStatusAction('seated')}
                    loading={actionLoadingKey === 'status:seated'}
                    disabled={Boolean(actionLoadingKey)}
                  >
                    Seat guests
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => void handleStatusAction('left')}
                    loading={actionLoadingKey === 'status:left'}
                    disabled={Boolean(actionLoadingKey)}
                  >
                    Mark left
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => void handleStatusAction('confirmed')}
                    loading={actionLoadingKey === 'status:confirmed'}
                    disabled={Boolean(actionLoadingKey)}
                  >
                    Mark confirmed
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => void handleStatusAction('completed')}
                    loading={actionLoadingKey === 'status:completed'}
                    disabled={Boolean(actionLoadingKey)}
                  >
                    Mark completed
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={openBookingEdit}
                    disabled={Boolean(actionLoadingKey)}
                  >
                    Edit booking
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={openPartySizeEdit}
                    disabled={Boolean(actionLoadingKey)}
                  >
                    Edit party size
                  </Button>
                  {booking.status === 'pending_payment' && (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => void handleCopyDepositLink()}
                      loading={actionLoadingKey === 'deposit-link'}
                      disabled={Boolean(actionLoadingKey)}
                    >
                      Copy deposit link
                    </Button>
                  )}
                </div>

                <div className="space-y-2 border-t border-gray-100 pt-4">
                  <label htmlFor="move-table-select" className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                    Move table
                  </label>
                  <div className="flex flex-col gap-2 sm:flex-row xl:flex-col 2xl:flex-row">
                    <select
                      id="move-table-select"
                      value={moveTableId}
                      onChange={(e) => setMoveTableId(e.target.value)}
                      disabled={loadingMoveTables || availableMoveTables.length === 0}
                      className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gray-500 focus:outline-none focus:ring-2 focus:ring-gray-200"
                    >
                      <option value="">
                        {loadingMoveTables
                          ? 'Loading available tables...'
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
                    </select>
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
                </div>
              </div>
            </SectionCard>
          )}

          <SectionCard title="Payment And Deposit">
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                {depositState.kind !== 'none' ? (
                  <span className={`text-xs font-medium px-2 py-0.5 rounded border ${getTableBookingDepositBadgeClasses(depositState.kind)}`}>
                    {depositState.label}
                    {depositState.amount != null ? ` · ${formatGbp(depositState.amount)}` : ''}
                  </span>
                ) : (
                  <Badge tone="neutral">No deposit required</Badge>
                )}
                {booking.payment_status && <Badge tone="neutral">{formatLabel(booking.payment_status)}</Badge>}
              </div>

              <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
                <DetailItem label="Method" value={formatLabel(booking.payment_method)} />
                <DetailItem label="Refundable" value={refundableDepositAmount > 0 ? formatGbp(refundableDepositAmount) : '-'} />
                <DetailItem label="Locked amount" value={booking.deposit_amount_locked != null ? formatGbp(Number(booking.deposit_amount_locked)) : '-'} />
                <DetailItem label="Captured" value={formatLondonDateTime(booking.card_capture_completed_at)} />
              </dl>

              {booking.paypal_deposit_capture_id && (
                <p className="break-all text-xs text-gray-500">Capture ID: {booking.paypal_deposit_capture_id}</p>
              )}

              {refundTotals.totalRefunded > 0 && (
                <Badge
                  variant={refundTotals.totalRefunded >= refundableDepositAmount ? 'info' : 'warning'}
                  size="sm"
                >
                  {refundTotals.totalRefunded >= refundableDepositAmount ? 'Refunded' : 'Partially refunded'}
                </Badge>
              )}

              {canRefund && booking.payment_status === 'completed' && refundTotals.totalRefunded < refundableDepositAmount && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setShowRefundDialog(true)}
                >
                  Process refund
                </Button>
              )}

              {booking.payment_status === 'completed' && (
                <div className="border-t border-gray-100 pt-3">
                  <RefundHistoryTable sourceType="table_booking" sourceId={booking.id} />
                </div>
              )}
            </div>
          </SectionCard>

          <SectionCard title="Send SMS">
            {canEdit ? (
              <div className="space-y-3">
                <textarea
                  value={smsBody}
                  onChange={(e) => setSmsBody(e.target.value)}
                  rows={5}
                  maxLength={640}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-gray-500 focus:outline-none focus:ring-2 focus:ring-gray-200"
                  placeholder="Type message..."
                />
                <div className="flex items-center justify-between">
                  <p className="text-xs text-gray-500">{smsBody.length}/640</p>
                  <Button
                    size="sm"
                    variant="secondary"
                    loading={actionLoadingKey === 'send-sms'}
                    disabled={Boolean(actionLoadingKey)}
                    onClick={() => void handleSendSms()}
                  >
                    Send SMS
                  </Button>
                </div>
              </div>
            ) : (
              <p className="text-sm text-gray-500">You do not have permission to send SMS messages.</p>
            )}
          </SectionCard>

          <SectionCard title="Operational Flags">
            {operationalFlags.length > 0 ? (
              <ul className="space-y-2">
                {operationalFlags.map((flag) => (
                  <li key={flag} className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
                    {flag}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-gray-500">No operational flags for this booking.</p>
            )}
          </SectionCard>

          {canManage && (
            <SectionCard title="Danger Zone" className="border-red-200">
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="danger"
                  onClick={() => setNoShowConfirmOpen(true)}
                  disabled={Boolean(actionLoadingKey)}
                >
                  Mark no-show
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  onClick={() => setCancelConfirmOpen(true)}
                  disabled={Boolean(actionLoadingKey)}
                >
                  Cancel booking
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  onClick={() => setDeleteConfirmOpen(true)}
                  disabled={Boolean(actionLoadingKey)}
                >
                  Delete booking
                </Button>
              </div>
            </SectionCard>
          )}
        </aside>
      </div>

      <SectionCard title="Audit Trail" description="Every recorded booking audit event, newest first.">
        {auditTrail.length === 0 ? (
          <p className="text-sm text-gray-500">No audit events have been recorded for this booking yet.</p>
        ) : (
          <ol className="divide-y divide-gray-100">
            {auditTrail.map((entry) => {
              const details = getAuditDetails(entry)
              return (
                <li key={entry.id} className="grid grid-cols-1 gap-3 py-4 lg:grid-cols-[220px_minmax(0,1fr)_180px]">
                  <div>
                    <p className="text-sm font-medium text-gray-900">{formatLondonDateTime(entry.created_at)}</p>
                    <p className="mt-0.5 text-xs text-gray-500">{getAuditActor(entry)}</p>
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-gray-900">{formatAuditEvent(entry.event)}</p>
                    {details.length > 0 && (
                      <ul className="mt-2 space-y-1">
                        {details.map((detail) => (
                          <li key={detail} className="whitespace-pre-wrap text-sm text-gray-600">
                            {detail}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <div className="lg:text-right">
                    {entry.new_status ? (
                      <Badge tone="neutral">{formatLabel(entry.new_status)}</Badge>
                    ) : (
                      <span className="text-xs text-gray-400">No status change</span>
                    )}
                  </div>
                </li>
              )
            })}
          </ol>
        )}
      </SectionCard>

      <ConfirmDialog
        open={noShowConfirmOpen}
        onClose={() => setNoShowConfirmOpen(false)}
        onConfirm={async () => {
          setNoShowConfirmOpen(false)
          await handleStatusAction('no_show')
        }}
        type="warning"
        title="Mark as no-show?"
        message="This will mark the booking as no-show and remove it from active covers."
        confirmText="Mark No-show"
        closeOnConfirm={false}
      />

      <ConfirmDialog
        open={cancelConfirmOpen}
        onClose={() => setCancelConfirmOpen(false)}
        onConfirm={async () => {
          setCancelConfirmOpen(false)
          await handleStatusAction('cancelled')
        }}
        type="warning"
        title="Cancel this booking?"
        message="The customer will be notified."
        confirmText="Cancel Booking"
        confirmVariant="danger"
        closeOnConfirm={false}
      />

      <ConfirmDialog
        open={deleteConfirmOpen}
        onClose={() => setDeleteConfirmOpen(false)}
        onConfirm={() => void handleDeleteBooking()}
        type="danger"
        destructive
        title="Delete this booking?"
        message={`Delete booking ${booking.booking_reference ?? ''} permanently? This cannot be undone.`}
        confirmText="Delete"
      />

      <Modal
        open={bookingEditOpen}
        onClose={() => setBookingEditOpen(false)}
        title="Edit booking"
        size="xl"
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setBookingEditOpen(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={() => void handleSubmitBookingEdit()}
              loading={actionLoadingKey === 'booking-edit'}
              disabled={Boolean(actionLoadingKey) || !bookingEdit}
            >
              Save
            </Button>
          </>
        }
      >
        {bookingEdit && (
          <div className="space-y-5">
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

            <div>
              <p className="mb-1 text-[13px] font-medium text-text">Customer</p>
              <CustomerSearchInput
                selectedCustomerId={bookingEdit.customer_id}
                placeholder="Search customers..."
                onCustomerSelect={(customer) =>
                  setBookingEdit((prev) => prev ? { ...prev, customer_id: customer?.id ?? null } : prev)
                }
              />
            </div>

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
        title="Edit pre-order"
        size="lg"
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setPreorderEditOpen(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={() => void handleSubmitPreorderEdit()}
              loading={actionLoadingKey === 'preorder-edit'}
              disabled={Boolean(actionLoadingKey)}
            >
              Save
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {preorderItems.map((item) => (
            <div key={item.id} className="rounded-md border border-gray-200 p-3">
              <p className="text-sm font-medium text-gray-900">
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
            </div>
          ))}
        </div>
      </Modal>

      <Modal
        open={partySizeEditOpen}
        onClose={() => setPartySizeEditOpen(false)}
        title="Edit party size"
        size="sm"
      >
        <div className="space-y-4">
          <div>
            <label htmlFor="party-size-input" className="block text-sm font-medium text-gray-700">
              New party size
            </label>
            <input
              id="party-size-input"
              type="number"
              min={1}
              max={20}
              value={partySizeEditValue}
              onChange={(e) => setPartySizeEditValue(e.target.value)}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gray-500 focus:outline-none focus:ring-2 focus:ring-gray-200"
            />
          </div>
          {partySizeNeedsLargerTable && (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3">
              <p className="text-sm text-amber-900">
                This party is larger than the current {assignedCapacity} seats. Saving will move it
                to a larger table setup automatically — pick specific tables below if you&rsquo;d prefer.
              </p>
              <label htmlFor="party-size-move-table" className="mt-3 block text-sm font-medium text-amber-950">
                Larger table
              </label>
              <select
                id="party-size-move-table"
                value={partySizeMoveTableId}
                onChange={(event) => setPartySizeMoveTableId(event.target.value)}
                disabled={loadingMoveTables || partySizeMoveTableOptions.length === 0}
                className="mt-1 w-full rounded-md border border-amber-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-200"
              >
                <option value="">
                  {loadingMoveTables
                    ? 'Loading tables...'
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
              </select>
            </div>
          )}
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={partySizeEditSendSms}
              onChange={(event) => setPartySizeEditSendSms(event.target.checked)}
              className="rounded border-gray-300 text-green-600 focus:ring-green-500"
            />
            Notify guest by SMS
          </label>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={() => setPartySizeEditOpen(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={() => void handleSubmitPartySize()}
              loading={actionLoadingKey === 'party-size'}
              disabled={
                Boolean(actionLoadingKey) ||
                !partySizeEditValue ||
                Number.parseInt(partySizeEditValue, 10) < 1
              }
            >
              Save
            </Button>
          </div>
        </div>
      </Modal>

      {canRefund && booking.payment_status === 'completed' && (
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
  )
}
