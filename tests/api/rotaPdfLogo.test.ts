import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import type { LeaveDayWithRequest, RotaEmployee, RotaShift, RotaWeek } from '@/app/actions/rota'
import type { HoursReportData } from '@/lib/rota/hours-report-data'

const mocks = vi.hoisted(() => ({
  generatePDFFromHTML: vi.fn(async (_html: string, _options?: unknown) => Buffer.from('pdf')),
  getDocumentLogoDataUri: vi.fn<() => string | undefined>(() => 'data:image/png;base64,AAAA'),
  getOrCreateRotaWeek: vi.fn(),
  getWeekShifts: vi.fn(),
  getActiveEmployeesForRota: vi.fn(),
  getLeaveDaysForWeek: vi.fn(),
  getShiftTemplates: vi.fn(),
  loadHoursReportData: vi.fn(),
}))

vi.mock('@/lib/pdf-generator', () => ({ generatePDFFromHTML: mocks.generatePDFFromHTML }))
vi.mock('@/lib/pdf/document-logo', () => ({ getDocumentLogoDataUri: mocks.getDocumentLogoDataUri }))
vi.mock('@/app/actions/rbac', () => ({ checkUserPermission: vi.fn(async () => true) }))
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({ auth: { getUser: async () => ({ data: { user: { id: 'user-1' } } }) } })),
}))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn(() => ({})) }))
vi.mock('@/app/actions/rota', () => ({
  getOrCreateRotaWeek: mocks.getOrCreateRotaWeek,
  getWeekShifts: mocks.getWeekShifts,
  getActiveEmployeesForRota: mocks.getActiveEmployeesForRota,
  getLeaveDaysForWeek: mocks.getLeaveDaysForWeek,
}))
vi.mock('@/app/actions/rota-templates', () => ({ getShiftTemplates: mocks.getShiftTemplates }))
vi.mock('@/lib/rota/hours-report-data', () => ({ loadHoursReportData: mocks.loadHoursReportData }))

import { GET as getRotaPdf } from '@/app/api/rota/pdf/route'
import { GET as getRotaHoursPdf } from '@/app/api/rota/hours/pdf/route'

const WEEK_START = '2026-10-05'
const LOGO_IMG = 'src="data:image/png;base64,AAAA" alt="Orange Jelly"'

const NAMES = ['Alexandra', 'Tomasz', 'Priyanka', 'Siobhan', 'Oluwaseun', 'Margaret', 'Benedict', 'Charlotte']

const EMPLOYEES: RotaEmployee[] = NAMES.map((first, i) => ({
  employee_id: `emp-${i}`,
  first_name: first,
  last_name: 'Sample',
  preferred_name: null,
  job_title: i % 3 === 0 ? 'Chef' : 'Bar and floor',
  max_weekly_hours: null,
  is_active: true,
}))

function isoDay(offset: number): string {
  const date = new Date(`${WEEK_START}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + offset)
  return date.toISOString().slice(0, 10)
}

function shift(id: string, employeeId: string | null, day: number, overrides: Partial<RotaShift> = {}): RotaShift {
  return {
    id,
    week_id: 'week-1',
    employee_id: employeeId,
    template_id: null,
    shift_date: isoDay(day),
    start_time: '12:00:00',
    end_time: '20:00:00',
    unpaid_break_minutes: 30,
    department: 'bar',
    status: 'scheduled',
    sick_reason: null,
    notes: null,
    is_overnight: false,
    is_open_shift: employeeId === null,
    name: null,
    ...overrides,
  } as RotaShift
}

const SHIFTS: RotaShift[] = [
  ...EMPLOYEES.flatMap((employee, e) =>
    [0, 1, 2, 3, 4, 5, 6]
      .filter((day) => (day + e) % 3 !== 0)
      .map((day) =>
        shift(`s-${e}-${day}`, employee.employee_id, day, {
          department: e % 3 === 0 ? 'kitchen' : 'bar',
          start_time: day > 4 ? '10:00:00' : '16:00:00',
          end_time: day > 4 ? '18:00:00' : '23:00:00',
          status: e === 2 && day === 1 ? 'sick' : 'scheduled',
        })
      )
  ),
  shift('open-1', null, 5, { name: 'Saturday close' }),
]

const WEEK: RotaWeek = {
  id: 'week-1',
  week_start: WEEK_START,
  status: 'published',
  published_at: '2026-10-01T10:00:00Z',
  published_by: 'user-1',
  has_unpublished_changes: false,
  created_at: '2026-09-28T10:00:00Z',
  updated_at: '2026-10-01T10:00:00Z',
}

const LEAVE: LeaveDayWithRequest[] = [
  { employee_id: 'emp-1', leave_date: isoDay(3), request_id: 'req-1', status: 'approved' },
  { employee_id: 'emp-4', leave_date: isoDay(6), request_id: 'req-2', status: 'pending' },
]

/** Twelve weeks of clocked sessions ending the day before WEEK_START. */
function hoursData(): HoursReportData {
  const sessions: HoursReportData['sessions'] = []
  for (let week = 0; week < 12; week += 1) {
    EMPLOYEES.slice(0, 4).forEach((employee, e) => {
      for (let day = 0; day < 3 + (e % 2); day += 1) {
        const workDate = isoDay(-84 + week * 7 + day + e)
        sessions.push({
          id: `sess-${week}-${e}-${day}`,
          employee_id: employee.employee_id,
          work_date: workDate,
          clock_in_at: `${workDate}T11:00:00Z`,
          clock_out_at: `${workDate}T${String(17 + ((week + e) % 4)).padStart(2, '0')}:30:00Z`,
        })
      }
    })
  }
  return {
    employees: EMPLOYEES.map((employee) => ({
      employee_id: employee.employee_id,
      first_name: employee.first_name,
      last_name: employee.last_name,
      preferred_name: employee.preferred_name,
      job_title: employee.job_title,
      status: 'Active',
    })),
    sessions,
    leaveDays: [
      { employee_id: 'emp-0', leave_date: isoDay(-40), request_id: 'req-1' },
      { employee_id: 'emp-0', leave_date: isoDay(-39), request_id: 'req-1' },
      { employee_id: 'emp-2', leave_date: isoDay(-20), request_id: 'req-2' },
    ],
    sickShifts: [{ id: 'sick-1', employee_id: 'emp-1', shift_date: isoDay(-30), sick_reason: 'Unwell' }],
    plannedShifts: [],
  }
}

function lastHtml(): string {
  return String(mocks.generatePDFFromHTML.mock.calls.at(-1)?.[0])
}

function rotaRequest(): NextRequest {
  return new NextRequest(`http://localhost/api/rota/pdf?week=${WEEK_START}`)
}

function hoursRequest(): NextRequest {
  const params = new URLSearchParams({ from: isoDay(-84), to: isoDay(-1) })
  EMPLOYEES.slice(0, 4).forEach((employee) => params.append('employee', employee.employee_id))
  return new NextRequest(`http://localhost/api/rota/hours/pdf?${params.toString()}`)
}

describe('rota PDFs carry the Orange Jelly logo', () => {
  beforeEach(() => {
    mocks.generatePDFFromHTML.mockClear()
    mocks.getDocumentLogoDataUri.mockReturnValue('data:image/png;base64,AAAA')
    mocks.getOrCreateRotaWeek.mockResolvedValue({ success: true, data: WEEK })
    mocks.getActiveEmployeesForRota.mockResolvedValue({ success: true, data: EMPLOYEES })
    mocks.getWeekShifts.mockResolvedValue({ success: true, data: SHIFTS })
    mocks.getLeaveDaysForWeek.mockResolvedValue({ success: true, data: LEAVE })
    mocks.getShiftTemplates.mockResolvedValue({ success: true, data: [] })
    mocks.loadHoursReportData.mockResolvedValue(hoursData())
  })

  it('prints the wordmark beside the weekly rota title', async () => {
    const response = await getRotaPdf(rotaRequest())

    expect(response.status).toBe(200)
    const html = lastHtml()
    expect(html).toContain(LOGO_IMG)
    expect(html.indexOf(LOGO_IMG)).toBeLessThan(html.indexOf('Weekly Rota'))
  })

  it('prints the wordmark beside the hours report title', async () => {
    const response = await getRotaHoursPdf(hoursRequest())

    expect(response.status).toBe(200)
    const html = lastHtml()
    expect(html).toContain(LOGO_IMG)
    expect(html.indexOf(LOGO_IMG)).toBeLessThan(html.indexOf('<h1>Hours by Week</h1>'))
  })

  it('still prints both reports, without an image, when the logo cannot be read', async () => {
    mocks.getDocumentLogoDataUri.mockReturnValue(undefined)

    expect((await getRotaPdf(rotaRequest())).status).toBe(200)
    expect(lastHtml()).not.toContain('<img')
    expect(lastHtml()).toContain('Weekly Rota')

    expect((await getRotaHoursPdf(hoursRequest())).status).toBe(200)
    expect(lastHtml()).not.toContain('<img')
    expect(lastHtml()).toContain('Hours by Week')
  })
})
