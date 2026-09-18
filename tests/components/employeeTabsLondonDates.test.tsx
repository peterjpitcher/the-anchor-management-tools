// Employee tabs around midnight, in both test zones.
//
// The pay tab took "today" from the UTC clock, so from midnight to 1am British Summer Time a
// rate starting that day still read as upcoming (and editable). The right-to-work tab compared
// a date-only follow-up with the current instant, so the follow-up warning appeared an hour
// late. Several tabs also formatted dates without a time zone, or without a locale, so what
// staff saw depended on the device or server the code ran on. Every date on these tabs is now
// a London date, and the wording and format are unchanged.
//
// Instants are written in UTC so the file reads the same in both test zones: 23:30 UTC on
// 17 September 2026 is 00:30 BST on Friday 18 September in London, but still Thursday in UTC.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import EmployeePayTab from '@/components/features/employees/EmployeePayTab'
import OnboardingChecklistTab from '@/components/features/employees/OnboardingChecklistTab'
import EmployeeHolidaysTab from '@/components/features/employees/EmployeeHolidaysTab'
import EmployeeReliabilityTab from '@/components/features/employees/EmployeeReliabilityTab'
import RightToWorkTab from '@/components/features/employees/RightToWorkTab'
import { EmployeeAuditTrail } from '@/components/features/employees/EmployeeAuditTrail'
import type { EmployeeRateOverride } from '@/app/actions/pay-bands'
import type { LeaveRequest } from '@/app/actions/leave'
import type { AuditLogEntry } from '@/app/actions/employeeDetails'
import type { EmployeeReliabilityData } from '@/services/employee-reliability'
import type { EmployeeReliabilityEvent, ReliabilityScoreBreakdown } from '@/lib/employee-reliability-scoring'
import type { EmployeeRightToWork } from '@/types/database'

const getOnboardingProgressMock = vi.hoisted(() => vi.fn())

vi.mock('@/app/actions/pay-bands', () => ({
  upsertEmployeePaySettings: vi.fn(),
  addEmployeeRateOverride: vi.fn(),
  updateEmployeeRateOverride: vi.fn(),
}))

vi.mock('@/app/actions/leave', () => ({
  bookApprovedHoliday: vi.fn(),
}))

vi.mock('@/app/actions/employeeActions', () => ({
  getOnboardingProgress: getOnboardingProgressMock,
  updateOnboardingChecklist: vi.fn(),
  createRightToWorkDocumentUploadUrl: vi.fn(),
  deleteRightToWorkPhoto: vi.fn(),
  getRightToWorkPhotoUrl: vi.fn(),
  upsertRightToWork: vi.fn(),
}))

vi.mock('@/components/providers/SupabaseProvider', () => ({
  useSupabase: () => ({}),
}))

const EMPLOYEE_ID = '00000000-0000-4000-8000-000000000001'

// 00:30 BST on Friday 18 September 2026 in London; Thursday 17 September in UTC.
const JUST_AFTER_MIDNIGHT_BST = '2026-09-17T23:30:00Z'
// 23:30 BST on Thursday 17 September 2026: the same day in London and in UTC.
const JUST_BEFORE_MIDNIGHT_BST = '2026-09-17T22:30:00Z'

function at(isoInstant: string) {
  vi.setSystemTime(new Date(isoInstant))
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('EmployeePayTab rate overrides', () => {
  const startsToday: EmployeeRateOverride = {
    id: 'override-september',
    employee_id: EMPLOYEE_ID,
    hourly_rate: 13.5,
    effective_from: '2026-09-18',
    created_at: '2026-09-01T10:00:00+00:00',
  }
  const earlier: EmployeeRateOverride = {
    id: 'override-april',
    employee_id: EMPLOYEE_ID,
    hourly_rate: 12.21,
    effective_from: '2026-04-01',
    created_at: '2026-03-20T10:00:00+00:00',
  }

  function renderPayTab() {
    render(
      <EmployeePayTab
        employeeId={EMPLOYEE_ID}
        canEdit
        initialPaySettings={null}
        initialOverrides={[startsToday, earlier]}
        currentRate={null}
      />
    )
  }

  function overrideRow(rateLabel: string) {
    const row = screen.getByText(rateLabel).closest('tr')
    if (!row) throw new Error(`No override row shows ${rateLabel}`)
    return within(row)
  }

  it('treats a rate starting today as current from midnight, London time', () => {
    at(JUST_AFTER_MIDNIGHT_BST)
    renderPayTab()

    expect(overrideRow('£13.50/hr').getByText('Current')).toBeInTheDocument()
    expect(overrideRow('£13.50/hr').queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()
    expect(overrideRow('£12.21/hr').getByText('Historical')).toBeInTheDocument()
  })

  it('keeps it upcoming, and editable, until midnight', () => {
    at(JUST_BEFORE_MIDNIGHT_BST)
    renderPayTab()

    expect(overrideRow('£13.50/hr').getByText('Upcoming')).toBeInTheDocument()
    expect(overrideRow('£13.50/hr').getByRole('button', { name: 'Edit' })).toBeInTheDocument()
    expect(overrideRow('£12.21/hr').getByText('Current')).toBeInTheDocument()
  })

  it('shows each effective date as the calendar date stored', () => {
    at(JUST_AFTER_MIDNIGHT_BST)
    renderPayTab()

    expect(overrideRow('£13.50/hr').getByText('18 Sept 2026')).toBeInTheDocument()
    expect(overrideRow('£12.21/hr').getByText('1 Apr 2026')).toBeInTheDocument()
  })
})

describe('RightToWorkTab follow-up check', () => {
  const rightToWork: EmployeeRightToWork = {
    employee_id: EMPLOYEE_ID,
    document_type: 'Passport',
    check_method: 'manual',
    document_reference: null,
    document_details: null,
    verification_date: '2026-03-02',
    document_expiry_date: '2031-05-01',
    follow_up_date: '2026-09-18',
    verified_by_user_id: null,
    photo_storage_path: null,
    created_at: '2026-03-02T10:00:00+00:00',
    updated_at: '2026-03-02T10:00:00+00:00',
  }

  function renderRightToWorkTab() {
    render(
      <RightToWorkTab
        employeeId={EMPLOYEE_ID}
        rightToWork={rightToWork}
        canEdit={false}
        canViewDocuments={false}
      />
    )
  }

  it('asks for the follow-up from midnight on the day it is due, London time', () => {
    at(JUST_AFTER_MIDNIGHT_BST)
    renderRightToWorkTab()

    expect(screen.getByText('Follow-up Required')).toBeInTheDocument()
    expect(screen.getByText('A follow-up check was due on 18/09/2026.')).toBeInTheDocument()
    expect(screen.queryByText('Right to Work Verified')).not.toBeInTheDocument()
  })

  it('does not ask for it the evening before', () => {
    at(JUST_BEFORE_MIDNIGHT_BST)
    renderRightToWorkTab()

    expect(screen.queryByText('Follow-up Required')).not.toBeInTheDocument()
    expect(screen.getByText('Right to Work Verified')).toBeInTheDocument()
  })
})

describe('OnboardingChecklistTab completion dates', () => {
  type ChecklistItem = { field: string; label: string; completed: boolean; date: string | null }

  function checklistReturns(items: ChecklistItem[]) {
    const completed = items.filter(item => item.completed).length
    getOnboardingProgressMock.mockResolvedValue({
      data: {
        completed,
        total: items.length,
        percentage: Math.round((completed / items.length) * 100),
        items,
        data: null,
      },
    })
  }

  async function completedLine(label: string) {
    const item = (await screen.findByText(label)).closest('li')
    if (!item) throw new Error(`No checklist item for ${label}`)
    return within(item)
  }

  it('shows each date in UK format, on the London day it was recorded', async () => {
    at(JUST_AFTER_MIDNIGHT_BST)
    checklistReturns([
      // A date column, stamped with the London date when the task was ticked.
      { field: 'till_system_setup', label: 'Till System Setup', completed: true, date: '2026-09-18' },
      // A timestamp column: the agreement was accepted at 00:30 BST on 18 September.
      {
        field: 'employee_agreement_accepted',
        label: 'Employee Agreement Accepted',
        completed: true,
        date: '2026-09-17T23:30:00+00:00',
      },
      { field: 'training_flow_setup', label: 'Training in Flow Setup', completed: false, date: null },
    ])
    render(<OnboardingChecklistTab employeeId={EMPLOYEE_ID} canEdit={false} />)

    expect((await completedLine('Till System Setup')).getByText('Completed on 18/09/2026')).toBeInTheDocument()
    expect((await completedLine('Employee Agreement Accepted')).getByText('Completed on 18/09/2026')).toBeInTheDocument()
    expect((await completedLine('Training in Flow Setup')).queryByText(/Completed on/)).not.toBeInTheDocument()
  })

  it('does not move a late winter acceptance, when London is on UTC', async () => {
    at('2026-01-15T09:00:00Z')
    checklistReturns([
      {
        field: 'employee_agreement_accepted',
        label: 'Employee Agreement Accepted',
        completed: true,
        date: '2026-01-14T23:30:00+00:00',
      },
    ])
    render(<OnboardingChecklistTab employeeId={EMPLOYEE_ID} canEdit={false} />)

    expect((await completedLine('Employee Agreement Accepted')).getByText('Completed on 14/01/2026')).toBeInTheDocument()
  })
})

describe('EmployeeReliabilityTab event dates', () => {
  const score: ReliabilityScoreBreakdown = {
    score: 100,
    isLowSample: true,
    counts: {
      manualAccepts: 0,
      autoAccepts: 0,
      rejections: 0,
      lateRejectionAttempts: 0,
      couldntWork: 0,
      holidayRequests: 0,
      holidayApproved: 0,
      lateHolidays: 0,
      holidayConflicts: 0,
      eligibleShiftSignals: 0,
      manualResponseSignals: 0,
    },
    components: { acceptance: 45, responseSpeed: 10, disruptionDiscipline: 35, holidayNoticeImpact: 10 },
    rates: { manualAcceptRate: null, rejectionRate: null, responseRate: null },
    averageResponseHours: null,
  }

  function reliabilityEvent(overrides: Partial<EmployeeReliabilityEvent>): EmployeeReliabilityEvent {
    return {
      id: 'event-1',
      employee_id: EMPLOYEE_ID,
      event_type: 'couldnt_work',
      event_at: '2026-09-17T23:30:00+00:00',
      source: 'rota',
      source_table: null,
      source_id: null,
      idempotency_key: 'event-1',
      shift_id: null,
      leave_request_id: null,
      week_id: null,
      shift_date: null,
      start_time: null,
      end_time: null,
      department: null,
      shift_name: null,
      leave_start_date: null,
      leave_end_date: null,
      leave_day_count: null,
      published_at: null,
      notice_days: null,
      impacted_shift_count: 0,
      score_eligible: true,
      note: null,
      metadata: null,
      created_at: '2026-09-17T23:30:00+00:00',
      ...overrides,
    }
  }

  function renderReliabilityTab(events: EmployeeReliabilityEvent[]) {
    const reliability: EmployeeReliabilityData = { employeeId: EMPLOYEE_ID, recent: score, allTime: score, events }
    render(<EmployeeReliabilityTab reliability={reliability} />)
  }

  it('shows when an event happened in London time, just after midnight in summer', () => {
    at(JUST_AFTER_MIDNIGHT_BST)
    renderReliabilityTab([
      reliabilityEvent({
        event_at: '2026-09-17T23:30:00+00:00',
        shift_date: '2026-09-18',
        start_time: '09:00:00',
        end_time: '17:00:00',
      }),
    ])

    expect(screen.getByText('18 Sept 2026, 00:30')).toBeInTheDocument()
    expect(screen.getByText('Shift: 18 Sept 2026 9am-5pm')).toBeInTheDocument()
  })

  it('does not move a winter event, when London is on UTC', () => {
    at('2026-01-15T09:00:00Z')
    renderReliabilityTab([reliabilityEvent({ event_at: '2026-01-14T23:30:00+00:00' })])

    expect(screen.getByText('14 Jan 2026, 23:30')).toBeInTheDocument()
  })

  it('shows holiday dates as the calendar dates booked', () => {
    at(JUST_AFTER_MIDNIGHT_BST)
    renderReliabilityTab([
      reliabilityEvent({
        event_type: 'holiday_approved',
        leave_start_date: '2026-09-18',
        leave_end_date: '2026-09-21',
      }),
    ])

    expect(screen.getByText('Holiday: 18 Sept 2026 to 21 Sept 2026')).toBeInTheDocument()
  })
})

describe('EmployeeHolidaysTab request dates', () => {
  it('shows a booked holiday as the calendar dates booked', () => {
    at(JUST_AFTER_MIDNIGHT_BST)
    const holiday: LeaveRequest = {
      id: 'leave-1',
      employee_id: EMPLOYEE_ID,
      start_date: '2026-09-18',
      end_date: '2026-09-21',
      note: null,
      status: 'approved',
      manager_note: null,
      reviewed_by: null,
      reviewed_at: null,
      holiday_year: 2026,
      created_at: '2026-08-01T10:00:00+00:00',
      updated_at: '2026-08-01T10:00:00+00:00',
    }
    render(
      <EmployeeHolidaysTab
        employeeId={EMPLOYEE_ID}
        canCreateLeave={false}
        leaveRequests={[holiday]}
        leaveDays={[]}
        paySettings={null}
        rotaSettings={{ holidayYearStartMonth: 1, holidayYearStartDay: 1, defaultHolidayDays: 28 }}
      />
    )

    expect(screen.getByText('18 Sept 2026 – 21 Sept 2026')).toBeInTheDocument()
  })
})

describe('EmployeeAuditTrail shift and holiday dates', () => {
  function auditLog(overrides: Partial<AuditLogEntry>): AuditLogEntry {
    return {
      id: 'audit-1',
      created_at: '2026-09-17T23:30:00+00:00',
      user_email: 'manager@example.com',
      operation_type: 'update',
      resource_type: 'employee',
      resource_id: EMPLOYEE_ID,
      operation_status: 'success',
      old_values: null,
      new_values: null,
      additional_info: null,
      ...overrides,
    }
  }

  it('shows the dates a log refers to as the calendar dates recorded', () => {
    at(JUST_AFTER_MIDNIGHT_BST)
    render(
      <EmployeeAuditTrail
        employeeId={EMPLOYEE_ID}
        canViewAudit
        auditLogs={[
          auditLog({
            id: 'audit-sick',
            created_at: '2026-09-17T23:30:00+00:00',
            additional_info: {
              action: 'mark_shift_sick',
              shift_date: '2026-09-18',
              start_time: '09:00:00',
              end_time: '17:00:00',
              sick_reason: 'Unwell',
            },
          }),
          auditLog({
            id: 'audit-holiday',
            created_at: '2026-09-17T22:00:00+00:00',
            additional_info: { action: 'holiday_approved', start_date: '2026-09-18', end_date: '2026-09-21' },
          }),
        ]}
      />
    )

    expect(screen.getByText('18 Sept 2026, 00:30')).toBeInTheDocument()
    expect(screen.getByText('Shift: 18 Sept 2026 09:00-17:00 • Reason: Unwell')).toBeInTheDocument()
    expect(screen.getByText('17 Sept 2026, 23:00')).toBeInTheDocument()
    expect(screen.getByText('Holiday: 18 Sept 2026 to 21 Sept 2026')).toBeInTheDocument()
  })
})
