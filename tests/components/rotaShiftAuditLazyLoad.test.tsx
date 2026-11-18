// The rota page used to read up to 500 audit rows (with old and new values) and two name lookups
// on every view, only for the shift modal's "Shift Audit Trail" card. The modal now loads the
// history for its own shift when it opens, and loads it again after a save. The grid also no
// longer prefetches the weeks either side, which was two extra full page renders per view.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import ShiftDetailModal from '@/app/(authenticated)/rota/ShiftDetailModal'
import RotaGrid from '@/app/(authenticated)/rota/RotaGrid'
import type { RotaShift, RotaWeek, ShiftAuditTrailEntry } from '@/app/actions/rota'
import { getShiftAuditTrail, updateShift } from '@/app/actions/rota'

const routerMock = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
  prefetch: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => routerMock,
}))

vi.mock('@/app/actions/rota', () => ({
  addShiftsFromTemplates: vi.fn(),
  autoPopulateWeekFromTemplates: vi.fn(),
  createShift: vi.fn(),
  deleteShift: vi.fn(),
  getShiftAuditTrail: vi.fn(),
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

vi.mock('@/ds/primitives/Toast', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}))

const EMPLOYEE_ID = '00000000-0000-4000-8000-000000000001'
const OTHER_EMPLOYEE_ID = '00000000-0000-4000-8000-000000000002'

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
  acceptance_status: null,
  acceptance_decided_at: null,
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
  updated_at: '2026-09-20T10:00:00Z',
}

const reassignEntry: ShiftAuditTrailEntry = {
  id: 'audit-1',
  shift_id: 'shift-1',
  created_at: '2026-10-01T10:00:00Z',
  user_email: 'manager@example.com',
  user_id: 'user-9',
  user_name: 'Billy',
  operation_type: 'update',
  old_values: { employee_id: OTHER_EMPLOYEE_ID },
  new_values: { employee_id: EMPLOYEE_ID },
  additional_info: null,
}

function renderModal() {
  return render(
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
      canEdit
      departments={[]}
      auditValueLabels={{ [EMPLOYEE_ID]: 'Amanda Jones' }}
      onClose={vi.fn()}
      onUpdated={vi.fn()}
      onDeleted={vi.fn()}
    />,
  )
}

describe('ShiftDetailModal audit history', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('loads the history for its own shift when it opens and names both people', async () => {
    let resolveLoad: (value: Awaited<ReturnType<typeof getShiftAuditTrail>>) => void = () => {}
    vi.mocked(getShiftAuditTrail).mockReturnValueOnce(new Promise(resolve => { resolveLoad = resolve }))

    renderModal()

    expect(getShiftAuditTrail).toHaveBeenCalledTimes(1)
    expect(getShiftAuditTrail).toHaveBeenCalledWith('shift-1')
    // While loading, the card must not claim there is no history.
    expect(screen.getByText('Loading the change history')).toBeInTheDocument()
    expect(screen.queryByText('No changes yet')).not.toBeInTheDocument()

    resolveLoad({
      success: true,
      data: { entries: [reassignEntry], valueLabels: { [OTHER_EMPLOYEE_ID]: 'Sam Smith' } },
    })

    // The former employee's name comes from the server; the current one from the page.
    expect(await screen.findByText('Employee: Sam Smith -> Amanda Jones')).toBeInTheDocument()
    expect(screen.getByText('By Billy')).toBeInTheDocument()
    expect(screen.queryByText('Loading the change history')).not.toBeInTheDocument()
  })

  it('says the history could not be loaded rather than showing an empty history', async () => {
    vi.mocked(getShiftAuditTrail).mockResolvedValueOnce({ success: false, error: 'Permission denied' })

    renderModal()

    expect(await screen.findByText(/Could not load the change history/)).toBeInTheDocument()
    expect(screen.queryByText('No changes yet')).not.toBeInTheDocument()
  })

  it('shows "No changes yet" only once an empty history has loaded', async () => {
    vi.mocked(getShiftAuditTrail).mockResolvedValueOnce({ success: true, data: { entries: [], valueLabels: {} } })

    renderModal()

    expect(await screen.findByText('No changes yet')).toBeInTheDocument()
  })

  it('loads the history again after the shift is saved', async () => {
    vi.mocked(getShiftAuditTrail).mockResolvedValue({ success: true, data: { entries: [], valueLabels: {} } })
    vi.mocked(updateShift).mockResolvedValue({
      success: true,
      data: { ...shift, notes: 'Cover', updated_at: '2026-10-02T09:00:00Z' },
    })

    renderModal()
    await screen.findByText('No changes yet')
    expect(getShiftAuditTrail).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'Edit Shift' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Save Changes' }))

    await waitFor(() => expect(getShiftAuditTrail).toHaveBeenCalledTimes(2))
    expect(getShiftAuditTrail).toHaveBeenLastCalledWith('shift-1')
  })
})

describe('RotaGrid adjacent weeks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('does not prefetch the previous or next week, and loads no audit history', () => {
    const week: RotaWeek = {
      id: 'week-1',
      week_start: '2026-09-28',
      status: 'draft',
      published_at: null,
      published_by: null,
      has_unpublished_changes: false,
      created_at: '2026-09-20T10:00:00Z',
      updated_at: '2026-09-20T10:00:00Z',
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
        canEdit
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

    expect(routerMock.prefetch).not.toHaveBeenCalled()
    expect(getShiftAuditTrail).not.toHaveBeenCalled()
  })
})
