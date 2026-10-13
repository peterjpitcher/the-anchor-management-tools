import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

// The panels import the workflow server actions; none is called by what is rendered here.
vi.mock('@/app/actions/privateBookingWorkflow', () => ({
  listDeductions: vi.fn(),
  proposeDeduction: vi.fn(),
  recordDeductionDiscussion: vi.fn(),
  decideDeduction: vi.fn(),
  listBookingSuppliers: vi.fn(),
  addBookingSupplier: vi.fn(),
  updateBookingSupplier: vi.fn(),
  setSupplierStatus: vi.fn(),
  setWaiverStatus: vi.fn(),
  uploadSignedWaiver: vi.fn(),
  setRiskStatus: vi.fn(),
  lockBookingRecord: vi.fn(),
  unlockBookingRecord: vi.fn(),
  logComplaint: vi.fn(),
  updateComplaint: vi.fn(),
  listComplaints: vi.fn(),
}))

import { WaiverRiskPanel, WorkflowStatusPanel } from '@/components/private-bookings/WorkflowPanels'
import type { PrivateBookingWithDetails } from '@/types/private-bookings'

/**
 * The booking page shows the food agreement status that applies, not only the one stored. A
 * booking with "Outside food" ticked and a stored "not required" (a tick made before the tick
 * counted, 13 October 2026) used to show no food agreement at all.
 */

function booking(extra: Record<string, unknown>): PrivateBookingWithDetails {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    risk_status: 'normal',
    supplier_status: 'not_applicable',
    outside_food: false,
    waiver_status: 'not_required',
    ...extra,
  } as unknown as PrivateBookingWithDetails
}

describe('the food agreement in the workflow status panel', () => {
  it('shows it as required for a booking with the tick on and a stored status of not required', () => {
    render(<WorkflowStatusPanel booking={booking({ outside_food: true, waiver_status: 'not_required' })} />)

    expect(screen.getByText('Self-catering waiver')).toBeInTheDocument()
    expect(screen.getByText('Required')).toBeInTheDocument()
  })

  it.each([
    ['required', 'Required'],
    ['sent', 'Sent'],
    ['overdue', 'Overdue'],
    ['signed', 'Signed'],
  ])('shows a stored status of %s as it is', (status, label) => {
    render(<WorkflowStatusPanel booking={booking({ outside_food: true, waiver_status: status })} />)

    expect(screen.getByText('Self-catering waiver')).toBeInTheDocument()
    expect(screen.getByText(label)).toBeInTheDocument()
  })

  it('shows nothing for a booking with no outside food and nothing else outstanding', () => {
    const { container } = render(<WorkflowStatusPanel booking={booking({})} />)
    expect(container).toBeEmptyDOMElement()
  })
})

describe('the food agreement in the waiver and risk panel', () => {
  it('shows it as required for a booking with the tick on and a stored status of not required', () => {
    render(<WaiverRiskPanel booking={booking({ outside_food: true, waiver_status: 'not_required' })} canManage={false} onChanged={() => undefined} />)

    expect(screen.getByText('Self-Catering Waiver')).toBeInTheDocument()
    expect(screen.getByText('Required')).toBeInTheDocument()
  })

  it('shows nothing to someone who cannot manage it, for a booking with no outside food', () => {
    const { container } = render(<WaiverRiskPanel booking={booking({})} canManage={false} onChanged={() => undefined} />)
    expect(container).toBeEmptyDOMElement()
  })
})
