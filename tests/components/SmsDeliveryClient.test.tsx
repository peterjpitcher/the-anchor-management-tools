import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import SmsDeliveryClient, { type SmsStats } from '@/app/(authenticated)/settings/sms-delivery/SmsDeliveryClient'

const mockGetSmsDeliveryStats = vi.fn()
const mockGetDeliveryFailureReport = vi.fn()

vi.mock('@/app/actions/customerSmsActions', () => ({
  getSmsDeliveryStats: (...args: unknown[]) => mockGetSmsDeliveryStats(...args),
  getDeliveryFailureReport: (...args: unknown[]) => mockGetDeliveryFailureReport(...args),
}))

describe('SmsDeliveryClient', () => {
  const baseStats: SmsStats = {
    messages: {
      total: 10,
      byStatus: { delivered: 8, failed: 2 },
      totalCost: '4.50',
      deliveryRate: '80.0',
    },
    customers: {
      active: 5,
      inactive: 3,
      total: 8,
    },
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders an error message when provided via props', () => {
    render(
      <SmsDeliveryClient
        initialStats={null}
        initialFailedCustomers={[]}
        initialError="Insufficient permissions"
      />,
    )

    expect(screen.getByText('Error loading statistics')).toBeInTheDocument()
    expect(screen.getByText('Insufficient permissions')).toBeInTheDocument()
  })

  it('shows summary metrics and customer data', () => {
    render(
      <SmsDeliveryClient
        initialStats={baseStats}
        initialFailedCustomers={[
          {
            id: '1',
            first_name: 'Jane',
            last_name: 'Doe',
            mobile_number: '+441234567890',
            sms_delivery_failures: 3,
            last_sms_failure_reason: 'Twilio error',
            sms_deactivation_reason: null,
            sms_opt_in: false,
          },
        ]}
        initialError={null}
      />,
    )

    expect(screen.getByText('Total Messages (30d)')).toBeInTheDocument()
    expect(screen.getByText('+441234567890')).toBeInTheDocument()
  })

  it('surfaces refresh errors from server actions', async () => {
    mockGetSmsDeliveryStats.mockResolvedValue({ error: 'Refresh failed' })
    mockGetDeliveryFailureReport.mockResolvedValue({ customers: [] })

    render(
      <SmsDeliveryClient
        initialStats={baseStats}
        initialFailedCustomers={[]}
        initialError={null}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /refresh/i }))

    await waitFor(() => {
      expect(mockGetSmsDeliveryStats).toHaveBeenCalled()
      expect(screen.getByText('Refresh failed')).toBeInTheDocument()
    })
  })
})
