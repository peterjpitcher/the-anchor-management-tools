'use client'

import { useActionState, useMemo, useRef, useState } from 'react'
import {
  CheckCircleIcon,
  ClockIcon,
  DocumentTextIcon,
  EnvelopeIcon,
  ExclamationTriangleIcon,
  EyeIcon,
  PlusIcon,
  PrinterIcon,
  SparklesIcon,
  TrashIcon,
  UserPlusIcon,
} from '@heroicons/react/24/outline'
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Drawer,
  Input,
  SearchInput,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TablePagination,
  TableRow,
  Tabs,
  Textarea,
} from '@/ds'
import type { RecruitmentCandidate } from '@/types/recruitment'
import {
  createManualRecruitmentApplicationAction,
  createRecruitmentPostingAction,
  createRecruitmentSlotAction,
  draftRecruitmentEmailAction,
  eraseRecruitmentCandidateAction,
  getRecruitmentCandidates,
  getRecruitmentCvUrlAction,
  getRecruitmentPrintableKitAction,
  issueRecruitmentBookingInviteAction,
  inviteRecruitmentCandidateAsEmployeeAction,
  matchRecruitmentCandidateAction,
  recordRecruitmentAppointmentOutcomeAction,
  rescoreRecruitmentApplicationAction,
  runRecruitmentRetentionAction,
  sendRecruitmentDecisionEmailAction,
  transitionRecruitmentStatusAction,
  updateRecruitmentCandidateAction,
  updateRecruitmentPostingAction,
} from '@/app/actions/recruitment'

type Props = {
  initialData: any
  permissions: {
    canCreate: boolean
    canEdit: boolean
    canManage: boolean
    canSend: boolean
    canDelete: boolean
  }
}

const statusOptions = [
  'new',
  'ai_screened',
  'shortlisted',
  'interview_invited',
  'interview_scheduled',
  'interviewed',
  'trial_offered',
  'trial_scheduled',
  'trial_completed',
  'offered',
  'hired',
  'talent_pool',
  'rejected',
  'withdrawn',
  'on_hold',
]

function formatDateTime(value: string | null | undefined) {
  if (!value) return 'Not set'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Not set'
  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

function candidateName(candidate: any) {
  return [candidate?.first_name, candidate?.last_name].filter(Boolean).join(' ') || candidate?.email || 'Candidate'
}

function roleTitle(application: any) {
  return application?.job_posting?.title || 'Talent pool'
}

function textList(value: unknown) {
  if (!Array.isArray(value) || value.length === 0) return '-'
  return value.map(item => String(item)).join(', ')
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map(item => String(item).trim()).filter(Boolean)
}

function extractedDataError(candidate: any): string | null {
  const data = candidate?.extracted_data
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null
  const value = (data as { extraction_error?: unknown }).extraction_error
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function extractedProfile(candidate: any): Record<string, unknown> | null {
  const data = candidate?.extracted_data
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null
  if ('extraction_error' in data) return null
  return data as Record<string, unknown>
}

function profileArray(candidate: any, key: string): string[] {
  const profile = extractedProfile(candidate)
  return asStringArray(profile?.[key])
}

function profileSummary(candidate: any): string | null {
  const profile = extractedProfile(candidate)
  const summary = candidate?.cv_summary ?? profile?.experience_summary
  return typeof summary === 'string' && summary.trim() ? summary.trim() : null
}

function roleFitSummary(candidate: any): string {
  const roleFit = extractedProfile(candidate)?.role_fit
  if (!roleFit || typeof roleFit !== 'object' || Array.isArray(roleFit)) return '-'

  return Object.entries(roleFit)
    .filter(([, value]) => value === 'strong' || value === 'possible')
    .map(([role, value]) => `${role.replaceAll('_', ' ')}: ${String(value)}`)
    .join(', ') || '-'
}

function cvExtractionMessage(candidate: any): string | null {
  if (!candidate?.cv_file_path) return null
  const status = candidate.cv_extraction_status
  const error = extractedDataError(candidate)

  if (status === 'done' && !error) return null
  if (status === 'no_cv') return null
  if (status === 'pending') return 'CV extraction is still pending.'
  if (status === 'unsupported' || status === 'failed') {
    return `CV text extraction failed: ${error ?? status}. Add details manually or upload a text PDF/DOCX.`
  }
  if (error) return `CV AI extraction failed: ${error}`
  return null
}

function cvStatusTone(status: string | null | undefined): 'success' | 'warning' | 'danger' | 'neutral' {
  if (status === 'done') return 'success'
  if (status === 'pending') return 'warning'
  if (status === 'failed' || status === 'unsupported') return 'danger'
  return 'neutral'
}

function todayLocalDateTime(value: string | null | undefined) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60 * 1000)
  return local.toISOString().slice(0, 16)
}

function ActionStateMessage({ state }: { state: any }) {
  if (!state) return null
  return (
    <p className={`text-xs ${state.success ? 'text-success' : 'text-danger'}`}>
      {state.success ? state.message || 'Saved.' : state.error}
    </p>
  )
}

function SubmitButton({ children, variant = 'primary' }: { children: React.ReactNode; variant?: 'primary' | 'secondary' | 'danger' }) {
  return (
    <Button type="submit" size="sm" variant={variant}>
      {children}
    </Button>
  )
}

export default function RecruitmentDashboardClient({ initialData, permissions }: Props) {
  const [postingState, postingAction] = useActionState(createRecruitmentPostingAction, null)
  const [postingUpdateState, postingUpdateAction] = useActionState(updateRecruitmentPostingAction, null)
  const [applicationState, applicationAction] = useActionState(createManualRecruitmentApplicationAction, null)
  const [candidateUpdateState, candidateUpdateAction] = useActionState(updateRecruitmentCandidateAction, null)
  const [slotState, slotAction] = useActionState(createRecruitmentSlotAction, null)
  const [retentionState, retentionAction] = useActionState(runRecruitmentRetentionAction, null)
  const [activeTab, setActiveTab] = useState<'applications' | 'postings' | 'schedule' | 'talent' | 'communications'>('applications')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [selectedApplicationId, setSelectedApplicationId] = useState<string | null>(null)
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(null)
  const [detailDrawerOpen, setDetailDrawerOpen] = useState(false)
  const [emailDraft, setEmailDraft] = useState<{ type: string; subject: string; body: string; error?: string } | null>(null)
  const [printableText, setPrintableText] = useState<string | null>(null)
  const [clientMessage, setClientMessage] = useState<string | null>(null)
  const TALENT_PAGE_SIZE = 25
  const [talentCandidates, setTalentCandidates] = useState<RecruitmentCandidate[]>(initialData.candidates ?? [])
  const [talentTotal, setTalentTotal] = useState<number>(initialData.candidatesTotal ?? (initialData.candidates ?? []).length)
  const [talentPage, setTalentPage] = useState(1)
  const [talentSearch, setTalentSearch] = useState('')
  const [talentStatusFilter, setTalentStatusFilter] = useState('')
  const [talentSourceFilter, setTalentSourceFilter] = useState('')
  const [talentLoading, setTalentLoading] = useState(false)
  const talentSearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const statusFormAction = transitionRecruitmentStatusAction as unknown as (formData: FormData) => Promise<void>
  const bookingInviteFormAction = issueRecruitmentBookingInviteAction as unknown as (formData: FormData) => Promise<void>
  const decisionEmailFormAction = sendRecruitmentDecisionEmailAction as unknown as (formData: FormData) => Promise<void>
  const hireFormAction = inviteRecruitmentCandidateAsEmployeeAction as unknown as (formData: FormData) => Promise<void>
  const erasureFormAction = eraseRecruitmentCandidateAction as unknown as (formData: FormData) => Promise<void>
  const rescoreFormAction = rescoreRecruitmentApplicationAction as unknown as (formData: FormData) => Promise<void>
  const matchFormAction = matchRecruitmentCandidateAction as unknown as (formData: FormData) => Promise<void>
  const outcomeFormAction = recordRecruitmentAppointmentOutcomeAction as unknown as (formData: FormData) => Promise<void>

  const applications = initialData.applications ?? []
  const postings = initialData.postings ?? []
  const slots = initialData.slots ?? []
  const appointments = initialData.appointments ?? []
  const candidates = initialData.candidates ?? []
  const communications = initialData.communications ?? []
  const statusEvents = initialData.statusEvents ?? []
  const aiRuns = initialData.aiRuns ?? []
  const dashboard = initialData.dashboard
  const activeApplications = applications.filter((application: any) => application.status !== 'talent_pool')
  const selectedApplication = applications.find((application: any) => application.id === selectedApplicationId) ?? null
  const selectedCandidate = selectedApplication?.candidate
    ?? candidates.find((candidate: any) => candidate.id === (selectedCandidateId ?? selectedApplication?.candidate_id))
    ?? null
  const selectedCvExtractionMessage = cvExtractionMessage(selectedApplication?.candidate)
  const selectedCvProfileSummary = profileSummary(selectedApplication?.candidate)
  const selectedStrengths = asStringArray(selectedApplication?.ai_strengths).length > 0
    ? selectedApplication?.ai_strengths
    : profileArray(selectedApplication?.candidate, 'strengths')
  const selectedConcerns = asStringArray(selectedApplication?.ai_concerns).length > 0
    ? selectedApplication?.ai_concerns
    : profileArray(selectedApplication?.candidate, 'concerns')

  const filteredApplications = useMemo(() => {
    const query = search.trim().toLowerCase()
    return applications.filter((application: any) => {
      const candidate = application.candidate ?? {}
      const haystack = [
        candidate.first_name,
        candidate.last_name,
        candidate.email,
        candidate.phone,
        application.job_posting?.title,
        application.status,
        application.ai_recommendation,
      ].filter(Boolean).join(' ').toLowerCase()
      const matchesStatus = statusFilter ? application.status === statusFilter : application.status !== 'talent_pool'
      return (!query || haystack.includes(query)) && matchesStatus
    })
  }, [applications, search, statusFilter])

  const pipeline = useMemo(() => {
    const columns = ['new', 'ai_screened', 'shortlisted', 'interview_scheduled', 'trial_scheduled', 'offered']
    return columns.map(status => ({
      status,
      applications: filteredApplications.filter((application: any) => application.status === status).slice(0, 6),
    }))
  }, [filteredApplications])
  const selectedApplicationEvents = statusEvents.filter((event: any) => event.application_id === selectedApplication?.id).slice(0, 8)
  const selectedApplicationAiRuns = aiRuns.filter((run: any) => run.application_id === selectedApplication?.id || run.candidate_id === selectedCandidate?.id).slice(0, 8)
  const selectedApplicationCommunications = communications.filter((communication: any) => (
    communication.application_id === selectedApplication?.id || communication.candidate_id === selectedCandidate?.id
  )).slice(0, 8)
  const selectedApplicationAppointments = appointments.filter((appointment: any) => (
    appointment.application_id === selectedApplication?.id || appointment.candidate_id === selectedCandidate?.id
  )).slice(0, 5)

  async function draftEmail(applicationId: string, type: string) {
    setClientMessage(null)
    setEmailDraft(null)
    const formData = new FormData()
    formData.set('application_id', applicationId)
    formData.set('type', type)
    const result = await draftRecruitmentEmailAction(formData)
    if (!result.success || !result.data || !(result.data as any).success) {
      setEmailDraft({ type, subject: '', body: '', error: !result.success ? result.error : (result.data as any).error })
      return
    }
    setEmailDraft({
      type,
      subject: (result.data as any).subject,
      body: (result.data as any).body,
    })
  }

  async function openCv(candidateId: string) {
    setClientMessage(null)
    const result = await getRecruitmentCvUrlAction(candidateId)
    if (!result.success || !result.data?.url) {
      setClientMessage(result.success ? 'No CV file is available.' : result.error)
      return
    }
    window.open(result.data.url, '_blank', 'noopener,noreferrer')
  }

  async function buildPrintable(applicationId: string, kind: 'interview' | 'trial') {
    setClientMessage(null)
    const formData = new FormData()
    formData.set('application_id', applicationId)
    formData.set('kind', kind)
    const result = await getRecruitmentPrintableKitAction(formData)
    if (!result.success || !result.data?.text) {
      setClientMessage(result.success ? 'Printable kit could not be built.' : result.error)
      return
    }
    setPrintableText(result.data.text)
  }

  async function loadTalent(opts: { page: number; search: string; status: string; source: string }) {
    setTalentLoading(true)
    try {
      const result = await getRecruitmentCandidates({
        page: opts.page,
        pageSize: TALENT_PAGE_SIZE,
        search: opts.search || null,
        extractionStatus: opts.status || null,
        source: opts.source || null,
      })
      if (result.success && result.data) {
        setTalentCandidates(result.data.candidates)
        setTalentTotal(result.data.totalCount)
        setTalentPage(result.data.page)
      } else if (!result.success) {
        setClientMessage(result.error)
      }
    } finally {
      setTalentLoading(false)
    }
  }

  function handleTalentSearch(value: string) {
    setTalentSearch(value)
    if (talentSearchTimer.current) clearTimeout(talentSearchTimer.current)
    talentSearchTimer.current = setTimeout(() => {
      loadTalent({ page: 1, search: value, status: talentStatusFilter, source: talentSourceFilter })
    }, 300)
  }

  function handleTalentStatusFilter(value: string) {
    setTalentStatusFilter(value)
    loadTalent({ page: 1, search: talentSearch, status: value, source: talentSourceFilter })
  }

  function handleTalentSourceFilter(value: string) {
    setTalentSourceFilter(value)
    loadTalent({ page: 1, search: talentSearch, status: talentStatusFilter, source: value })
  }

  function handleTalentPageChange(page: number) {
    loadTalent({ page, search: talentSearch, status: talentStatusFilter, source: talentSourceFilter })
  }

  function openApplicationDetail(application: any) {
    setSelectedApplicationId(application.id)
    setSelectedCandidateId(application.candidate_id)
    setEmailDraft(null)
    setPrintableText(null)
    setClientMessage(null)
    setDetailDrawerOpen(true)
  }

  const talentTotalPages = Math.max(1, Math.ceil(talentTotal / TALENT_PAGE_SIZE))

  return (
    <main className="min-h-screen bg-bg">
      <div className="px-4 py-5 sm:px-6 lg:px-8 space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-text-strong">Recruitment</h1>
            <p className="text-sm text-text-muted">ATS dashboard</p>
          </div>
          {permissions.canManage && (
            <form action={retentionAction}>
              <Button type="submit" size="sm" variant="secondary" icon={<TrashIcon className="h-4 w-4" />}>
                Run retention
              </Button>
              <ActionStateMessage state={retentionState} />
            </form>
          )}
        </div>

        <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {(dashboard?.actionItems ?? []).map((item: any) => (
            <Card key={item.id}>
              <CardBody className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-medium text-text-muted">{item.label}</p>
                  <p className="mt-1 text-2xl font-semibold text-text-strong">{item.count}</p>
                </div>
                <div className="rounded-md border border-border bg-surface-2 p-2">
                  {item.id === 'new' && <DocumentTextIcon className="h-5 w-5" />}
                  {item.id === 'fast_track' && <CheckCircleIcon className="h-5 w-5" />}
                  {item.id === 'manual_review' && <ExclamationTriangleIcon className="h-5 w-5" />}
                  {item.id === 'awaiting_booking' && <EnvelopeIcon className="h-5 w-5" />}
                  {item.id === 'appointments' && <ClockIcon className="h-5 w-5" />}
                  {item.id !== 'new' && item.id !== 'fast_track' && item.id !== 'manual_review' && item.id !== 'awaiting_booking' && item.id !== 'appointments' && <UserPlusIcon className="h-5 w-5" />}
                </div>
              </CardBody>
            </Card>
          ))}
        </section>

        <section>
          <Tabs
            activeTab={activeTab}
            onTabChange={(id) => setActiveTab(id as typeof activeTab)}
            tabs={[
              { id: 'applications', label: 'Applications', count: activeApplications.length },
              { id: 'postings', label: 'Postings', count: postings.length },
              { id: 'schedule', label: 'Schedule', count: appointments.length },
              { id: 'talent', label: 'Talent pool', count: talentTotal },
              { id: 'communications', label: 'Comms', count: communications.length },
            ]}
          />
        </section>

        {activeTab === 'applications' && (
          <section className="space-y-5">
            <div className="flex flex-col gap-3 md:flex-row md:items-center">
              <SearchInput
                value={search}
                onChange={setSearch}
                placeholder="Search candidates, role, status..."
                className="md:w-80"
              />
              <Select
                aria-label="Filter by status"
                value={statusFilter}
                onChange={event => setStatusFilter(event.target.value)}
                className="md:w-48"
              >
                <option value="">Active statuses</option>
                {statusOptions.map(status => (
                  <option key={status} value={status}>{status.replaceAll('_', ' ')}</option>
                ))}
              </Select>
              {clientMessage && <p className="text-xs text-text-muted">{clientMessage}</p>}
            </div>

            <div className="grid grid-cols-1 gap-4 xl:grid-cols-6">
              {pipeline.map(column => (
                <div key={column.status} className="rounded-lg border border-border bg-surface p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <h2 className="text-xs font-semibold uppercase text-text-muted">{column.status.replaceAll('_', ' ')}</h2>
                    <span className="text-xs text-text-muted">{column.applications.length}</span>
                  </div>
                  <div className="space-y-2">
                    {column.applications.map((application: any) => (
                      <button
                        type="button"
                        key={application.id}
                        onClick={() => openApplicationDetail(application)}
                        className="w-full rounded-md border border-border bg-surface-2 p-2 text-left hover:border-primary"
                      >
                        <p className="truncate text-sm font-medium text-text-strong">{candidateName(application.candidate)}</p>
                        <p className="truncate text-xs text-text-muted">{roleTitle(application)}</p>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <Card>
              <CardHeader title="Applications" />
              <CardBody>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Candidate</TableHead>
                      <TableHead>Role</TableHead>
                      <TableHead>Score</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredApplications.map((application: any) => (
                      <TableRow key={application.id} className={selectedApplication?.id === application.id ? 'bg-primary/5' : undefined}>
                        <TableCell className="align-top whitespace-normal">
                          <p className="font-medium text-text-strong">{candidateName(application.candidate)}</p>
                          <p className="text-xs text-text-muted">{application.candidate?.email}</p>
                        </TableCell>
                        <TableCell className="align-top whitespace-normal">{roleTitle(application)}</TableCell>
                        <TableCell className="align-top">
                          <span className="font-medium">{application.ai_score ?? '-'}</span>
                          {application.ai_recommendation && (
                            <span className="ml-2 text-xs text-text-muted">{application.ai_recommendation.replaceAll('_', ' ')}</span>
                          )}
                          {application.job_posting?.version && application.ai_scored_against_version && application.ai_scored_against_version !== application.job_posting.version && (
                            <Badge tone="warning" className="ml-2">stale</Badge>
                          )}
                        </TableCell>
                        <TableCell className="align-top">
                          {permissions.canEdit ? (
                            <form action={statusFormAction} className="flex items-center gap-2">
                              <input type="hidden" name="application_id" value={application.id} />
                              <Select name="status" defaultValue={application.status} className="w-40">
                                {statusOptions.map(status => (
                                  <option key={status} value={status}>{status.replaceAll('_', ' ')}</option>
                                ))}
                              </Select>
                              <SubmitButton variant="secondary">Save</SubmitButton>
                            </form>
                          ) : application.status.replaceAll('_', ' ')}
                        </TableCell>
                        <TableCell className="align-top whitespace-normal">
                          <div className="flex flex-wrap gap-2">
                            <Button
                              type="button"
                              size="sm"
                              variant="secondary"
                              icon={<EyeIcon className="h-4 w-4" />}
                              onClick={() => openApplicationDetail(application)}
                            >
                              Detail
                            </Button>
                            {permissions.canManage && application.job_posting_id && (
                              <form action={rescoreFormAction}>
                                <input type="hidden" name="application_id" value={application.id} />
                                <SubmitButton variant="secondary">Re-score</SubmitButton>
                              </form>
                            )}
                            {permissions.canSend && (
                              <>
                                <form action={bookingInviteFormAction}>
                                  <input type="hidden" name="application_id" value={application.id} />
                                  <input type="hidden" name="type" value="interview" />
                                  <SubmitButton variant="secondary">Interview</SubmitButton>
                                </form>
                                <form action={bookingInviteFormAction}>
                                  <input type="hidden" name="application_id" value={application.id} />
                                  <input type="hidden" name="type" value="trial_shift" />
                                  <SubmitButton variant="secondary">Trial</SubmitButton>
                                </form>
                                <form action={decisionEmailFormAction}>
                                  <input type="hidden" name="application_id" value={application.id} />
                                  <input type="hidden" name="type" value="rejection" />
                                  <SubmitButton variant="secondary">Reject email</SubmitButton>
                                </form>
                              </>
                            )}
                            {permissions.canManage && application.candidate?.email && (
                              <form action={hireFormAction} className="flex gap-2">
                                <input type="hidden" name="application_id" value={application.id} />
                                <Input name="job_title" placeholder="Job title" className="w-32" />
                                <SubmitButton>Hire</SubmitButton>
                              </form>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardBody>
            </Card>

            <Drawer
              open={detailDrawerOpen && Boolean(selectedApplication)}
              onClose={() => setDetailDrawerOpen(false)}
              title={selectedApplication ? candidateName(selectedApplication.candidate) : 'Application detail'}
              width="min(980px, 100vw)"
            >
              {selectedApplication && (
                <div className="space-y-5">
                  <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
                    <div className="space-y-3">
                      <div>
                        <p className="text-xs font-semibold uppercase text-text-muted">Candidate</p>
                        <p className="text-base font-semibold text-text-strong">{candidateName(selectedApplication.candidate)}</p>
                        <p className="text-sm text-text-muted">{selectedApplication.candidate?.email || 'No email on file'}</p>
                        <p className="text-sm text-text-muted">{selectedApplication.candidate?.phone || selectedApplication.candidate?.phone_e164 || 'No phone on file'}</p>
                      </div>
                      <div>
                        <p className="text-xs font-semibold uppercase text-text-muted">Role</p>
                        <p className="text-sm text-text">{roleTitle(selectedApplication)}</p>
                        <p className="text-xs text-text-muted">{selectedApplication.source} · {formatDateTime(selectedApplication.created_at)}</p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {selectedApplication.candidate?.cv_file_path && (
                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            icon={<DocumentTextIcon className="h-4 w-4" />}
                            onClick={() => openCv(selectedApplication.candidate_id)}
                          >
                            Open CV
                          </Button>
                        )}
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          icon={<PrinterIcon className="h-4 w-4" />}
                          onClick={() => buildPrintable(selectedApplication.id, 'interview')}
                        >
                          Interview kit
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          icon={<PrinterIcon className="h-4 w-4" />}
                          onClick={() => buildPrintable(selectedApplication.id, 'trial')}
                        >
                          Trial brief
                        </Button>
                      </div>
                    </div>

                    <div className="space-y-3">
                      <div>
                        <p className="text-xs font-semibold uppercase text-text-muted">AI score</p>
                        <p className="text-2xl font-semibold text-text-strong">{selectedApplication.ai_score ?? '-'}</p>
                        <p className="text-sm text-text-muted">{selectedApplication.ai_recommendation?.replaceAll('_', ' ') || 'Manual review'}</p>
                      </div>
                      {selectedCvExtractionMessage && (
                        <div className="rounded border border-warning/30 bg-warning-soft p-3 text-sm text-warning-fg">
                          <p className="font-medium">CV extraction needs review</p>
                          <p className="mt-1">{selectedCvExtractionMessage}</p>
                        </div>
                      )}
                      <div>
                        <p className="text-xs font-semibold uppercase text-text-muted">Rationale</p>
                        <p className="text-sm text-text">{selectedApplication.ai_rationale || selectedCvProfileSummary || 'No AI rationale recorded.'}</p>
                      </div>
                      <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                        <div>
                          <p className="text-xs font-semibold uppercase text-text-muted">Strengths</p>
                          <p className="text-sm text-text">{textList(selectedStrengths)}</p>
                        </div>
                        <div>
                          <p className="text-xs font-semibold uppercase text-text-muted">Concerns</p>
                          <p className="text-sm text-text">{textList(selectedConcerns)}</p>
                        </div>
                      </div>
                      {extractedProfile(selectedApplication.candidate) && (
                        <div className="rounded border border-border bg-surface-2 p-3">
                          <p className="text-xs font-semibold uppercase text-text-muted">CV profile</p>
                          <p className="mt-1 text-sm text-text">
                            Skills: {textList(profileArray(selectedApplication.candidate, 'relevant_skills'))}
                          </p>
                          <p className="mt-1 text-sm text-text">
                            Recommended roles: {textList(profileArray(selectedApplication.candidate, 'recommended_role_types'))}
                          </p>
                          <p className="mt-1 text-sm text-text">
                            Role fit: {roleFitSummary(selectedApplication.candidate)}
                          </p>
                        </div>
                      )}
                    </div>

                    <form action={candidateUpdateAction} className="grid grid-cols-1 gap-2">
                      <input type="hidden" name="candidate_id" value={selectedApplication.candidate_id} />
                      <p className="text-xs font-semibold uppercase text-text-muted">Candidate profile</p>
                      <div className="grid grid-cols-2 gap-2">
                        <Input name="first_name" defaultValue={selectedApplication.candidate?.first_name ?? ''} placeholder="First name" />
                        <Input name="last_name" defaultValue={selectedApplication.candidate?.last_name ?? ''} placeholder="Last name" />
                      </div>
                      <Input name="email" defaultValue={selectedApplication.candidate?.email ?? ''} placeholder="Email" />
                      <Input name="phone" defaultValue={selectedApplication.candidate?.phone ?? ''} placeholder="Phone" />
                      <Input name="location" defaultValue={selectedApplication.candidate?.location ?? ''} placeholder="Location" />
                      <Select name="right_to_work_status" defaultValue={selectedApplication.candidate?.right_to_work_status ?? 'not_checked'}>
                        <option value="not_checked">Right to work not checked</option>
                        <option value="pending">Right to work pending</option>
                        <option value="verified">Right to work verified</option>
                        <option value="failed">Right to work failed</option>
                      </Select>
                      <Select name="right_to_work_document_type" defaultValue={selectedApplication.candidate?.right_to_work_document_type ?? ''}>
                        <option value="">Document type</option>
                        <option value="Passport">Passport</option>
                        <option value="Biometric Residence Permit">Biometric Residence Permit</option>
                        <option value="Share Code">Share Code</option>
                        <option value="List A">List A</option>
                        <option value="List B">List B</option>
                        <option value="Other">Other</option>
                      </Select>
                      <Input name="right_to_work_checked_at" type="datetime-local" defaultValue={todayLocalDateTime(selectedApplication.candidate?.right_to_work_checked_at)} />
                      <Textarea name="notes" defaultValue={selectedApplication.candidate?.notes ?? ''} placeholder="Recruitment notes" rows={3} />
                      <label className="flex items-center gap-2 text-sm">
                        <input type="checkbox" name="sms_consent" defaultChecked={selectedApplication.candidate?.sms_consent === true} />
                        SMS consent
                      </label>
                      <label className="flex items-center gap-2 text-sm">
                        <input type="checkbox" name="future_recruitment_consent" defaultChecked={selectedApplication.candidate?.future_recruitment_consent === true} />
                        Future recruitment consent
                      </label>
                      <div className="flex items-center gap-2">
                        <SubmitButton>Save candidate</SubmitButton>
                        <ActionStateMessage state={candidateUpdateState} />
                      </div>
                    </form>
                  </div>

                  <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
                    <div className="space-y-2">
                      <p className="text-xs font-semibold uppercase text-text-muted">Email composer</p>
                      <div className="flex flex-wrap gap-2">
                        {['interview_invite', 'trial_invite', 'rejection', 'already_considered', 'offer'].map(type => (
                          <Button
                            key={type}
                            type="button"
                            size="sm"
                            variant="secondary"
                            icon={<SparklesIcon className="h-4 w-4" />}
                            onClick={() => draftEmail(selectedApplication.id, type)}
                          >
                            Draft {type.replaceAll('_', ' ')}
                          </Button>
                        ))}
                      </div>
                      {emailDraft?.error && <p className="text-xs text-danger">{emailDraft.error}</p>}
                      {emailDraft && !emailDraft.error && (
                        <form action={decisionEmailFormAction} className="space-y-2">
                          <input type="hidden" name="application_id" value={selectedApplication.id} />
                          <Select name="type" defaultValue={emailDraft.type}>
                            <option value="interview_invite">Interview invite</option>
                            <option value="trial_invite">Trial invite</option>
                            <option value="rejection">Rejection</option>
                            <option value="already_considered">Already considered</option>
                            <option value="offer">Offer</option>
                          </Select>
                          <Input name="subject" defaultValue={emailDraft.subject} />
                          <Textarea name="body" defaultValue={emailDraft.body} rows={6} />
                          <Input name="offer_terms" placeholder="Offer terms if sending an offer" />
                          <SubmitButton>Send reviewed email</SubmitButton>
                        </form>
                      )}
                    </div>

                    <div className="space-y-2">
                      <p className="text-xs font-semibold uppercase text-text-muted">Timeline</p>
                      {selectedApplicationEvents.length === 0 && <p className="text-sm text-text-muted">No status events yet.</p>}
                      {selectedApplicationEvents.map((event: any) => (
                        <div key={event.id} className="rounded border border-border bg-surface-2 p-2">
                          <p className="text-sm font-medium text-text-strong">{event.to_status?.replaceAll('_', ' ')}</p>
                          <p className="text-xs text-text-muted">{formatDateTime(event.created_at)} · {event.note || 'No note'}</p>
                        </div>
                      ))}
                    </div>

                    <div className="space-y-2">
                      <p className="text-xs font-semibold uppercase text-text-muted">AI and communications audit</p>
                      <div className="space-y-2">
                        {selectedApplicationAiRuns.map((run: any) => (
                          <div key={run.id} className="rounded border border-border bg-surface-2 p-2">
                            <p className="text-sm font-medium text-text-strong">{run.operation?.replaceAll('_', ' ')} · {run.status}</p>
                            <p className="text-xs text-text-muted">{run.model} · GBP {Number(run.cost ?? 0).toFixed(4)}</p>
                          </div>
                        ))}
                        {selectedApplicationCommunications.map((communication: any) => (
                          <div key={communication.id} className="rounded border border-border bg-surface-2 p-2">
                            <p className="text-sm font-medium text-text-strong">{communication.type?.replaceAll('_', ' ')} · {communication.delivery_status}</p>
                            <p className="text-xs text-text-muted">{formatDateTime(communication.created_at)} · {communication.subject || communication.channel}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  {printableText && (
                    <pre className="max-h-80 overflow-auto rounded border border-border bg-surface-2 p-3 text-xs text-text">
                      {printableText}
                    </pre>
                  )}
                </div>
              )}
            </Drawer>

            {permissions.canCreate && (
              <Card>
                <CardHeader title="Add Application" />
                <CardBody>
                  <form action={applicationAction} className="grid grid-cols-1 gap-3 md:grid-cols-4">
                    <Input name="first_name" placeholder="First name" />
                    <Input name="last_name" placeholder="Last name" />
                    <Input name="email" type="email" placeholder="Email" />
                    <Input name="phone" placeholder="Phone" />
                    <Select name="job_posting_id">
                      <option value="">Talent pool</option>
                      {postings.map((posting: any) => (
                        <option key={posting.id} value={posting.id}>{posting.title}</option>
                      ))}
                    </Select>
                    <Input name="start_availability" placeholder="Start availability" />
                    <input name="cv" type="file" accept=".pdf,.doc,.docx" className="rounded-default border border-border bg-surface px-3 py-2 text-[13px] md:col-span-2" />
                    <div className="md:col-span-4">
                      <Textarea name="cover_note" placeholder="Cover note" rows={3} />
                    </div>
                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" name="sms_consent" defaultChecked />
                      SMS consent
                    </label>
                    <input type="hidden" name="sms_consent" value="false" />
                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" name="future_recruitment_consent" defaultChecked />
                      Future recruitment consent
                    </label>
                    <input type="hidden" name="future_recruitment_consent" value="false" />
                    <div className="md:col-span-4 flex items-center gap-3">
                      <Button type="submit" variant="primary" icon={<PlusIcon className="h-4 w-4" />}>Add application</Button>
                      <ActionStateMessage state={applicationState} />
                    </div>
                  </form>
                </CardBody>
              </Card>
            )}
          </section>
        )}

        {activeTab === 'postings' && (
          <section className="grid grid-cols-1 gap-4 xl:grid-cols-3">
            <Card className="xl:col-span-2">
              <CardHeader title="Postings" />
              <CardBody>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Posting</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Visibility</TableHead>
                      <TableHead>Version</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {postings.map((posting: any) => (
                      <TableRow key={posting.id}>
                        <TableCell className="align-top whitespace-normal">
                          <p className="font-medium text-text-strong">{posting.title}</p>
                          <p className="text-xs text-text-muted">{posting.slug}</p>
                        </TableCell>
                        <TableCell className="align-top">{posting.status}</TableCell>
                        <TableCell className="align-top">{posting.is_public ? 'Public' : 'Private'}</TableCell>
                        <TableCell className="align-top">v{posting.version}</TableCell>
                        <TableCell className="align-top whitespace-normal">
                          {permissions.canEdit && (
                            <form action={postingUpdateAction} className="grid min-w-72 grid-cols-2 gap-2">
                              <input type="hidden" name="id" value={posting.id} />
                              <input type="hidden" name="title" value={posting.title} />
                              <input type="hidden" name="slug" value={posting.slug} />
                              <input type="hidden" name="role_type" value={posting.role_type} />
                              <input type="hidden" name="description" value={posting.description} />
                              <input type="hidden" name="requirements" value={posting.requirements} />
                              <input type="hidden" name="ai_scoring_notes" value={posting.ai_scoring_notes ?? ''} />
                              <input type="hidden" name="employment_type" value={posting.employment_type} />
                              <input type="hidden" name="positions_available" value={posting.positions_available ?? 1} />
                              <Select name="status" defaultValue={posting.status} className="text-xs">
                                <option value="draft">Draft</option>
                                <option value="open">Open</option>
                                <option value="closed">Closed</option>
                                <option value="archived">Archived</option>
                              </Select>
                              <label className="flex items-center gap-1 text-xs">
                                <input type="checkbox" name="is_public" defaultChecked={posting.is_public === true} />
                                Public
                              </label>
                              <SubmitButton variant="secondary">Update</SubmitButton>
                            </form>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <ActionStateMessage state={postingUpdateState} />
              </CardBody>
            </Card>

            {permissions.canCreate && (
              <Card>
                <CardHeader title="New Posting" />
                <CardBody>
                  <form action={postingAction} className="space-y-3">
                    <Input name="title" placeholder="Title" required />
                    <Input name="slug" placeholder="slug" required />
                    <Select name="role_type" defaultValue="either">
                      <option value="bar">Bar</option>
                      <option value="kitchen">Kitchen</option>
                      <option value="either">Either</option>
                      <option value="management">Management</option>
                      <option value="other">Other</option>
                    </Select>
                    <Select name="employment_type" defaultValue="part_time">
                      <option value="full_time">Full time</option>
                      <option value="part_time">Part time</option>
                      <option value="casual">Casual</option>
                    </Select>
                    <Select name="status" defaultValue="draft">
                      <option value="draft">Draft</option>
                      <option value="open">Open</option>
                      <option value="closed">Closed</option>
                      <option value="archived">Archived</option>
                    </Select>
                    <Input name="positions_available" type="number" min="1" defaultValue="1" />
                    <Textarea name="description" placeholder="Description" required rows={4} />
                    <Textarea name="requirements" placeholder="Requirements" required rows={4} />
                    <Textarea name="ai_scoring_notes" placeholder="AI scoring notes" rows={3} />
                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" name="is_public" />
                      Public
                    </label>
                    <Button type="submit" variant="primary">Create posting</Button>
                    <ActionStateMessage state={postingState} />
                  </form>
                </CardBody>
              </Card>
            )}
          </section>
        )}

        {activeTab === 'schedule' && (
          <section className="grid grid-cols-1 gap-4 xl:grid-cols-3">
            <Card className="xl:col-span-2">
              <CardHeader title="Slots" />
              <CardBody>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Type</TableHead>
                      <TableHead>When</TableHead>
                      <TableHead>Location</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {slots.map((slot: any) => (
                      <TableRow key={slot.id}>
                        <TableCell>{slot.type.replaceAll('_', ' ')}</TableCell>
                        <TableCell>{formatDateTime(slot.starts_at)}</TableCell>
                        <TableCell>{slot.location}</TableCell>
                        <TableCell>{slot.status}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardBody>
            </Card>

            {permissions.canCreate && (
              <Card>
                <CardHeader title="New Slot" />
                <CardBody>
                  <form action={slotAction} className="space-y-3">
                    <Select name="type" defaultValue="interview">
                      <option value="interview">Interview</option>
                      <option value="trial_shift">Trial shift</option>
                    </Select>
                    <Input name="starts_at" type="datetime-local" required />
                    <Input name="ends_at" type="datetime-local" required />
                    <Input name="location" defaultValue="The Anchor" />
                    <Input name="timezone" defaultValue="Europe/London" />
                    <Button type="submit" variant="primary">Create slot</Button>
                    <ActionStateMessage state={slotState} />
                  </form>
                </CardBody>
              </Card>
            )}

            <Card className="xl:col-span-3">
              <CardHeader title="Appointments" />
              <CardBody>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Candidate</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>When</TableHead>
                      <TableHead>Calendar</TableHead>
                      <TableHead>Outcome</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {appointments.map((appointment: any) => (
                      <TableRow key={appointment.id}>
                        <TableCell className="align-top whitespace-normal">
                          <p className="font-medium text-text-strong">{candidateName(appointment.candidate)}</p>
                          <p className="text-xs text-text-muted">{appointment.application?.job_posting?.title || 'Talent pool'}</p>
                        </TableCell>
                        <TableCell className="align-top">{appointment.type?.replaceAll('_', ' ')}</TableCell>
                        <TableCell className="align-top">{formatDateTime(appointment.scheduled_start)}</TableCell>
                        <TableCell className="align-top whitespace-normal">
                          <span className="text-xs text-text-muted">{appointment.calendar_sync_status}</span>
                          {appointment.calendar_last_error && <p className="max-w-xs truncate text-xs text-danger">{appointment.calendar_last_error}</p>}
                        </TableCell>
                        <TableCell className="align-top whitespace-normal">
                          {permissions.canEdit ? (
                            <form action={outcomeFormAction} className="grid min-w-[34rem] grid-cols-5 gap-2">
                              <input type="hidden" name="appointment_id" value={appointment.id} />
                              <Select name="status" defaultValue={appointment.status} className="text-xs">
                                <option value="scheduled">Scheduled</option>
                                <option value="completed">Completed</option>
                                <option value="no_show">No-show</option>
                                <option value="cancelled">Cancelled</option>
                              </Select>
                              <Select name="outcome_rating" defaultValue={appointment.outcome_rating ?? ''} className="text-xs">
                                <option value="">Rating</option>
                                <option value="1">1</option>
                                <option value="2">2</option>
                                <option value="3">3</option>
                                <option value="4">4</option>
                                <option value="5">5</option>
                              </Select>
                              <Input name="outcome" defaultValue={appointment.outcome ?? ''} placeholder="Notes" className="text-xs" />
                              <label className="flex items-center gap-1 text-xs">
                                <input type="checkbox" name="meal_provided" defaultChecked={appointment.meal_provided === true} />
                                Meal
                              </label>
                              <SubmitButton variant="secondary">Save</SubmitButton>
                            </form>
                          ) : appointment.status}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardBody>
            </Card>
          </section>
        )}

        {activeTab === 'talent' && (
          <section>
            <Card>
              <CardHeader title="Talent pool" />
              <CardBody className="space-y-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <SearchInput
                    value={talentSearch}
                    onChange={handleTalentSearch}
                    placeholder="Search name or email..."
                    className="sm:w-80"
                  />
                  <div className="flex flex-wrap gap-2">
                    <Select
                      aria-label="Filter by CV status"
                      value={talentStatusFilter}
                      onChange={event => handleTalentStatusFilter(event.target.value)}
                      className="sm:w-44"
                      options={[
                        { value: '', label: 'All CV statuses' },
                        { value: 'done', label: 'Extracted' },
                        { value: 'failed', label: 'Extract failed' },
                        { value: 'no_cv', label: 'No CV text' },
                        { value: 'pending', label: 'Pending' },
                        { value: 'unsupported', label: 'Unsupported' },
                      ]}
                    />
                    <Select
                      aria-label="Filter by source"
                      value={talentSourceFilter}
                      onChange={event => handleTalentSourceFilter(event.target.value)}
                      className="sm:w-40"
                      options={[
                        { value: '', label: 'All sources' },
                        { value: 'manual_upload', label: 'Manual upload' },
                        { value: 'website', label: 'Website' },
                        { value: 'referral', label: 'Referral' },
                        { value: 'job_board', label: 'Job board' },
                        { value: 'other', label: 'Other' },
                      ]}
                    />
                  </div>
                </div>

                {clientMessage && <p className="text-xs text-text-muted">{clientMessage}</p>}

                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Candidate</TableHead>
                      <TableHead>CV</TableHead>
                      <TableHead>AI profile</TableHead>
                      <TableHead>Consent</TableHead>
                      <TableHead>Converted</TableHead>
                      <TableHead>Match</TableHead>
                      <TableHead>Erasure</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {talentCandidates.map((candidate: any) => (
                      <TableRow key={candidate.id}>
                        <TableCell className="align-top whitespace-normal">
                          <p className="font-medium text-text-strong">{candidateName(candidate)}</p>
                          <p className="text-xs text-text-muted">{candidate.email}</p>
                        </TableCell>
                        <TableCell className="align-top">
                          <div className="flex items-center gap-2">
                            <Badge tone={cvStatusTone(candidate.cv_extraction_status)}>
                              {candidate.cv_extraction_status?.replaceAll('_', ' ') ?? 'no cv'}
                            </Badge>
                            {candidate.cv_file_path && (
                              <Button type="button" size="xs" variant="secondary" onClick={() => openCv(candidate.id)}>
                                CV
                              </Button>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="max-w-md align-top whitespace-normal">
                          <p className="line-clamp-2 text-xs text-text">{profileSummary(candidate) ?? '-'}</p>
                          <p className="mt-1 text-xs text-text-muted">Strengths: {textList(profileArray(candidate, 'strengths').slice(0, 3))}</p>
                          <p className="mt-1 text-xs text-text-muted">Fit: {roleFitSummary(candidate)}</p>
                        </TableCell>
                        <TableCell className="align-top">
                          <span className="text-xs text-text-muted">
                            SMS {candidate.sms_consent ? 'yes' : 'no'} · Future {candidate.future_recruitment_consent ? 'yes' : 'no'}
                          </span>
                        </TableCell>
                        <TableCell className="align-top">{candidate.converted_employee_id ? 'Yes' : 'No'}</TableCell>
                        <TableCell className="align-top">
                          {permissions.canManage && (
                            <form action={matchFormAction} className="flex gap-2">
                              <input type="hidden" name="candidate_id" value={candidate.id} />
                              <Select name="job_posting_id" className="w-36">
                                {postings.map((posting: any) => (
                                  <option key={posting.id} value={posting.id}>{posting.title}</option>
                                ))}
                              </Select>
                              <SubmitButton variant="secondary">Match</SubmitButton>
                            </form>
                          )}
                        </TableCell>
                        <TableCell className="align-top">
                          {permissions.canDelete && !candidate.anonymised_at ? (
                            <form action={erasureFormAction} className="flex gap-2">
                              <input type="hidden" name="candidate_id" value={candidate.id} />
                              <Input name="reason" placeholder="Reason" className="w-32" />
                              <SubmitButton variant="danger">Erase</SubmitButton>
                            </form>
                          ) : candidate.anonymised_at ? 'Anonymised' : '-'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>

                {talentCandidates.length === 0 && (
                  <p className="py-6 text-center text-sm text-text-muted">
                    {talentLoading ? 'Loading candidates…' : 'No candidates match your filters.'}
                  </p>
                )}

                <TablePagination
                  page={talentPage}
                  totalPages={talentTotalPages}
                  totalItems={talentTotal}
                  pageSize={TALENT_PAGE_SIZE}
                  onPageChange={handleTalentPageChange}
                />
              </CardBody>
            </Card>
          </section>
        )}

        {activeTab === 'communications' && (
          <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <Card>
              <CardHeader title="Recent Communications" />
              <CardBody>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Type</TableHead>
                      <TableHead>Channel</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Subject</TableHead>
                      <TableHead>Sent</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {communications.map((communication: any) => (
                      <TableRow key={communication.id}>
                        <TableCell>{communication.type?.replaceAll('_', ' ')}</TableCell>
                        <TableCell>{communication.channel}</TableCell>
                        <TableCell>{communication.delivery_status}</TableCell>
                        <TableCell className="whitespace-normal">
                          <p className="max-w-md truncate">{communication.subject || communication.final_body}</p>
                        </TableCell>
                        <TableCell>{formatDateTime(communication.sent_at || communication.created_at)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="AI Runs" />
              <CardBody>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Operation</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Model</TableHead>
                      <TableHead>Cost</TableHead>
                      <TableHead>When</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {aiRuns.map((run: any) => (
                      <TableRow key={run.id}>
                        <TableCell>{run.operation?.replaceAll('_', ' ')}</TableCell>
                        <TableCell>{run.status}</TableCell>
                        <TableCell>{run.model}</TableCell>
                        <TableCell>GBP {Number(run.cost ?? 0).toFixed(4)}</TableCell>
                        <TableCell>{formatDateTime(run.created_at)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardBody>
            </Card>
          </section>
        )}
      </div>
    </main>
  )
}
