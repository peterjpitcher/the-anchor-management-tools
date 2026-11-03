// The birthdays page: month grouping, the reminder copy and the button.
//
// FF-57: grouping by month alone put a birthday from earlier this month (next due in eleven months)
// at the top, under this month. FF-54: the page said the email went to a fixed address at 8 AM;
// the code sends to MANAGER_EMAIL from a cron at 09:00 UTC (9am GMT, 10am BST). The real
// getAllBirthdays runs over a mocked Supabase client.
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

import EmployeeBirthdaysPage from '@/app/(authenticated)/employees/birthdays/page'

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

function pageOutline(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('h3, a[href^="/employees/0"]'))
    .map(element => element.textContent ?? '')
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ toFake: ['Date'] })
  // Thursday 15 October 2026, midday in London.
  vi.setSystemTime(new Date('2026-10-15T11:00:00Z'))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('EmployeeBirthdaysPage', () => {
  it('files a birthday from earlier this month under next year, at the end, not at the top', async () => {
    sessionFromMock.mockReturnValue(employeesQuery([
      employee(1, 'Early', '1990-10-05'), // next on 5 October 2027
      employee(2, 'Later', '1990-10-20'), // in 5 days
      employee(3, 'Winter', '1990-01-10'), // 10 January 2027
    ]))

    const { container } = render(await EmployeeBirthdaysPage())

    expect(pageOutline(container)).toEqual([
      'October 2026', 'Later',
      'January 2027', 'Winter',
      'October 2027', 'Early',
    ])
  })

  it('says when and to whom the reminder goes, without naming an address', async () => {
    sessionFromMock.mockReturnValue(employeesQuery([]))

    render(await EmployeeBirthdaysPage())

    const copy = screen.getByText(/a reminder is emailed/)
    expect(copy.textContent).toContain("the manager's email address")
    expect(copy.textContent).toContain('9am (10am in British Summer Time)')
    expect(copy.textContent).toContain('exactly 7 days away')
    expect(copy.textContent).not.toMatch(/@|8 AM/)
  })

  it('labels the button with what it does', async () => {
    sessionFromMock.mockReturnValue(employeesQuery([]))

    render(await EmployeeBirthdaysPage())

    // The page header renders its actions for both widths, so the button can appear twice.
    expect(screen.getAllByRole('button', { name: 'Email Reminder for Birthdays in 7 Days' }).length).toBeGreaterThan(0)
    expect(screen.queryByText('Send Weekly Reminders')).not.toBeInTheDocument()
  })
})
