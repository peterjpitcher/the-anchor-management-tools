import { describe, beforeEach, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { BusinessHoursManager } from '@/app/(authenticated)/settings/business-hours/BusinessHoursManager'
import CustomerLabelsClient from '@/app/(authenticated)/settings/customer-labels/CustomerLabelsClient'
import type { BusinessHours } from '@/types/business-hours'
import type { CustomerLabel } from '@/app/actions/customer-labels'

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
  }),
}))

vi.mock('react-hot-toast', () => ({
  __esModule: true,
  default: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

vi.mock('@/components/ui-v2/feedback/Toast', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
    loading: vi.fn(),
    promise: vi.fn(),
    custom: vi.fn(),
    dismiss: vi.fn(),
    remove: vi.fn(),
  },
}))

vi.mock('@/app/actions/business-hours', () => ({
  getBusinessHours: vi.fn(),
  updateBusinessHours: vi.fn(),
}))

vi.mock('@/app/actions/customer-labels', () => ({
  getCustomerLabels: vi.fn(),
  createCustomerLabel: vi.fn(),
  updateCustomerLabel: vi.fn(),
  deleteCustomerLabel: vi.fn(),
  applyLabelsRetroactively: vi.fn(),
}))

describe('Settings read-only behaviour', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('disables business hours controls for read-only viewers', async () => {
    const mockHours: BusinessHours[] = Array.from({ length: 7 }, (_, index) => ({
      id: `hour-${index}`,
      day_of_week: index,
      opens: '09:00',
      closes: '17:00',
      kitchen_opens: null,
      kitchen_closes: null,
      is_closed: false,
      is_kitchen_closed: false,
      created_at: '',
      updated_at: '',
    }))

    const { container } = render(
      <BusinessHoursManager canManage={false} initialHours={mockHours} />,
    )

    await screen.findByText('Monday')

    const timeInputs = container.querySelectorAll('input[type="time"]')
    expect(timeInputs.length).toBeGreaterThan(0)
    timeInputs.forEach((input) => {
      expect(input).toBeDisabled()
    })

    const checkboxes = container.querySelectorAll('input[type="checkbox"]')
    expect(checkboxes.length).toBeGreaterThan(0)
    checkboxes.forEach((checkbox) => {
      expect(checkbox).toBeDisabled()
    })

    expect(screen.getByRole('button', { name: /Save Changes/i })).toBeDisabled()
  })

  it('renders customer labels read-only state without manage permission', () => {
    const labels: CustomerLabel[] = [
      {
        id: 'label-1',
        name: 'VIP',
        description: 'High value customers',
        color: '#10B981',
        icon: 'star',
        auto_apply_rules: {},
        created_at: '',
        updated_at: '',
      },
    ]

    render(<CustomerLabelsClient initialLabels={labels} canManage={false} />)

    expect(
      screen.getByText(
        'You can view customer labels but need the customers:manage permission to create, edit, or delete them.',
      ),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'New Label' })).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Apply Retroactively' }),
    ).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Edit label')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Delete label')).not.toBeInTheDocument()
    expect(screen.getByText('VIP')).toBeInTheDocument()
  })
})
