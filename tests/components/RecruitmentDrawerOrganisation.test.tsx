import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import RecruitmentDashboardClient from '@/app/(authenticated)/recruitment/_components/RecruitmentDashboardClient'

/**
 * Guards the candidate drawer's organisation.
 *
 * The drawer used to file its controls by data type, which put the action that
 * actually hires someone at the bottom of a fifth tab called "Profile", under a
 * heading called "Admin". These tests pin the replacement: four tabs named after
 * the question each answers, and one stage-aware action bar that is reachable
 * without changing tab.
 */

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
    getRecruitmentCandidateTrailAction: vi.fn().mockResolvedValue({
      success: true,
      data: {
        notes: [{ id: 'note-1', created_at: '2026-07-01T09:00:00.000Z', content: 'Rang her, keen on weekends', created_by_email: 'peter@example.com' }],
        systemChanges: [{ id: 'sys-1', at: '2026-07-01T08:00:00.000Z', operation_type: 'update', resource_type: 'recruitment_application', changed_keys: ['ai_score'], actor: 'system' }],
      },
    }),
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

const permissions = {
  canView: true,
  canCreate: true,
  canEdit: true,
  canDelete: true,
  canManage: true,
  canExport: true,
  canSend: true,
}

function makeInitialData(overrides: { status?: string; communications?: any[] } = {}) {
  return {
    applications: [{
      id: 'application-1',
      status: overrides.status ?? 'new',
      source: 'website',
      created_at: '2026-06-30T10:00:00.000Z',
      candidate_id: 'candidate-1',
      candidate: {
        id: 'candidate-1',
        first_name: 'Rowan',
        last_name: 'Blake',
        email: 'rowan@example.com',
        phone: '07700900123',
        right_to_work_status: 'verified',
        sms_consent: true,
        future_recruitment_consent: false,
        location: 'Stanwell Moor',
      },
      job_posting: { id: 'posting-1', title: 'Bartender', version: 1, requirements: 'Must be over 18' },
      job_posting_id: 'posting-1',
      ai_score: 82,
      ai_recommendation: 'interview',
      ai_rationale: 'Strong bar experience',
    }],
    postings: [{ id: 'posting-1', title: 'Bartender' }],
    slots: [],
    appointments: [],
    candidates: [],
    communications: overrides.communications ?? [],
    templates: [],
    scorecards: [],
    statusEvents: [],
    aiRuns: [],
    dashboard: { actionItems: [] },
  }
}

function openDrawer(data: ReturnType<typeof makeInitialData>) {
  render(<RecruitmentDashboardClient initialData={data} permissions={permissions} />)
  fireEvent.click(screen.getByRole('tab', { name: /Applications/i }))
  fireEvent.click(screen.getByRole('button', { name: /Rowan Blake/i }))
}

describe('recruitment candidate drawer organisation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('offers four tabs named after the question each answers', () => {
    openDrawer(makeInitialData())

    const dialog = screen.getByRole('dialog')
    for (const label of ['Candidate', 'Progress', 'Messages', 'Notes']) {
      expect(within(dialog).getByRole('tab', { name: new RegExp(`^${label}`) })).toBeInTheDocument()
    }
    expect(within(dialog).queryByRole('tab', { name: /^Overview/ })).not.toBeInTheDocument()
    expect(within(dialog).queryByRole('tab', { name: /^Profile/ })).not.toBeInTheDocument()
  })

  it('leads with the action the stage calls for', () => {
    openDrawer(makeInitialData({ status: 'new' }))
    expect(screen.getByRole('button', { name: 'Shortlist' })).toBeInTheDocument()
  })

  it('surfaces creating the employee invite for an offered candidate without changing tab', () => {
    // The headline problem: hiring someone used to sit at the bottom of the
    // fifth tab, under a heading called "Admin".
    openDrawer(makeInitialData({ status: 'offered' }))

    const hire = screen.getByRole('button', { name: 'Create employee invite' })
    expect(hire).toBeInTheDocument()

    fireEvent.click(hire)
    expect(screen.getByLabelText(/Job title for the employee invite/i)).toBeInTheDocument()
  })

  it('keeps the action bar on screen when the tab changes', () => {
    openDrawer(makeInitialData({ status: 'new' }))

    fireEvent.click(screen.getByRole('tab', { name: /^Notes/ }))
    expect(screen.getByRole('button', { name: 'Shortlist' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: /^Messages/ }))
    expect(screen.getByRole('button', { name: 'Shortlist' })).toBeInTheDocument()
  })

  it('shows what was actually sent to the candidate, body and all', () => {
    openDrawer(makeInitialData({
      communications: [{
        id: 'comm-1',
        application_id: 'application-1',
        candidate_id: 'candidate-1',
        type: 'interview_invite',
        channel: 'email',
        subject: 'Come and meet us at The Anchor',
        final_body: 'Hi Rowan, we would love to meet you on Tuesday.',
        delivery_status: 'sent',
        created_at: '2026-07-01T10:00:00.000Z',
        sent_at: '2026-07-01T10:00:00.000Z',
      }],
    }))

    fireEvent.click(screen.getByRole('tab', { name: /^Messages/ }))

    expect(screen.getByText('Come and meet us at The Anchor')).toBeInTheDocument()
    expect(screen.getByText('Hi Rowan, we would love to meet you on Tuesday.')).toBeInTheDocument()
  })

  it('leads the Notes tab with what people wrote and hides the machine trail', async () => {
    openDrawer(makeInitialData())

    fireEvent.click(screen.getByRole('tab', { name: /^Notes/ }))

    expect(await screen.findByText('Rang her, keen on weekends')).toBeInTheDocument()
    expect(screen.getByText(/Show system activity/)).toBeInTheDocument()
  })

  it('keeps the candidate profile editable from the Candidate tab', () => {
    openDrawer(makeInitialData())

    expect(screen.getByText('Edit candidate details')).toBeInTheDocument()
    expect(screen.getByLabelText(/Right to work checked at/i)).toBeInTheDocument()
  })
})
