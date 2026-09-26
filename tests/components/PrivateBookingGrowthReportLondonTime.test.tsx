// The private booking growth report's "Updated" stamp, on the London clock.
//
// The report is a client component, so its first render happens on the UTC server. The stamp
// read the host's zone, so during British Summer Time it showed the time an hour early, and the
// day before when the snapshot was built just after midnight.
//
// 23:30 UTC on 1 October 2026 is 00:30 BST on 2 October in London.
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import PrivateBookingGrowthReportClient from '@/app/(authenticated)/private-bookings/reports/_components/PrivateBookingGrowthReportClient'
import type { PrivateBookingGrowthSnapshot } from '@/lib/analytics/private-booking-growth'

const snapshot: PrivateBookingGrowthSnapshot = {
  generatedAt: '2026-10-01T23:30:00.000Z',
  asOfDate: '2026-10-02',
  firstRecordDate: '2025-06-14',
  futureConfirmedCount: 0,
  excludedCount: 0,
  records: [
    {
      id: 'booking-1',
      eventDate: '2025-06-14',
      customerName: 'Jane Regular',
      eventType: 'Birthday party',
      guestCount: 40,
      status: 'completed',
      source: null,
      isHistoricalImport: false,
    },
    {
      id: 'booking-2',
      eventDate: '2026-05-09',
      customerName: 'Sam Local',
      eventType: 'Wake',
      guestCount: null,
      status: 'completed',
      source: null,
      isHistoricalImport: false,
    },
  ],
}

describe('PrivateBookingGrowthReportClient, London clock', () => {
  it('shows the Updated time on the London clock', () => {
    render(<PrivateBookingGrowthReportClient snapshot={snapshot} />)

    expect(screen.getByText('Updated 2 Oct 2026, 00:30')).toBeInTheDocument()
  })
})
