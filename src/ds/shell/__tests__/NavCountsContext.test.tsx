import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { OutstandingCounts } from '@/actions/get-outstanding-counts'

const COUNTS: OutstandingCounts = {
  events: 2,
  menu_management: 0,
  table_bookings: 0,
  private_bookings: 0,
  parking: 0,
  cashing_up: 0,
  invoices: 0,
  receipts: 0,
}

vi.mock('@/hooks/useUnreadMessageCount', () => ({
  useUnreadMessageCount: () => 7,
}))

vi.mock('@/hooks/useOutstandingCounts', () => ({
  useOutstandingCounts: () => ({ counts: COUNTS, loading: false, error: null }),
}))

import { NavCountsProvider, useNavCounts } from '../NavCountsContext'

function Probe() {
  const { unreadCount, counts } = useNavCounts()
  return (
    <div>
      <span data-testid="unread">{unreadCount}</span>
      <span data-testid="events">{counts?.events ?? 'null'}</span>
    </div>
  )
}

describe('NavCountsProvider', () => {
  it('supplies the fetched counts to consumers', () => {
    render(
      <NavCountsProvider>
        <Probe />
      </NavCountsProvider>,
    )

    expect(screen.getByTestId('unread')).toHaveTextContent('7')
    expect(screen.getByTestId('events')).toHaveTextContent('2')
  })

  it('falls back to zero/null when no provider is mounted (e.g. FOH mode)', () => {
    render(<Probe />)

    expect(screen.getByTestId('unread')).toHaveTextContent('0')
    expect(screen.getByTestId('events')).toHaveTextContent('null')
  })
})
