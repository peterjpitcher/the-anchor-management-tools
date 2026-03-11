'use client'

import { useState } from 'react'
import PreorderTab from './PreorderTab'
import { formatDateInLondon } from '@/lib/dateUtils'

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
  customer: BookingCustomer | null
  table_booking_tables: BookingTable[]
}

interface Props {
  booking: Booking
  canEdit: boolean
  canManage: boolean
}

export default function BookingDetailClient({ booking, canEdit, canManage: _canManage }: Props) {
  const [tab, setTab] = useState<Tab>('overview')
  const isSundayLunch = booking.booking_type === 'sunday_lunch'

  const tabs: { id: Tab; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    ...(isSundayLunch ? [{ id: 'preorder' as Tab, label: 'Pre-order' }] : []),
    { id: 'sms', label: 'SMS' },
  ]

  // Note: _canManage is used in the overview tab quick actions (Task 6).

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
                Seated: {formatDateInLondon(new Date(booking.seated_at), { hour: '2-digit', minute: '2-digit', hour12: false })}
              </p>
            )}
            {booking.left_at && (
              <p className="text-xs text-gray-400">
                Left: {formatDateInLondon(new Date(booking.left_at), { hour: '2-digit', minute: '2-digit', hour12: false })}
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

          {/* Placeholder for quick actions — added in Task 6 */}
          {canEdit && (
            <div className="rounded-lg border border-gray-200 bg-white p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Quick actions — coming next</p>
            </div>
          )}
        </div>
      )}
      {tab === 'preorder' && isSundayLunch && (
        <PreorderTab booking={booking} canEdit={canEdit} />
      )}
      {tab === 'sms' && (
        <div className="text-sm text-gray-500">SMS — coming in next task</div>
      )}
    </div>
  )
}
