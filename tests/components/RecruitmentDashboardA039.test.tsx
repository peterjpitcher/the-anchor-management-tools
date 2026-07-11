import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import RecruitmentDashboardClient from '@/app/(authenticated)/recruitment/_components/RecruitmentDashboardClient'
import { scheduleRecruitmentInterviewForCandidateAction } from '@/app/actions/recruitment'

vi.mock('@/app/actions/recruitment', () => {
  const ok = vi.fn().mockResolvedValue({ success: true, message: 'Done.' })
  return {
    addRecruitmentCandidateNoteAction: ok,
    archiveRecruitmentApplicationAction: ok,
    archiveRecruitmentAppointmentAction: ok,
    archiveRecruitmentSlotAction: ok,
    bulkRecruitmentApplicationsAction: ok,
    cancelRecruitmentAppointmentAction: ok,
    cancelRecruitmentSlotAction: ok,
    createManualRecruitmentApplicationAction: ok,
    createRecruitmentPostingAction: ok,
    createRecruitmentSlotAction: ok,
    decideRecruitmentApplicationAction: ok,
    draftRecruitmentEmailAction: ok,
    duplicateRecruitmentPostingAction: ok,
    eraseRecruitmentCandidateAction: ok,
    exportRecruitmentApplicationsCsvAction: ok,
    getRecruitmentCandidates: vi.fn().mockResolvedValue({ success: true, candidates: [], total: 0 }),
    getRecruitmentCandidateTrailAction: vi.fn().mockResolvedValue({ success: true, data: { notes: [], systemChanges: [] } }),
    getRecruitmentCvUrlAction: ok,
    getRecruitmentPrintableKitAction: ok,
    issueRecruitmentBookingInviteAction: ok,
    inviteRecruitmentCandidateAsEmployeeAction: ok,
    matchRecruitmentCandidateAction: ok,
    previewRecruitmentDecisionEmailAction: vi.fn().mockResolvedValue({ success: true, data: { subject: '', body: '' } }),
    recordRecruitmentScorecardAction: ok,
    recordRecruitmentAppointmentOutcomeAction: ok,
    rescheduleRecruitmentAppointmentAction: ok,
    restoreRecruitmentApplicationAction: ok,
    restoreRecruitmentAppointmentAction: ok,
    restoreRecruitmentSlotAction: ok,
    rescoreRecruitmentApplicationAction: ok,
    retryRecruitmentCommunicationAction: ok,
    retryManualReviewCvsAction: ok,
    retryRecruitmentCvExtractionAction: ok,
    runRecruitmentRetentionAction: ok,
    saveRecruitmentEmailTemplateAction: ok,
    scheduleRecruitmentInterviewForCandidateAction: ok,
    scheduleRecruitmentTrialForCandidateAction: ok,
    sendRecruitmentDecisionEmailAction: ok,
    transitionRecruitmentStatusAction: ok,
    updateRecruitmentCandidateAction: ok,
    updateRecruitmentPostingAction: ok,
    updateRecruitmentSlotAction: ok,
  }
})

function makeInitialData() {
  return {
    applications: Array.from({ length: 30 }, (_, index) => ({
      id: `application-${index + 1}`,
      status: 'new',
      source: 'website',
      created_at: `2026-06-${String(30 - index).padStart(2, '0')}T10:00:00.000Z`,
      candidate_id: `candidate-${index + 1}`,
      candidate: {
        id: `candidate-${index + 1}`,
        first_name: `Candidate ${index + 1}`,
        last_name: 'Test',
        email: `candidate${index + 1}@example.com`,
        phone: null,
      },
      job_posting: { id: 'posting-1', title: 'Bartender', version: 1 },
      job_posting_id: 'posting-1',
      ai_score: index,
      ai_recommendation: null,
    })),
    postings: [{ id: 'posting-1', title: 'Bartender' }],
    slots: [],
    appointments: [],
    candidates: [],
    communications: [],
    templates: [],
    scorecards: [],
    statusEvents: [],
    aiRuns: [],
    dashboard: { actionItems: [] },
  }
}

const permissions = {
  canView: true,
  canCreate: true,
  canEdit: true,
  canDelete: true,
  canManage: true,
  canExport: true,
  canSend: true,
}

describe('RecruitmentDashboardClient A-039', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('paginates the applications table at 25 rows', () => {
    render(<RecruitmentDashboardClient initialData={makeInitialData()} permissions={permissions} />)

    fireEvent.click(screen.getByRole('tab', { name: /Applications/i }))

    expect(screen.getByText('Candidate 30 Test')).toBeInTheDocument()
    expect(screen.queryByText('Candidate 1 Test')).not.toBeInTheDocument()
    expect(screen.getByText('Showing 1-25 of 30')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '2' }))

    expect(screen.getByText('Candidate 1 Test')).toBeInTheDocument()
  })

  it('keeps every populated in-progress status visible on the pipeline', () => {
    const data = makeInitialData()
    data.applications = [
      { ...data.applications[0], status: 'interviewed' },
      { ...data.applications[1], status: 'trial_completed' },
      { ...data.applications[2], status: 'on_hold' },
    ]

    render(<RecruitmentDashboardClient initialData={data} permissions={permissions} />)

    expect(screen.getByRole('heading', { name: 'interviewed' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'trial completed' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'on hold' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'new' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'offered' })).not.toBeInTheDocument()
    expect(screen.getByText('Candidate 1 Test')).toBeInTheDocument()
    expect(screen.getByText('Candidate 2 Test')).toBeInTheDocument()
    expect(screen.getByText('Candidate 3 Test')).toBeInTheDocument()
  })

  it('does not add completed outcome columns to the active pipeline', () => {
    const data = makeInitialData()
    data.applications = [
      { ...data.applications[0], status: 'hired' },
      { ...data.applications[1], status: 'rejected' },
      { ...data.applications[2], status: 'withdrawn' },
    ]

    render(<RecruitmentDashboardClient initialData={data} permissions={permissions} />)

    expect(screen.queryByRole('heading', { name: 'hired' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'rejected' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'withdrawn' })).not.toBeInTheDocument()
  })

  it('requires confirmation before erasing a candidate', () => {
    const data = makeInitialData()
    data.candidates = [{
      id: 'candidate-erase',
      first_name: 'Delete',
      last_name: 'Me',
      email: 'delete@example.com',
      cv_extraction_status: 'done',
      sms_consent: false,
      future_recruitment_consent: false,
      converted_employee_id: null,
      anonymised_at: null,
    }]
    data.candidatesTotal = 1

    render(<RecruitmentDashboardClient initialData={data} permissions={permissions} />)

    fireEvent.click(screen.getByRole('tab', { name: /Talent pool/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Erase' }))

    expect(screen.getByRole('dialog', { name: 'Erase candidate' })).toBeInTheDocument()
    expect(screen.getByText('This permanently anonymises the candidate record. Continue?')).toBeInTheDocument()
  })

  it('uses explicit quarter-hour slot time controls and defaults close time two hours later', () => {
    const { container } = render(<RecruitmentDashboardClient initialData={makeInitialData()} permissions={permissions} />)

    fireEvent.click(screen.getByRole('tab', { name: /Schedule/i }))

    const startsAt = container.querySelector<HTMLInputElement>('input[name="starts_at"]')
    const endsAt = container.querySelector<HTMLInputElement>('input[name="ends_at"]')
    const opensDate = screen.getByLabelText('Opens date')
    const opensHour = screen.getByLabelText('Opens hour')
    const opensMinute = screen.getByLabelText('Opens minute')

    expect(startsAt).not.toBeNull()
    expect(endsAt).not.toBeNull()
    expect(Array.from((opensHour as HTMLSelectElement).options).map((option) => option.textContent)).toContain('9am')
    expect(Array.from((opensHour as HTMLSelectElement).options).map((option) => option.textContent)).toContain('3pm')
    expect(Array.from((opensMinute as HTMLSelectElement).options).map((option) => option.value)).toEqual(['', '00', '15', '30', '45'])

    fireEvent.change(opensDate, { target: { value: '2099-01-01' } })
    fireEvent.change(opensHour, { target: { value: '10' } })
    fireEvent.change(opensMinute, { target: { value: '15' } })

    expect(startsAt?.value).toBe('2099-01-01T10:15')
    expect(endsAt?.value).toBe('2099-01-01T12:15')
  })

  it('shows slot opens and closes times in the schedule table', () => {
    const data = makeInitialData()
    data.slots = [{
      id: 'slot-1',
      type: 'interview',
      starts_at: '2026-07-01T11:00:00.000Z',
      ends_at: '2026-07-01T13:00:00.000Z',
      location: 'The Anchor',
      status: 'open',
      archived_at: null,
    }]

    render(<RecruitmentDashboardClient initialData={data} permissions={permissions} />)

    fireEvent.click(screen.getByRole('tab', { name: /Schedule/i }))

    expect(screen.getByRole('columnheader', { name: 'Opens' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Closes' })).toBeInTheDocument()
    expect(screen.getByText('Wed, 1 Jul 2026, 12:00')).toBeInTheDocument()
    expect(screen.getByText('Wed, 1 Jul 2026, 14:00')).toBeInTheDocument()
  })

  it('lets managers schedule an interview from the candidate drawer', () => {
    const data = makeInitialData()
    data.applications = [{
      ...data.applications[0],
      status: 'interview_invited',
    }]
    data.slots = [{
      id: 'slot-1',
      type: 'interview',
      starts_at: '2099-07-02T12:00:00.000Z',
      ends_at: '2099-07-02T13:00:00.000Z',
      location: 'The Anchor',
      status: 'open',
      archived_at: null,
    }]

    render(<RecruitmentDashboardClient initialData={data} permissions={permissions} />)

    fireEvent.click(screen.getByRole('button', { name: /Candidate 1 Test/i }))

    expect(screen.getByText('Schedule interview for candidate')).toBeInTheDocument()
    expect(screen.getByLabelText('Interview slot to schedule')).toHaveValue('slot-1')
    expect(screen.getByRole('button', { name: 'Schedule interview' })).toBeInTheDocument()
  })

  it('confirms, then submits the schedule interview action with the chosen slot', async () => {
    const data = makeInitialData()
    data.applications = [{
      ...data.applications[0],
      status: 'interview_invited',
    }]
    data.slots = [{
      id: 'slot-1',
      type: 'interview',
      starts_at: '2099-07-02T12:00:00.000Z',
      ends_at: '2099-07-02T13:00:00.000Z',
      location: 'The Anchor',
      status: 'open',
      archived_at: null,
    }]

    render(<RecruitmentDashboardClient initialData={data} permissions={permissions} />)
    fireEvent.click(screen.getByRole('button', { name: /Candidate 1 Test/i }))

    fireEvent.click(screen.getByRole('button', { name: 'Schedule interview' }))

    // A confirmation step gates the action (it emails the candidate + books a calendar slot).
    expect(scheduleRecruitmentInterviewForCandidateAction).not.toHaveBeenCalled()
    const dialog = await screen.findByRole('dialog', { name: 'Schedule interview' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm' }))

    await waitFor(() => expect(scheduleRecruitmentInterviewForCandidateAction).toHaveBeenCalledTimes(1))
    const formData = (scheduleRecruitmentInterviewForCandidateAction as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as FormData
    expect(formData.get('application_id')).toBe('application-1')
    expect(formData.get('slot_id')).toBe('slot-1')
  })
})
