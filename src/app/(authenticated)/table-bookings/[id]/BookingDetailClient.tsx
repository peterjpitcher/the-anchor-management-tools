'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import toast from 'react-hot-toast'
import { Modal } from '@/components/ui-v2/overlay/Modal'
import { ConfirmDialog } from '@/components/ui-v2/overlay/ConfirmDialog'
import { Button } from '@/components/ui-v2/forms/Button'
import PreorderTab from './PreorderTab'
// formatDateInLondon uses toLocaleDateString (date-only); use Intl.DateTimeFormat directly for time display
const formatLondonTime = (iso: string) =>
  new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Europe/London',
  }).format(new Date(iso))

function StatusBadge({ status }: { status: string }) {
  const colours: Record<string, string> = {
    confirmed: 'bg-green-100 text-green-800',
    pending: 'bg-yellow-100 text-yellow-800',
    seated: 'bg-blue-100 text-blue-800',
    completed: 'bg-gray-100 text-gray-600',
    cancelled: 'bg-red-100 text-red-800',
    no_show: 'bg-red-100 text-red-800',
  }
  return (
    <span
      className={`text-xs font-semibold uppercase tracking-wide px-2 py-0.5 rounded ${colours[status] ?? 'bg-gray-100 text-gray-600'}`}
    >
      {status.replace(/_/g, ' ')}
    </span>
  )
}

type Tab = 'overview' | 'preorder' | 'sms'

interface BookingCustomer {
  id: string
  first_name: string | null
  last_name: string | null
  mobile_number: string | null
}

interface BookingTableInner {
  id: string
  name: string
  table_number: string | null
  capacity: number | null
}

interface BookingTable {
  table: BookingTableInner | null
}

export interface Booking {
  id: string
  booking_reference: string | null
  booking_date: string
  booking_time: string | null
  party_size: number | null
  booking_type: string | null
  booking_purpose: string | null
  status: string
  special_requirements: string | null
  dietary_requirements: string | null
  allergies: string | null
  celebration_type: string | null
  seated_at: string | null
  left_at: string | null
  no_show_at: string | null
  confirmed_at: string | null
  cancelled_at: string | null
  start_datetime: string | null
  end_datetime: string | null
  duration_minutes: number | null
  sunday_preorder_cutoff_at: string | null
  sunday_preorder_completed_at: string | null
  deposit_waived: boolean | null
  payment_status: string | null
  payment_method: string | null
  paypal_deposit_capture_id: string | null
  deposit_amount: number | null
  customer: BookingCustomer | null
  table_booking_tables: BookingTable[]
}

interface Props {
  booking: Booking
  canEdit: boolean
  canManage: boolean
}

type MoveTableOption = {
  id: string
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

export default function BookingDetailClient({ booking, canEdit, canManage }: Props) {
  const [tab, setTab] = useState<Tab>('overview')
  const isSundayLunch = booking.booking_type === 'sunday_lunch'

  const tabs: { id: Tab; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    ...(isSundayLunch ? [{ id: 'preorder' as Tab, label: 'Pre-order' }] : []),
    { id: 'sms', label: 'SMS' },
  ]

  const router = useRouter()
  const [actionLoadingKey, setActionLoadingKey] = useState<string | null>(null)
  const [moveTableId, setMoveTableId] = useState<string>('')
  const [availableMoveTables, setAvailableMoveTables] = useState<
    { id: string; name: string; table_number: string | null; capacity: number | null }[]
  >([])
  const [loadingMoveTables, setLoadingMoveTables] = useState(false)
  const [noShowConfirmOpen, setNoShowConfirmOpen] = useState(false)
  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [partySizeEditOpen, setPartySizeEditOpen] = useState(false)
  const [partySizeEditValue, setPartySizeEditValue] = useState('')
  const [partySizeEditSendSms, setPartySizeEditSendSms] = useState(true)
  const [smsBody, setSmsBody] = useState('')

  async function runAction(key: string, fn: () => Promise<void>, successMsg: string) {
    setActionLoadingKey(key)
    try {
      await fn()
      toast.success(successMsg)
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
        const response = await fetch(`/api/boh/table-bookings/${booking.id}/status`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action }),
        })
        const payload = (await response.json()) as { error?: string }
        if (!response.ok) throw new Error(payload.error ?? 'Failed to update booking status')
      },
      'Booking updated'
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
        const response = await fetch(`/api/boh/table-bookings/${booking.id}/move-table`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ table_id: moveTableId }),
        })
        const payload = (await response.json()) as { error?: string }
        if (!response.ok) throw new Error(payload.error ?? 'Failed to move booking to selected table')
      },
      'Table assignment updated'
    )
  }

  async function handleSubmitPartySize() {
    const nextSize = Number.parseInt(partySizeEditValue, 10)
    if (!Number.isFinite(nextSize) || nextSize < 1 || nextSize > 50) {
      toast.error('Enter a party size between 1 and 50')
      return
    }
    await runAction(
      'party-size',
      async () => {
        const response = await fetch(`/api/boh/table-bookings/${booking.id}/party-size`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ party_size: nextSize, send_sms: partySizeEditSendSms }),
        })
        const payload = (await response.json()) as { error?: string }
        if (!response.ok) throw new Error(payload.error ?? 'Failed to update party size')
        setPartySizeEditOpen(false)
      },
      'Party size updated'
    )
  }

  async function handleCopyDepositLink() {
    await runAction(
      'deposit-link',
      async () => {
        // Deposit link endpoint uses GET (matches BohBookingsClient pattern)
        const response = await fetch(`/api/boh/table-bookings/${booking.id}/deposit-link`)
        const payload = (await response.json()) as { error?: string; url?: string }
        if (!response.ok) throw new Error(payload.error ?? 'Failed to generate deposit link')
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
        const response = await fetch(`/api/boh/table-bookings/${booking.id}`, {
          method: 'DELETE',
        })
        const payload = (await response.json()) as { error?: string }
        if (!response.ok) throw new Error(payload.error ?? 'Failed to delete booking')
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
        const response = await fetch(`/api/boh/table-bookings/${booking.id}/sms`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: trimmed }),
        })
        const payload = (await response.json()) as { error?: string }
        if (!response.ok) throw new Error(payload.error ?? 'Failed to send SMS')
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
    <div>
      {/* Tab bar */}
      <div className="flex border-b border-gray-200 mb-6">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t.id
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === 'overview' && (
        <div className="space-y-4 max-w-2xl">
          {/* Status strip */}
          <div className="flex flex-wrap items-center gap-3 p-4 bg-gray-50 rounded-lg border border-gray-200">
            <StatusBadge status={booking.status} />
            {booking.party_size != null && (
              <span className="text-sm text-gray-600">{booking.party_size} covers</span>
            )}
            {booking.table_booking_tables.length > 0 && (
              <span className="text-sm text-gray-600">
                {booking.table_booking_tables.map((t) => t.table?.name).filter(Boolean).join(', ')}
              </span>
            )}
            {booking.booking_type && (
              <span className="text-xs font-medium uppercase tracking-wide text-gray-500 bg-gray-200 px-2 py-0.5 rounded">
                {booking.booking_type.replace(/_/g, ' ')}
              </span>
            )}
            {booking.deposit_waived != null && (
              <span className={`text-xs font-medium px-2 py-0.5 rounded ${booking.deposit_waived ? 'bg-gray-100 text-gray-500' : 'bg-blue-100 text-blue-700'}`}>
                {booking.deposit_waived ? 'Deposit waived' : 'Deposit required'}
              </span>
            )}
          </div>

          {/* Guest info */}
          <div className="rounded-lg border border-gray-200 bg-white p-4 space-y-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">Guest</p>
            <p className="text-sm font-medium text-gray-900">
              {[booking.customer?.first_name, booking.customer?.last_name].filter(Boolean).join(' ') || '—'}
            </p>
            {booking.customer?.mobile_number && (
              <p className="text-sm text-gray-600">{booking.customer.mobile_number}</p>
            )}
            {booking.seated_at && (
              <p className="text-xs text-gray-400">
                Seated: {formatLondonTime(booking.seated_at)}
              </p>
            )}
            {booking.left_at && (
              <p className="text-xs text-gray-400">
                Left: {formatLondonTime(booking.left_at)}
              </p>
            )}
            {booking.no_show_at && (
              <p className="text-xs text-red-400">
                No-show: {formatLondonTime(booking.no_show_at)}
              </p>
            )}
          </div>

          {/* Notes — conditional */}
          {(booking.special_requirements || booking.dietary_requirements || booking.allergies || booking.celebration_type) && (
            <div className="rounded-lg border border-gray-200 bg-white p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">Notes</p>
              {booking.special_requirements && (
                <p className="text-sm text-gray-700 mb-1">{booking.special_requirements}</p>
              )}
              {booking.dietary_requirements && (
                <p className="text-sm text-gray-700 mb-1">Dietary: {booking.dietary_requirements}</p>
              )}
              {booking.allergies && (
                <p className="text-sm text-gray-700 mb-1">Allergies: {booking.allergies}</p>
              )}
              {booking.celebration_type && (
                <p className="text-sm text-gray-700">Celebration: {booking.celebration_type}</p>
              )}
            </div>
          )}

          {/* Deposit section — only when a deposit is involved */}
          {(booking.payment_status === 'completed' || booking.payment_status === 'pending' || booking.status === 'pending_payment') && (
            <div className="rounded-lg border border-gray-200 bg-white p-4 space-y-1">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">Deposit</p>
              {booking.payment_status === 'completed' ? (
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    <span className="inline-block w-2 h-2 rounded-full bg-green-500" />
                    <span className="text-sm font-medium text-green-700">
                      Paid via {booking.payment_method === 'paypal' ? 'PayPal' : booking.payment_method ?? 'Card'}
                    </span>
                    <span className="text-green-500 text-sm">✓</span>
                  </div>
                  {booking.deposit_amount != null && (
                    <p className="text-sm text-gray-700 pl-4">
                      £{booking.deposit_amount.toFixed(2)}
                    </p>
                  )}
                  {booking.paypal_deposit_capture_id && (
                    <p className="text-xs text-gray-400 pl-4">
                      Capture ID: {booking.paypal_deposit_capture_id}
                    </p>
                  )}
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <span className="text-amber-500 text-sm">⚠</span>
                  <span className="text-sm font-medium text-amber-700">
                    Outstanding —{' '}
                    {booking.deposit_amount != null
                      ? `£${booking.deposit_amount.toFixed(2)}`
                      : booking.party_size != null
                        ? `£${(booking.party_size * 10).toFixed(2)} (£10 × ${booking.party_size})`
                        : 'amount pending'}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Pre-order banner — Sunday lunch only */}
          {isSundayLunch && (
            <button
              type="button"
              onClick={() => setTab('preorder')}
              className={`w-full text-left rounded-lg border p-4 flex items-center justify-between transition-colors ${
                booking.sunday_preorder_completed_at
                  ? 'border-green-300 bg-green-50 hover:bg-green-100'
                  : 'border-amber-300 bg-amber-50 hover:bg-amber-100'
              }`}
            >
              <span
                className={`text-sm font-medium ${booking.sunday_preorder_completed_at ? 'text-green-800' : 'text-amber-800'}`}
              >
                {booking.sunday_preorder_completed_at
                  ? 'Sunday pre-order submitted'
                  : 'Sunday pre-order not yet submitted'}
              </span>
              <span
                className={`text-xs ${booking.sunday_preorder_completed_at ? 'text-green-600' : 'text-amber-600'}`}
              >
                View in Pre-order tab →
              </span>
            </button>
          )}

          {/* Quick actions */}
          {canEdit && (
            <div className="rounded-lg border border-gray-200 bg-white p-4 space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Quick actions</p>
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
                  onClick={() => setPartySizeEditOpen(true)}
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

              {/* Move table */}
              <div className="flex flex-col gap-2 sm:flex-row pt-2 border-t border-gray-100">
                <select
                  value={moveTableId}
                  onChange={(e) => setMoveTableId(e.target.value)}
                  disabled={loadingMoveTables || availableMoveTables.length === 0}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gray-500 focus:outline-none focus:ring-2 focus:ring-gray-200"
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
                      {table.capacity ? ` · cap ${table.capacity}` : ''}
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
          )}

          {/* Danger zone — separate section, gated on canManage independently of canEdit */}
          {canManage && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-4 space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-red-500">Danger zone</p>
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
            </div>
          )}
        </div>
      )}
      {tab === 'preorder' && isSundayLunch && (
        <PreorderTab booking={booking} canEdit={canManage} />
      )}
      {tab === 'sms' && (
        <div className="space-y-4 max-w-lg">
          {canEdit ? (
            <div className="rounded-lg border border-gray-200 bg-white p-4 space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Send SMS to guest</p>
              <textarea
                value={smsBody}
                onChange={(e) => setSmsBody(e.target.value)}
                rows={5}
                maxLength={640}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-gray-500 focus:outline-none focus:ring-2 focus:ring-gray-200"
                placeholder="Type message…"
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
        </div>
      )}

      {/* No-show confirmation */}
      <ConfirmDialog
        open={noShowConfirmOpen}
        onClose={() => setNoShowConfirmOpen(false)}
        onConfirm={async () => {
          setNoShowConfirmOpen(false)
          await handleStatusAction('no_show')
        }}
        type="warning"
        title="Mark as no-show?"
        message="This may trigger a charge request for the customer."
        confirmText="Mark No-show"
        closeOnConfirm={false}
      />

      {/* Cancel confirmation */}
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

      {/* Delete confirmation */}
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

      {/* Party size edit modal */}
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
              max={50}
              value={partySizeEditValue}
              onChange={(e) => setPartySizeEditValue(e.target.value)}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gray-500 focus:outline-none focus:ring-2 focus:ring-gray-200"
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={partySizeEditSendSms}
              onChange={(e) => setPartySizeEditSendSms(e.target.checked)}
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
              disabled={Boolean(actionLoadingKey) || !partySizeEditValue || Number.parseInt(partySizeEditValue, 10) < 1}
            >
              Save
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
