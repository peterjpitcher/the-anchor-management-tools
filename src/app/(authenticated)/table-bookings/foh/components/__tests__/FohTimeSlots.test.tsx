import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { FohTimeSlots, type FohTimeSlotsProps } from '../FohTimeSlots'

/**
 * Owner decision of 10 November 2026: a Christmas party of 27 or more (above the online ceiling of 26)
 * is offered tables that are not joined, and the free times say so before staff pick a time.
 */
const PROPS: FohTimeSlotsProps = {
  date: '2026-12-05',
  partySize: '27',
  purpose: 'christmas',
  outside: false,
  requiresAccessibleTable: false,
  highChairCount: '0',
  walkIn: false,
  selectedTime: '',
  onPick: vi.fn(),
}

const WARNING = 'These tables are not joined: move them together before the party arrives.'

function stubAvailability(data: Record<string, unknown>) {
  const fetchMock = vi.fn(async () =>
    new Response(JSON.stringify({ success: true, data: { calculation_state: 'complete', ...data } }), { status: 200 })
  )
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('FohTimeSlots: Christmas parties on tables that are not joined', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('warns that the tables are not joined for a party of 27 with free times', async () => {
    const fetchMock = stubAvailability({
      tables_unjoined: true,
      slots: [
        { time: '13:00', state: 'available', public_reason: null },
        { time: '13:15', state: 'unavailable', public_reason: 'kitchen_full' },
      ],
    })
    render(<FohTimeSlots {...PROPS} />)

    expect(await screen.findByText(WARNING)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /13:00/ })).toBeEnabled()
    const url = String((fetchMock.mock.calls[0] as unknown[])[0])
    expect(url).toContain('party_size=27')
    expect(url).toContain('purpose=christmas')
  })

  it('says nothing about joining for a party that fits joined tables', async () => {
    stubAvailability({
      tables_unjoined: false,
      slots: [{ time: '13:00', state: 'available', public_reason: null }],
    })
    render(<FohTimeSlots {...PROPS} partySize="26" />)

    expect(await screen.findByRole('button', { name: /13:00/ })).toBeInTheDocument()
    expect(screen.queryByText(WARNING)).not.toBeInTheDocument()
  })

  it('keeps the warning away when no time is free, since there is nothing to seat', async () => {
    stubAvailability({
      tables_unjoined: true,
      slots: [{ time: '13:00', state: 'unavailable', public_reason: 'tables_full' }],
    })
    render(<FohTimeSlots {...PROPS} />)

    await waitFor(() => expect(screen.getByRole('button', { name: /13:00/ })).toBeDisabled())
    expect(screen.queryByText(WARNING)).not.toBeInTheDocument()
  })
})
