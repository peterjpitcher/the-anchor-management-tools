import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'

const mocks = vi.hoisted(() => ({
  clockIn: vi.fn(),
  clockOut: vi.fn(),
  getOpenSessions: vi.fn(),
  toastError: vi.fn(),
}))

vi.mock('@/app/actions/timeclock', () => ({
  clockIn: mocks.clockIn,
  clockOut: mocks.clockOut,
  getOpenSessions: mocks.getOpenSessions,
}))
vi.mock('react-hot-toast', () => ({ default: { error: mocks.toastError, success: vi.fn() } }))

import { FohClockBand } from '@/ds/shell/FohClockBand'
import {
  FOH_RELOAD_IDLE_MS,
  FOH_RELOAD_MAX_DEFER_MS,
  shouldReloadForDeployment,
} from '@/app/(authenticated)/table-bookings/foh/hooks/useFohDeploymentRefresh'
import {
  STALE_PAGE_MESSAGE,
  isStaleServerActionError,
  resetStalePageReloadForTests,
} from '@/lib/foh/stale-page'

const base = { versionChanged: true, busy: false, formOpen: false, idleMs: FOH_RELOAD_IDLE_MS, updatePendingMs: 0 }

describe('FOH reload decision (BK-096)', () => {
  it('reloads an idle screen with a new release even with a booking panel open', () => {
    expect(shouldReloadForDeployment(base)).toBe(true)
  })

  it('waits while staff are using the screen', () => {
    expect(shouldReloadForDeployment({ ...base, idleMs: FOH_RELOAD_IDLE_MS - 1 })).toBe(false)
  })

  it('never reloads under a request in flight', () => {
    expect(shouldReloadForDeployment({ ...base, busy: true, updatePendingMs: FOH_RELOAD_MAX_DEFER_MS * 4 })).toBe(false)
  })

  it('lets an open form delay the reload for at most 15 minutes', () => {
    expect(shouldReloadForDeployment({ ...base, formOpen: true, updatePendingMs: FOH_RELOAD_MAX_DEFER_MS - 1 })).toBe(false)
    expect(shouldReloadForDeployment({ ...base, formOpen: true, updatePendingMs: FOH_RELOAD_MAX_DEFER_MS })).toBe(true)
  })

  it('does nothing without a new release', () => {
    expect(shouldReloadForDeployment({ ...base, versionChanged: false })).toBe(false)
  })
})

describe('isStaleServerActionError', () => {
  it('recognises the Next.js missing action error', () => {
    const error = new Error('Server Action "00384c5a" was not found on the server.')
    error.name = 'UnrecognizedActionError'
    expect(isStaleServerActionError(error)).toBe(true)
    expect(isStaleServerActionError(new Error('Failed to find Server Action "x"'))).toBe(true)
  })

  it('does not treat a dropped connection as a stale page', () => {
    expect(isStaleServerActionError(new TypeError('Failed to fetch'))).toBe(false)
  })
})

describe('FohClockBand when the clock action throws (BK-096)', () => {
  const reload = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    resetStalePageReloadForTests()
    mocks.getOpenSessions.mockResolvedValue({ success: true, data: [] })
    Object.defineProperty(window, 'location', { configurable: true, value: { ...window.location, reload } })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('clears the spinner and reloads an out-of-date page', async () => {
    const stale = new Error('Server Action "abc" was not found on the server.')
    stale.name = 'UnrecognizedActionError'
    mocks.clockIn.mockRejectedValue(stale)

    render(<FohClockBand employeeId="emp-1" />)
    const button = await screen.findByRole('button', { name: /clock in/i })
    vi.useFakeTimers()
    await act(async () => {
      fireEvent.click(button)
    })

    expect(mocks.toastError).toHaveBeenCalledWith(STALE_PAGE_MESSAGE)
    expect(screen.getByRole('button', { name: /clock in/i })).not.toBeDisabled()
    await act(async () => {
      vi.advanceTimersByTime(2_000)
    })
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('clears the spinner and says so when the connection drops', async () => {
    mocks.clockIn.mockRejectedValue(new TypeError('Failed to fetch'))
    render(<FohClockBand employeeId="emp-1" />)
    fireEvent.click(await screen.findByRole('button', { name: /clock in/i }))

    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledTimes(1))
    expect(mocks.toastError.mock.calls[0][0]).toMatch(/connection dropped/)
    expect(screen.getByRole('button', { name: /clock in/i })).not.toBeDisabled()
    expect(reload).not.toHaveBeenCalled()
  })
})
