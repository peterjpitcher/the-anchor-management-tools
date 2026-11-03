import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The employee record's Training tab: added beside Signing for holders of training view only,
 * and opened directly by `?tab=training` (the training log links there).
 */

const mocks = vi.hoisted(() => ({
  permissions: new Set<string>(),
  search: new URLSearchParams(),
}))

vi.mock('next/navigation', () => ({
  useParams: () => ({ employee_id: 'emp-7' }),
  useSearchParams: () => mocks.search,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
}))
vi.mock('@/contexts/PermissionContext', () => ({
  usePermissions: () => ({
    loading: false,
    hasPermission: (module: string, action: string) => mocks.permissions.has(`${module}:${action}`),
  }),
}))
vi.mock('@/components/features/training/EmployeeTrainingTab', () => ({
  EmployeeTrainingTab: ({ employeeId }: { employeeId: string }) => <p>Training panel for {employeeId}</p>,
}))

import { EmployeeDetailTabs } from '@/app/(authenticated)/employees/[employee_id]/_components/EmployeeDetailTabs'

const PAGE_TABS = [
  { key: 'details', label: 'Details', content: <p>Details panel</p> },
  { key: 'signing', label: 'Signing', content: <p>Signing panel</p> },
  { key: 'pay', label: 'Pay', content: <p>Pay panel</p> },
]

function optionLabels(): string[] {
  return screen.getAllByRole('option').map((option) => option.textContent ?? '')
}

describe('EmployeeDetailTabs and the Training tab', () => {
  beforeEach(() => {
    mocks.permissions = new Set()
    mocks.search = new URLSearchParams()
  })

  it('leaves the Training tab out without training view', () => {
    render(<EmployeeDetailTabs tabs={PAGE_TABS} />)
    expect(optionLabels()).toEqual(['Details', 'Signing', 'Pay'])
    expect(screen.queryByText(/Training panel/)).not.toBeInTheDocument()
  })

  it('adds the Training tab beside Signing for holders of training view', () => {
    mocks.permissions = new Set(['training:view'])
    render(<EmployeeDetailTabs tabs={PAGE_TABS} />)
    expect(optionLabels()).toEqual(['Details', 'Signing', 'Training', 'Pay'])
    // It loads only when opened: the first tab is showing.
    expect(screen.getByText('Details panel')).toBeInTheDocument()
    expect(screen.queryByText(/Training panel/)).not.toBeInTheDocument()
  })

  it('opens the Training tab from ?tab=training, for this employee', () => {
    mocks.permissions = new Set(['training:view'])
    mocks.search = new URLSearchParams('tab=training')
    render(<EmployeeDetailTabs tabs={PAGE_TABS} />)
    expect(screen.getByText('Training panel for emp-7')).toBeInTheDocument()
  })

  it('falls back to the first tab when ?tab names one the person cannot see', () => {
    mocks.search = new URLSearchParams('tab=training')
    render(<EmployeeDetailTabs tabs={PAGE_TABS} />)
    expect(screen.getByText('Details panel')).toBeInTheDocument()
  })
})
