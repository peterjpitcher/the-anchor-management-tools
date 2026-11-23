import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

/**
 * The page behind the morning-after no-show email (owner decisions of 22 November 2026). Mail
 * scanners open links, so a GET must only ask: it renders both answers as POST forms and writes
 * nothing. The reason is optional, and a link that is dead, answered or already sorted says so.
 */

const { lookup } = vi.hoisted(() => ({ lookup: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/table-bookings/no-show-guest-reply', () => ({ lookupNoShowFollowUpToken: lookup }))

import { createAdminClient } from '@/lib/supabase/admin'
import NoShowFollowUpPage from '@/app/g/[token]/no-show-follow-up/page'
import { createRecordingSupabase } from '../mocks/recordingSupabase'

const BOOKING = {
  id: 'tb-1',
  bookingReference: 'TB-0001',
  bookingDate: '2026-11-21',
  bookingTime: '19:00:00',
  startDatetime: '2026-11-21T19:00:00.000Z',
  endDatetime: '2026-11-21T21:00:00.000Z',
  partySize: 4,
  status: 'no_show',
  response: null,
  customerFirstName: 'Sam',
}

async function open(state?: string) {
  const page = await NoShowFollowUpPage({
    params: Promise.resolve({ token: 'raw-token' }),
    searchParams: Promise.resolve(state ? { state } : {}),
  })
  return render(page)
}

beforeEach(() => {
  vi.clearAllMocks()
  lookup.mockResolvedValue({ ok: true, booking: BOOKING })
})

describe('the no-show follow-up page', () => {
  it('asks both questions as POST forms and writes nothing when it is opened', async () => {
    const db = createRecordingSupabase()
    vi.mocked(createAdminClient).mockReturnValue(db.client as never)

    const { container } = await open()

    expect(screen.getByRole('heading', { name: 'Did we miss you?' })).toBeInTheDocument()
    // The weekday is worked out from the date: 21 November 2026 is a Saturday.
    expect(container.textContent).toContain('We had a table for 4 booked for you at 7pm on Saturday 21 November 2026')
    expect(container.textContent).toContain('nobody is cross')

    const forms = Array.from(container.querySelectorAll('form'))
    expect(forms).toHaveLength(2)
    for (const form of forms) {
      expect(form.getAttribute('method')?.toUpperCase()).toBe('POST')
      expect(form.getAttribute('action')).toBe('/g/raw-token/no-show-follow-up/action')
    }
    expect(screen.getByRole('button', { name: 'I did come in' })).toHaveAttribute('value', 'attended')
    // The email's second link lands on the reason form.
    expect(forms[1].getAttribute('id')).toBe('what-happened')
    expect(forms[1].querySelector('input[type="hidden"][name="answer"]')).toHaveAttribute('value', 'could_not_make_it')

    const writes = db.queries.flatMap((query) =>
      query.calls.filter((call) => ['insert', 'update', 'upsert', 'delete'].includes(call.method))
    )
    expect(writes).toEqual([])
    expect(db.rpc).not.toHaveBeenCalled()
  })

  it('offers the owner\'s reasons and requires none of them', async () => {
    const { container } = await open()

    const radios = Array.from(container.querySelectorAll('input[type="radio"][name="reason"]'))
    expect(radios.map((radio) => radio.getAttribute('value'))).toEqual([
      'plans_changed',
      'forgot',
      'could_not_cancel',
      'did_not_know_how_to_cancel',
      'on_the_day',
      'booked_by_mistake',
      'other',
    ])
    expect(screen.getByLabelText("I tried to cancel or change it and couldn't")).toBeInTheDocument()
    // Nothing is required: Send works with nothing ticked and nothing typed.
    expect(container.querySelectorAll('[required]')).toHaveLength(0)
    expect(container.querySelector('textarea[name="detail"]')).not.toBeNull()
  })

  it('thanks the guest after either answer', async () => {
    await open('thanks_attended')
    expect(screen.getByRole('heading', { name: 'Thank you for letting us know' })).toBeInTheDocument()
    expect(screen.getByText('Sorry we got that wrong, and thank you for coming in.')).toBeInTheDocument()
  })

  it('thanks the guest for a reason and asks nothing more', async () => {
    const { container } = await open('thanks_reason')
    expect(screen.getByText("We'd love to see you another time.")).toBeInTheDocument()
    expect(container.querySelector('form')).toBeNull()
  })

  it('shows no form for a dead link, an answered one or a booking staff already sorted', async () => {
    lookup.mockResolvedValueOnce({ ok: false })
    const dead = await open()
    expect(screen.getByRole('heading', { name: 'This link has expired' })).toBeInTheDocument()
    expect(dead.container.querySelector('form')).toBeNull()
    dead.unmount()

    lookup.mockResolvedValueOnce({ ok: true, booking: { ...BOOKING, response: 'attended' } })
    const answered = await open()
    expect(screen.getByRole('heading', { name: "Thanks, we've got your reply" })).toBeInTheDocument()
    expect(answered.container.querySelector('form')).toBeNull()
    answered.unmount()

    lookup.mockResolvedValueOnce({ ok: true, booking: { ...BOOKING, status: 'confirmed' } })
    const sorted = await open()
    expect(screen.getByRole('heading', { name: 'This is already sorted' })).toBeInTheDocument()
    expect(sorted.container.querySelector('form')).toBeNull()
  })
})
