import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

/**
 * The tap-to-confirm link now goes out by email (messaging flag
 * table_confirm_reminder_email_first), and mail scanners open links before the guest does. The
 * link lands on this page, which must only ask: a GET renders the question and writes nothing,
 * and the answer is a POST from the page to /confirm-booking/action, which has no GET handler.
 */

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/table-bookings/confirm-token', () => ({
  isAnswerable: (status: string) => status === 'confirmed',
  lookupConfirmToken: vi.fn(async () => ({
    ok: true,
    booking: {
      id: 'tb-1',
      bookingReference: 'TB-0001',
      bookingDate: '2026-09-12',
      bookingTime: '19:30:00',
      partySize: 4,
      status: 'confirmed',
      guestConfirmedAt: null,
      customerFirstName: 'Jane',
    },
  })),
}))

import { createAdminClient } from '@/lib/supabase/admin'
import ConfirmBookingPage from '@/app/g/[token]/confirm-booking/page'
import * as answerRoute from '@/app/g/[token]/confirm-booking/action/route'
import { createRecordingSupabase } from '../mocks/recordingSupabase'

describe('the confirm page a mail scanner reaches', () => {
  it('renders the question for a GET, including one the short link redirector tags, and writes nothing', async () => {
    const db = createRecordingSupabase()
    vi.mocked(createAdminClient).mockReturnValue(db.client as never)

    const page = await ConfirmBookingPage({
      params: Promise.resolve({ token: 'conf-token' }),
      searchParams: Promise.resolve({ short_code: 'cf1' } as { state?: string }),
    })
    const { container } = render(page)

    expect(screen.getByRole('heading', { name: 'Are you still coming?' })).toBeInTheDocument()
    const form = container.querySelector('form')
    expect(form?.getAttribute('method')?.toUpperCase()).toBe('POST')
    expect(form?.getAttribute('action')).toBe('/g/conf-token/confirm-booking/action')

    const writes = db.queries.flatMap((query) =>
      query.calls.filter((call) => ['insert', 'update', 'upsert', 'delete'].includes(call.method))
    )
    expect(writes).toEqual([])
    expect(db.rpc).not.toHaveBeenCalled()
  })

  it('accepts an answer only as a POST', () => {
    expect(typeof answerRoute.POST).toBe('function')
    expect((answerRoute as Record<string, unknown>).GET).toBeUndefined()
  })
})
