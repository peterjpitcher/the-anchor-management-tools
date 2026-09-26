// Rota timestamps, in both test zones.
//
// The shift detail modal formatted its acceptance, rejection and audit timestamps without a
// time zone, so they followed whichever zone the code ran in rather than the pub's clock. The
// rota grid's "published" date did the same, and the grid's first HTML is rendered on the
// server, which runs in UTC, so a week published late in the evening during British Summer
// Time showed the previous day. Every one of these is now a London date or time.
//
// Instants are written in UTC so the file reads the same in both zones: 23:30 UTC on
// 1 October 2026 is 00:30 BST on 2 October in London, but still 1 October in UTC.
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import ShiftDetailModal from '@/app/(authenticated)/rota/ShiftDetailModal'
import RotaGrid from '@/app/(authenticated)/rota/RotaGrid'
import type { RotaShift, RotaWeek, RejectedShiftRecord, ShiftAuditTrailEntry } from '@/app/actions/rota'

vi.mock('@/app/actions/rota', () => ({
  addShiftsFromTemplates: vi.fn(),
  autoPopulateWeekFromTemplates: vi.fn(),
  createShift: vi.fn(),
  deleteShift: vi.fn(),
  markEmployeeCouldntWork: vi.fn(),
  markShiftSick: vi.fn(),
  moveShift: vi.fn(),
  updateShift: vi.fn(),
  upsertRotaSalesTargetOverride: vi.fn(),
}))

vi.mock('@/app/actions/leave', () => ({
  bookApprovedHoliday: vi.fn(),
  deleteLeaveRequest: vi.fn(),
  getLeaveRequestById: vi.fn(),
  updateLeaveRequestDates: vi.fn(),
}))

vi.mock('react-hot-toast', () => ({
  default: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

const EMPLOYEE_ID = '00000000-0000-4000-8000-000000000001'

const shift: RotaShift = {
  id: 'shift-1',
  week_id: 'week-1',
  employee_id: EMPLOYEE_ID,
  template_id: null,
  shift_date: '2026-10-03',
  start_time: '17:00',
  end_time: '23:00',
  unpaid_break_minutes: 0,
  department: 'bar',
  status: 'scheduled',
  sick_reason: null,
  notes: null,
  is_overnight: false,
  is_open_shift: false,
  name: null,
  reassigned_from_id: null,
  reassigned_at: null,
  reassigned_by: null,
  reassignment_reason: null,
  acceptance_status: 'accepted',
  // 00:30 BST on 2 October in London; 23:30 on 1 October in UTC.
  acceptance_decided_at: '2026-10-01T23:30:00Z',
  acceptance_decided_by: null,
  acceptance_note: null,
  auto_accept_reason: null,
  auto_accept_warning_sent_at: null,
  rate_multiplier: null,
  rate_override: null,
  premium_reason: null,
  premium_start_time: null,
  premium_end_time: null,
  created_at: '2026-09-20T10:00:00Z',
  updated_at: '2026-10-01T23:30:00Z',
}

const rejection: RejectedShiftRecord = {
  id: 'rejection-1',
  shift_id: 'shift-1',
  employee_id: 'employee-2',
  week_id: 'week-1',
  shift_date: '2026-10-03',
  start_time: '17:00',
  end_time: '23:00',
  unpaid_break_minutes: 0,
  department: 'bar',
  notes: null,
  is_overnight: false,
  name: null,
  rejection_note: 'Away that weekend',
  // 18:05 BST on 1 October in London; 17:05 in UTC.
  rejected_at: '2026-10-01T17:05:00Z',
  rejected_by: null,
  created_at: '2026-10-01T17:05:00Z',
}

const auditEntry: ShiftAuditTrailEntry = {
  id: 'audit-1',
  shift_id: 'shift-1',
  // 00:10 BST on 3 October in London; 23:10 on 2 October in UTC.
  created_at: '2026-10-02T23:10:00Z',
  user_email: 'manager@example.com',
  user_id: null,
  user_name: 'Billy',
  operation_type: 'update',
  old_values: { notes: null },
  new_values: { notes: 'Cover for Sam' },
  additional_info: null,
}

describe('ShiftDetailModal London times', () => {
  function renderModal() {
    render(
      <ShiftDetailModal
        shift={shift}
        employee={{
          employee_id: EMPLOYEE_ID,
          first_name: 'Amanda',
          last_name: 'Jones',
          preferred_name: null,
          job_title: null,
          max_weekly_hours: null,
          is_active: true,
        }}
        acceptanceDeciderName="Amanda"
        canEdit={false}
        departments={[]}
        auditTrail={[auditEntry]}
        rejectionHistory={[rejection]}
        rejectedEmployeeNames={{ 'employee-2': 'Sam Smith' }}
        onClose={vi.fn()}
        onUpdated={vi.fn()}
        onDeleted={vi.fn()}
      />,
    )
  }

  it('shows when the shift was accepted on the London clock', () => {
    renderModal()

    expect(screen.getByText('2 Oct 2026, 00:30 by Amanda')).toBeInTheDocument()
  })

  it('shows when the shift was rejected on the London clock', () => {
    renderModal()

    expect(screen.getByText('1 Oct 2026, 18:05')).toBeInTheDocument()
  })

  it('shows audit trail entries on the London clock', () => {
    renderModal()

    expect(screen.getByText('3 Oct 2026, 00:10')).toBeInTheDocument()
  })
})

describe('RotaGrid London published date', () => {
  it('shows the London day a week was published', () => {
    const week: RotaWeek = {
      id: 'week-1',
      week_start: '2026-09-28',
      status: 'published',
      // 00:30 BST on 2 October in London; 23:30 on 1 October in UTC.
      published_at: '2026-10-01T23:30:00Z',
      published_by: null,
      has_unpublished_changes: false,
      created_at: '2026-09-20T10:00:00Z',
      updated_at: '2026-10-01T23:30:00Z',
    }

    render(
      <RotaGrid
        week={week}
        shifts={[]}
        publishedShifts={[]}
        employees={[]}
        templates={[]}
        leaveDays={[]}
        weekStart="2026-09-28"
        days={['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04']}
        canEdit={false}
        canViewLeave={false}
        canCreateLeave={false}
        canEditLeave={false}
        departments={[]}
        dayInfo={{}}
        periodSummary={null}
        canViewSpend={false}
        canViewSalesTargets={false}
        canEditSalesTargets={false}
      />,
    )

    expect(screen.getByText('02/10/2026')).toBeInTheDocument()
    expect(screen.queryByText('01/10/2026')).not.toBeInTheDocument()
  })
})
