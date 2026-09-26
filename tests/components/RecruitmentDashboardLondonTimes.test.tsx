// The recruitment dashboard's times and posting expiry, in both test zones.
//
// Application, appointment and message times were formatted without a time zone, and the
// dashboard's first HTML is rendered on the server, which runs in UTC, so during British
// Summer Time they read an hour early (and a late application showed the previous day).
// A posting's closing date was compared with the UTC date, so from midnight to 1am BST a
// posting that closed yesterday still read as Public, although the website had already
// stopped taking applications for it.
//
// Instants are written in UTC so the file reads the same in both zones: 23:30 UTC on
// 1 October 2026 is 00:30 BST on 2 October in London, but still 1 October in UTC.
import type { ComponentProps } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import RecruitmentDashboardClient from '@/app/(authenticated)/recruitment/_components/RecruitmentDashboardClient'

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

// The component types initialData loosely, so each test fills in only the section it needs.
type InitialData = ComponentProps<typeof RecruitmentDashboardClient>['initialData']

function makeInitialData(): InitialData {
  return {
    applications: [{
      id: 'application-1',
      status: 'new',
      source: 'website',
      // 00:30 BST on 2 October in London; 23:30 on 1 October in UTC.
      created_at: '2026-10-01T23:30:00.000Z',
      candidate_id: 'candidate-1',
      candidate: {
        id: 'candidate-1',
        first_name: 'Megan',
        last_name: 'Daily',
        email: 'megan@example.com',
        phone: null,
      },
      job_posting: { id: 'posting-1', title: 'Bartender', version: 1 },
      job_posting_id: 'posting-1',
      ai_score: 7,
      ai_recommendation: null,
    }],
    postings: [{
      id: 'posting-1',
      title: 'Bartender',
      slug: 'bartender',
      status: 'open',
      is_public: true,
      version: 1,
      // A Postgres date: the last day applications are taken.
      application_closing_date: '2026-10-01',
    }],
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
  canCreate: true,
  canEdit: true,
  canDelete: true,
  canManage: true,
  canExport: true,
  canSend: true,
}

function at(isoInstant: string) {
  vi.setSystemTime(new Date(isoInstant))
}

function postingVisibility(): string | null {
  const row = screen.getByRole('button', { name: 'Bartender' }).closest('tr')
  if (!row) throw new Error('Posting row not found')
  // Columns: Posting, Status, Visibility, Closes, Version.
  return within(row).getAllByRole('cell')[2].textContent
}

describe('RecruitmentDashboardClient London times', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    at('2026-09-26T12:00:00Z')
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows when an application arrived on the London clock on the pipeline', () => {
    render(<RecruitmentDashboardClient initialData={makeInitialData()} permissions={permissions} />)

    expect(screen.getByText('2 Oct 2026, 00:30')).toBeInTheDocument()
    expect(screen.queryByText('1 Oct 2026, 23:30')).not.toBeInTheDocument()
  })

  it('shows when an application arrived on the London clock in the applications table', () => {
    render(<RecruitmentDashboardClient initialData={makeInitialData()} permissions={permissions} />)
    fireEvent.click(screen.getByRole('tab', { name: /Applications/i }))

    expect(screen.getByText('2 Oct 2026, 00:30')).toBeInTheDocument()
  })

  it('marks a posting expired once its closing date has passed in London', () => {
    // 00:30 BST on 2 October in London; still 1 October in UTC.
    at('2026-10-01T23:30:00Z')
    render(<RecruitmentDashboardClient initialData={makeInitialData()} permissions={permissions} />)
    fireEvent.click(screen.getByRole('tab', { name: /Postings/i }))

    expect(postingVisibility()).toBe('Expired')
  })

  it('keeps a posting public until its closing date ends in London', () => {
    // 23:30 BST on 1 October: the closing day itself, in London and in UTC.
    at('2026-10-01T22:30:00Z')
    render(<RecruitmentDashboardClient initialData={makeInitialData()} permissions={permissions} />)
    fireEvent.click(screen.getByRole('tab', { name: /Postings/i }))

    expect(postingVisibility()).toBe('Public')
  })
})
