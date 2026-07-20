import { describe, expect, it, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { ProjectsOverview } from '@/app/(authenticated)/oj-projects/_components/ProjectsOverview'
import { PermissionProvider } from '@/contexts/PermissionContext'
import { getTodayIsoDate } from '@/lib/dateUtils'

const routerRefresh = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    refresh: routerRefresh,
  }),
}))

const toast = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  info: vi.fn(),
  loading: vi.fn(),
  dismiss: vi.fn(),
}))

vi.mock('@/ds', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/ds')>()
  return {
    ...actual,
    RevenueChart: ({ data }: { data: Array<{ day: string; amount: number }> }) => (
      <div data-testid="work-history-chart" data-chart={JSON.stringify(data)} />
    ),
    toast,
  }
})

const createTimeEntry = vi.fn()
const createMileageEntry = vi.fn()
const createOneOffCharge = vi.fn()
const getEntries = vi.fn()
const updateEntry = vi.fn()
const deleteEntry = vi.fn()

vi.mock('@/app/actions/oj-projects/entries', () => ({
  createTimeEntry: (...args: unknown[]) => createTimeEntry(...args),
  createMileageEntry: (...args: unknown[]) => createMileageEntry(...args),
  createOneOffCharge: (...args: unknown[]) => createOneOffCharge(...args),
  getEntries: (...args: unknown[]) => getEntries(...args),
  updateEntry: (...args: unknown[]) => updateEntry(...args),
  deleteEntry: (...args: unknown[]) => deleteEntry(...args),
}))

describe('ProjectsOverview', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    createTimeEntry.mockResolvedValue({})
    getEntries.mockResolvedValue({ entries: [] })
  })

  function renderOverview(entries: any[] = []): void {
    render(
      <PermissionProvider
        initialPermissions={[
          { module_name: 'oj_projects', action: 'create' },
        ]}
      >
        <ProjectsOverview
          projects={[]}
          entries={entries}
          workTypes={[]}
          clients={[
            { id: '11111111-1111-1111-1111-111111111111', name: 'Alpha Client', projectCount: 0, retainerHours: null },
            { id: '22222222-2222-2222-2222-222222222222', name: 'Bravo Client', projectCount: 0, retainerHours: null },
          ]}
        />
      </PermissionProvider>,
    )
  }

  it('keeps the submitted client selected for the next new entry', async () => {
    renderOverview()

    fireEvent.click(screen.getByRole('button', { name: 'New Entry' }))

    const dialog = await screen.findByRole('dialog', { name: 'New Entry' })
    const clientSelect = within(dialog).getAllByRole('combobox')[0] as HTMLSelectElement
    fireEvent.change(clientSelect, { target: { value: '22222222-2222-2222-2222-222222222222' } })
    fireEvent.change(within(dialog).getByPlaceholderText('e.g. 1.5'), { target: { value: '1.5' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create Entry' }))

    await waitFor(() => expect(createTimeEntry).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'New Entry' })).not.toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'New Entry' }))

    const nextDialog = await screen.findByRole('dialog', { name: 'New Entry' })
    const nextClientSelect = within(nextDialog).getAllByRole('combobox')[0] as HTMLSelectElement
    expect(nextClientSelect.value).toBe('22222222-2222-2222-2222-222222222222')
  })

  it('shows billable state and only counts billable unbilled entries', () => {
    renderOverview([
      {
        id: 'entry-billable',
        vendor_id: '11111111-1111-1111-1111-111111111111',
        project_id: 'project-1',
        entry_type: 'time',
        entry_date: '2026-06-02',
        duration_minutes_rounded: 60,
        hourly_rate_ex_vat_snapshot: 75,
        billable: true,
        status: 'unbilled',
        description: 'Client change',
        project: { project_name: 'Website', project_code: 'OJP-001' },
        vendor: { id: '11111111-1111-1111-1111-111111111111', name: 'Alpha Client' },
      },
      {
        id: 'entry-non-billable',
        vendor_id: '11111111-1111-1111-1111-111111111111',
        project_id: 'project-1',
        entry_type: 'time',
        entry_date: '2026-06-03',
        duration_minutes_rounded: 45,
        hourly_rate_ex_vat_snapshot: 75,
        billable: false,
        status: 'unbilled',
        description: 'Internal tidy-up',
        project: { project_name: 'Website', project_code: 'OJP-001' },
        vendor: { id: '11111111-1111-1111-1111-111111111111', name: 'Alpha Client' },
      },
    ])

    expect(screen.getAllByText('Billable').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Non-billable').length).toBeGreaterThan(0)
    const stat = screen.getByText('Billable Unbilled').closest('div')
    expect(stat).not.toBeNull()
    expect(within(stat as HTMLElement).getByText('1')).toBeInTheDocument()
  })

  it('expands work history and totals time entries by day', () => {
    const month = getTodayIsoDate().slice(0, 7)
    renderOverview([
      {
        id: 'entry-one',
        entry_type: 'time',
        entry_date: `${month}-01`,
        duration_minutes_rounded: 60,
        status: 'unbilled',
      },
      {
        id: 'entry-two',
        entry_type: 'time',
        entry_date: `${month}-01`,
        duration_minutes_rounded: 30,
        status: 'unbilled',
      },
      {
        id: 'entry-mileage',
        entry_type: 'mileage',
        entry_date: `${month}-01`,
        miles: 10,
        status: 'unbilled',
      },
    ])

    expect(screen.queryByTestId('work-history-chart')).not.toBeInTheDocument()

    const showButton = screen.getByRole('button', { name: 'Show work history chart' })
    expect(showButton).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(showButton)

    expect(screen.getByRole('button', { name: 'Hide work history chart' })).toHaveAttribute('aria-expanded', 'true')
    const chart = screen.getByTestId('work-history-chart')
    const data = JSON.parse(chart.getAttribute('data-chart') || '[]') as Array<{ day: string; amount: number }>
    expect(data.find((day) => day.day.startsWith('1 '))?.amount).toBe(1.5)
  })
})
