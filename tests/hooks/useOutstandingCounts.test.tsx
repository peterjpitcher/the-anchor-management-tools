import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Every poll here costs a round of database work, and the FOH iPad sits on this screen
 * all day. An unattended tab used to keep polling overnight, so these tests pin the
 * pausing behaviour rather than just the happy path.
 */

import { useOutstandingCounts } from '@/hooks/useOutstandingCounts'

const COUNTS = {
  events: 1, menu_management: 2, private_bookings: 3, cashing_up: 4,
  invoices: 5, receipts: 76, rota: 7, checklists: 8, feedback: 9,
}

let visibility: 'visible' | 'hidden'

function setVisibility(next: 'visible' | 'hidden') {
  visibility = next
  document.dispatchEvent(new Event('visibilitychange'))
}

beforeEach(() => {
  vi.useFakeTimers()
  visibility = 'visible'
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility)
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ success: true, data: COUNTS }),
  }))
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const fetchCalls = () => (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.length

/** waitFor never settles under fake timers, so drain pending promises directly. */
async function flush() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0)
  })
}

describe('useOutstandingCounts', () => {
  it('fetches once on mount and exposes the counts', async () => {
    const { result } = renderHook(() => useOutstandingCounts())

    await flush()
    expect(result.current.counts).toEqual(COUNTS)
    expect(result.current.loading).toBe(false)
    expect(fetchCalls()).toBe(1)
  })

  it('keeps polling on the minute while the tab is visible', async () => {
    renderHook(() => useOutstandingCounts())
    await flush()
    expect(fetchCalls()).toBe(1)

    await act(async () => { await vi.advanceTimersByTimeAsync(60_000) })
    expect(fetchCalls()).toBe(2)

    await act(async () => { await vi.advanceTimersByTimeAsync(60_000) })
    expect(fetchCalls()).toBe(3)
  })

  it('stops polling entirely once the tab is hidden', async () => {
    renderHook(() => useOutstandingCounts())
    await flush()
    expect(fetchCalls()).toBe(1)

    await act(async () => { setVisibility('hidden') })
    const callsWhenHidden = fetchCalls()

    // Ten minutes of an unattended tab must cost nothing.
    await act(async () => { await vi.advanceTimersByTimeAsync(10 * 60_000) })

    expect(fetchCalls()).toBe(callsWhenHidden)
  })

  it('refreshes immediately when the tab comes back rather than waiting out the interval', async () => {
    renderHook(() => useOutstandingCounts())
    await flush()
    expect(fetchCalls()).toBe(1)

    await act(async () => { setVisibility('hidden') })
    await act(async () => { await vi.advanceTimersByTimeAsync(5 * 60_000) })
    const before = fetchCalls()

    await act(async () => { setVisibility('visible') })

    expect(fetchCalls()).toBe(before + 1)
  })

  it('resumes the regular cadence after coming back into view', async () => {
    renderHook(() => useOutstandingCounts())
    await flush()
    expect(fetchCalls()).toBe(1)

    await act(async () => { setVisibility('hidden') })
    await act(async () => { setVisibility('visible') })
    const afterReturn = fetchCalls()

    await act(async () => { await vi.advanceTimersByTimeAsync(60_000) })

    expect(fetchCalls()).toBe(afterReturn + 1)
  })

  it('stops polling when unmounted', async () => {
    const { unmount } = renderHook(() => useOutstandingCounts())
    await flush()
    expect(fetchCalls()).toBe(1)

    unmount()
    await act(async () => { await vi.advanceTimersByTimeAsync(5 * 60_000) })

    expect(fetchCalls()).toBe(1)
  })

  it('surfaces an error without wedging the loading state', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: false, error: 'nope' }),
    }))

    const { result } = renderHook(() => useOutstandingCounts())

    await flush()
    expect(result.current.error).toBeInstanceOf(Error)
    expect(result.current.loading).toBe(false)
  })
})
