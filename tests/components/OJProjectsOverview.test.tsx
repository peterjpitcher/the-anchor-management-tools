import { describe, expect, it, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { ProjectsOverview } from '@/app/(authenticated)/oj-projects/_components/ProjectsOverview'
import { PermissionProvider } from '@/contexts/PermissionContext'

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

  function renderOverview(): void {
    render(
      <PermissionProvider
        initialPermissions={[
          { module_name: 'oj_projects', action: 'create' },
        ]}
      >
        <ProjectsOverview
          projects={[]}
          entries={[]}
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
})
