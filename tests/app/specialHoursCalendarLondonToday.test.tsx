import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

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

const mockedGetSpecialHours = getSpecialHours as unknown as Mock
const mockedGetOverrides = getServiceStatusOverrides as unknown as Mock

// One reference for every render, as the server page gives the client.
const NO_SPECIAL_HOURS: never[] = []

beforeEach(() => {
  vi.clearAllMocks()
  mockedGetSpecialHours.mockResolvedValue({ data: [] })
  mockedGetOverrides.mockResolvedValue({ data: [] })
  // 23:30 UTC on 30 September 2026 is 00:30 on 1 October in London (BST). The calendar renders on
  // the UTC server first, where the host clock still says September.
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-09-30T23:30:00Z'))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('the special hours calendar just after London midnight', () => {
  it('opens on the London month and rings London today', async () => {
    const { container } = render(<SpecialHoursCalendar canManage initialSpecialHours={NO_SPECIAL_HOURS} />)

    await waitFor(() => expect(mockedGetOverrides).toHaveBeenCalled())

    expect(screen.getByText('October 2026')).toBeInTheDocument()

    const ringed = Array.from(container.querySelectorAll('button')).filter((button) =>
      button.className.split(/\s+/).includes('ring-2'),
    )
    expect(ringed).toHaveLength(1)
    expect(ringed[0].querySelector('span')?.textContent).toBe('1')
  })
})
