import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { TodayChecklistResult } from '@/app/actions/checklists'
import { ChecklistScreen } from './ChecklistScreen'

const { getAttributionCandidatesMock, refreshMock } = vi.hoisted(() => ({
  getAttributionCandidatesMock: vi.fn(),
  refreshMock: vi.fn(),
}))

vi.mock('@/app/actions/checklists', () => ({
  getAttributionCandidates: getAttributionCandidatesMock,
  completeChecklistInstance: vi.fn(),
  // TaskRow imports this too. Leaving it out of the factory makes the module's other
  // exports undefined at import time in some resolutions, so keep the mock complete.
  skipChecklistInstance: vi.fn(),
  undoChecklistInstance: vi.fn(),
}))

// The global next/navigation mock in vitest.setup.ts hands back a fresh refresh() on every
// useRouter() call, so it cannot be asserted on. This one is stable.
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: refreshMock,
    prefetch: vi.fn(),
  }),
}))

const initial: TodayChecklistResult = {
  businessDate: '2026-07-22',
  businessDayStartHour: 5,
  moduleEnabled: true,
  generationStatus: 'complete',
  nextWindowStart: null,
  hiddenCount: 0,
  groups: [
    {
      checklistId: 'checklist-1',
      checklistName: 'Opening',
      department: 'bar',
      sortOrder: 0,
      tasks: [
        {
          id: 'task-1',
          title: 'Open the till',
          instruction: null,
          slot: 'open',
          department: 'bar',
          requiresValue: false,
          valueUnit: null,
          valueMin: null,
          valueMax: null,
          dueAt: '2026-07-22T09:00:00.000Z',
          graceUntil: '2026-07-22T09:30:00.000Z',
          state: 'pending',
          locked: false,
          completedByEmployeeId: null,
          completedByName: null,
          completedAt: null,
          wasLate: false,
          valueRecorded: null,
          valueBreach: false,
          notes: null,
          skipReason: null,
        },
      ],
    },
  ],
}

describe('ChecklistScreen attribution', () => {
  beforeEach(() => {
    sessionStorage.clear()
    getAttributionCandidatesMock.mockReset()
  })

  it('defaults to the most recent clock-in and still allows a manual change', async () => {
    const user = userEvent.setup()
    sessionStorage.setItem(
      'checklist-identity',
      JSON.stringify({ employeeId: 'previous', name: 'Previous Person' }),
    )
    getAttributionCandidatesMock.mockResolvedValue({
      data: [
        {
          employeeId: 'older',
          name: 'Older Clock-in',
          clockedIn: true,
          clockedInAt: '2026-07-22T08:00:00.000Z',
          rostered: true,
        },
        {
          employeeId: 'latest',
          name: 'Latest Clock-in',
          clockedIn: true,
          clockedInAt: '2026-07-22T09:00:00.000Z',
          rostered: true,
        },
      ],
    })

    render(<ChecklistScreen initial={initial} />)

    expect(await screen.findByText('Latest Clock-in')).toBeInTheDocument()
    expect(JSON.parse(sessionStorage.getItem('checklist-identity') ?? '{}')).toEqual({
      employeeId: 'latest',
      name: 'Latest Clock-in',
    })

    await user.click(screen.getByRole('button', { name: 'Change' }))
    await user.click(screen.getByRole('button', { name: /Older Clock-in/ }))

    await waitFor(() => {
      expect(screen.getByText('Older Clock-in')).toBeInTheDocument()
    })
    expect(JSON.parse(sessionStorage.getItem('checklist-identity') ?? '{}')).toEqual({
      employeeId: 'older',
      name: 'Older Clock-in',
    })
  })
})

// Regression cover for the night of 2026-08-28, when the whole closing checklist never
// appeared. The screen renders a snapshot of the tasks that were due at render time; before
// this it only refetched when someone ticked something or at the 05:00 boundary, so a tab
// whose last tick was at 20:13 never saw the 21:00 closing batch. Every test here fails
// against that version.
describe('ChecklistScreen refreshes itself when a task window opens', () => {
  // 2026-07-22 19:13Z = 20:13 BST. Next window 20:00Z = 21:00 BST, 47 minutes away.
  const RENDER_AT = new Date('2026-07-22T19:13:00Z')
  const NEXT_WINDOW = '2026-07-22T20:00:00Z'
  const FORTY_SEVEN_MINUTES = 47 * 60 * 1000

  const withClosingToCome: TodayChecklistResult = {
    ...initial,
    nextWindowStart: NEXT_WINDOW,
    hiddenCount: 22,
    groups: [
      {
        ...initial.groups[0],
        tasks: [{ ...initial.groups[0].tasks[0], state: 'done', completedByName: 'Jacob' }],
      },
    ],
  }

  beforeEach(() => {
    sessionStorage.clear()
    refreshMock.mockReset()
    getAttributionCandidatesMock.mockReset()
    getAttributionCandidatesMock.mockResolvedValue({ data: [] })
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(RENDER_AT)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('refetches when the window opens, and not a moment before', async () => {
    render(<ChecklistScreen initial={withClosingToCome} />)

    await act(async () => {
      vi.advanceTimersByTime(FORTY_SEVEN_MINUTES - 1000)
    })
    expect(refreshMock).not.toHaveBeenCalled()

    await act(async () => {
      vi.advanceTimersByTime(2000)
    })
    expect(refreshMock).toHaveBeenCalledTimes(1)
  })

  it('recovers a tab that was asleep when the window opened', async () => {
    render(<ChecklistScreen initial={withClosingToCome} />)

    // The iPad slept through the deadline, so the timer never ran. Move the clock without
    // running pending timers, then wake the tab. This is the common case on the bar.
    vi.setSystemTime(new Date(RENDER_AT.getTime() + FORTY_SEVEN_MINUTES + 60_000))
    expect(refreshMock).not.toHaveBeenCalled()

    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(refreshMock).toHaveBeenCalledTimes(1)
  })

  it('does nothing when the tab is woken before the window opens', async () => {
    render(<ChecklistScreen initial={withClosingToCome} />)

    vi.setSystemTime(new Date(RENDER_AT.getTime() + 20 * 60 * 1000))
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
      window.dispatchEvent(new Event('pageshow'))
    })

    expect(refreshMock).not.toHaveBeenCalled()
  })

  it('does not storm when the tab is woken repeatedly after the window opened', async () => {
    render(<ChecklistScreen initial={withClosingToCome} />)

    vi.setSystemTime(new Date(RENDER_AT.getTime() + FORTY_SEVEN_MINUTES + 60_000))
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
      document.dispatchEvent(new Event('visibilitychange'))
      window.dispatchEvent(new Event('pageshow'))
    })

    expect(refreshMock).toHaveBeenCalledTimes(1)
  })

  it('still refreshes with no window to come, at the 05:00 boundary', async () => {
    render(<ChecklistScreen initial={{ ...withClosingToCome, nextWindowStart: null, hiddenCount: 0 }} />)

    // 20:13 BST to 05:00 BST is 8h47m.
    await act(async () => {
      vi.advanceTimersByTime(8 * 3600_000 + 46 * 60_000)
    })
    expect(refreshMock).not.toHaveBeenCalled()

    await act(async () => {
      vi.advanceTimersByTime(2 * 60_000)
    })
    expect(refreshMock).toHaveBeenCalledTimes(1)
  })
})

describe('ChecklistScreen tells the truth about what is still to come', () => {
  beforeEach(() => {
    sessionStorage.clear()
    getAttributionCandidatesMock.mockReset()
    getAttributionCandidatesMock.mockResolvedValue({ data: [] })
  })

  const allTicked: TodayChecklistResult = {
    ...initial,
    // 2026-07-22 20:00Z = 21:00 BST.
    nextWindowStart: '2026-07-22T20:00:00Z',
    hiddenCount: 22,
    groups: [
      {
        ...initial.groups[0],
        tasks: [{ ...initial.groups[0].tasks[0], state: 'done', completedByName: 'Jacob' }],
      },
    ],
  }

  it('names the time the next batch arrives instead of promising vaguely', async () => {
    render(<ChecklistScreen initial={allTicked} />)

    expect(await screen.findByText(/All done for now/)).toBeInTheDocument()
    expect(screen.getByText(/22 more tasks appear at 9pm/)).toBeInTheDocument()
    // The old copy told staff to stop checking, which is how a closedown got skipped.
    expect(screen.queryByText(/New tasks appear when they are due/)).not.toBeInTheDocument()
  })

  it('says when nothing further is coming, rather than implying more will arrive', async () => {
    render(<ChecklistScreen initial={{ ...allTicked, nextWindowStart: null, hiddenCount: 0 }} />)

    expect(await screen.findByText(/All done for now/)).toBeInTheDocument()
    expect(screen.getByText(/Nothing else is due before 5am/)).toBeInTheDocument()
  })

  it('does not label the filtered count as the day total', async () => {
    render(<ChecklistScreen initial={allTicked} />)

    expect(await screen.findByText('Showing')).toBeInTheDocument()
    // It read "Total 28" on a day that actually had 50 tasks.
    expect(screen.queryByText('Total')).not.toBeInTheDocument()
  })

  it('says when the first tasks arrive if nothing is due yet', async () => {
    render(
      <ChecklistScreen
        initial={{ ...allTicked, groups: [], hiddenCount: 22 }}
      />,
    )

    expect(await screen.findByText(/Nothing needs doing right now/)).toBeInTheDocument()
    expect(screen.getByText(/The first tasks appear at 9pm/)).toBeInTheDocument()
  })
})
