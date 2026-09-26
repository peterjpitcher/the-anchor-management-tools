import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import {
  REFUND_STATUS_TONE,
  RefundHistoryTable,
} from '@/components/features/invoices/RefundHistoryTable'
import { RefundHistoryTable as ParkingRefundHistoryTable } from '@/app/(authenticated)/parking/_components/RefundHistoryTable'
import { RefundDialog as ParkingRefundDialog } from '@/app/(authenticated)/parking/_components/RefundDialog'
import { RefundDialog } from '@/components/features/invoices/RefundDialog'

const mockGetRefundHistory = vi.fn()

vi.mock('@/app/actions/refundActions', () => ({
  getRefundHistory: (...args: unknown[]) => mockGetRefundHistory(...args),
  processPayPalRefund: vi.fn(),
  processManualRefund: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}))

const refunds = [
  {
    id: 'refund-completed-1',
    amount: 10,
    refund_method: 'paypal',
    status: 'completed',
    reason: 'Guest cancelled',
    paypal_refund_id: 'PP-123',
    initiated_by_type: 'staff',
    created_at: '2026-09-01T10:00:00.000Z',
    completed_at: '2026-09-01T10:00:05.000Z',
    failure_message: null,
  },
  {
    id: 'refund-pending-1',
    amount: 5,
    refund_method: 'bank_transfer',
    status: 'pending',
    reason: null,
    paypal_refund_id: null,
    initiated_by_type: 'staff',
    created_at: '2026-09-02T10:00:00.000Z',
    completed_at: null,
    failure_message: null,
  },
]

describe('RefundHistoryTable (shared by parking, private bookings and table bookings)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('has one status tone map', () => {
    expect(REFUND_STATUS_TONE).toEqual({ completed: 'success', pending: 'warning', failed: 'danger' })
  })

  it('draws its own titled card by default, with statuses, methods and totals', async () => {
    mockGetRefundHistory.mockResolvedValue({ data: refunds })
    render(<RefundHistoryTable sourceType="table_booking" sourceId="booking-1" />)

    expect(await screen.findByRole('heading', { name: 'Refund History' })).toBeInTheDocument()
    expect(screen.getByText('Completed')).toBeInTheDocument()
    expect(screen.getByText('Pending')).toBeInTheDocument()
    expect(screen.getByText('PayPal')).toBeInTheDocument()
    expect(screen.getByText('Bank Transfer')).toBeInTheDocument()
    expect(screen.getByText(/Refunded: £10\.00/)).toBeInTheDocument()
    expect(screen.getByText(/Pending: £5\.00/)).toBeInTheDocument()
    expect(mockGetRefundHistory).toHaveBeenCalledWith('table_booking', 'booking-1')
  })

  it('gives parking the bare table, because ParkingClient already titles the card', async () => {
    mockGetRefundHistory.mockResolvedValue({ data: refunds })
    render(<ParkingRefundHistoryTable sourceType="parking" sourceId="payment-1" />)

    expect(await screen.findByText('Completed')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Refund History' })).not.toBeInTheDocument()
  })

  it('shows a failed load as a failure, not as no refunds', async () => {
    mockGetRefundHistory.mockResolvedValue({ error: 'Database unavailable' })
    render(<RefundHistoryTable sourceType="private_booking" sourceId="booking-2" />)

    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to load refund history: Database unavailable')
  })

  it('renders nothing when there are no refunds', async () => {
    mockGetRefundHistory.mockResolvedValue({ data: [] })
    const { container } = render(<RefundHistoryTable sourceType="parking" sourceId="payment-2" />)

    await vi.waitFor(() => expect(mockGetRefundHistory).toHaveBeenCalled())
    await vi.waitFor(() => expect(container).toBeEmptyDOMElement())
  })
})

describe('RefundDialog', () => {
  it('parking re-exports the one shared dialog', () => {
    expect(ParkingRefundDialog).toBe(RefundDialog)
  })
})
