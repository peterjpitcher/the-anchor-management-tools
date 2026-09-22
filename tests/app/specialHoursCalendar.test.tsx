import { Profiler } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'

vi.mock('@/app/actions/business-hours', () => ({
  getSpecialHours: vi.fn(),
  getServiceStatusOverrides: vi.fn(),
  createSpecialHours: vi.fn(),
  updateSpecialHours: vi.fn(),
  deleteSpecialHours: vi.fn(),
  getBusinessHoursByDay: vi.fn(),
}))

import { getServiceStatusOverrides, getSpecialHours } from '@/app/actions/business-hours'
import { SpecialHoursCalendar } from '@/app/(authenticated)/settings/business-hours/SpecialHoursCalendar'
import type { ServiceStatusOverride } from '@/types/business-hours'

const mockedGetSpecialHours = getSpecialHours as unknown as Mock
const mockedGetOverrides = getServiceStatusOverrides as unknown as Mock

// One reference for every render, as the server page gives the client: a fresh literal per render
// would re-run the initialSpecialHours effect and muddy what these tests measure.
const NO_SPECIAL_HOURS: never[] = []

// Spans every month the calendar can open on, so the test does not depend on today's date or zone.
const LEGACY_OVERRIDE: ServiceStatusOverride = {
  id: 'override-1',
  service_code: 'sunday_lunch',
  start_date: '2000-01-01',
  end_date: '2100-12-31',
  is_enabled: false,
  message: null,
  created_at: '2026-09-01T09:00:00Z',
  updated_at: '2026-09-01T09:00:00Z',
}

// A render loop commits without end. Stop it well past anything a settled mount needs, so a
// regression fails with a clear message instead of hanging the run.
const COMMIT_CEILING = 40

let commits = 0
const countCommit = (): void => {
  commits += 1
  if (commits > COMMIT_CEILING) {
    throw new Error(`SpecialHoursCalendar committed more than ${COMMIT_CEILING} times: it is in a render loop`)
  }
}

let consoleError: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  vi.clearAllMocks()
  commits = 0
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
  mockedGetSpecialHours.mockResolvedValue({ data: [] })
  mockedGetOverrides.mockResolvedValue({ data: [LEGACY_OVERRIDE] })
})

afterEach(() => {
  consoleError.mockRestore()
})

function renderWithoutOverridesProp(): ReturnType<typeof render> {
  // initialOverrides is left out on purpose: that is the case the default value has to survive.
  return render(
    <Profiler id="special-hours-calendar" onRender={countCommit}>
      <SpecialHoursCalendar canManage initialSpecialHours={NO_SPECIAL_HOURS} />
    </Profiler>,
  )
}

async function flushPending(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50))
  })
}

describe('the special hours calendar without initialOverrides', () => {
  it('settles after mount instead of re-running its effects on every render', async () => {
    renderWithoutOverridesProp()

    await waitFor(() => expect(screen.getAllByText('Legacy Override Active').length).toBeGreaterThan(0))
    const settledCommits = commits
    await flushPending()

    expect(commits).toBe(settledCommits)
    expect(mockedGetSpecialHours).toHaveBeenCalledTimes(1)
    expect(mockedGetOverrides).toHaveBeenCalledTimes(1)
    expect(consoleError).not.toHaveBeenCalledWith(expect.stringContaining('Maximum update depth'), expect.anything())
  })

  it('keeps the overrides it loaded when the parent re-renders without the prop', async () => {
    const { rerender } = renderWithoutOverridesProp()
    await waitFor(() => expect(screen.getAllByText('Legacy Override Active').length).toBeGreaterThan(0))

    rerender(
      <Profiler id="special-hours-calendar" onRender={countCommit}>
        <SpecialHoursCalendar canManage initialSpecialHours={NO_SPECIAL_HOURS} />
      </Profiler>,
    )
    await flushPending()

    // A fresh default array would re-run the sync effect and wipe the loaded overrides back to none.
    expect(screen.getAllByText('Legacy Override Active').length).toBeGreaterThan(0)
    expect(mockedGetOverrides).toHaveBeenCalledTimes(1)
  })
})
