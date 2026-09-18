import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { STAFF } from '@/lib/brand/palette'
import { displayName } from '@/lib/employees/display-name'
import { ROTA_HOURS_SERIES_COLOURS } from '@/lib/rota/status-ui'

vi.mock('@/app/actions/rbac', () => ({
  checkUserPermission: vi.fn(async () => true),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({})),
}))

vi.mock('@/lib/rota/hours-report-data', () => ({
  loadHoursReportData: vi.fn(),
}))

vi.mock('@/lib/pdf-generator', () => ({
  generatePDFFromHTML: vi.fn(async () => Buffer.from('%PDF')),
}))

import { GET } from './route'
import { loadHoursReportData } from '@/lib/rota/hours-report-data'
import { generatePDFFromHTML } from '@/lib/pdf-generator'

// Ten people, so the ninth colour is used and the tenth wraps round to the first, as on screen.
// Person N works 11 - N hours, which fixes the order the report sorts them into.
const PEOPLE = Array.from({ length: 10 }, (_, index) => ({
  employee_id: `emp-${String(index + 1).padStart(2, '0')}`,
  first_name: `Person${index + 1}`,
  last_name: 'Test',
  preferred_name: null,
  job_title: 'Bar Staff',
  status: 'Active',
}))

const SESSIONS = PEOPLE.map((person, index) => ({
  id: `session-${index + 1}`,
  employee_id: person.employee_id,
  work_date: '2026-09-01',
  clock_in_at: '2026-09-01T08:00:00Z',
  clock_out_at: `2026-09-01T${String(8 + 10 - index).padStart(2, '0')}:00:00Z`,
}))

async function printedHtml(): Promise<string> {
  const params = new URLSearchParams({ from: '2026-08-31', to: '2026-09-13' })
  for (const person of PEOPLE) params.append('employee', person.employee_id)
  const res = await GET(new NextRequest(`http://localhost/api/rota/hours/pdf?${params}`))
  expect(res.status).toBe(200)
  return vi.mocked(generatePDFFromHTML).mock.calls.at(-1)?.[0] as string
}

/** The chart legend as [colour, label] pairs, in the order printed. */
function legend(html: string): Array<[string, string]> {
  const pattern = /<circle cx="[^"]+" cy="[^"]+" r="5" fill="([^"]+)" \/>\s*<text [^>]*class="legend-label">([^<]+)<\/text>/g
  return [...html.matchAll(pattern)].map(match => [match[1], match[2]])
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-09-18T10:00:00Z'))
  vi.mocked(generatePDFFromHTML).mockClear()
  vi.mocked(loadHoursReportData).mockResolvedValue({
    employees: PEOPLE,
    sessions: SESSIONS,
    leaveDays: [{ employee_id: 'emp-01', leave_date: '2026-09-02', request_id: 'req-1' }],
    sickShifts: [{ id: 'sick-1', employee_id: 'emp-02', shift_date: '2026-09-03', sick_reason: 'Flu' }],
    plannedShifts: [],
  })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('GET /api/rota/hours/pdf colours', () => {
  it('gives each person the colour /rota/hours gives them, in the same order', async () => {
    const html = await printedHtml()
    const people = legend(html).slice(0, PEOPLE.length)

    expect(people.map(([, label]) => label)).toEqual(PEOPLE.map(person => displayName(person)))
    expect(people.map(([colour]) => colour)).toEqual(
      PEOPLE.map((_, index) => ROTA_HOURS_SERIES_COLOURS[index % ROTA_HOURS_SERIES_COLOURS.length].print),
    )
  })

  it('shows holiday as success and Couldn\'t Work as danger, in the legend, the bars and the tables', async () => {
    const html = await printedHtml()

    expect(legend(html).slice(PEOPLE.length)).toEqual([
      [STAFF.success, 'Holiday days'],
      [STAFF.danger, 'Couldn&#39;t Work days'],
    ])
    expect(html).toMatch(new RegExp(`<rect [^>]*fill="${STAFF.success}" />`))
    expect(html).toMatch(new RegExp(`<rect [^>]*fill="${STAFF.danger}" />`))
    expect(html).toContain(`<span class="dot" style="background:${STAFF.success}"></span>${displayName(PEOPLE[0])}<`)
    expect(html).toContain(`<span class="dot" style="background:${STAFF.danger}"></span>${displayName(PEOPLE[1])}<`)
  })

  it('prints no broken values', async () => {
    const html = await printedHtml()

    for (const broken of ['undefined', 'NaN', 'Invalid Date']) {
      expect(html).not.toContain(broken)
    }
  })
})
