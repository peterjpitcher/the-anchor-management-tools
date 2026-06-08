'use client'

import { useActionState, useMemo, useState } from 'react'
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
import { Button, Card, CardBody, CardHeader } from '@/ds'
import {
  createManualRecruitmentApplicationAction,
  createRecruitmentPostingAction,
  createRecruitmentSlotAction,
  draftRecruitmentEmailAction,
  eraseRecruitmentCandidateAction,
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
  const [emailDraft, setEmailDraft] = useState<{ type: string; subject: string; body: string; error?: string } | null>(null)
  const [printableText, setPrintableText] = useState<string | null>(null)
  const [clientMessage, setClientMessage] = useState<string | null>(null)
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
  const selectedApplication = applications.find((application: any) => application.id === selectedApplicationId) ?? applications[0] ?? null
  const selectedCandidate = candidates.find((candidate: any) => candidate.id === (selectedCandidateId ?? selectedApplication?.candidate_id)) ?? selectedApplication?.candidate ?? candidates[0] ?? null
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
      return (!query || haystack.includes(query)) && (!statusFilter || application.status === statusFilter)
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
          <div className="flex flex-wrap gap-2 border-b border-border">
            {[
              ['applications', 'Applications'],
              ['postings', 'Postings'],
              ['schedule', 'Schedule'],
              ['talent', 'Talent pool'],
              ['communications', 'Comms'],
            ].map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setActiveTab(key as typeof activeTab)}
                className={`border-b-2 px-3 py-2 text-sm font-medium ${
                  activeTab === key
                    ? 'border-primary text-primary'
                    : 'border-transparent text-text-muted hover:text-text'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </section>

        {activeTab === 'applications' && (
          <section className="space-y-5">
            <div className="flex flex-col gap-3 md:flex-row md:items-center">
              <input
                value={search}
                onChange={event => setSearch(event.target.value)}
                placeholder="Search candidates, role, status..."
                className="w-full rounded border border-border bg-surface px-3 py-2 text-sm md:max-w-sm"
              />
              <select
                value={statusFilter}
                onChange={event => setStatusFilter(event.target.value)}
                className="rounded border border-border bg-surface px-3 py-2 text-sm"
              >
                <option value="">All statuses</option>
                {statusOptions.map(status => (
                  <option key={status} value={status}>{status.replaceAll('_', ' ')}</option>
                ))}
              </select>
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
                        onClick={() => {
                          setSelectedApplicationId(application.id)
                          setSelectedCandidateId(application.candidate_id)
                        }}
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
              <CardBody className="overflow-x-auto">
                <table className="min-w-full divide-y divide-border text-sm">
                  <thead>
                    <tr className="text-left text-xs font-semibold uppercase text-text-muted">
                      <th className="py-2 pr-3">Candidate</th>
                      <th className="py-2 pr-3">Role</th>
                      <th className="py-2 pr-3">Score</th>
                      <th className="py-2 pr-3">Status</th>
                      <th className="py-2 pr-3">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {filteredApplications.map((application: any) => (
                      <tr key={application.id} className={selectedApplication?.id === application.id ? 'bg-primary/5' : undefined}>
                        <td className="py-3 pr-3">
                          <p className="font-medium text-text-strong">{candidateName(application.candidate)}</p>
                          <p className="text-xs text-text-muted">{application.candidate?.email}</p>
                        </td>
                        <td className="py-3 pr-3">{roleTitle(application)}</td>
                        <td className="py-3 pr-3">
                          <span className="font-medium">{application.ai_score ?? '-'}</span>
                          {application.ai_recommendation && (
                            <span className="ml-2 text-xs text-text-muted">{application.ai_recommendation.replaceAll('_', ' ')}</span>
                          )}
                          {application.job_posting?.version && application.ai_scored_against_version && application.ai_scored_against_version !== application.job_posting.version && (
                            <span className="ml-2 rounded bg-warning/10 px-1.5 py-0.5 text-xs text-warning">stale</span>
                          )}
                        </td>
                        <td className="py-3 pr-3">
                          {permissions.canEdit ? (
                            <form action={statusFormAction} className="flex items-center gap-2">
                              <input type="hidden" name="application_id" value={application.id} />
                              <select name="status" defaultValue={application.status} className="rounded border border-border bg-surface px-2 py-1 text-xs">
                                {statusOptions.map(status => (
                                  <option key={status} value={status}>{status.replaceAll('_', ' ')}</option>
                                ))}
                              </select>
                              <SubmitButton variant="secondary">Save</SubmitButton>
                            </form>
                          ) : application.status.replaceAll('_', ' ')}
                        </td>
                        <td className="py-3 pr-3">
                          <div className="flex flex-wrap gap-2">
                            <Button
                              type="button"
                              size="sm"
                              variant="secondary"
                              icon={<EyeIcon className="h-4 w-4" />}
                              onClick={() => {
                                setSelectedApplicationId(application.id)
                                setSelectedCandidateId(application.candidate_id)
                              }}
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
                                <input name="job_title" placeholder="Job title" className="w-32 rounded border border-border bg-surface px-2 py-1 text-xs" />
                                <SubmitButton>Hire</SubmitButton>
                              </form>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardBody>
            </Card>

            {selectedApplication && (
              <Card>
                <CardHeader title="Application Detail" />
                <CardBody className="space-y-5">
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
                        <input name="first_name" defaultValue={selectedApplication.candidate?.first_name ?? ''} placeholder="First name" className="rounded border border-border bg-surface px-3 py-2 text-sm" />
                        <input name="last_name" defaultValue={selectedApplication.candidate?.last_name ?? ''} placeholder="Last name" className="rounded border border-border bg-surface px-3 py-2 text-sm" />
                      </div>
                      <input name="email" defaultValue={selectedApplication.candidate?.email ?? ''} placeholder="Email" className="rounded border border-border bg-surface px-3 py-2 text-sm" />
                      <input name="phone" defaultValue={selectedApplication.candidate?.phone ?? ''} placeholder="Phone" className="rounded border border-border bg-surface px-3 py-2 text-sm" />
                      <input name="location" defaultValue={selectedApplication.candidate?.location ?? ''} placeholder="Location" className="rounded border border-border bg-surface px-3 py-2 text-sm" />
                      <select name="right_to_work_status" defaultValue={selectedApplication.candidate?.right_to_work_status ?? 'not_checked'} className="rounded border border-border bg-surface px-3 py-2 text-sm">
                        <option value="not_checked">Right to work not checked</option>
                        <option value="pending">Right to work pending</option>
                        <option value="verified">Right to work verified</option>
                        <option value="failed">Right to work failed</option>
                      </select>
                      <select name="right_to_work_document_type" defaultValue={selectedApplication.candidate?.right_to_work_document_type ?? ''} className="rounded border border-border bg-surface px-3 py-2 text-sm">
                        <option value="">Document type</option>
                        <option value="Passport">Passport</option>
                        <option value="Biometric Residence Permit">Biometric Residence Permit</option>
                        <option value="Share Code">Share Code</option>
                        <option value="List A">List A</option>
                        <option value="List B">List B</option>
                        <option value="Other">Other</option>
                      </select>
                      <input name="right_to_work_checked_at" type="datetime-local" defaultValue={todayLocalDateTime(selectedApplication.candidate?.right_to_work_checked_at)} className="rounded border border-border bg-surface px-3 py-2 text-sm" />
                      <textarea name="notes" defaultValue={selectedApplication.candidate?.notes ?? ''} placeholder="Recruitment notes" className="min-h-20 rounded border border-border bg-surface px-3 py-2 text-sm" />
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
                          <select name="type" className="rounded border border-border bg-surface px-3 py-2 text-sm" defaultValue={emailDraft.type}>
                            <option value="interview_invite">Interview invite</option>
                            <option value="trial_invite">Trial invite</option>
                            <option value="rejection">Rejection</option>
                            <option value="already_considered">Already considered</option>
                            <option value="offer">Offer</option>
                          </select>
                          <input name="subject" defaultValue={emailDraft.subject} className="w-full rounded border border-border bg-surface px-3 py-2 text-sm" />
                          <textarea name="body" defaultValue={emailDraft.body} className="min-h-40 w-full rounded border border-border bg-surface px-3 py-2 text-sm" />
                          <input name="offer_terms" placeholder="Offer terms if sending an offer" className="w-full rounded border border-border bg-surface px-3 py-2 text-sm" />
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
                </CardBody>
              </Card>
            )}

            {permissions.canCreate && (
              <Card>
                <CardHeader title="Add Application" />
                <CardBody>
                  <form action={applicationAction} className="grid grid-cols-1 gap-3 md:grid-cols-4">
                    <input name="first_name" placeholder="First name" className="rounded border border-border bg-surface px-3 py-2 text-sm" />
                    <input name="last_name" placeholder="Last name" className="rounded border border-border bg-surface px-3 py-2 text-sm" />
                    <input name="email" type="email" placeholder="Email" className="rounded border border-border bg-surface px-3 py-2 text-sm" />
                    <input name="phone" placeholder="Phone" className="rounded border border-border bg-surface px-3 py-2 text-sm" />
                    <select name="job_posting_id" className="rounded border border-border bg-surface px-3 py-2 text-sm">
                      <option value="">Talent pool</option>
                      {postings.map((posting: any) => (
                        <option key={posting.id} value={posting.id}>{posting.title}</option>
                      ))}
                    </select>
                    <input name="start_availability" placeholder="Start availability" className="rounded border border-border bg-surface px-3 py-2 text-sm" />
                    <input name="cv" type="file" accept=".pdf,.doc,.docx" className="rounded border border-border bg-surface px-3 py-2 text-sm md:col-span-2" />
                    <textarea name="cover_note" placeholder="Cover note" className="min-h-20 rounded border border-border bg-surface px-3 py-2 text-sm md:col-span-4" />
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
              <CardBody className="overflow-x-auto">
                <table className="min-w-full divide-y divide-border text-sm">
                  <tbody className="divide-y divide-border">
                    {postings.map((posting: any) => (
                      <tr key={posting.id}>
                        <td className="py-3 pr-3">
                          <p className="font-medium text-text-strong">{posting.title}</p>
                          <p className="text-xs text-text-muted">{posting.slug}</p>
                        </td>
                        <td className="py-3 pr-3">{posting.status}</td>
                        <td className="py-3 pr-3">{posting.is_public ? 'Public' : 'Private'}</td>
                        <td className="py-3 pr-3">v{posting.version}</td>
                        <td className="py-3 pr-3">
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
                              <select name="status" defaultValue={posting.status} className="rounded border border-border bg-surface px-2 py-1 text-xs">
                                <option value="draft">Draft</option>
                                <option value="open">Open</option>
                                <option value="closed">Closed</option>
                                <option value="archived">Archived</option>
                              </select>
                              <label className="flex items-center gap-1 text-xs">
                                <input type="checkbox" name="is_public" defaultChecked={posting.is_public === true} />
                                Public
                              </label>
                              <SubmitButton variant="secondary">Update</SubmitButton>
                            </form>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <ActionStateMessage state={postingUpdateState} />
              </CardBody>
            </Card>

            {permissions.canCreate && (
              <Card>
                <CardHeader title="New Posting" />
                <CardBody>
                  <form action={postingAction} className="space-y-3">
                    <input name="title" placeholder="Title" required className="w-full rounded border border-border bg-surface px-3 py-2 text-sm" />
                    <input name="slug" placeholder="slug" required className="w-full rounded border border-border bg-surface px-3 py-2 text-sm" />
                    <select name="role_type" className="w-full rounded border border-border bg-surface px-3 py-2 text-sm" defaultValue="either">
                      <option value="bar">Bar</option>
                      <option value="kitchen">Kitchen</option>
                      <option value="either">Either</option>
                      <option value="management">Management</option>
                      <option value="other">Other</option>
                    </select>
                    <select name="employment_type" className="w-full rounded border border-border bg-surface px-3 py-2 text-sm" defaultValue="part_time">
                      <option value="full_time">Full time</option>
                      <option value="part_time">Part time</option>
                      <option value="casual">Casual</option>
                    </select>
                    <select name="status" className="w-full rounded border border-border bg-surface px-3 py-2 text-sm" defaultValue="draft">
                      <option value="draft">Draft</option>
                      <option value="open">Open</option>
                      <option value="closed">Closed</option>
                      <option value="archived">Archived</option>
                    </select>
                    <input name="positions_available" type="number" min="1" defaultValue="1" className="w-full rounded border border-border bg-surface px-3 py-2 text-sm" />
                    <textarea name="description" placeholder="Description" required className="min-h-24 w-full rounded border border-border bg-surface px-3 py-2 text-sm" />
                    <textarea name="requirements" placeholder="Requirements" required className="min-h-24 w-full rounded border border-border bg-surface px-3 py-2 text-sm" />
                    <textarea name="ai_scoring_notes" placeholder="AI scoring notes" className="min-h-20 w-full rounded border border-border bg-surface px-3 py-2 text-sm" />
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
              <CardBody className="overflow-x-auto">
                <table className="min-w-full divide-y divide-border text-sm">
                  <tbody className="divide-y divide-border">
                    {slots.map((slot: any) => (
                      <tr key={slot.id}>
                        <td className="py-3 pr-3">{slot.type.replaceAll('_', ' ')}</td>
                        <td className="py-3 pr-3">{formatDateTime(slot.starts_at)}</td>
                        <td className="py-3 pr-3">{slot.location}</td>
                        <td className="py-3 pr-3">{slot.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardBody>
            </Card>

            {permissions.canCreate && (
              <Card>
                <CardHeader title="New Slot" />
                <CardBody>
                  <form action={slotAction} className="space-y-3">
                    <select name="type" className="w-full rounded border border-border bg-surface px-3 py-2 text-sm" defaultValue="interview">
                      <option value="interview">Interview</option>
                      <option value="trial_shift">Trial shift</option>
                    </select>
                    <input name="starts_at" type="datetime-local" required className="w-full rounded border border-border bg-surface px-3 py-2 text-sm" />
                    <input name="ends_at" type="datetime-local" required className="w-full rounded border border-border bg-surface px-3 py-2 text-sm" />
                    <input name="location" defaultValue="The Anchor" className="w-full rounded border border-border bg-surface px-3 py-2 text-sm" />
                    <input name="timezone" defaultValue="Europe/London" className="w-full rounded border border-border bg-surface px-3 py-2 text-sm" />
                    <Button type="submit" variant="primary">Create slot</Button>
                    <ActionStateMessage state={slotState} />
                  </form>
                </CardBody>
              </Card>
            )}

            <Card className="xl:col-span-3">
              <CardHeader title="Appointments" />
              <CardBody className="overflow-x-auto">
                <table className="min-w-full divide-y divide-border text-sm">
                  <thead>
                    <tr className="text-left text-xs font-semibold uppercase text-text-muted">
                      <th className="py-2 pr-3">Candidate</th>
                      <th className="py-2 pr-3">Type</th>
                      <th className="py-2 pr-3">When</th>
                      <th className="py-2 pr-3">Calendar</th>
                      <th className="py-2 pr-3">Outcome</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {appointments.map((appointment: any) => (
                      <tr key={appointment.id}>
                        <td className="py-3 pr-3">
                          <p className="font-medium text-text-strong">{candidateName(appointment.candidate)}</p>
                          <p className="text-xs text-text-muted">{appointment.application?.job_posting?.title || 'Talent pool'}</p>
                        </td>
                        <td className="py-3 pr-3">{appointment.type?.replaceAll('_', ' ')}</td>
                        <td className="py-3 pr-3">{formatDateTime(appointment.scheduled_start)}</td>
                        <td className="py-3 pr-3">
                          <span className="text-xs text-text-muted">{appointment.calendar_sync_status}</span>
                          {appointment.calendar_last_error && <p className="max-w-xs truncate text-xs text-danger">{appointment.calendar_last_error}</p>}
                        </td>
                        <td className="py-3 pr-3">
                          {permissions.canEdit ? (
                            <form action={outcomeFormAction} className="grid min-w-[34rem] grid-cols-5 gap-2">
                              <input type="hidden" name="appointment_id" value={appointment.id} />
                              <select name="status" defaultValue={appointment.status} className="rounded border border-border bg-surface px-2 py-1 text-xs">
                                <option value="scheduled">Scheduled</option>
                                <option value="completed">Completed</option>
                                <option value="no_show">No-show</option>
                                <option value="cancelled">Cancelled</option>
                              </select>
                              <select name="outcome_rating" defaultValue={appointment.outcome_rating ?? ''} className="rounded border border-border bg-surface px-2 py-1 text-xs">
                                <option value="">Rating</option>
                                <option value="1">1</option>
                                <option value="2">2</option>
                                <option value="3">3</option>
                                <option value="4">4</option>
                                <option value="5">5</option>
                              </select>
                              <input name="outcome" defaultValue={appointment.outcome ?? ''} placeholder="Notes" className="rounded border border-border bg-surface px-2 py-1 text-xs" />
                              <label className="flex items-center gap-1 text-xs">
                                <input type="checkbox" name="meal_provided" defaultChecked={appointment.meal_provided === true} />
                                Meal
                              </label>
                              <SubmitButton variant="secondary">Save</SubmitButton>
                            </form>
                          ) : appointment.status}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardBody>
            </Card>
          </section>
        )}

        {activeTab === 'talent' && (
          <section>
            <Card>
              <CardHeader title="Candidates" />
              <CardBody className="overflow-x-auto">
                <table className="min-w-full divide-y divide-border text-sm">
                  <thead>
                    <tr className="text-left text-xs font-semibold uppercase text-text-muted">
                      <th className="py-2 pr-3">Candidate</th>
                      <th className="py-2 pr-3">CV</th>
                      <th className="py-2 pr-3">AI profile</th>
                      <th className="py-2 pr-3">Consent</th>
                      <th className="py-2 pr-3">Converted</th>
                      <th className="py-2 pr-3">Match</th>
                      <th className="py-2 pr-3">Erasure</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {candidates.map((candidate: any) => (
                      <tr key={candidate.id}>
                        <td className="py-3 pr-3">
                          <p className="font-medium text-text-strong">{candidateName(candidate)}</p>
                          <p className="text-xs text-text-muted">{candidate.email}</p>
                        </td>
                        <td className="py-3 pr-3">
                          <span>{candidate.cv_extraction_status?.replaceAll('_', ' ')}</span>
                          {candidate.cv_file_path && (
                            <Button
                              type="button"
                              size="xs"
                              variant="secondary"
                              className="ml-2"
                              onClick={() => openCv(candidate.id)}
                            >
                              CV
                            </Button>
                          )}
                        </td>
                        <td className="max-w-md py-3 pr-3">
                          <p className="line-clamp-2 text-xs text-text">{profileSummary(candidate) ?? '-'}</p>
                          <p className="mt-1 text-xs text-text-muted">
                            Strengths: {textList(profileArray(candidate, 'strengths').slice(0, 3))}
                          </p>
                          <p className="mt-1 text-xs text-text-muted">
                            Fit: {roleFitSummary(candidate)}
                          </p>
                        </td>
                        <td className="py-3 pr-3">
                          <span className="text-xs text-text-muted">
                            SMS {candidate.sms_consent ? 'yes' : 'no'} · Future {candidate.future_recruitment_consent ? 'yes' : 'no'}
                          </span>
                        </td>
                        <td className="py-3 pr-3">{candidate.converted_employee_id ? 'Yes' : 'No'}</td>
                        <td className="py-3 pr-3">
                          {permissions.canManage && (
                            <form action={matchFormAction} className="flex gap-2">
                              <input type="hidden" name="candidate_id" value={candidate.id} />
                              <select name="job_posting_id" className="rounded border border-border bg-surface px-2 py-1 text-xs">
                                {postings.map((posting: any) => (
                                  <option key={posting.id} value={posting.id}>{posting.title}</option>
                                ))}
                              </select>
                              <SubmitButton variant="secondary">Match</SubmitButton>
                            </form>
                          )}
                        </td>
                        <td className="py-3 pr-3">
                          {permissions.canDelete && !candidate.anonymised_at ? (
                            <form action={erasureFormAction} className="flex gap-2">
                              <input type="hidden" name="candidate_id" value={candidate.id} />
                              <input name="reason" placeholder="Reason" className="w-32 rounded border border-border bg-surface px-2 py-1 text-xs" />
                              <SubmitButton variant="danger">Erase</SubmitButton>
                            </form>
                          ) : candidate.anonymised_at ? 'Anonymised' : '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardBody>
            </Card>
          </section>
        )}

        {activeTab === 'communications' && (
          <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <Card>
              <CardHeader title="Recent Communications" />
              <CardBody className="overflow-x-auto">
                <table className="min-w-full divide-y divide-border text-sm">
                  <thead>
                    <tr className="text-left text-xs font-semibold uppercase text-text-muted">
                      <th className="py-2 pr-3">Type</th>
                      <th className="py-2 pr-3">Channel</th>
                      <th className="py-2 pr-3">Status</th>
                      <th className="py-2 pr-3">Subject</th>
                      <th className="py-2 pr-3">Sent</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {communications.map((communication: any) => (
                      <tr key={communication.id}>
                        <td className="py-3 pr-3">{communication.type?.replaceAll('_', ' ')}</td>
                        <td className="py-3 pr-3">{communication.channel}</td>
                        <td className="py-3 pr-3">{communication.delivery_status}</td>
                        <td className="py-3 pr-3">
                          <p className="max-w-md truncate">{communication.subject || communication.final_body}</p>
                        </td>
                        <td className="py-3 pr-3">{formatDateTime(communication.sent_at || communication.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="AI Runs" />
              <CardBody className="overflow-x-auto">
                <table className="min-w-full divide-y divide-border text-sm">
                  <thead>
                    <tr className="text-left text-xs font-semibold uppercase text-text-muted">
                      <th className="py-2 pr-3">Operation</th>
                      <th className="py-2 pr-3">Status</th>
                      <th className="py-2 pr-3">Model</th>
                      <th className="py-2 pr-3">Cost</th>
                      <th className="py-2 pr-3">When</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {aiRuns.map((run: any) => (
                      <tr key={run.id}>
                        <td className="py-3 pr-3">{run.operation?.replaceAll('_', ' ')}</td>
                        <td className="py-3 pr-3">{run.status}</td>
                        <td className="py-3 pr-3">{run.model}</td>
                        <td className="py-3 pr-3">GBP {Number(run.cost ?? 0).toFixed(4)}</td>
                        <td className="py-3 pr-3">{formatDateTime(run.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardBody>
            </Card>
          </section>
        )}
      </div>
    </main>
  )
}
