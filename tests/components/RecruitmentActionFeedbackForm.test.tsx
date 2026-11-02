import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * What staff see after the hire dialog's form runs. A hire whose welcome email may have gone
 * comes back done but with a `warning`, and the dialog closes on success, so the warning has to
 * reach staff in a toast: a message under the form went away with the dialog before anyone read it.
 */

const toast = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  info: vi.fn(),
  loading: vi.fn(),
  dismiss: vi.fn(),
}))

vi.mock('@/ds', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/ds')>()
  return { ...actual, toast }
})

const hire = vi.hoisted(() => vi.fn())

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
    inviteRecruitmentCandidateAsEmployeeAction: (...args: unknown[]) => hire(...args),
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

import RecruitmentDashboardClient from '@/app/(authenticated)/recruitment/_components/RecruitmentDashboardClient'

const permissions = {
  canView: true,
  canCreate: true,
  canEdit: true,
  canDelete: true,
  canManage: true,
  canExport: true,
  canSend: true,
}

const initialData = {
  applications: [{
    id: 'application-1',
    status: 'offered',
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
  communications: [],
  templates: [],
  scorecards: [],
  statusEvents: [],
  aiRuns: [],
  dashboard: { actionItems: [] },
}

const MAY_HAVE_GONE =
  'The employee was created and the hire was completed. We sent the invite to rowan@example.com, but we did not hear back from the email service, so it may have gone. Check with them before sending it again.'

function hireForm(): HTMLFormElement | null {
  return document.getElementById('recruitment-hire-form') as HTMLFormElement | null
}

function submitHire(): void {
  render(<RecruitmentDashboardClient initialData={initialData} permissions={permissions} />)
  fireEvent.click(screen.getByRole('tab', { name: /Applications/i }))
  fireEvent.click(screen.getByRole('button', { name: /Rowan Blake/i }))
  fireEvent.click(screen.getByRole('button', { name: 'Create Employee Invite' }))
  fireEvent.change(screen.getByLabelText(/Job title for the employee invite/i), { target: { value: 'Bar staff' } })
  const form = hireForm()
  if (!form) throw new Error('The hire form did not open')
  fireEvent.submit(form)
}

describe('recruitment action form feedback', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows a may-have-gone hire as a lasting warning toast, then closes the dialog', async () => {
    hire.mockResolvedValue({ success: true, data: { employeeId: 'emp-1' }, message: MAY_HAVE_GONE, warning: MAY_HAVE_GONE })

    submitHire()

    await waitFor(() => expect(toast.warning).toHaveBeenCalledWith(MAY_HAVE_GONE, { duration: 10000 }))
    expect(hireForm()).toBeNull()
    expect(screen.queryByText(MAY_HAVE_GONE)).not.toBeInTheDocument()
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('keeps the dialog open and shows the error under the form when the hire fails', async () => {
    hire.mockResolvedValue({ success: false, error: 'Could not complete the hire just now. Please try again.' })

    submitHire()

    expect(await screen.findByText('Could not complete the hire just now. Please try again.')).toHaveClass('text-danger-fg')
    expect(hireForm()).not.toBeNull()
    expect(toast.warning).not.toHaveBeenCalled()
  })

  it('closes the dialog without a warning when the hire is fully done', async () => {
    hire.mockResolvedValue({ success: true, data: { employeeId: 'emp-1' }, message: 'Candidate invite sent and hire handoff completed.' })

    submitHire()

    await waitFor(() => expect(hireForm()).toBeNull())
    expect(toast.warning).not.toHaveBeenCalled()
  })
})
