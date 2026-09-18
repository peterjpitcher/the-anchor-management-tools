import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { CATEGORY, STAFF } from '@/lib/brand/palette'
import { ROTA_DEPARTMENT_CATEGORIES } from '@/lib/rota/status-ui'

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: vi.fn(async () => ({ data: { user: { id: 'user-1' } } })) },
  })),
}))

vi.mock('@/app/actions/rbac', () => ({
  checkUserPermission: vi.fn(async () => true),
}))

vi.mock('@/app/actions/rota', () => ({
  getOrCreateRotaWeek: vi.fn(),
  getActiveEmployeesForRota: vi.fn(),
  getWeekShifts: vi.fn(),
  getLeaveDaysForWeek: vi.fn(),
}))

vi.mock('@/app/actions/rota-templates', () => ({
  getShiftTemplates: vi.fn(),
}))

vi.mock('@/lib/pdf-generator', () => ({
  generatePDFFromHTML: vi.fn(async () => Buffer.from('%PDF')),
}))

import { GET } from './route'
import {
  getActiveEmployeesForRota,
  getLeaveDaysForWeek,
  getOrCreateRotaWeek,
  getWeekShifts,
} from '@/app/actions/rota'
import { getShiftTemplates } from '@/app/actions/rota-templates'
import { generatePDFFromHTML } from '@/lib/pdf-generator'
import { SHIFT_TEMPLATE_COLOURS } from '@/lib/rota/shift-template-colours'

const WEEK = '2026-09-14'

function colour(label: string): string {
  const option = SHIFT_TEMPLATE_COLOURS.find(item => item.label === label)
  if (!option) throw new Error(`no shift colour called ${label}`)
  return option.value
}

function shift(overrides: Record<string, unknown>) {
  return {
    id: String(overrides.name),
    week_id: 'week-1',
    employee_id: 'emp-1',
    template_id: null,
    shift_date: WEEK,
    start_time: '12:00:00',
    end_time: '17:00:00',
    unpaid_break_minutes: 0,
    department: 'bar',
    status: 'scheduled',
    sick_reason: null,
    notes: null,
    is_overnight: false,
    is_open_shift: false,
    ...overrides,
  }
}

function template(overrides: Record<string, unknown>) {
  return {
    name: 'Template',
    end_time: '22:00:00',
    unpaid_break_minutes: 0,
    is_active: true,
    day_of_week: null,
    employee_id: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

const SHIFTS = [
  shift({ name: 'Lunch bar', department: 'bar', start_time: '12:00:00' }),
  shift({ name: 'Late bar', department: 'bar', start_time: '18:00:00', shift_date: '2026-09-15' }),
  shift({ name: 'Tasting menu', department: 'kitchen', start_time: '17:00:00', template_id: 'tpl-special', shift_date: '2026-09-16' }),
  shift({ name: 'Deep clean', department: 'cleaning', start_time: '09:00:00', shift_date: '2026-09-17' }),
  shift({ name: 'Off sick', department: 'bar', start_time: '00:00:00', end_time: '00:00:00', status: 'sick', shift_date: '2026-09-18' }),
  // No automatic rule covers a 2pm bar shift or a cellar shift, so they show their department.
  shift({ name: 'Afternoon bar', department: 'bar', start_time: '14:00:00', end_time: '18:00:00', shift_date: '2026-09-19' }),
  shift({ name: 'Cellar tidy', department: 'cellar', start_time: '10:00:00', end_time: '12:00:00', shift_date: '2026-09-19' }),
  shift({ name: 'Floor runner', department: 'runner', start_time: '11:00:00', end_time: '15:00:00', shift_date: '2026-09-20' }),
]

const TEMPLATES = [
  // Picked by hand: the automatic colour for a 17:00 kitchen shift is orange.
  template({ id: 'tpl-special', department: 'kitchen', start_time: '17:00:00', colour: colour('Green') }),
]

function request(): NextRequest {
  return new NextRequest(`http://localhost/api/rota/pdf?week=${WEEK}`)
}

async function printedHtml(): Promise<string> {
  const res = await GET(request())
  expect(res.status).toBe(200)
  return vi.mocked(generatePDFFromHTML).mock.calls.at(-1)?.[0] as string
}

/** The background, text and edge colours of the chip for the shift with this name. */
function chip(html: string, name: string): { bg: string; fg: string; border: string } {
  const pattern = new RegExp(
    `<div style="background:(#[0-9a-fA-F]+);color:(#[0-9a-fA-F]+);border:1px solid (#[0-9a-fA-F]+);[^"]*">\\s*<div style="[^"]*">${name}</div>`,
  )
  const match = html.match(pattern)
  if (!match) throw new Error(`no chip for ${name}`)
  return { bg: match[1], fg: match[2], border: match[3] }
}

/** The inside of the chip for the shift with this name, up to the end of the chip. */
function chipBody(html: string, name: string): string {
  const start = html.indexOf(`>${name}</div>`)
  if (start < 0) throw new Error(`no chip for ${name}`)
  const end = html.indexOf('</div>\n    </div>', start)
  return html.slice(start, end)
}

beforeEach(() => {
  vi.mocked(generatePDFFromHTML).mockClear()
  vi.mocked(getOrCreateRotaWeek).mockResolvedValue({
    success: true,
    data: {
      id: 'week-1', week_start: WEEK, status: 'published', published_at: null, published_by: null,
      has_unpublished_changes: false, created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z',
    },
  } as never)
  vi.mocked(getActiveEmployeesForRota).mockResolvedValue({
    success: true,
    data: [{ employee_id: 'emp-1', first_name: 'Jo', last_name: 'Bloggs', preferred_name: null, job_title: 'Bar Staff', max_weekly_hours: null, is_active: true }],
  } as never)
  vi.mocked(getWeekShifts).mockResolvedValue({ success: true, data: SHIFTS } as never)
  vi.mocked(getLeaveDaysForWeek).mockResolvedValue({ success: true, data: [] } as never)
  vi.mocked(getShiftTemplates).mockResolvedValue({ success: true, data: TEMPLATES } as never)
})

describe('GET /api/rota/pdf shift colours', () => {
  it('colours each shift as /rota does, from its role and start time or its template', async () => {
    const html = await printedHtml()

    expect(chip(html, 'Lunch bar')).toEqual({ bg: colour('Light blue'), fg: STAFF.text, border: colour('Light blue') })
    expect(chip(html, 'Late bar')).toEqual({ bg: colour('Dark blue'), fg: STAFF.primaryFg, border: colour('Dark blue') })
    expect(chip(html, 'Tasting menu')).toEqual({ bg: colour('Green'), fg: STAFF.primaryFg, border: colour('Green') })
  })

  it('gives a white shift a visible edge and shows Couldn\'t Work in danger', async () => {
    const html = await printedHtml()

    expect(chip(html, 'Deep clean')).toEqual({ bg: colour('White'), fg: STAFF.text, border: STAFF.borderStrong })
    expect(chip(html, 'Off sick')).toEqual({ bg: STAFF.dangerSoft, fg: STAFF.dangerFg, border: STAFF.dangerBorder })
  })

  it('falls back to the automatic colours when the templates cannot be read, as /rota does', async () => {
    vi.mocked(getShiftTemplates).mockResolvedValue({ success: false, error: 'Permission denied' } as never)

    const html = await printedHtml()

    expect(chip(html, 'Tasting menu').bg).toBe(colour('Orange'))
  })

  it('no longer prints the old department colours', async () => {
    const html = await printedHtml()

    // #ffedd5 and #9a3412 are also cat-5, the kitchen department look, but no shift here falls
    // back to it: the kitchen shift has a colour picked by hand.
    for (const retired of ['#dbeafe', '#ffedd5', '#1e40af', '#9a3412', '#fee2e2']) {
      expect(html).not.toContain(retired)
    }
    expect(html).toContain('Shift colour follows role and start time')
  })

  it('shows a shift with no colour rule in its department look, as /rota does', async () => {
    const html = await printedHtml()
    const bar = CATEGORY[ROTA_DEPARTMENT_CATEGORIES.bar - 1]

    // The same as bg-cat-1-soft text-cat-1-fg border-cat-1/20 on screen (0x33 is 20% opacity).
    expect(chip(html, 'Afternoon bar')).toEqual({ bg: bar.soft, fg: bar.fg, border: `${bar.base}33` })
    // A department with no category is the neutral chip, like the screen fallback.
    expect(chip(html, 'Cellar tidy')).toEqual({ bg: STAFF.surface2, fg: STAFF.textMuted, border: STAFF.border })
  })

  it('names each shift by its department and a sick shift as Couldn\'t Work, as /rota does', async () => {
    const html = await printedHtml()

    expect(chipBody(html, 'Floor runner')).toContain('Runner · 4.0h')
    expect(chipBody(html, 'Floor runner')).not.toContain('Kitchen')
    expect(chipBody(html, 'Afternoon bar')).toContain('Bar · 4.0h')
    expect(chipBody(html, 'Cellar tidy')).toContain('Cellar · 2.0h')
    expect(chipBody(html, 'Off sick')).toContain("Couldn't Work")
    expect(html).not.toMatch(/>\s*Sick\s*</)
  })

  it('shows holiday in the rota\'s holiday colours, with an edge', async () => {
    vi.mocked(getLeaveDaysForWeek).mockResolvedValue({
      success: true,
      data: [
        { employee_id: 'emp-1', leave_date: '2026-09-15', request_id: 'req-1', status: 'approved' },
        { employee_id: 'emp-1', leave_date: '2026-09-16', request_id: 'req-2', status: 'pending' },
      ],
    } as never)

    const html = await printedHtml()

    expect(html).toMatch(new RegExp(`border:1px solid ${STAFF.successBorder};[^"]*background:${STAFF.successSoft};\\s*color:${STAFF.successFg}">\\s*Holiday\\s*<`))
    expect(html).toMatch(new RegExp(`border:1px solid ${STAFF.warningBorder};[^"]*background:${STAFF.warningSoft};\\s*color:${STAFF.warningFg}">\\s*Holiday&nbsp;\\(P\\)\\s*<`))
  })

  it('escapes names before they reach the PDF renderer', async () => {
    vi.mocked(getWeekShifts).mockResolvedValue({
      success: true,
      data: [shift({ name: 'Bar & <b>Grill</b>', department: 'bar', start_time: '12:00:00' })],
    } as never)

    const html = await printedHtml()

    expect(html).toContain('Bar &amp; &lt;b&gt;Grill&lt;/b&gt;')
    expect(html).not.toContain('<b>Grill</b>')
  })
})
