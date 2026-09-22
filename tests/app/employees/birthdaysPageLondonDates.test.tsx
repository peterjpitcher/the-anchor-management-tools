// The birthdays page around midnight, in both test zones.
//
// The page groups each birthday under the month it next falls in, working that out from the
// host clock plus the helper's day count, and starts the list at the host clock's month. On the
// UTC server that clock is still yesterday from 00:00 to 00:59 British Summer Time, so on the
// last night of a month a birthday "today" was filed under the month before. The page and the
// helper now both count from the London date, so they agree about the day. The real
// getAllBirthdays runs here, over a mocked Supabase client, so the two are tested together.
//
// Instants are written in UTC: 23:30 UTC on 30 September 2026 is 00:30 BST on Thursday
// 1 October in London, but still Wednesday 30 September in UTC.
import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const sessionFromMock = vi.hoisted(() => vi.fn())

vi.mock('next/navigation', () => ({
  redirect: vi.fn(),
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/employees/birthdays',
}))
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ from: sessionFromMock }) }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/email/emailService', () => ({ sendEmail: vi.fn() }))
vi.mock('@/app/actions/rbac', () => ({ checkUserPermission: vi.fn().mockResolvedValue(true) }))
vi.mock('@/app/actions/audit', () => ({ logAuditEvent: vi.fn() }))
vi.mock('@/components/features/employees/SendBirthdayRemindersButton', () => ({
  default: () => <button type="button">Send reminders</button>,
}))

import EmployeeBirthdaysPage from '@/app/(authenticated)/employees/birthdays/page'

// 00:30 BST on Thursday 1 October 2026 in London; Wednesday 30 September in UTC.
const JUST_AFTER_MIDNIGHT_BST = '2026-09-30T23:30:00Z'
// 23:30 BST on Wednesday 30 September 2026: the same day in London and in UTC.
const JUST_BEFORE_MIDNIGHT_BST = '2026-09-30T22:30:00Z'
// Winter control: 00:30 GMT on Sunday 1 February 2026, the same day in both zones.
const JUST_AFTER_MIDNIGHT_GMT = '2026-02-01T00:30:00Z'

function employee(id: number, firstName: string, dateOfBirth: string) {
  return {
    employee_id: `00000000-0000-4000-8000-00000000000${id}`,
    first_name: firstName,
    last_name: 'Rowe',
    preferred_name: null,
    job_title: 'Bar Staff',
    date_of_birth: dateOfBirth,
    email_address: null,
  }
}

function employeesQuery(rows: unknown[]) {
  const not = vi.fn().mockResolvedValue({ data: rows, error: null })
  const inStatus = vi.fn().mockReturnValue({ not })
  return { select: vi.fn().mockReturnValue({ in: inStatus }) }
}

/** Month headings and employee names, in the order the page shows them. */
function pageOutline(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('h2 > span:first-of-type, a[href^="/employees/0"]'))
    .map(element => element.textContent ?? '')
}

async function renderAt(isoInstant: string, rows: unknown[]) {
  vi.setSystemTime(new Date(isoInstant))
  sessionFromMock.mockReturnValue(employeesQuery(rows))
  return render(await EmployeeBirthdaysPage())
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ toFake: ['Date'] })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('EmployeeBirthdaysPage', () => {
  const OCTOBER_FIRST = employee(1, 'Alex', '1990-10-01')
  const SEPTEMBER_LAST = employee(2, 'Sam', '1990-09-30')

  it('files a birthday today under this London month in the first hour of the day', async () => {
    const { container } = await renderAt(JUST_AFTER_MIDNIGHT_BST, [SEPTEMBER_LAST, OCTOBER_FIRST])

    expect(pageOutline(container)).toEqual(['October', 'Alex', 'September', 'Sam'])
    expect(screen.getByText('Today! 🎉')).toBeInTheDocument()
    expect(screen.getByText('Oct 1')).toBeInTheDocument()
    expect(screen.getByText('Sep 30')).toBeInTheDocument()
    expect(screen.getByText('Turning 36')).toBeInTheDocument()
    expect(screen.getByText('Turning 37')).toBeInTheDocument()
  })

  it('keeps the last day of the month under that month before midnight', async () => {
    const { container } = await renderAt(JUST_BEFORE_MIDNIGHT_BST, [SEPTEMBER_LAST, OCTOBER_FIRST])

    expect(pageOutline(container)).toEqual(['September', 'Sam', 'October', 'Alex'])
    expect(screen.getByText('Today! 🎉')).toBeInTheDocument()
    expect(screen.getByText('Tomorrow')).toBeInTheDocument()
  })

  it('agrees in both zones in winter', async () => {
    const { container } = await renderAt(JUST_AFTER_MIDNIGHT_GMT, [
      employee(3, 'Jo', '1990-01-31'),
      employee(4, 'Kim', '1990-02-01'),
    ])

    expect(pageOutline(container)).toEqual(['February', 'Kim', 'January', 'Jo'])
    expect(screen.getByText('Feb 1')).toBeInTheDocument()
    expect(screen.getByText('Jan 31')).toBeInTheDocument()
  })
})
