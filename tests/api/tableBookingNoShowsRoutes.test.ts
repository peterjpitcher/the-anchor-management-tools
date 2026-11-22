import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The two thin routes of the no-show follow-up (owner decisions of 22 November 2026): the hourly
 * cron (auth, sweep then emails, a failure in one half not stopping the other) and the guest
 * reply (only a POST records, and the guest is never sent to a dead end).
 */

const state = vi.hoisted(() => ({
  authorized: true,
  sweep: vi.fn(),
  followUps: vi.fn(),
  lookup: vi.fn(),
  attended: vi.fn(),
  reason: vi.fn(),
  throttleAllowed: true,
}))

vi.mock('@/lib/cron-auth', () => ({
  authorizeCronRequest: () => (state.authorized ? { authorized: true } : { authorized: false, reason: 'Unauthorized' }),
}))
// The run recorder is covered by its own tests; here the handler is what matters.
vi.mock('@/lib/cron/run-recorder', () => ({ withCronRun: (_name: string, handler: unknown) => handler }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({}) }))
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('@/lib/table-bookings/no-show-sweep', () => ({ runNoShowSweep: state.sweep }))
vi.mock('@/lib/table-bookings/no-show-follow-up', () => ({ runNoShowFollowUps: state.followUps }))
vi.mock('@/lib/guest/token-throttle', () => ({
  checkGuestTokenThrottle: vi.fn(async () => ({ allowed: state.throttleAllowed, retryAfterSeconds: 0, remaining: 1 })),
}))
vi.mock('@/lib/table-bookings/no-show-guest-reply', () => ({
  lookupNoShowFollowUpToken: state.lookup,
  recordGuestAttended: state.attended,
  recordGuestCouldNotMakeIt: state.reason,
}))

import { GET as cron } from '@/app/api/cron/table-booking-no-shows/route'
import * as guestAction from '@/app/g/[token]/no-show-follow-up/action/route'

const SWEPT = { state: 'ran', tradingDay: '2026-11-22', considered: 1, marked: 1, skipped: {}, errors: 0 }
const NOT_DUE = { state: 'not_due', londonTime: '00:00' }

beforeEach(() => {
  vi.clearAllMocks()
  state.authorized = true
  state.throttleAllowed = true
  state.sweep.mockResolvedValue(SWEPT)
  state.followUps.mockResolvedValue(NOT_DUE)
  state.lookup.mockResolvedValue({ ok: true, booking: { id: 'b1', status: 'no_show', response: null } })
  state.attended.mockResolvedValue({ state: 'recorded', putRight: true })
  state.reason.mockResolvedValue({ state: 'recorded', putRight: false })
})

describe('GET /api/cron/table-booking-no-shows', () => {
  const call = () => cron(new Request('http://localhost/api/cron/table-booking-no-shows') as never)

  it('refuses a call without the cron secret and runs nothing', async () => {
    state.authorized = false
    const response = await call()
    expect(response.status).toBe(401)
    expect(state.sweep).not.toHaveBeenCalled()
    expect(state.followUps).not.toHaveBeenCalled()
  })

  it('sweeps first, then runs the emails, and reports both', async () => {
    const order: string[] = []
    state.sweep.mockImplementation(async () => { order.push('sweep'); return SWEPT })
    state.followUps.mockImplementation(async () => { order.push('emails'); return NOT_DUE })

    const response = await call()

    expect(response.status).toBe(200)
    expect(order).toEqual(['sweep', 'emails'])
    expect(await response.json()).toEqual({ success: true, sweep: SWEPT, followUps: NOT_DUE, itemFailures: 0 })
  })

  it('counts what could not be handled, so the run is flagged', async () => {
    state.sweep.mockResolvedValue({ ...SWEPT, errors: 1 })
    state.followUps.mockResolvedValue({ state: 'ran', flag: 'on', held: null, considered: 3, sent: 1, refused: 1, uncertain: 1, skipped: {}, errors: 0 })
    expect((await (await call()).json()).itemFailures).toBe(3)
  })

  it('still sends the emails when the sweep fails, and answers 500', async () => {
    state.sweep.mockRejectedValue(new Error('database down'))
    const response = await call()
    expect(response.status).toBe(500)
    expect(state.followUps).toHaveBeenCalledTimes(1)
  })

  it('answers 500 when the sweep is held because the opening hours cannot be read, and still sends the emails', async () => {
    state.sweep.mockResolvedValue({ state: 'held', reason: 'hours_unreadable' })
    const response = await call()
    expect(response.status).toBe(500)
    expect(state.followUps).toHaveBeenCalledTimes(1)
  })
})

describe('the guest reply route', () => {
  function post(fields: Record<string, string>) {
    const form = new FormData()
    for (const [key, value] of Object.entries(fields)) form.set(key, value)
    return guestAction.POST(
      new Request('http://localhost/g/raw/no-show-follow-up/action', { method: 'POST', body: form }) as never,
      { params: Promise.resolve({ token: 'raw' }) },
    )
  }
  const location = (response: Response) => new URL(response.headers.get('location') as string)

  it('has no GET, so opening a link can never record an answer', () => {
    expect(Object.keys(guestAction)).not.toContain('GET')
  })

  it('records "I did come in" and thanks the guest', async () => {
    const response = await post({ answer: 'attended' })
    expect(response.status).toBe(303)
    expect(state.attended).toHaveBeenCalledTimes(1)
    expect(location(response).pathname).toBe('/g/raw/no-show-follow-up')
    expect(location(response).searchParams.get('state')).toBe('thanks_attended')
  })

  it('thanks the guest the same way when a person has to finish putting it right', async () => {
    state.attended.mockResolvedValue({ state: 'recorded', putRight: false })
    expect(location(await post({ answer: 'attended' })).searchParams.get('state')).toBe('thanks_attended')
  })

  it('records a reason, or none, and thanks the guest', async () => {
    const withReason = await post({ answer: 'could_not_make_it', reason: 'forgot', detail: 'Sorry' })
    expect(state.reason.mock.calls[0][2]).toEqual({ code: 'forgot', detail: 'Sorry' })
    expect(location(withReason).searchParams.get('state')).toBe('thanks_reason')

    await post({ answer: 'could_not_make_it' })
    expect(state.reason.mock.calls[1][2]).toEqual({ code: null, detail: null })
  })

  it('records nothing for a dead link, an unknown answer or a throttled caller', async () => {
    state.lookup.mockResolvedValueOnce({ ok: false })
    expect(location(await post({ answer: 'attended' })).search).toBe('')
    expect(location(await post({ answer: 'something' })).search).toBe('')
    state.throttleAllowed = false
    expect(location(await post({ answer: 'attended' })).searchParams.get('state')).toBe('busy')
    expect(state.attended).not.toHaveBeenCalled()
    expect(state.reason).not.toHaveBeenCalled()
  })

  it('tells the guest when it could not be saved', async () => {
    state.attended.mockResolvedValue({ state: 'failed' })
    expect(location(await post({ answer: 'attended' })).searchParams.get('state')).toBe('error')
    state.reason.mockRejectedValue(new Error('boom'))
    expect(location(await post({ answer: 'could_not_make_it' })).searchParams.get('state')).toBe('error')
  })
})
