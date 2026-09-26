// The public timeclock kiosk, in both test zones.
//
// The kiosk shows the pub's time. The clock-in time of each open session was formatted without
// a time zone, and the page renders on the server, which runs in UTC, so during British Summer
// Time "In since" read an hour early. The live clock and date read the device's zone, so a
// kiosk device not set to London showed the wrong time and, around midnight, the wrong day.
//
// 23:30 UTC on 1 October 2026 is 00:30 BST on Friday 2 October in London, but Thursday in UTC.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import TimeclockClient from '@/app/(timeclock)/timeclock/_components/TimeclockClient'

vi.mock('@/app/actions/timeclock', () => ({
  clockIn: vi.fn(),
  clockOut: vi.fn(),
}))

vi.mock('react-hot-toast', () => ({
  default: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

const EMPLOYEE_ID = '00000000-0000-4000-8000-000000000001'

const employees = [
  { employee_id: EMPLOYEE_ID, first_name: 'Amanda', last_name: 'Jones', preferred_name: null },
]

const openSessions = [
  // 18:05 BST in London; 17:05 in UTC.
  { employee_id: EMPLOYEE_ID, clock_in_at: '2026-10-01T17:05:00Z', employee_name: 'Amanda Jones' },
]

describe('TimeclockClient London time', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-01T23:30:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows the clock-in time of an open session on the London clock', () => {
    render(<TimeclockClient employees={employees} openSessions={openSessions} />)

    expect(screen.getByText(/In since 18:05/)).toBeInTheDocument()
  })

  it('shows the live clock and date on the London clock', () => {
    render(<TimeclockClient employees={employees} openSessions={openSessions} />)

    expect(screen.getByText('00:30:00')).toBeInTheDocument()
    expect(screen.getByText(/^Friday,? 2 October 2026$/)).toBeInTheDocument()
  })
})
