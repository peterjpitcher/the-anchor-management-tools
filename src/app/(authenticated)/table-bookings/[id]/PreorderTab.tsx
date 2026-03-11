'use client'

import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui-v2/forms/Button'
import toast from 'react-hot-toast'
import type { Booking } from './BookingDetailClient'

interface PreorderItem {
  menu_dish_id: string
  custom_item_name: string | null
  item_type: 'main' | 'side' | 'extra'
  quantity: number
  price_at_booking: number
  guest_name: string | null
}

interface MenuItem {
  menu_dish_id: string
  name: string
  price: number
  category_code: string | null
  item_type: 'main' | 'side' | 'extra'
  sort_order: number
}

interface PreorderData {
  state: 'ready' | 'blocked'
  reason?: string
  can_submit?: boolean
  submit_deadline_at?: string | null
  sunday_preorder_cutoff_at?: string | null
  sunday_preorder_completed_at?: string | null
  existing_items?: PreorderItem[]
  menu_items?: MenuItem[]
}

interface Props {
  booking: Booking
  canEdit: boolean
}

function formatLondonDateTime(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Europe/London',
  }).format(new Date(iso))
}

export default function PreorderTab({ booking, canEdit }: Props) {
  const [data, setData] = useState<PreorderData | null>(null)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/boh/table-bookings/${booking.id}/preorder`)
      if (!res.ok) throw new Error('Failed to load pre-order')
      const json = (await res.json()) as PreorderData
      setData(json)
    } catch {
      toast.error('Could not load pre-order data')
    } finally {
      setLoading(false)
    }
  }, [booking.id])

  useEffect(() => {
    void load()
  }, [load])

  if (loading) return <p className="text-sm text-gray-500">Loading pre-order&hellip;</p>

  if (!data || data.state === 'blocked') {
    return (
      <p className="text-sm text-gray-500">
        Pre-order not available{data?.reason ? `: ${data.reason}` : ''}
      </p>
    )
  }

  const itemsByType = {
    main: data.existing_items?.filter((i) => i.item_type === 'main') ?? [],
    side: data.existing_items?.filter((i) => i.item_type === 'side') ?? [],
    extra: data.existing_items?.filter((i) => i.item_type === 'extra') ?? [],
  }

  const hasItems = (data.existing_items?.length ?? 0) > 0

  if (editing) {
    return (
      <PreorderEditForm
        data={data}
        bookingId={booking.id}
        onSave={() => {
          setEditing(false)
          void load()
        }}
        onCancel={() => setEditing(false)}
      />
    )
  }

  return (
    <div className="space-y-4 max-w-2xl">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-gray-900">
            {data.sunday_preorder_completed_at ? '✓ Submitted by guest' : 'Not yet submitted'}
          </p>
          {data.sunday_preorder_cutoff_at && (
            <p className="text-xs text-gray-500 mt-0.5">
              Cutoff: {formatLondonDateTime(data.sunday_preorder_cutoff_at)}
            </p>
          )}
        </div>
        {canEdit && (
          <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
            {hasItems ? 'Edit pre-order' : 'Create pre-order'}
          </Button>
        )}
      </div>

      {!hasItems && (
        <p className="text-sm text-gray-500 italic">No items on this pre-order yet.</p>
      )}

      {/* Mains */}
      {itemsByType.main.length > 0 && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">Mains</p>
          {itemsByType.main.map((item) => (
            <div
              key={item.menu_dish_id}
              className="flex items-center justify-between bg-gray-50 rounded-md px-3 py-2 mb-1"
            >
              <span className="text-sm text-gray-900">
                {item.custom_item_name ?? item.menu_dish_id}
              </span>
              <span className="text-sm font-medium text-gray-600 bg-white border border-gray-200 rounded px-2 py-0.5">
                &times; {item.quantity}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Sides */}
      {itemsByType.side.length > 0 && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">Sides</p>
          {itemsByType.side.map((item) => (
            <div
              key={item.menu_dish_id}
              className="flex items-center justify-between bg-gray-50 rounded-md px-3 py-2 mb-1"
            >
              <span className="text-sm text-gray-900">
                {item.custom_item_name ?? item.menu_dish_id}
              </span>
              <span className="text-sm font-medium text-gray-600 bg-white border border-gray-200 rounded px-2 py-0.5">
                &times; {item.quantity}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Extras */}
      {itemsByType.extra.length > 0 && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">Extras</p>
          {itemsByType.extra.map((item) => (
            <div
              key={item.menu_dish_id}
              className="flex items-center justify-between bg-gray-50 rounded-md px-3 py-2 mb-1"
            >
              <span className="text-sm text-gray-900">
                {item.custom_item_name ?? item.menu_dish_id}
              </span>
              <span className="text-sm font-medium text-gray-600 bg-white border border-gray-200 rounded px-2 py-0.5">
                &times; {item.quantity}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Edit form — Task 10 will replace this stub
// ---------------------------------------------------------------------------

function PreorderEditForm({
  data: _data,
  bookingId: _bookingId,
  onSave,
  onCancel,
}: {
  data: PreorderData
  bookingId: string
  onSave: () => void
  onCancel: () => void
}) {
  return (
    <div className="space-y-4 max-w-2xl">
      <p className="text-sm text-gray-500">Edit form coming soon.</p>
      <div className="flex gap-2">
        <Button size="sm" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" onClick={onSave}>
          Save
        </Button>
      </div>
    </div>
  )
}
