'use client'

import { useState } from 'react'
import PreorderTab from './PreorderTab'

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
  table: BookingTableInner | BookingTableInner[] | null
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
  customer: BookingCustomer | BookingCustomer[] | null
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
        <div className="text-sm text-gray-500">Overview — coming in next task</div>
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
