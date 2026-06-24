import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import RecruitmentDashboardClient from '@/app/(authenticated)/recruitment/_components/RecruitmentDashboardClient'

vi.mock('@/app/actions/recruitment', () => {
  const ok = vi.fn().mockResolvedValue({ success: true, message: 'Done.' })
  return {
    archiveRecruitmentApplicationAction: ok,
    archiveRecruitmentAppointmentAction: ok,
    archiveRecruitmentSlotAction: ok,
    bulkRecruitmentApplicationsAction: ok,
    cancelRecruitmentAppointmentAction: ok,
    cancelRecruitmentSlotAction: ok,
    createManualRecruitmentApplicationAction: ok,
    createRecruitmentPostingAction: ok,
    createRecruitmentSlotAction: ok,
    draftRecruitmentEmailAction: ok,
    duplicateRecruitmentPostingAction: ok,
    eraseRecruitmentCandidateAction: ok,
    exportRecruitmentApplicationsCsvAction: ok,
    getRecruitmentCandidates: vi.fn().mockResolvedValue({ success: true, candidates: [], total: 0 }),
    getRecruitmentCvUrlAction: ok,
    getRecruitmentPrintableKitAction: ok,
    issueRecruitmentBookingInviteAction: ok,
    inviteRecruitmentCandidateAsEmployeeAction: ok,
    matchRecruitmentCandidateAction: ok,
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

    fireEvent.click(screen.getByRole('button', { name: /Applications/i }))

    expect(screen.getByText('Candidate 30 Test')).toBeInTheDocument()
    expect(screen.queryByText('Candidate 1 Test')).not.toBeInTheDocument()
    expect(screen.getByText('Showing 1-25 of 30')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '2' }))

    expect(screen.getByText('Candidate 1 Test')).toBeInTheDocument()
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

    fireEvent.click(screen.getByRole('button', { name: /Talent pool/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Erase' }))

    expect(screen.getByRole('dialog', { name: 'Erase candidate' })).toBeInTheDocument()
    expect(screen.getByText('This permanently anonymises the candidate record. Continue?')).toBeInTheDocument()
  })
})
