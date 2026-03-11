'use client'

import type { Booking } from './BookingDetailClient'

export default function PreorderTab({ booking: _booking, canEdit: _canEdit }: { booking: Booking; canEdit: boolean }) {
  return <div className="text-sm text-gray-500">Pre-order tab — coming soon</div>
}
