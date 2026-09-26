// The staff portal's shift acceptance line, in both test zones.
//
// The accepted time was formatted without a time zone. The portal page renders on the server,
// which runs in UTC, so during British Summer Time a shift accepted at 00:30 read as 23:30 the
// day before. It must be the London wall-clock time.
//
// 23:30 UTC on 1 October 2026 is 00:30 BST on 2 October in London, but 1 October in UTC.
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import ShiftDecisionControls from '@/app/(staff-portal)/portal/shifts/ShiftDecisionControls'

vi.mock('@/app/actions/rota', () => ({
  acceptPortalShift: vi.fn(),
  rejectPortalShift: vi.fn(),
}))

vi.mock('react-hot-toast', () => ({
  default: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

describe('ShiftDecisionControls London time', () => {
  it('shows when the shift was accepted on the London clock', () => {
    render(
      <ShiftDecisionControls
        shiftId="shift-1"
        acceptanceStatus="accepted"
        acceptedAt="2026-10-01T23:30:00Z"
        autoAcceptReason={null}
        autoAcceptDeadline="Sun 4 Oct 2026 5pm"
      />,
    )

    expect(screen.getByText('Accepted 2 Oct, 00:30')).toBeInTheDocument()
  })

  it('shows when the shift was auto-accepted on the London clock', () => {
    render(
      <ShiftDecisionControls
        shiftId="shift-1"
        acceptanceStatus="auto_accepted"
        // 18:05 BST in London; 17:05 in UTC.
        acceptedAt="2026-10-01T17:05:00Z"
        autoAcceptReason="No response before the deadline."
        autoAcceptDeadline="Sun 4 Oct 2026 5pm"
      />,
    )

    expect(screen.getByText('Auto-accepted 1 Oct, 18:05')).toBeInTheDocument()
  })
})
