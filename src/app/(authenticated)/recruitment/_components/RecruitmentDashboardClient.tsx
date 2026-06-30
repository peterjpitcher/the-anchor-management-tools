'use client'

import { useActionState, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  ArrowPathIcon,
  CheckCircleIcon,
  ClockIcon,
  DocumentTextIcon,
  EnvelopeIcon,
  ExclamationTriangleIcon,
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
  ConfirmDialog,
  Drawer,
  Input,
  PageHeader,
  SearchInput,
  SectionNav,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TablePagination,
  TableRow,
  Textarea,
} from '@/ds'
import type { RecruitmentCandidate } from '@/types/recruitment'
import {
  addRecruitmentCandidateNoteAction,
  archiveRecruitmentApplicationAction,
  archiveRecruitmentAppointmentAction,
  archiveRecruitmentSlotAction,
  bulkRecruitmentApplicationsAction,
  cancelRecruitmentAppointmentAction,
  cancelRecruitmentSlotAction,
  createManualRecruitmentApplicationAction,
  createRecruitmentPostingAction,
  createRecruitmentSlotAction,
  decideRecruitmentApplicationAction,
  draftRecruitmentEmailAction,
  duplicateRecruitmentPostingAction,
  eraseRecruitmentCandidateAction,
  exportRecruitmentApplicationsCsvAction,
  getRecruitmentCandidates,
  getRecruitmentCandidateTrailAction,
  getRecruitmentCvUrlAction,
  getRecruitmentPrintableKitAction,
  issueRecruitmentBookingInviteAction,
  inviteRecruitmentCandidateAsEmployeeAction,
  matchRecruitmentCandidateAction,
  previewRecruitmentDecisionEmailAction,
  recordRecruitmentScorecardAction,
  recordRecruitmentAppointmentOutcomeAction,
  rescheduleRecruitmentAppointmentAction,
  restoreRecruitmentApplicationAction,
  restoreRecruitmentAppointmentAction,
  restoreRecruitmentSlotAction,
  rescoreRecruitmentApplicationAction,
  retryRecruitmentCommunicationAction,
  retryManualReviewCvsAction,
  retryRecruitmentCvExtractionAction,
  runRecruitmentRetentionAction,
  saveRecruitmentEmailTemplateAction,
  scheduleRecruitmentInterviewForCandidateAction,
  scheduleRecruitmentTrialForCandidateAction,
  sendRecruitmentDecisionEmailAction,
  transitionRecruitmentStatusAction,
  updateRecruitmentCandidateAction,
  updateRecruitmentPostingAction,
  updateRecruitmentSlotAction,
} from '@/app/actions/recruitment'

type Props = {
  initialData: any
  permissions: {
    canCreate: boolean
    canEdit: boolean
    canManage: boolean
    canSend: boolean
    canDelete: boolean
    canExport?: boolean
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

const DECISION_CONFIG: Record<'reject'|'offer'|'decline_duplicate'|'withdraw'|'hold', { confirm: string; template: 'rejection'|'offer'|'already_considered' | null; danger?: boolean }> = {
  reject: { confirm: 'Reject candidate', template: 'rejection', danger: true },
  offer: { confirm: 'Make offer', template: 'offer' },
  decline_duplicate: { confirm: 'Decline (already considered)', template: 'already_considered' },
  withdraw: { confirm: 'Mark withdrawn', template: null },
  hold: { confirm: 'Put on hold', template: null },
}
const DECISION_STATUSES = ['rejected', 'offered', 'declined_duplicate', 'withdrawn', 'on_hold']

const DEFAULT_SLOT_DURATION_MS = 2 * 60 * 60 * 1000
const HOUR_OPTIONS = Array.from({ length: 24 }, (_, index) => ({
  value: String(index).padStart(2, '0'),
  label: `${index % 12 || 12}${index < 12 ? 'am' : 'pm'}`,
}))
const MINUTE_OPTIONS = ['00', '15', '30', '45']

type SlotDateTimeParts = {
  date: string
  hour: string
  minute: string
}

const emptySlotDateTime: SlotDateTimeParts = { date: '', hour: '', minute: '' }

const DRAWER_TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'schedule', label: 'Schedule' },
  { id: 'comms', label: 'Comms' },
  { id: 'activity', label: 'Activity' },
  { id: 'profile', label: 'Profile' },
] as const

type DrawerTab = (typeof DRAWER_TABS)[number]['id']

function calendarSyncLabel(status: string | null | undefined) {
  switch (status) {
    case 'synced':
      return 'synced'
    case 'ics_fallback':
      return 'email invite only'
    case 'failed':
      return 'sync failed'
    case 'pending':
      return 'syncing…'
    default:
      return status || 'not synced'
  }
}

function rtwLabel(status: string | null | undefined) {
  switch (status) {
    case 'verified':
      return 'verified'
    case 'pending':
      return 'pending'
    case 'failed':
      return 'failed'
    default:
      return 'not checked'
  }
}

function rtwTone(status: string | null | undefined): 'success' | 'warning' | 'danger' | 'info' {
  switch (status) {
    case 'verified':
      return 'success'
    case 'failed':
      return 'danger'
    case 'pending':
      return 'info'
    default:
      return 'warning'
  }
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return 'Not set'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Not set'
  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

function formatSlotDateTime(value: string | null | undefined) {
  if (!value) return 'Not set'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Not set'
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/London',
  }).format(date)
}

function formatTimeOnly(value: string | null | undefined) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/London',
  }).format(date)
}

// Builds a slot option label: London-pinned start, end time, and location, so two
// same-day slots of different lengths are distinguishable in the dropdown.
function formatSlotOptionLabel(slot: { starts_at: string; ends_at?: string | null; location?: string | null }) {
  const end = formatTimeOnly(slot.ends_at)
  const window = end ? `${formatSlotDateTime(slot.starts_at)}–${end}` : formatSlotDateTime(slot.starts_at)
  return `${window} · ${slot.location || 'The Anchor'}`
}

function toTime(value: string | null | undefined): number {
  if (!value) return 0
  const time = new Date(value).getTime()
  return Number.isNaN(time) ? 0 : time
}

function candidateName(candidate: any) {
  return [candidate?.first_name, candidate?.last_name].filter(Boolean).join(' ') || candidate?.email || 'Candidate'
}

function roleTitle(application: any) {
  return application?.job_posting?.title || 'Talent pool'
}

function scoreTone(score: number | null | undefined): 'success' | 'warning' | 'danger' | 'neutral' {
  if (typeof score !== 'number') return 'neutral'
  if (score >= 70) return 'success'
  if (score >= 40) return 'warning'
  return 'danger'
}

function scoreLabel(score: number | null | undefined) {
  if (typeof score !== 'number') return 'Unscored'
  if (score >= 70) return 'High'
  if (score >= 40) return 'Medium'
  return 'Low'
}

function scoreText(score: number | null | undefined) {
  return typeof score === 'number' ? `${scoreLabel(score)} ${score}` : scoreLabel(score)
}

function statusLabel(status: string | null | undefined) {
  return status ? status.replaceAll('_', ' ') : 'unknown'
}

type QuickStatusAction = {
  status: string
  label: string
  note: string
  variant?: 'primary' | 'secondary' | 'danger'
  confirmTitle?: string
  confirmMessage?: string
}

function quickStatusActionsFor(status: string): QuickStatusAction[] {
  const rejectAction: QuickStatusAction = {
    status: 'rejected',
    label: 'Reject candidate',
    note: 'Rejected from quick action',
    variant: 'danger',
    confirmTitle: 'Reject candidate',
    confirmMessage: 'Reject this candidate?',
  }

  switch (status) {
    case 'new':
    case 'ai_screened':
      return [
        { status: 'shortlisted', label: 'Shortlist candidate', note: 'Shortlisted from quick action', variant: 'primary' },
        rejectAction,
      ]
    case 'shortlisted':
      return [rejectAction]
    case 'interview_scheduled':
      return [
        { status: 'interviewed', label: 'Mark interviewed', note: 'Marked interviewed from quick action', variant: 'primary' },
        rejectAction,
      ]
    case 'interviewed':
      return [
        { status: 'offered', label: 'Mark offered', note: 'Marked offered from quick action', variant: 'primary' },
        rejectAction,
      ]
    case 'trial_scheduled':
      return [
        { status: 'trial_completed', label: 'Mark trial completed', note: 'Marked trial completed from quick action', variant: 'primary' },
        rejectAction,
      ]
    case 'trial_completed':
      return [
        { status: 'offered', label: 'Mark offered', note: 'Marked offered from quick action', variant: 'primary' },
        rejectAction,
      ]
    case 'offered':
      return [{ status: 'hired', label: 'Mark hired', note: 'Marked hired from quick action', variant: 'primary' }]
    case 'on_hold':
      return [{ status: 'shortlisted', label: 'Reopen as shortlisted', note: 'Reopened from quick action', variant: 'primary' }]
    default:
      return []
  }
}

function recruitmentNextActionHint(status: string, interviewInviteSent: boolean, trialInviteSent: boolean) {
  switch (status) {
    case 'new':
    case 'ai_screened':
      return 'Review, then shortlist, reject, or send an interview booking link.'
    case 'shortlisted':
      return interviewInviteSent ? 'Interview invite has been sent. Wait for booking or resend only if needed.' : 'Send an interview booking link when ready.'
    case 'interview_invited':
      return 'Waiting for the candidate to book an interview. Resend the link only if needed.'
    case 'interview_scheduled':
      return 'After the interview, mark them interviewed.'
    case 'interviewed':
      return trialInviteSent ? 'Trial invite has been sent. Wait for booking or resend only if needed.' : 'Send a trial booking link, make an offer, or reject.'
    case 'trial_offered':
      return 'Waiting for the candidate to book a trial shift. Resend the link only if needed.'
    case 'trial_scheduled':
      return 'After the trial, mark it completed.'
    case 'trial_completed':
      return 'Decide whether to make an offer or reject.'
    case 'offered':
      return 'Create the employee invite when they accept.'
    case 'hired':
      return 'Candidate is hired.'
    case 'rejected':
      return 'Candidate has been rejected.'
    case 'withdrawn':
      return 'Candidate has withdrawn.'
    default:
      return 'Use the next action that matches the latest candidate conversation.'
  }
}

function scoreRowClass(score: number | null | undefined) {
  const tone = scoreTone(score)
  if (tone === 'success') return 'border-l-4 border-success/70 bg-success-soft/30'
  if (tone === 'warning') return 'border-l-4 border-warning/70 bg-warning-soft/30'
  if (tone === 'danger') return 'border-l-4 border-danger/70 bg-danger-soft/30'
  return 'border-l-4 border-border'
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
    const detail = String(error ?? status).replace(/\.+$/, '')
    return `CV text extraction failed: ${detail}. Add details manually or upload a clearer PDF, DOC, DOCX, TXT, RTF or ODT CV.`
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

function dateTimeLocalToParts(value: string | null | undefined): SlotDateTimeParts {
  const localValue = todayLocalDateTime(value)
  if (!localValue) return emptySlotDateTime
  const [date, time] = localValue.split('T')
  const [hour, minute] = (time ?? '').split(':')
  return { date: date ?? '', hour: hour ?? '', minute: minute ?? '' }
}

function partsToDateTimeLocal(value: SlotDateTimeParts) {
  if (!value.date || !value.hour || !value.minute) return ''
  return `${value.date}T${value.hour}:${value.minute}`
}

function addDurationToDateTimeParts(value: SlotDateTimeParts, durationMs: number) {
  const localValue = partsToDateTimeLocal(value)
  if (!localValue) return emptySlotDateTime
  const date = new Date(localValue)
  if (Number.isNaN(date.getTime())) return emptySlotDateTime
  return dateTimeLocalToParts(new Date(date.getTime() + durationMs).toISOString())
}

function dateInputValue(value: string | null | undefined) {
  return value ? value.slice(0, 10) : ''
}

function formatDateOnly(value: string | null | undefined) {
  if (!value) return 'Not set'
  const date = new Date(`${value.slice(0, 10)}T12:00:00Z`)
  if (Number.isNaN(date.getTime())) return 'Not set'
  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeZone: 'Europe/London',
  }).format(date)
}

function isPastClosingDate(value: string | null | undefined) {
  if (!value) return false
  return value.slice(0, 10) < new Date().toISOString().slice(0, 10)
}

function postingVisibilityText(posting: any) {
  if (isPastClosingDate(posting.application_closing_date)) return 'Expired'
  return posting.is_public ? 'Public' : 'Private'
}

function Field({ label, help, children }: { label: string; help?: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-semibold uppercase text-text-muted">{label}</span>
      {children}
      {help && <span className="block text-xs text-text-muted">{help}</span>}
    </label>
  )
}

function SlotDateTimeInput({
  label,
  name,
  initialValue,
  value,
  onChange,
}: {
  label: string
  name: string
  initialValue?: string | null
  value?: SlotDateTimeParts
  onChange?: (value: SlotDateTimeParts) => void
}) {
  const [internalValue, setInternalValue] = useState(() => dateTimeLocalToParts(initialValue))
  const currentValue = value ?? internalValue

  useEffect(() => {
    if (!value) setInternalValue(dateTimeLocalToParts(initialValue))
  }, [initialValue, value])

  function update(part: keyof SlotDateTimeParts, nextValue: string) {
    const next = { ...currentValue, [part]: nextValue }
    if (onChange) {
      onChange(next)
    } else {
      setInternalValue(next)
    }
  }

  return (
    <div className="space-y-1">
      <span className="text-[13px] font-medium text-text">{label}</span>
      <input type="hidden" name={name} value={partsToDateTimeLocal(currentValue)} />
      <div className="grid grid-cols-[minmax(0,1fr)_86px_86px] gap-2">
        <Input
          aria-label={`${label} date`}
          type="date"
          value={currentValue.date}
          onChange={(event) => update('date', event.currentTarget.value)}
          required
        />
        <Select
          aria-label={`${label} hour`}
          value={currentValue.hour}
          onChange={(event) => update('hour', event.currentTarget.value)}
          required
        >
          <option value="" disabled>Hour</option>
          {HOUR_OPTIONS.map((hour) => (
            <option key={hour.value} value={hour.value}>{hour.label}</option>
          ))}
        </Select>
        <Select
          aria-label={`${label} minute`}
          value={currentValue.minute}
          onChange={(event) => update('minute', event.currentTarget.value)}
          required
        >
          <option value="" disabled>Minute</option>
          {MINUTE_OPTIONS.map((minute) => (
            <option key={minute} value={minute}>{minute}</option>
          ))}
        </Select>
      </div>
    </div>
  )
}

function ActionStateMessage({ state }: { state: any }) {
  if (!state) return null
  return (
    <p className={`text-xs ${state.success ? 'text-success' : 'text-danger'}`}>
      {state.success ? state.message || 'Saved.' : state.error}
    </p>
  )
}

function ProfileField({
  label,
  children,
  className,
}: {
  label: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <label className={['block space-y-1 text-xs font-medium text-text-muted', className].filter(Boolean).join(' ')}>
      <span>{label}</span>
      {children}
    </label>
  )
}

function SubmitButton({
  children,
  variant = 'primary',
  disabled = false,
}: {
  children: React.ReactNode
  variant?: 'primary' | 'secondary' | 'danger'
  disabled?: boolean
}) {
  return (
    <Button type="submit" size="sm" variant={variant} disabled={disabled}>
      {children}
    </Button>
  )
}

type RecruitmentActionResult = { success?: boolean; message?: string; error?: string } | null | void
type RecruitmentFormAction = (formData: FormData) => Promise<RecruitmentActionResult>

function ActionFeedbackForm({
  action,
  children,
  className,
  confirmTitle,
  confirmMessage,
  successMessage = 'Done.',
  onSuccess,
}: {
  action: RecruitmentFormAction
  children: React.ReactNode
  className?: string
  confirmTitle?: string
  confirmMessage?: string
  successMessage?: string
  onSuccess?: () => void
}) {
  const [pending, setPending] = useState(false)
  const [state, setState] = useState<{ success?: string; error?: string } | null>(null)
  const [confirmData, setConfirmData] = useState<FormData | null>(null)

  async function run(formData: FormData): Promise<void> {
    setPending(true)
    setState(null)
    try {
      const result = await action(formData)
      if (result && 'error' in result && result.error) {
        setState({ error: result.error })
        return
      }
      setState({ success: result && 'message' in result && result.message ? result.message : successMessage })
      onSuccess?.()
    } catch (error) {
      setState({ error: error instanceof Error ? error.message : 'Action failed.' })
    } finally {
      setPending(false)
    }
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    if (confirmMessage) {
      setConfirmData(formData)
      return
    }
    void run(formData)
  }

  return (
    <>
      <form onSubmit={handleSubmit} className={className}>
        {/* Disable all controls while the action is in flight to prevent double-submit.
            display:contents keeps the fieldset out of the layout so the form's own
            flex/grid classes still apply to the children. */}
        <fieldset disabled={pending} className="contents">
          {children}
        </fieldset>
        {pending && <p className="text-xs text-text-muted">Working...</p>}
        {state?.error && <p className="text-xs text-danger">{state.error}</p>}
        {state?.success && <p className="text-xs text-success">{state.success}</p>}
      </form>
      <ConfirmDialog
        open={Boolean(confirmData)}
        onClose={() => setConfirmData(null)}
        onConfirm={async () => {
          if (!confirmData) return
          await run(confirmData)
          setConfirmData(null)
        }}
        title={confirmTitle ?? 'Confirm action'}
        message={confirmMessage}
        confirmLabel="Confirm"
        tone="warning"
      />
    </>
  )
}

export default function RecruitmentDashboardClient({ initialData, permissions }: Props) {
  const router = useRouter()
  const [postingState, postingAction] = useActionState(createRecruitmentPostingAction, null)
  const [postingUpdateState, postingUpdateAction] = useActionState(updateRecruitmentPostingAction, null)
  const [postingDuplicateState, postingDuplicateAction] = useActionState(duplicateRecruitmentPostingAction, null)
  const [applicationState, applicationAction] = useActionState(createManualRecruitmentApplicationAction, null)
  const [candidateUpdateState, candidateUpdateAction] = useActionState(updateRecruitmentCandidateAction, null)
  const [slotState, slotAction] = useActionState(createRecruitmentSlotAction, null)
  const [slotUpdateState, slotUpdateAction] = useActionState(updateRecruitmentSlotAction, null)
  const [templateState, templateAction] = useActionState(saveRecruitmentEmailTemplateAction, null)
  const [scorecardState, scorecardAction] = useActionState(recordRecruitmentScorecardAction, null)
  const [retentionState, retentionAction] = useActionState(runRecruitmentRetentionAction, null)
  const [cvRetryState, cvRetryAction] = useActionState(retryRecruitmentCvExtractionAction, null)
  const [cvBatchState, cvBatchAction] = useActionState(retryManualReviewCvsAction, null)
  const [activeTab, setActiveTab] = useState<'pipeline' | 'applications' | 'postings' | 'schedule' | 'talent' | 'templates' | 'communications'>('pipeline')
  const [drawerTab, setDrawerTab] = useState<DrawerTab>('overview')
  const [decisionDialog, setDecisionDialog] = useState<null | { decision: 'reject'|'offer'|'decline_duplicate'|'withdraw'|'hold' }>(null)
  const [decisionEmail, setDecisionEmail] = useState<{ subject: string; body: string }>({ subject: '', body: '' })
  const [decisionSendEmail, setDecisionSendEmail] = useState(true)
  const [decisionLoadingPreview, setDecisionLoadingPreview] = useState(false)
  const [decisionState, decisionFormAction] = useActionState(decideRecruitmentApplicationAction, null)
  const [candidateTrail, setCandidateTrail] = useState<{ notes: any[]; systemChanges: any[] }>({ notes: [], systemChanges: [] })
  const [addNoteState, addNoteAction] = useActionState(addRecruitmentCandidateNoteAction, null)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [showArchived, setShowArchived] = useState(false)
  const [selectedBulkIds, setSelectedBulkIds] = useState<string[]>([])
  const [selectedPostingId, setSelectedPostingId] = useState<string | null>(null)
  const [postingDrawerOpen, setPostingDrawerOpen] = useState(false)
  const [selectedApplicationId, setSelectedApplicationId] = useState<string | null>(null)
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(null)
  const [detailDrawerOpen, setDetailDrawerOpen] = useState(false)
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null)
  const [slotDrawerOpen, setSlotDrawerOpen] = useState(false)
  const [selectedAppointmentId, setSelectedAppointmentId] = useState<string | null>(null)
  const [appointmentDrawerOpen, setAppointmentDrawerOpen] = useState(false)
  const [selectedCommunicationId, setSelectedCommunicationId] = useState<string | null>(null)
  const [communicationDrawerOpen, setCommunicationDrawerOpen] = useState(false)
  const [selectedTalentCandidateId, setSelectedTalentCandidateId] = useState<string | null>(null)
  const [talentDrawerOpen, setTalentDrawerOpen] = useState(false)
  const [emailDraft, setEmailDraft] = useState<{ type: string; subject: string; body: string; error?: string } | null>(null)
  const [emailSendState, setEmailSendState] = useState<{ success: boolean; message?: string; error?: string } | null>(null)
  const [printableText, setPrintableText] = useState<string | null>(null)
  const [clientMessage, setClientMessage] = useState<string | null>(null)
  const [newSlotStartsAt, setNewSlotStartsAt] = useState<SlotDateTimeParts>(emptySlotDateTime)
  const [newSlotEndsAt, setNewSlotEndsAt] = useState<SlotDateTimeParts>(emptySlotDateTime)
  const APPLICATION_PAGE_SIZE = 25
  const [applicationPage, setApplicationPage] = useState(1)
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
  const hireFormAction = inviteRecruitmentCandidateAsEmployeeAction as unknown as (formData: FormData) => Promise<void>
  const erasureFormAction = eraseRecruitmentCandidateAction as unknown as (formData: FormData) => Promise<void>
  const rescoreFormAction = rescoreRecruitmentApplicationAction as unknown as (formData: FormData) => Promise<void>
  const matchFormAction = matchRecruitmentCandidateAction as unknown as (formData: FormData) => Promise<void>
  const outcomeFormAction = recordRecruitmentAppointmentOutcomeAction as unknown as (formData: FormData) => Promise<void>
  const bulkFormAction = bulkRecruitmentApplicationsAction as unknown as (formData: FormData) => Promise<void>
  const archiveApplicationFormAction = archiveRecruitmentApplicationAction as unknown as (formData: FormData) => Promise<void>
  const restoreApplicationFormAction = restoreRecruitmentApplicationAction as unknown as (formData: FormData) => Promise<void>
  const cancelSlotFormAction = cancelRecruitmentSlotAction as unknown as (formData: FormData) => Promise<void>
  const archiveSlotFormAction = archiveRecruitmentSlotAction as unknown as (formData: FormData) => Promise<void>
  const restoreSlotFormAction = restoreRecruitmentSlotAction as unknown as (formData: FormData) => Promise<void>
  const cancelAppointmentFormAction = cancelRecruitmentAppointmentAction as unknown as (formData: FormData) => Promise<void>
  const rescheduleAppointmentFormAction = rescheduleRecruitmentAppointmentAction as unknown as (formData: FormData) => Promise<void>
  const scheduleInterviewFormAction = scheduleRecruitmentInterviewForCandidateAction as unknown as (formData: FormData) => Promise<void>
  const scheduleTrialFormAction = scheduleRecruitmentTrialForCandidateAction as unknown as (formData: FormData) => Promise<void>
  const archiveAppointmentFormAction = archiveRecruitmentAppointmentAction as unknown as (formData: FormData) => Promise<void>
  const restoreAppointmentFormAction = restoreRecruitmentAppointmentAction as unknown as (formData: FormData) => Promise<void>
  const retryCommunicationFormAction = retryRecruitmentCommunicationAction as unknown as (formData: FormData) => Promise<void>
  const cvRetryFormAction = (formData: FormData) => retryRecruitmentCvExtractionAction(null, formData)

  const applications = initialData.applications ?? []
  const postings = initialData.postings ?? []
  const slots = initialData.slots ?? []
  const appointments = initialData.appointments ?? []
  const candidates = initialData.candidates ?? []
  const communications = initialData.communications ?? []
  const templates = initialData.templates ?? []
  const scorecards = initialData.scorecards ?? []
  const statusEvents = initialData.statusEvents ?? []
  const aiRuns = initialData.aiRuns ?? []
  const dashboard = initialData.dashboard
  const activeApplications = applications.filter((application: any) => (
    application.status !== 'talent_pool'
    && application.status !== 'declined_duplicate'
    && !application.duplicate_of_application_id
    && !application.archived_at
  ))
  const selectedPosting = postings.find((posting: any) => posting.id === selectedPostingId) ?? null
  const selectedApplication = applications.find((application: any) => application.id === selectedApplicationId) ?? null
  const selectedSlot = slots.find((slot: any) => slot.id === selectedSlotId) ?? null
  const selectedAppointment = appointments.find((appointment: any) => appointment.id === selectedAppointmentId) ?? null
  const selectedCommunication = communications.find((communication: any) => communication.id === selectedCommunicationId) ?? null
  const selectedTalentCandidate = talentCandidates.find((candidate: any) => candidate.id === selectedTalentCandidateId)
    ?? candidates.find((candidate: any) => candidate.id === selectedTalentCandidateId)
    ?? null
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
      const isDuplicate = application.status === 'declined_duplicate' || Boolean(application.duplicate_of_application_id)
      const archivedMatches = showArchived ? Boolean(application.archived_at) : !application.archived_at
      const matchesStatus = statusFilter
        ? application.status === statusFilter && !isDuplicate
        : application.status !== 'talent_pool' && !isDuplicate
      return archivedMatches && (!query || haystack.includes(query)) && matchesStatus
    }).sort((a: any, b: any) => {
      const scoreDiff = (b.ai_score ?? -1) - (a.ai_score ?? -1)
      return scoreDiff || toTime(b.created_at) - toTime(a.created_at)
    })
  }, [applications, search, showArchived, statusFilter])

  const applicationTotalPages = Math.max(1, Math.ceil(filteredApplications.length / APPLICATION_PAGE_SIZE))
  const paginatedApplications = filteredApplications.slice(
    (applicationPage - 1) * APPLICATION_PAGE_SIZE,
    applicationPage * APPLICATION_PAGE_SIZE,
  )

  const filteredSlots = slots.filter((slot: any) => showArchived ? Boolean(slot.archived_at) : !slot.archived_at)
  const filteredAppointments = appointments.filter((appointment: any) => showArchived ? Boolean(appointment.archived_at) : !appointment.archived_at)
  const filteredCommunications = communications

  const pipeline = useMemo(() => {
    const columns = [
      'new',
      'ai_screened',
      'shortlisted',
      'interview_invited',
      'interview_scheduled',
      'trial_offered',
      'trial_scheduled',
      'offered',
    ]
    return columns.map(status => ({
      status,
      applications: filteredApplications.filter((application: any) => application.status === status),
    }))
  }, [filteredApplications])
  const selectedApplicationEvents = statusEvents.filter((event: any) => event.application_id === selectedApplication?.id).slice(0, 8)
  const selectedApplicationAiRuns = aiRuns.filter((run: any) => run.application_id === selectedApplication?.id || run.candidate_id === selectedCandidate?.id).slice(0, 8)
  const selectedApplicationAllCommunications = communications.filter((communication: any) => (
    communication.application_id === selectedApplication?.id || communication.candidate_id === selectedCandidate?.id
  ))
  const selectedApplicationCommunications = selectedApplicationAllCommunications.slice(0, 8)
  const previousEmailForDraft = emailDraft && !emailDraft.error
    ? selectedApplicationAllCommunications.find((communication: any) => (
      communication.type === emailDraft.type
      && ['queued', 'sent'].includes(communication.delivery_status)
    ))
    : null
  const duplicateEmailWarning = previousEmailForDraft
    ? `This ${emailDraft?.type.replaceAll('_', ' ')} email is already ${previousEmailForDraft.delivery_status} for this application (${formatDateTime(previousEmailForDraft.sent_at || previousEmailForDraft.created_at)}).`
    : null
  const selectedApplicationStatus = selectedApplication?.status ?? ''
  const candidateHasEmail = Boolean(selectedApplication?.candidate?.email)
  const interviewInviteSent = selectedApplicationAllCommunications.some((communication: any) => (
    communication.type === 'interview_invite'
    && ['queued', 'sent'].includes(communication.delivery_status)
  ))
  const trialInviteSent = selectedApplicationAllCommunications.some((communication: any) => (
    communication.type === 'trial_invite'
    && ['queued', 'sent'].includes(communication.delivery_status)
  ))
  const canSendInterviewBooking = Boolean(selectedApplication && [
    'new',
    'ai_screened',
    'shortlisted',
    'interview_invited',
    'on_hold',
  ].includes(selectedApplicationStatus))
  const canSendTrialBooking = Boolean(selectedApplication && [
    'interviewed',
    'trial_offered',
    'on_hold',
  ].includes(selectedApplicationStatus))
  const quickStatusActions = selectedApplication ? quickStatusActionsFor(selectedApplicationStatus) : []
  const nextActionHint = selectedApplication
    ? recruitmentNextActionHint(selectedApplicationStatus, interviewInviteSent, trialInviteSent)
    : null
  const selectedApplicationAppointments = appointments.filter((appointment: any) => (
    appointment.application_id === selectedApplication?.id || appointment.candidate_id === selectedCandidate?.id
  )).slice(0, 5)
  useEffect(() => {
    if (!detailDrawerOpen || !selectedCandidateId) {
      setCandidateTrail({ notes: [], systemChanges: [] })
      return
    }
    let cancelled = false
    getRecruitmentCandidateTrailAction(selectedCandidateId).then(result => {
      if (cancelled) return
      if (result.success && result.data) setCandidateTrail(result.data)
    })
    return () => { cancelled = true }
  }, [detailDrawerOpen, selectedCandidateId, addNoteState])
  const candidateTrailEvents = useMemo(() => {
    const events: Array<{ key: string; at: string; kind: string; title: string; detail?: string; actor?: string }> = []
    for (const note of candidateTrail.notes) {
      events.push({ key: `note-${note.id}`, at: note.created_at, kind: 'note', title: 'Note', detail: note.content, actor: note.created_by_email ?? undefined })
    }
    for (const event of selectedApplicationEvents) {
      events.push({ key: `status-${event.id}`, at: event.created_at, kind: 'status', title: `Status → ${String(event.to_status ?? '').replaceAll('_', ' ')}`, detail: event.note ?? undefined })
    }
    for (const comm of selectedApplicationCommunications) {
      events.push({ key: `comm-${comm.id}`, at: comm.created_at, kind: 'comms', title: `${String(comm.type ?? comm.channel ?? 'message').replaceAll('_', ' ')} · ${comm.delivery_status ?? ''}`, detail: comm.subject ?? undefined })
    }
    for (const apt of selectedApplicationAppointments) {
      events.push({ key: `appt-${apt.id}`, at: apt.created_at, kind: 'appointment', title: `${apt.type === 'trial_shift' ? 'Trial' : 'Interview'} scheduled`, detail: formatSlotDateTime(apt.scheduled_start) })
      if (apt.outcome_recorded_at) {
        events.push({ key: `apt-out-${apt.id}`, at: apt.outcome_recorded_at, kind: 'appointment', title: `Appointment outcome: ${String(apt.status ?? '').replaceAll('_', ' ')}`, detail: apt.outcome ?? undefined })
      }
    }
    for (const run of selectedApplicationAiRuns) {
      events.push({ key: `ai-${run.id}`, at: run.created_at, kind: 'ai', title: `AI ${String(run.operation ?? '').replaceAll('_', ' ')} · ${run.status ?? ''}`, detail: run.model ?? undefined })
    }
    for (const change of candidateTrail.systemChanges) {
      events.push({ key: `sys-${change.id}`, at: change.at, kind: 'system', title: `${String(change.operation_type ?? '').replaceAll('_', ' ')} ${String(change.resource_type ?? '').replace('recruitment_', '').replaceAll('_', ' ')}`.trim(), detail: (change.changed_keys ?? []).join(', ') || undefined, actor: change.actor ?? undefined })
    }
    return events.filter(e => e.at).sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
  }, [candidateTrail, selectedApplicationEvents, selectedApplicationCommunications, selectedApplicationAppointments, selectedApplicationAiRuns])
  // Duplicate guard is per APPLICATION (a candidate may hold several applications).
  const applicationHasFutureScheduled = (type: 'interview' | 'trial_shift') => appointments.some((appointment: any) => (
    appointment.application_id === selectedApplication?.id
    && appointment.type === type
    && appointment.status === 'scheduled'
    && toTime(appointment.scheduled_start) > Date.now()
  ))
  const openSlotsOfType = (type: 'interview' | 'trial_shift') => slots.filter((slot: any) => (
    !slot.archived_at
    && slot.status === 'open'
    && slot.type === type
    && toTime(slot.starts_at) > Date.now()
  ))
  const selectedApplicationHasScheduledInterview = applicationHasFutureScheduled('interview')
  const selectedApplicationHasScheduledTrial = applicationHasFutureScheduled('trial_shift')
  const selectedApplicationOpenInterviewSlots = openSlotsOfType('interview')
  const selectedApplicationOpenTrialSlots = openSlotsOfType('trial_shift')
  const canScheduleInterviewForCandidate = Boolean(selectedApplication && permissions.canEdit && !selectedApplicationHasScheduledInterview && [
    'new',
    'ai_screened',
    'shortlisted',
    'interview_invited',
    'on_hold',
  ].includes(selectedApplicationStatus))
  const canScheduleTrialForCandidate = Boolean(selectedApplication && permissions.canEdit && !selectedApplicationHasScheduledTrial && [
    'interviewed',
    'trial_offered',
    'on_hold',
  ].includes(selectedApplicationStatus))

  async function draftEmail(applicationId: string, type: string) {
    setClientMessage(null)
    setEmailSendState(null)
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

  async function sendDecisionEmail(formData: FormData) {
    setClientMessage(null)
    setEmailSendState(null)
    const result = await sendRecruitmentDecisionEmailAction(formData)
    if (!result.success) {
      setEmailSendState({ success: false, error: result.error })
      return
    }
    setEmailDraft(null)
    setEmailSendState({ success: true, message: result.message ?? 'Recruitment email sent.' })
    router.refresh()
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

  useEffect(() => {
    if (decisionState?.success) {
      setDecisionDialog(null)
      router.refresh()
    }
  }, [decisionState, router])

  function openDecision(decision: 'reject'|'offer'|'decline_duplicate'|'withdraw'|'hold') {
    if (!selectedApplication) return
    setDecisionDialog({ decision })
    const template = DECISION_CONFIG[decision].template
    setDecisionSendEmail(Boolean(template) && candidateHasEmail)
    setDecisionEmail({ subject: '', body: '' })
    if (template) {
      setDecisionLoadingPreview(true)
      previewRecruitmentDecisionEmailAction(selectedApplication.id, template).then(result => {
        setDecisionLoadingPreview(false)
        if (result.success && result.data) setDecisionEmail(result.data)
      })
    }
  }

  async function improveDecisionEmailWithAi() {
    if (!selectedApplication || !decisionDialog) return
    const template = DECISION_CONFIG[decisionDialog.decision].template
    if (!template) return
    try {
      const formData = new FormData()
      formData.set('application_id', selectedApplication.id)
      formData.set('type', template)
      const result = await draftRecruitmentEmailAction(formData)
      if (result?.success) {
        const data = result.data as { subject?: string; body?: string } | undefined
        if (data && (data.subject || data.body)) {
          setDecisionEmail({ subject: data.subject ?? '', body: data.body ?? '' })
        }
      }
    } catch {
      // best-effort — never block the dialog if the AI draft fails
    }
  }

  function openApplicationDetail(application: any) {
    setSelectedApplicationId(application.id)
    setSelectedCandidateId(application.candidate_id)
    setEmailDraft(null)
    setEmailSendState(null)
    setPrintableText(null)
    setClientMessage(null)
    setDrawerTab(['interview_invited', 'trial_offered'].includes(application.status) ? 'schedule' : 'overview')
    setDetailDrawerOpen(true)
  }

  function openPostingDetail(posting: any) {
    setSelectedPostingId(posting.id)
    setPostingDrawerOpen(true)
  }

  function openSlotDetail(slot: any) {
    setSelectedSlotId(slot.id)
    setSlotDrawerOpen(true)
  }

  function openAppointmentDetail(appointment: any) {
    setSelectedAppointmentId(appointment.id)
    setAppointmentDrawerOpen(true)
  }

  function openCommunicationDetail(communication: any) {
    setSelectedCommunicationId(communication.id)
    setCommunicationDrawerOpen(true)
  }

  function openTalentDetail(candidate: any) {
    setSelectedTalentCandidateId(candidate.id)
    setTalentDrawerOpen(true)
  }

  function toggleBulkId(applicationId: string, checked: boolean) {
    setSelectedBulkIds(ids => checked ? Array.from(new Set([...ids, applicationId])) : ids.filter(id => id !== applicationId))
  }

  async function exportApplicationsCsv() {
    setClientMessage(null)
    const formData = new FormData()
    selectedBulkIds.forEach(id => formData.append('ids', id))
    const result = await exportRecruitmentApplicationsCsvAction(formData)
    if (!result.success || !result.data?.csv) {
      setClientMessage(result.success ? 'Export failed.' : result.error)
      return
    }
    const blob = new Blob([result.data.csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'recruitment-applications.csv'
    link.click()
    URL.revokeObjectURL(url)
  }

  const talentTotalPages = Math.max(1, Math.ceil(talentTotal / TALENT_PAGE_SIZE))

  return (
    <main className="min-h-screen bg-bg">
      <div className="px-4 py-5 sm:px-6 lg:px-8 space-y-6">
        <PageHeader
          breadcrumbs={[{ label: 'People' }, { label: 'Recruitment' }]}
          title="Recruitment"
          subtitle="Review applicants, manage roles, schedule interviews and keep candidate communications tidy."
          className="mb-0"
          actions={permissions.canManage ? (
            <div className="flex flex-wrap items-start gap-2">
              <form action={cvBatchAction}>
                <input type="hidden" name="limit" value="10" />
                <Button type="submit" size="sm" variant="secondary" icon={<ArrowPathIcon className="h-4 w-4" />}>
                  Retry CV reviews
                </Button>
                <ActionStateMessage state={cvBatchState} />
              </form>
              <form action={retentionAction}>
                <Button type="submit" size="sm" variant="secondary" icon={<TrashIcon className="h-4 w-4" />}>
                  Run retention
                </Button>
                <ActionStateMessage state={retentionState} />
              </form>
            </div>
          ) : null}
        />

        <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {(dashboard?.actionItems ?? []).map((item: any) => {
            const inner = (
              <>
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
              </>
            )
            return (
              <Card key={item.id}>
                <CardBody>
                  {item.id === 'appointments' ? (
                    <button
                      type="button"
                      onClick={() => setActiveTab('schedule')}
                      aria-label="View upcoming interviews and trials"
                      className="flex w-full items-center justify-between gap-3 text-left"
                    >
                      {inner}
                    </button>
                  ) : (
                    <div className="flex items-center justify-between gap-3">{inner}</div>
                  )}
                </CardBody>
              </Card>
            )
          })}
        </section>

        <SectionNav
          activeId={activeTab}
          onSelect={(id) => setActiveTab(id as typeof activeTab)}
          items={[
            { id: 'pipeline', label: 'Pipeline', count: activeApplications.length },
            { id: 'applications', label: 'Applications', count: activeApplications.length },
            { id: 'postings', label: 'Postings', count: postings.length },
            { id: 'schedule', label: 'Schedule', count: appointments.length },
            { id: 'talent', label: 'Talent pool', count: talentTotal },
            { id: 'templates', label: 'Templates', count: templates.length },
            { id: 'communications', label: 'Comms', count: communications.length },
          ]}
        />

        {(activeTab === 'pipeline' || activeTab === 'applications') && (
          <section className="space-y-5">
            <div className="flex flex-col gap-3 md:flex-row md:items-center">
              <SearchInput
                value={search}
                onChange={(value) => {
                  setSearch(value)
                  setApplicationPage(1)
                  setSelectedBulkIds([])
                }}
                placeholder="Search candidates, role, status..."
                className="md:w-80"
              />
              <Select
                aria-label="Filter by status"
                value={statusFilter}
                onChange={event => {
                  setStatusFilter(event.target.value)
                  setApplicationPage(1)
                  setSelectedBulkIds([])
                }}
                className="md:w-48"
              >
                <option value="">Active statuses</option>
                {statusOptions.map(status => (
                  <option key={status} value={status}>{status.replaceAll('_', ' ')}</option>
                ))}
              </Select>
              <label className="flex items-center gap-2 text-sm text-text-muted">
                <input
                  type="checkbox"
                  checked={showArchived}
                  onChange={event => {
                    setShowArchived(event.target.checked)
                    setApplicationPage(1)
                    setSelectedBulkIds([])
                  }}
                />
                Show archived
              </label>
              {clientMessage && <p className="text-xs text-text-muted">{clientMessage}</p>}
            </div>

            {activeTab === 'pipeline' && (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-8">
                {pipeline.map(column => (
                  <div key={column.status} className="rounded-md border border-border bg-surface p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <h2 className="text-xs font-semibold uppercase text-text-muted">{column.status.replaceAll('_', ' ')}</h2>
                      <span className="text-xs text-text-muted">{column.applications.length}</span>
                    </div>
                    <div className="space-y-2">
                      {column.applications.length === 0 && (
                        <p className="rounded-md border border-dashed border-border bg-surface-2 p-3 text-xs text-text-muted">No applications</p>
                      )}
                      {column.applications.map((application: any) => {
                        const upcomingForApp = appointments
                          .filter((ap: any) => ap.application_id === application.id && ap.status === 'scheduled' && toTime(ap.scheduled_start) > Date.now())
                          .sort((a: any, b: any) => toTime(a.scheduled_start) - toTime(b.scheduled_start))
                        const nextAppt = upcomingForApp[0]
                        return (
                          <button
                            type="button"
                            key={application.id}
                            onClick={() => openApplicationDetail(application)}
                            className="w-full rounded-md border border-border bg-surface-2 p-2 text-left hover:border-primary"
                          >
                            <p className="truncate text-sm font-medium text-text-strong">{candidateName(application.candidate)}</p>
                            <p className="truncate text-xs text-text-muted">{roleTitle(application)}</p>
                            <div className="mt-1 flex items-center justify-between gap-2">
                              <Badge tone={scoreTone(application.ai_score)}>
                                {scoreText(application.ai_score)}
                              </Badge>
                              <span className="truncate text-xs text-text-muted">{formatDateTime(application.created_at)}</span>
                            </div>
                            {nextAppt && (
                              <p className="mt-1 truncate text-xs text-primary">
                                <ClockIcon className="mr-1 inline h-3 w-3" aria-hidden="true" />
                                {nextAppt.type === 'trial_shift' ? 'Trial' : 'Interview'} {formatSlotDateTime(nextAppt.scheduled_start)}
                              </p>
                            )}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {activeTab === 'applications' && (
              <Card>
                <CardHeader title="Applications" />
                <CardBody>
                {permissions.canEdit && selectedBulkIds.length > 0 && (
                  <ActionFeedbackForm
                    action={bulkFormAction}
                    className="mb-3 flex flex-wrap items-center gap-2 rounded-md border border-border bg-surface-2 p-3"
                    confirmTitle="Apply bulk action"
                    confirmMessage="Apply this change to the selected applications?"
                    successMessage="Bulk action applied."
                  >
                    {selectedBulkIds.map(id => <input key={id} type="hidden" name="ids" value={id} />)}
                    <span className="text-sm text-text-muted">{selectedBulkIds.length} selected</span>
                    <Select name="bulk_action" defaultValue="status" className="w-36">
                      <option value="status">Set status</option>
                      <option value="reject">Reject</option>
                      <option value="archive">Archive</option>
                      <option value="restore">Restore</option>
                    </Select>
                    <Select name="status" defaultValue="on_hold" className="w-44">
                      {statusOptions.map(status => (
                        <option key={status} value={status}>{status.replaceAll('_', ' ')}</option>
                      ))}
                    </Select>
                    <Input name="note" placeholder="Note or rejection reason" className="w-56" />
                    <SubmitButton variant="secondary">Apply</SubmitButton>
                    {permissions.canExport && (
                      <Button type="button" size="sm" variant="secondary" onClick={exportApplicationsCsv}>
                        Export CSV
                      </Button>
                    )}
                  </ActionFeedbackForm>
                )}
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>
                        <input
                          type="checkbox"
                          checked={paginatedApplications.length > 0 && paginatedApplications.every((application: any) => selectedBulkIds.includes(application.id))}
                          onChange={event => {
                            const pageIds = paginatedApplications.map((application: any) => application.id)
                            setSelectedBulkIds((current) => event.target.checked
                              ? Array.from(new Set([...current, ...pageIds]))
                              : current.filter((id) => !pageIds.includes(id)))
                          }}
                          aria-label="Select all applications on this page"
                        />
                      </TableHead>
                      <TableHead>Candidate</TableHead>
                      <TableHead>Applied</TableHead>
                      <TableHead>Role</TableHead>
                      <TableHead>Score</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paginatedApplications.map((application: any) => (
                      <TableRow
                        key={application.id}
                        className={[
                          scoreRowClass(application.ai_score),
                          selectedApplication?.id === application.id ? 'bg-primary/5' : '',
                        ].filter(Boolean).join(' ')}
                      >
                        <TableCell className="align-top">
                          <input
                            type="checkbox"
                            checked={selectedBulkIds.includes(application.id)}
                            onChange={event => toggleBulkId(application.id, event.target.checked)}
                            aria-label={`Select ${candidateName(application.candidate)}`}
                          />
                        </TableCell>
                        <TableCell className="align-top whitespace-normal">
                          <button
                            type="button"
                            className="text-left font-medium text-text-strong hover:text-primary hover:underline"
                            onClick={() => openApplicationDetail(application)}
                          >
                            {candidateName(application.candidate)}
                          </button>
                          <p className="text-xs text-text-muted">{application.candidate?.email}</p>
                        </TableCell>
                        <TableCell className="align-top whitespace-normal text-sm text-text">
                          {formatDateTime(application.created_at)}
                        </TableCell>
                        <TableCell className="align-top whitespace-normal">{roleTitle(application)}</TableCell>
                        <TableCell className="align-top">
                          <Badge tone={scoreTone(application.ai_score)}>
                            {scoreText(application.ai_score)}
                          </Badge>
                          {application.ai_recommendation && (
                            <span className="ml-2 text-xs text-text-muted">{application.ai_recommendation.replaceAll('_', ' ')}</span>
                          )}
                          {application.job_posting?.version && application.ai_scored_against_version && application.ai_scored_against_version !== application.job_posting.version && (
                            <Badge tone="warning" className="ml-2">stale</Badge>
                          )}
                        </TableCell>
                        <TableCell className="align-top">
                          {application.status.replaceAll('_', ' ')}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {filteredApplications.length === 0 && (
                  <p className="py-6 text-center text-sm text-text-muted">
                    {showArchived ? 'No archived applications match.' : 'No active applications match.'}
                  </p>
                )}
                {filteredApplications.length > APPLICATION_PAGE_SIZE && (
                  <TablePagination
                    page={applicationPage}
                    totalPages={applicationTotalPages}
                    totalItems={filteredApplications.length}
                    pageSize={APPLICATION_PAGE_SIZE}
                    onPageChange={(page) => setApplicationPage(page)}
                  />
                )}
                </CardBody>
              </Card>
            )}

            <Drawer
              open={detailDrawerOpen && Boolean(selectedApplication)}
              onClose={() => setDetailDrawerOpen(false)}
              title={selectedApplication ? candidateName(selectedApplication.candidate) : 'Application detail'}
              width="min(980px, 100vw)"
            >
              {selectedApplication && (
                <div className="space-y-4">
                  <div className="space-y-3 border-b border-border pb-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-base font-semibold text-text-strong">{candidateName(selectedApplication.candidate)}</p>
                      <Badge tone="neutral">{statusLabel(selectedApplication.status)}</Badge>
                      <Badge tone="neutral">AI {selectedApplication.ai_score ?? '-'} · {selectedApplication.ai_recommendation?.replaceAll('_', ' ') || 'review'}</Badge>
                    </div>
                    <p className="text-xs text-text-muted">{roleTitle(selectedApplication)} · {selectedApplication.source} · {formatDateTime(selectedApplication.created_at)}</p>
                    <div className="flex flex-wrap gap-2">
                      <Badge tone={rtwTone(selectedApplication.candidate?.right_to_work_status)}>RTW: {rtwLabel(selectedApplication.candidate?.right_to_work_status)}</Badge>
                      {selectedApplication.candidate?.sms_consent === true && <Badge tone="success">SMS ok</Badge>}
                      {selectedApplication.candidate?.future_recruitment_consent === true && <Badge tone="success">Future ok</Badge>}
                    </div>
                    <p className="text-sm text-text-muted">{selectedApplication.candidate?.email || 'No email on file'} · {selectedApplication.candidate?.phone || selectedApplication.candidate?.phone_e164 || 'No phone on file'}</p>
                    {nextActionHint && (
                      <div className="rounded border border-border bg-surface-2 p-3">
                        <p className="text-xs font-semibold uppercase text-text-muted">Next step</p>
                        <p className="mt-1 text-sm text-text">{nextActionHint}</p>
                      </div>
                    )}
                    <div className="flex flex-wrap gap-2">
                      {selectedApplication.candidate?.cv_file_path && (
                        <Button type="button" size="sm" variant="secondary" icon={<DocumentTextIcon className="h-4 w-4" />} onClick={() => openCv(selectedApplication.candidate_id)}>Open CV</Button>
                      )}
                      <Button type="button" size="sm" variant="secondary" icon={<PrinterIcon className="h-4 w-4" />} onClick={() => buildPrintable(selectedApplication.id, 'interview')}>Interview kit</Button>
                      <Button type="button" size="sm" variant="secondary" icon={<PrinterIcon className="h-4 w-4" />} onClick={() => buildPrintable(selectedApplication.id, 'trial')}>Trial brief</Button>
                    </div>
                  </div>

                  <div role="tablist" className="flex flex-wrap gap-1 border-b border-border">
                    {DRAWER_TABS.map(tab => (
                      <button key={tab.id} type="button" role="tab" aria-selected={drawerTab === tab.id} onClick={() => setDrawerTab(tab.id)} className={`-mb-px border-b-2 px-3 py-2 text-sm ${drawerTab === tab.id ? 'border-primary text-text-strong' : 'border-transparent text-text-muted hover:text-text'}`}>{tab.label}</button>
                    ))}
                  </div>

                  {drawerTab === 'overview' && (
                    <div className="space-y-4">
                      {permissions.canEdit && (
                        <div className="space-y-2">
                          <p className="text-xs font-semibold uppercase text-text-muted">Stage</p>
                          {quickStatusActions.filter(action => !DECISION_STATUSES.includes(action.status)).length > 0 && (
                            <div className="flex flex-wrap gap-2">
                              {quickStatusActions.filter(action => !DECISION_STATUSES.includes(action.status)).map(action => (
                                <ActionFeedbackForm
                                  key={action.status}
                                  action={statusFormAction}
                                  successMessage={`${statusLabel(action.status)} saved.`}
                                  confirmTitle={action.confirmTitle}
                                  confirmMessage={action.confirmMessage}
                                  onSuccess={() => router.refresh()}
                                >
                                  <input type="hidden" name="application_id" value={selectedApplication.id} />
                                  <input type="hidden" name="status" value={action.status} />
                                  <input type="hidden" name="note" value={action.note} />
                                  <SubmitButton variant={action.variant ?? 'secondary'}>{action.label}</SubmitButton>
                                </ActionFeedbackForm>
                              ))}
                            </div>
                          )}
                          <div className="flex flex-wrap gap-2">
                            {permissions.canEdit && <Button type="button" size="sm" variant="danger" onClick={() => openDecision('reject')}>Reject</Button>}
                            {permissions.canManage && <Button type="button" size="sm" variant="secondary" onClick={() => openDecision('offer')}>Make offer</Button>}
                            {permissions.canManage && <Button type="button" size="sm" variant="secondary" onClick={() => openDecision('decline_duplicate')}>Already considered</Button>}
                            {permissions.canEdit && <Button type="button" size="sm" variant="secondary" onClick={() => openDecision('withdraw')}>Withdraw</Button>}
                            {permissions.canEdit && <Button type="button" size="sm" variant="secondary" onClick={() => openDecision('hold')}>Hold</Button>}
                          </div>
                          <ActionFeedbackForm
                            action={statusFormAction}
                            className="flex flex-wrap items-center gap-2"
                            successMessage="Status saved."
                            onSuccess={() => router.refresh()}
                          >
                            <input type="hidden" name="application_id" value={selectedApplication.id} />
                            <Select name="status" defaultValue={selectedApplication.status} className="w-44" aria-label="Manual status">
                              {statusOptions.map(status => (
                                <option key={status} value={status}>{statusLabel(status)}</option>
                              ))}
                            </Select>
                            <input type="hidden" name="note" value="Status changed manually" />
                            <SubmitButton variant="secondary">Save manual status</SubmitButton>
                          </ActionFeedbackForm>
                        </div>
                      )}

                      {(() => {
                        const a = selectedApplication
                        const answerRows: Array<[string, string]> = []
                        const pushAnswer = (label: string, value: unknown) => {
                          if (value === null || value === undefined) return
                          const text = typeof value === 'string' ? value : JSON.stringify(value)
                          const trimmed = text.trim()
                          if (trimmed.length === 0 || trimmed === '{}' || trimmed === '[]' || trimmed === 'null') return
                          answerRows.push([label, trimmed])
                        }
                        const availabilityText = a?.availability && typeof a.availability === 'object'
                          ? (a.availability.raw ?? a.availability.text ?? null)
                          : a?.availability
                        pushAnswer('Availability', availabilityText)
                        pushAnswer('Experience', a?.relevant_experience_answer)
                        pushAnswer('Travel', a?.travel_answer)
                        pushAnswer('Can start', a?.start_availability)
                        pushAnswer('Cover note', a?.cover_note)
                        if (answerRows.length === 0) return null
                        return (
                          <div>
                            <p className="text-xs font-semibold uppercase text-text-muted">Their answers</p>
                            <dl className="mt-1 space-y-1 text-sm text-text">
                              {answerRows.map(([label, value]) => (
                                <div key={label}><span className="text-text-muted">{label}:</span> {value}</div>
                              ))}
                            </dl>
                          </div>
                        )
                      })()}

                      <div>
                        <p className="text-xs font-semibold uppercase text-text-muted">AI score</p>
                        <p className="text-2xl font-semibold text-text-strong">{selectedApplication.ai_score ?? '-'}</p>
                        <p className="text-sm text-text-muted">{selectedApplication.ai_recommendation?.replaceAll('_', ' ') || 'Manual review'}</p>
                      </div>
                      {selectedCvExtractionMessage && (
                        <div className="rounded border border-warning/30 bg-warning-soft p-3 text-sm text-warning-fg">
                          <p className="font-medium">CV extraction needs review</p>
                          <p className="mt-1">{selectedCvExtractionMessage}</p>
                          {selectedApplication.candidate?.cv_file_path && (
                            <ActionFeedbackForm action={cvRetryFormAction} className="mt-2 flex flex-wrap items-center gap-2" successMessage="CV extraction retry queued.">
                              <input type="hidden" name="candidate_id" value={selectedApplication.candidate_id} />
                              <Button type="submit" size="xs" variant="secondary" icon={<ArrowPathIcon className="h-4 w-4" />}>
                                Retry extraction
                              </Button>
                            </ActionFeedbackForm>
                          )}
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

                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <div className="rounded border border-border bg-surface-2 p-3">
                          <p className="text-xs font-semibold uppercase text-text-muted">Right to work</p>
                          <p className="mt-1 text-sm text-text">{rtwLabel(selectedApplication.candidate?.right_to_work_status)}{selectedApplication.candidate?.right_to_work_document_type ? ` · ${selectedApplication.candidate.right_to_work_document_type}` : ''}</p>
                          {selectedApplication.candidate?.right_to_work_checked_at && (
                            <p className="text-xs text-text-muted">Checked {formatDateTime(selectedApplication.candidate.right_to_work_checked_at)}</p>
                          )}
                        </div>
                        <div className="rounded border border-border bg-surface-2 p-3">
                          <p className="text-xs font-semibold uppercase text-text-muted">Consent</p>
                          <p className="mt-1 text-sm text-text">SMS: {selectedApplication.candidate?.sms_consent ? 'yes' : 'no'} · Future: {selectedApplication.candidate?.future_recruitment_consent ? 'yes' : 'no'}</p>
                        </div>
                      </div>
                    </div>
                  )}

                  {drawerTab === 'schedule' && (
                    <div className="space-y-3">
                      <div className="space-y-2">
                        <p className="text-xs font-semibold uppercase text-text-muted">Interviews and trials</p>
                        {selectedApplicationAppointments.length === 0 && (
                          <p className="text-sm text-text-muted">No interview or trial scheduled yet.</p>
                        )}
                        {selectedApplicationAppointments.map((apt: any) => {
                          const aptScorecards = scorecards.filter((sc: any) => sc.appointment_id === apt.id)
                          const interviewerName = apt.supervisor
                            ? [apt.supervisor.first_name, apt.supervisor.last_name].filter(Boolean).join(' ')
                            : ''
                          const rescheduleSlots = slots.filter((slot: any) => (
                            !slot.archived_at && slot.status === 'open' && slot.type === apt.type
                          ))
                          return (
                            <div key={apt.id} className="space-y-1 rounded border border-border bg-surface-2 p-3">
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-sm font-medium text-text-strong">{apt.type === 'trial_shift' ? 'Trial shift' : 'Interview'}</span>
                                <Badge tone="neutral">{String(apt.status).replaceAll('_', ' ')}</Badge>
                              </div>
                              <p className="text-sm text-text">{formatSlotDateTime(apt.scheduled_start)}</p>
                              <p className="text-xs text-text-muted">
                                {apt.location || 'The Anchor'}
                                {interviewerName ? ` · Interviewer: ${interviewerName}` : ''}
                                {` · Calendar: ${calendarSyncLabel(apt.calendar_sync_status)}`}
                              </p>
                              {apt.outcome && <p className="text-xs text-text-muted">Outcome: {apt.outcome}</p>}
                              {aptScorecards.map((sc: any) => (
                                <p key={sc.id} className="text-xs text-text-muted">
                                  Scorecard: {sc.recommendation?.replaceAll('_', ' ') || 'recorded'}
                                  {sc.overall_rating ? ` · ${sc.overall_rating}/5` : ''}
                                  {sc.comments ? ` · ${sc.comments}` : ''}
                                </p>
                              ))}
                              {permissions.canEdit && !apt.archived_at && (
                                <details className="mt-1">
                                  <summary className="cursor-pointer text-xs font-medium text-primary">Manage</summary>
                                  <div className="mt-2 space-y-3 border-t border-border pt-3">
                                    <form action={outcomeFormAction} className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                                      <input type="hidden" name="appointment_id" value={apt.id} />
                                      <Field label="Outcome">
                                        <Select name="status" defaultValue={apt.status}>
                                          <option value="scheduled">Scheduled</option>
                                          <option value="completed">Completed</option>
                                          <option value="no_show">No-show</option>
                                          <option value="cancelled">Cancelled</option>
                                        </Select>
                                      </Field>
                                      <Field label="Rating">
                                        <Select name="outcome_rating" defaultValue={apt.outcome_rating ?? ''}>
                                          <option value="">Rating</option>
                                          <option value="1">1</option>
                                          <option value="2">2</option>
                                          <option value="3">3</option>
                                          <option value="4">4</option>
                                          <option value="5">5</option>
                                        </Select>
                                      </Field>
                                      <label className="flex items-center gap-2 text-sm sm:col-span-2">
                                        <input type="checkbox" name="meal_provided" defaultChecked={apt.meal_provided === true} />
                                        Meal provided
                                      </label>
                                      <div className="sm:col-span-2">
                                        <Field label="Notes">
                                          <Textarea name="outcome" defaultValue={apt.outcome ?? ''} rows={2} />
                                        </Field>
                                      </div>
                                      <div className="sm:col-span-2">
                                        <SubmitButton variant="secondary">Save outcome</SubmitButton>
                                      </div>
                                    </form>
                                    <div className="flex flex-wrap gap-2 border-t border-border pt-3">
                                      {rescheduleSlots.length > 0 && (
                                        <ActionFeedbackForm
                                          action={rescheduleAppointmentFormAction}
                                          className="flex flex-wrap gap-2"
                                          successMessage="Appointment rescheduled."
                                          onSuccess={() => router.refresh()}
                                        >
                                          <input type="hidden" name="appointment_id" value={apt.id} />
                                          <Select name="slot_id" className="w-48" aria-label="Reschedule slot">
                                            {rescheduleSlots.map((slot: any) => (
                                              <option key={slot.id} value={slot.id}>{formatSlotDateTime(slot.starts_at)}</option>
                                            ))}
                                          </Select>
                                          <SubmitButton variant="secondary">Reschedule</SubmitButton>
                                        </ActionFeedbackForm>
                                      )}
                                      <ActionFeedbackForm
                                        action={cancelAppointmentFormAction}
                                        className="flex flex-wrap gap-2"
                                        confirmTitle="Cancel appointment"
                                        confirmMessage="Cancel this appointment and notify the candidate if configured?"
                                        successMessage="Appointment cancelled."
                                        onSuccess={() => router.refresh()}
                                      >
                                        <input type="hidden" name="appointment_id" value={apt.id} />
                                        <Input name="reason" placeholder="Cancel reason" className="w-40" />
                                        <SubmitButton variant="secondary">Cancel</SubmitButton>
                                      </ActionFeedbackForm>
                                    </div>
                                  </div>
                                </details>
                              )}
                            </div>
                          )
                        })}
                      </div>

                      <div className="space-y-2">
                        <p className="text-xs font-semibold uppercase text-text-muted">Booking links</p>
                        {!candidateHasEmail && permissions.canSend && (
                          <p className="text-xs text-text-muted">Add an email address before sending booking links.</p>
                        )}
                        <div className="flex flex-wrap gap-2">
                          {permissions.canSend && candidateHasEmail && canSendInterviewBooking && (
                            <ActionFeedbackForm
                              action={bookingInviteFormAction}
                              successMessage={interviewInviteSent ? 'Interview booking link resent.' : 'Interview booking link sent.'}
                              confirmTitle={interviewInviteSent ? 'Resend interview link' : undefined}
                              confirmMessage={interviewInviteSent ? 'An interview invite has already been sent. Send another booking link?' : undefined}
                              onSuccess={() => router.refresh()}
                            >
                              <input type="hidden" name="application_id" value={selectedApplication.id} />
                              <input type="hidden" name="type" value="interview" />
                              <SubmitButton variant={interviewInviteSent ? 'secondary' : 'primary'}>
                                {interviewInviteSent ? 'Resend interview booking link' : 'Send interview booking link'}
                              </SubmitButton>
                            </ActionFeedbackForm>
                          )}
                          {permissions.canSend && candidateHasEmail && canSendTrialBooking && (
                            <ActionFeedbackForm
                              action={bookingInviteFormAction}
                              successMessage={trialInviteSent ? 'Trial booking link resent.' : 'Trial booking link sent.'}
                              confirmTitle={trialInviteSent ? 'Resend trial link' : undefined}
                              confirmMessage={trialInviteSent ? 'A trial invite has already been sent. Send another booking link?' : undefined}
                              onSuccess={() => router.refresh()}
                            >
                              <input type="hidden" name="application_id" value={selectedApplication.id} />
                              <input type="hidden" name="type" value="trial_shift" />
                              <SubmitButton variant={trialInviteSent ? 'secondary' : 'primary'}>
                                {trialInviteSent ? 'Resend trial booking link' : 'Send trial booking link'}
                              </SubmitButton>
                            </ActionFeedbackForm>
                          )}
                        </div>
                      </div>
                      {canScheduleInterviewForCandidate && (
                        <div className="space-y-2 rounded border border-border bg-surface-2 p-3">
                          <p className="text-xs font-semibold uppercase text-text-muted">Schedule interview for candidate</p>
                          {selectedApplicationOpenInterviewSlots.length === 0 && (
                            <p className="text-xs text-text-muted">No open interview slots available.</p>
                          )}
                          <ActionFeedbackForm
                            action={scheduleInterviewFormAction}
                            className="flex flex-wrap items-center gap-2"
                            successMessage="Interview scheduled."
                            confirmTitle="Schedule interview"
                            confirmMessage={`Schedule an interview for ${candidateName(selectedApplication.candidate)}? They'll get a confirmation email with a calendar invite.`}
                            onSuccess={() => router.refresh()}
                          >
                            <input type="hidden" name="application_id" value={selectedApplication.id} />
                            <Select
                              name="slot_id"
                              className="w-72"
                              aria-label="Interview slot to schedule"
                              disabled={selectedApplicationOpenInterviewSlots.length === 0}
                            >
                              {selectedApplicationOpenInterviewSlots.map((slot: any) => (
                                <option key={slot.id} value={slot.id}>
                                  {formatSlotOptionLabel(slot)}
                                </option>
                              ))}
                            </Select>
                            <SubmitButton
                              variant={selectedApplicationStatus === 'interview_invited' ? 'primary' : 'secondary'}
                              disabled={selectedApplicationOpenInterviewSlots.length === 0}
                            >
                              Schedule interview
                            </SubmitButton>
                          </ActionFeedbackForm>
                        </div>
                      )}
                      {canScheduleTrialForCandidate && (
                        <div className="space-y-2 rounded border border-border bg-surface-2 p-3">
                          <p className="text-xs font-semibold uppercase text-text-muted">Schedule trial shift for candidate</p>
                          {selectedApplicationOpenTrialSlots.length === 0 && (
                            <p className="text-xs text-text-muted">No open trial shift slots available.</p>
                          )}
                          <ActionFeedbackForm
                            action={scheduleTrialFormAction}
                            className="flex flex-wrap items-center gap-2"
                            successMessage="Trial shift scheduled."
                            confirmTitle="Schedule trial shift"
                            confirmMessage={`Schedule a trial shift for ${candidateName(selectedApplication.candidate)}? They'll get a confirmation email with a calendar invite.`}
                            onSuccess={() => router.refresh()}
                          >
                            <input type="hidden" name="application_id" value={selectedApplication.id} />
                            <Select
                              name="slot_id"
                              className="w-72"
                              aria-label="Trial shift slot to schedule"
                              disabled={selectedApplicationOpenTrialSlots.length === 0}
                            >
                              {selectedApplicationOpenTrialSlots.map((slot: any) => (
                                <option key={slot.id} value={slot.id}>
                                  {formatSlotOptionLabel(slot)}
                                </option>
                              ))}
                            </Select>
                            <SubmitButton
                              variant={selectedApplicationStatus === 'trial_offered' ? 'primary' : 'secondary'}
                              disabled={selectedApplicationOpenTrialSlots.length === 0}
                            >
                              Schedule trial shift
                            </SubmitButton>
                          </ActionFeedbackForm>
                        </div>
                      )}
                    </div>
                  )}

                  {drawerTab === 'comms' && (
                    <div className="space-y-4">
                      <div className="space-y-2">
                        <p className="text-xs font-semibold uppercase text-text-muted">Email composer</p>
                        {permissions.canSend ? (
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
                        ) : (
                          <p className="text-sm text-text-muted">You do not have permission to send recruitment emails.</p>
                        )}
                        {emailDraft?.error && <p className="text-xs text-danger">{emailDraft.error}</p>}
                        <ActionStateMessage state={emailSendState} />
                        {emailDraft && !emailDraft.error && (
                          <form action={sendDecisionEmail} className="space-y-2">
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
                            {duplicateEmailWarning && (
                              <p className="rounded border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
                                {duplicateEmailWarning}
                              </p>
                            )}
                            <SubmitButton>Send reviewed email</SubmitButton>
                          </form>
                        )}
                      </div>

                      <div className="space-y-2">
                        <p className="text-xs font-semibold uppercase text-text-muted">Communications</p>
                        {selectedApplicationCommunications.map((communication: any) => (
                          <div key={communication.id} className="rounded border border-border bg-surface-2 p-2">
                            <p className="text-sm font-medium text-text-strong">{communication.type?.replaceAll('_', ' ')} · {communication.delivery_status}</p>
                            <p className="text-xs text-text-muted">{formatDateTime(communication.created_at)} · {communication.subject || communication.channel}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {drawerTab === 'activity' && (
                    <div className="space-y-4">
                      {permissions.canEdit && (
                        <form action={addNoteAction} className="space-y-2">
                          <input type="hidden" name="candidate_id" value={selectedApplication.candidate_id} />
                          <input type="hidden" name="application_id" value={selectedApplication.id} />
                          <Textarea name="content" placeholder="Add an internal note — date-stamped, visible to recruitment staff" rows={2} />
                          <div className="flex items-center gap-2">
                            <SubmitButton variant="secondary">Add note</SubmitButton>
                            <ActionStateMessage state={addNoteState} />
                          </div>
                        </form>
                      )}
                      <div className="space-y-2">
                        <p className="text-xs font-semibold uppercase text-text-muted">Audit trail</p>
                        {candidateTrailEvents.length === 0 && <p className="text-sm text-text-muted">No activity yet.</p>}
                        {candidateTrailEvents.map(ev => (
                          <div key={ev.key} className="rounded border border-border bg-surface-2 p-2">
                            <p className="text-sm font-medium text-text-strong">{ev.title}</p>
                            {ev.detail && <p className="whitespace-pre-wrap text-xs text-text">{ev.detail}</p>}
                            <p className="text-xs text-text-muted">{formatSlotDateTime(ev.at)}{ev.actor ? ` · ${ev.actor}` : ''}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {drawerTab === 'profile' && (
                    <div className="space-y-4">
                      {(() => {
                        const candidate = selectedApplication.candidate
                        const otherApplications = applications.filter((app: any) => (
                          app.candidate_id === selectedApplication.candidate_id && app.id !== selectedApplication.id
                        ))
                        const isTalentPool = selectedApplication.status === 'talent_pool'
                        const converted = Boolean(candidate?.converted_employee_id)
                        if (otherApplications.length === 0 && !isTalentPool && !converted) return null
                        return (
                          <div className="space-y-1 rounded border border-border bg-surface-2 p-3">
                            <p className="text-xs font-semibold uppercase text-text-muted">Candidate status</p>
                            {converted && <p className="text-sm text-text">Converted to employee</p>}
                            {isTalentPool && <p className="text-sm text-text">In talent pool</p>}
                            {otherApplications.length > 0 && (
                              <div className="text-sm text-text">
                                <p className="text-xs text-text-muted">Other applications</p>
                                {otherApplications.map((app: any) => (
                                  <p key={app.id} className="text-xs text-text-muted">
                                    {roleTitle(app)} · {statusLabel(app.status)} · {formatDateTime(app.created_at)}
                                  </p>
                                ))}
                              </div>
                            )}
                          </div>
                        )
                      })()}
                      <form action={candidateUpdateAction} className="space-y-3">
                        <input type="hidden" name="candidate_id" value={selectedApplication.candidate_id} />
                        <p className="text-xs font-semibold uppercase text-text-muted">Candidate profile</p>
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                          <ProfileField label="First name">
                            <Input name="first_name" defaultValue={selectedApplication.candidate?.first_name ?? ''} placeholder="First name" />
                          </ProfileField>
                          <ProfileField label="Last name">
                            <Input name="last_name" defaultValue={selectedApplication.candidate?.last_name ?? ''} placeholder="Last name" />
                          </ProfileField>
                        </div>
                        <ProfileField label="Email">
                          <Input name="email" defaultValue={selectedApplication.candidate?.email ?? ''} placeholder="Email" />
                        </ProfileField>
                        <ProfileField label="Phone">
                          <Input name="phone" defaultValue={selectedApplication.candidate?.phone ?? ''} placeholder="Phone" />
                        </ProfileField>
                        <ProfileField label="Location">
                          <Input name="location" defaultValue={selectedApplication.candidate?.location ?? ''} placeholder="Location" />
                        </ProfileField>
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                          <ProfileField label="Right to work">
                            <Select name="right_to_work_status" defaultValue={selectedApplication.candidate?.right_to_work_status ?? 'not_checked'}>
                              <option value="not_checked">Not checked</option>
                              <option value="pending">Pending</option>
                              <option value="verified">Verified</option>
                              <option value="failed">Failed</option>
                            </Select>
                          </ProfileField>
                          <ProfileField label="Document type">
                            <Select name="right_to_work_document_type" defaultValue={selectedApplication.candidate?.right_to_work_document_type ?? ''}>
                              <option value="">Not set</option>
                              <option value="Passport">Passport</option>
                              <option value="Biometric Residence Permit">Biometric Residence Permit</option>
                              <option value="Share Code">Share Code</option>
                              <option value="List A">List A</option>
                              <option value="List B">List B</option>
                              <option value="Other">Other</option>
                            </Select>
                          </ProfileField>
                        </div>
                        <ProfileField label="Right to work checked at">
                          <Input name="right_to_work_checked_at" type="datetime-local" defaultValue={todayLocalDateTime(selectedApplication.candidate?.right_to_work_checked_at)} />
                        </ProfileField>
                        <ProfileField label="Notes for AI context">
                          <Textarea name="notes" defaultValue={selectedApplication.candidate?.notes ?? ''} placeholder="Recruitment notes" rows={3} />
                        </ProfileField>
                        <div className="grid grid-cols-1 gap-2 text-sm text-text sm:grid-cols-2">
                          <label className="flex items-center gap-2">
                            <input type="checkbox" name="sms_consent" defaultChecked={selectedApplication.candidate?.sms_consent === true} />
                            SMS consent
                          </label>
                          <label className="flex items-center gap-2">
                            <input type="checkbox" name="future_recruitment_consent" defaultChecked={selectedApplication.candidate?.future_recruitment_consent === true} />
                            Future recruitment consent
                          </label>
                        </div>
                        <div className="flex items-center gap-2">
                          <SubmitButton>Save candidate</SubmitButton>
                          <ActionStateMessage state={candidateUpdateState} />
                        </div>
                      </form>

                      <div className="space-y-2">
                        <p className="text-xs font-semibold uppercase text-text-muted">Admin</p>
                        {permissions.canManage && selectedApplication.job_posting_id && (
                          <ActionFeedbackForm
                            action={rescoreFormAction}
                            successMessage="Application queued for re-score."
                            onSuccess={() => router.refresh()}
                          >
                            <input type="hidden" name="application_id" value={selectedApplication.id} />
                            <SubmitButton variant="secondary">Re-score AI fit</SubmitButton>
                          </ActionFeedbackForm>
                        )}
                        {permissions.canManage && candidateHasEmail && (
                          <ActionFeedbackForm
                            action={hireFormAction}
                            className="flex flex-wrap items-center gap-2"
                            confirmTitle="Hire candidate"
                            confirmMessage="Create an employee invite and link it to this application?"
                            successMessage="Employee invite created."
                            onSuccess={() => router.refresh()}
                          >
                            <input type="hidden" name="application_id" value={selectedApplication.id} />
                            <Input name="job_title" placeholder="Job title for employee invite" className="w-56" />
                            <SubmitButton variant={selectedApplicationStatus === 'offered' ? 'primary' : 'secondary'}>
                              Create employee invite
                            </SubmitButton>
                          </ActionFeedbackForm>
                        )}
                        {permissions.canEdit && (
                          <ActionFeedbackForm
                            action={selectedApplication.archived_at ? restoreApplicationFormAction : archiveApplicationFormAction}
                            confirmTitle={selectedApplication.archived_at ? 'Restore application' : 'Archive application'}
                            confirmMessage={selectedApplication.archived_at ? 'Restore this application?' : 'Archive this application?'}
                            successMessage={selectedApplication.archived_at ? 'Application restored.' : 'Application archived.'}
                            onSuccess={() => router.refresh()}
                          >
                            <input type="hidden" name="application_id" value={selectedApplication.id} />
                            <SubmitButton variant={selectedApplication.archived_at ? 'secondary' : 'danger'}>
                              {selectedApplication.archived_at ? 'Restore application' : 'Archive application'}
                            </SubmitButton>
                          </ActionFeedbackForm>
                        )}
                      </div>
                    </div>
                  )}

                  {printableText && (
                    <pre className="max-h-80 overflow-auto rounded border border-border bg-surface-2 p-3 text-xs text-text">
                      {printableText}
                    </pre>
                  )}

                  {decisionDialog && selectedApplication && (
                    <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setDecisionDialog(null)}>
                      <div className="max-h-[90vh] w-full max-w-lg overflow-auto rounded-lg border border-border bg-surface p-4 shadow-lg" onClick={e => e.stopPropagation()}>
                        <p className="text-sm font-semibold text-text-strong">{DECISION_CONFIG[decisionDialog.decision].confirm}</p>
                        <form action={decisionFormAction} className="mt-3 space-y-3">
                          <input type="hidden" name="application_id" value={selectedApplication.id} />
                          <input type="hidden" name="decision" value={decisionDialog.decision} />
                          <div>
                            <label className="text-xs font-semibold uppercase text-text-muted">Internal reason</label>
                            <Textarea name="reason" rows={2} placeholder="Why? (internal only — saved as a note)" />
                          </div>
                          {DECISION_CONFIG[decisionDialog.decision].template && (
                            <div className="space-y-2 rounded border border-border bg-surface-2 p-3">
                              <div className="flex items-center justify-between">
                                <p className="text-xs font-semibold uppercase text-text-muted">Email to candidate</p>
                                <label className="flex items-center gap-1 text-xs text-text">
                                  <input type="checkbox" name="send_email" checked={decisionSendEmail} disabled={!candidateHasEmail} onChange={e => setDecisionSendEmail(e.target.checked)} />
                                  Send email
                                </label>
                              </div>
                              {!candidateHasEmail && <p className="text-xs text-text-muted">No email on file — the decision will be recorded without emailing.</p>}
                              {decisionLoadingPreview ? (
                                <p className="text-xs text-text-muted">Loading proposed email…</p>
                              ) : (
                                <>
                                  <Input name="email_subject" value={decisionEmail.subject} onChange={e => setDecisionEmail(prev => ({ ...prev, subject: e.target.value }))} placeholder="Subject" />
                                  <Textarea name="email_body" rows={6} value={decisionEmail.body} onChange={e => setDecisionEmail(prev => ({ ...prev, body: e.target.value }))} placeholder="Email body" />
                                  <Button type="button" size="xs" variant="secondary" icon={<SparklesIcon className="h-4 w-4" />} onClick={improveDecisionEmailWithAi}>Improve with AI</Button>
                                </>
                              )}
                            </div>
                          )}
                          <div className="flex items-center justify-end gap-2">
                            <Button type="button" variant="secondary" onClick={() => setDecisionDialog(null)}>Cancel</Button>
                            <SubmitButton variant={DECISION_CONFIG[decisionDialog.decision].danger ? 'danger' : 'primary'}>{DECISION_CONFIG[decisionDialog.decision].confirm}</SubmitButton>
                          </div>
                          <ActionStateMessage state={decisionState} />
                        </form>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </Drawer>

            {activeTab === 'applications' && permissions.canCreate && (
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
                    <input name="cv" type="file" accept=".pdf,.doc,.docx,.txt,.rtf,.odt" className="rounded-default border border-border bg-surface px-3 py-2 text-[13px] md:col-span-2" />
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
                      <TableHead>Closes</TableHead>
                      <TableHead>Version</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {postings.map((posting: any) => (
                      <TableRow
                        key={posting.id}
                        className={selectedPosting?.id === posting.id ? 'bg-primary/5' : ''}
                      >
                        <TableCell className="align-top whitespace-normal">
                          <button
                            type="button"
                            className="text-left font-medium text-text-strong hover:text-primary hover:underline"
                            onClick={() => openPostingDetail(posting)}
                          >
                            {posting.title}
                          </button>
                          <p className="text-xs text-text-muted">{posting.slug}</p>
                        </TableCell>
                        <TableCell className="align-top">{posting.status}</TableCell>
                        <TableCell className="align-top">{postingVisibilityText(posting)}</TableCell>
                        <TableCell className="align-top">{formatDateOnly(posting.application_closing_date)}</TableCell>
                        <TableCell className="align-top">v{posting.version}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardBody>
            </Card>

            <Drawer
              open={postingDrawerOpen && Boolean(selectedPosting)}
              onClose={() => setPostingDrawerOpen(false)}
              title={selectedPosting ? selectedPosting.title : 'Posting detail'}
              width="min(760px, 100vw)"
            >
              {selectedPosting && (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-5">
                    <div>
                      <p className="text-xs font-semibold uppercase text-text-muted">Status</p>
                      <p className="text-text-strong">{selectedPosting.status}</p>
                    </div>
                    <div>
                      <p className="text-xs font-semibold uppercase text-text-muted">Visibility</p>
                      <p className="text-text-strong">{postingVisibilityText(selectedPosting)}</p>
                    </div>
                    <div>
                      <p className="text-xs font-semibold uppercase text-text-muted">Version</p>
                      <p className="text-text-strong">v{selectedPosting.version}</p>
                    </div>
                    <div>
                      <p className="text-xs font-semibold uppercase text-text-muted">Openings</p>
                      <p className="text-text-strong">{selectedPosting.positions_available ?? 1}</p>
                    </div>
                    <div>
                      <p className="text-xs font-semibold uppercase text-text-muted">Closes</p>
                      <p className="text-text-strong">{formatDateOnly(selectedPosting.application_closing_date)}</p>
                    </div>
                  </div>

                  {permissions.canEdit ? (
                    <form action={postingUpdateAction} className="space-y-3">
                      <input type="hidden" name="id" value={selectedPosting.id} />
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <Field label="Job title">
                          <Input name="title" defaultValue={selectedPosting.title} required />
                        </Field>
                        <Field label="Website slug" help="Used by the website URL and application form.">
                          <Input name="slug" defaultValue={selectedPosting.slug} required />
                        </Field>
                        <Field label="Role type">
                          <Select name="role_type" defaultValue={selectedPosting.role_type}>
                            <option value="bar">Bar</option>
                            <option value="kitchen">Kitchen</option>
                            <option value="either">Either</option>
                            <option value="management">Management</option>
                            <option value="other">Other</option>
                          </Select>
                        </Field>
                        <Field label="Employment type">
                          <Select name="employment_type" defaultValue={selectedPosting.employment_type}>
                            <option value="full_time">Full time</option>
                            <option value="part_time">Part time</option>
                            <option value="casual">Casual</option>
                          </Select>
                        </Field>
                        <Field label="Status" help="Only open and public postings show on the website.">
                          <Select name="status" defaultValue={selectedPosting.status}>
                            <option value="draft">Draft</option>
                            <option value="open">Open</option>
                            <option value="closed">Closed</option>
                            <option value="archived">Archived</option>
                          </Select>
                        </Field>
                        <Field label="Positions available">
                          <Input
                            name="positions_available"
                            type="number"
                            min="1"
                            defaultValue={selectedPosting.positions_available ?? 1}
                          />
                        </Field>
                        <Field label="Application closing date" help="The last date applicants can apply. After this date it drops off the website.">
                          <Input
                            name="application_closing_date"
                            type="date"
                            defaultValue={dateInputValue(selectedPosting.application_closing_date)}
                          />
                        </Field>
                      </div>
                      <Field label="Website description">
                        <Textarea name="description" defaultValue={selectedPosting.description} required rows={5} />
                      </Field>
                      <Field label="Website requirements">
                        <Textarea name="requirements" defaultValue={selectedPosting.requirements} required rows={5} />
                      </Field>
                      <Field label="AI scoring notes" help="Internal guidance only. Applicants do not see this.">
                        <Textarea
                          name="ai_scoring_notes"
                          defaultValue={selectedPosting.ai_scoring_notes ?? ''}
                          rows={5}
                        />
                      </Field>
                      <label className="flex items-center gap-2 text-sm">
                        <input type="checkbox" name="is_public" defaultChecked={selectedPosting.is_public === true} />
                        Public on website
                      </label>
                      <input type="hidden" name="is_public" value="false" />
                      <div className="flex items-center gap-3">
                        <SubmitButton>Save posting</SubmitButton>
                        <ActionStateMessage state={postingUpdateState} />
                      </div>
                    </form>
                  ) : (
                    <div className="space-y-3 text-sm text-text">
                      <div>
                        <p className="text-xs font-semibold uppercase text-text-muted">Description</p>
                        <p className="whitespace-pre-wrap">{selectedPosting.description}</p>
                      </div>
                      <div>
                        <p className="text-xs font-semibold uppercase text-text-muted">Requirements</p>
                        <p className="whitespace-pre-wrap">{selectedPosting.requirements}</p>
                      </div>
                      {selectedPosting.ai_scoring_notes && (
                        <div>
                          <p className="text-xs font-semibold uppercase text-text-muted">AI scoring notes</p>
                          <p className="whitespace-pre-wrap">{selectedPosting.ai_scoring_notes}</p>
                        </div>
                      )}
                    </div>
                  )}

                  {permissions.canCreate && (
                    <form action={postingDuplicateAction} className="border-t border-border pt-4">
                      <input type="hidden" name="id" value={selectedPosting.id} />
                      <div className="flex flex-wrap items-center gap-3">
                        <SubmitButton variant="secondary">Duplicate posting</SubmitButton>
                        <ActionStateMessage state={postingDuplicateState} />
                      </div>
                      <p className="mt-2 text-xs text-text-muted">Creates a private draft copy with a new slug.</p>
                    </form>
                  )}
                </div>
              )}
            </Drawer>

            {permissions.canCreate && (
              <Card>
                <CardHeader title="New Posting" />
                <CardBody>
                  <form action={postingAction} className="space-y-3">
                    <Field label="Job title">
                      <Input name="title" required />
                    </Field>
                    <Field label="Website slug" help="Lowercase letters, numbers and hyphens only.">
                      <Input name="slug" required />
                    </Field>
                    <Field label="Role type">
                      <Select name="role_type" defaultValue="either">
                        <option value="bar">Bar</option>
                        <option value="kitchen">Kitchen</option>
                        <option value="either">Either</option>
                        <option value="management">Management</option>
                        <option value="other">Other</option>
                      </Select>
                    </Field>
                    <Field label="Employment type">
                      <Select name="employment_type" defaultValue="part_time">
                        <option value="full_time">Full time</option>
                        <option value="part_time">Part time</option>
                        <option value="casual">Casual</option>
                      </Select>
                    </Field>
                    <Field label="Status">
                      <Select name="status" defaultValue="draft">
                        <option value="draft">Draft</option>
                        <option value="open">Open</option>
                        <option value="closed">Closed</option>
                        <option value="archived">Archived</option>
                      </Select>
                    </Field>
                    <Field label="Positions available">
                      <Input name="positions_available" type="number" min="1" defaultValue="1" />
                    </Field>
                    <Field label="Application closing date" help="The last date applicants can apply. Leave blank if there is no date yet.">
                      <Input name="application_closing_date" type="date" />
                    </Field>
                    <Field label="Website description">
                      <Textarea name="description" required rows={4} />
                    </Field>
                    <Field label="Website requirements">
                      <Textarea name="requirements" required rows={4} />
                    </Field>
                    <Field label="AI scoring notes" help="Internal guidance only. Applicants do not see this.">
                      <Textarea name="ai_scoring_notes" rows={3} />
                    </Field>
                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" name="is_public" />
                      Public on website
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
                <label className="mb-3 flex items-center gap-2 text-sm text-text-muted">
                  <input type="checkbox" checked={showArchived} onChange={event => setShowArchived(event.target.checked)} />
                  Show archived
                </label>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Type</TableHead>
                      <TableHead>Opens</TableHead>
                      <TableHead>Closes</TableHead>
                      <TableHead>Location</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredSlots.map((slot: any) => (
                      <TableRow key={slot.id} className={slot.archived_at ? 'opacity-60' : ''}>
                        <TableCell>
                          <button type="button" className="text-left font-medium hover:text-primary hover:underline" onClick={() => openSlotDetail(slot)}>
                            {slot.type.replaceAll('_', ' ')}
                          </button>
                        </TableCell>
                        <TableCell>{formatSlotDateTime(slot.starts_at)}</TableCell>
                        <TableCell>{formatSlotDateTime(slot.ends_at)}</TableCell>
                        <TableCell>{slot.location}</TableCell>
                        <TableCell>{slot.archived_at ? 'archived' : slot.status}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {filteredSlots.length === 0 && (
                  <p className="py-6 text-center text-sm text-text-muted">No slots to show.</p>
                )}
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
                    <SlotDateTimeInput
                      name="starts_at"
                      label="Opens"
                      value={newSlotStartsAt}
                      onChange={(value) => {
                        setNewSlotStartsAt(value)
                        setNewSlotEndsAt(addDurationToDateTimeParts(value, DEFAULT_SLOT_DURATION_MS))
                      }}
                    />
                    <SlotDateTimeInput
                      name="ends_at"
                      label="Closes"
                      value={newSlotEndsAt}
                      onChange={setNewSlotEndsAt}
                    />
                    <Input name="location" defaultValue="The Anchor" />
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
                    {filteredAppointments.map((appointment: any) => (
                      <TableRow key={appointment.id} className={appointment.archived_at ? 'opacity-60' : ''}>
                        <TableCell className="align-top whitespace-normal">
                          <button type="button" className="text-left font-medium text-text-strong hover:text-primary hover:underline" onClick={() => openAppointmentDetail(appointment)}>
                            {candidateName(appointment.candidate)}
                          </button>
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
                            <Button type="button" size="sm" variant="secondary" onClick={() => openAppointmentDetail(appointment)}>
                              Open
                            </Button>
                          ) : appointment.status}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {filteredAppointments.length === 0 && (
                  <p className="py-6 text-center text-sm text-text-muted">No appointments to show.</p>
                )}
              </CardBody>
            </Card>
          </section>
        )}

        <Drawer
          open={slotDrawerOpen && Boolean(selectedSlot)}
          onClose={() => setSlotDrawerOpen(false)}
          title={selectedSlot ? `${selectedSlot.type?.replaceAll('_', ' ')} slot` : 'Slot'}
          width="min(620px, 100vw)"
        >
          {selectedSlot && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-xs font-semibold uppercase text-text-muted">When</p>
                  <p>{formatDateTime(selectedSlot.starts_at)}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase text-text-muted">Status</p>
                  <p>{selectedSlot.archived_at ? 'archived' : selectedSlot.status}</p>
                </div>
              </div>
              {permissions.canEdit && (
                <form action={slotUpdateAction} className="space-y-3">
                  <input type="hidden" name="slot_id" value={selectedSlot.id} />
                  <Field label="Type">
                    <Select name="type" defaultValue={selectedSlot.type}>
                      <option value="interview">Interview</option>
                      <option value="trial_shift">Trial shift</option>
                    </Select>
                  </Field>
                  <SlotDateTimeInput name="starts_at" label="Starts" initialValue={selectedSlot.starts_at} />
                  <SlotDateTimeInput name="ends_at" label="Ends" initialValue={selectedSlot.ends_at} />
                  <Field label="Location">
                    <Input name="location" defaultValue={selectedSlot.location} />
                  </Field>
                  <div className="flex flex-wrap items-center gap-2">
                    <SubmitButton>Save slot</SubmitButton>
                    <ActionStateMessage state={slotUpdateState} />
                  </div>
                </form>
              )}
              {permissions.canEdit && (
                <div className="flex flex-wrap gap-2 border-t border-border pt-3">
                  <ActionFeedbackForm
                    action={cancelSlotFormAction}
                    confirmTitle="Cancel slot"
                    confirmMessage="Cancel this recruitment slot?"
                    successMessage="Slot cancelled."
                  >
                    <input type="hidden" name="slot_id" value={selectedSlot.id} />
                    <SubmitButton variant="secondary">Cancel slot</SubmitButton>
                  </ActionFeedbackForm>
                  <ActionFeedbackForm
                    action={selectedSlot.archived_at ? restoreSlotFormAction : archiveSlotFormAction}
                    confirmTitle={selectedSlot.archived_at ? 'Restore slot' : 'Archive slot'}
                    confirmMessage={selectedSlot.archived_at ? 'Restore this slot?' : 'Archive this slot?'}
                    successMessage={selectedSlot.archived_at ? 'Slot restored.' : 'Slot archived.'}
                  >
                    <input type="hidden" name="slot_id" value={selectedSlot.id} />
                    <SubmitButton variant="secondary">{selectedSlot.archived_at ? 'Restore slot' : 'Archive slot'}</SubmitButton>
                  </ActionFeedbackForm>
                </div>
              )}
            </div>
          )}
        </Drawer>

        <Drawer
          open={appointmentDrawerOpen && Boolean(selectedAppointment)}
          onClose={() => setAppointmentDrawerOpen(false)}
          title={selectedAppointment ? candidateName(selectedAppointment.candidate) : 'Appointment'}
          width="min(760px, 100vw)"
        >
          {selectedAppointment && (
            <div className="space-y-5">
              <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
                <div>
                  <p className="text-xs font-semibold uppercase text-text-muted">Type</p>
                  <p>{selectedAppointment.type?.replaceAll('_', ' ')}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase text-text-muted">When</p>
                  <p>{formatDateTime(selectedAppointment.scheduled_start)}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase text-text-muted">Status</p>
                  <p>{selectedAppointment.archived_at ? 'archived' : selectedAppointment.status}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase text-text-muted">Calendar</p>
                  <p>{selectedAppointment.calendar_sync_status}</p>
                </div>
              </div>

              {permissions.canEdit && (
                <form action={outcomeFormAction} className="grid grid-cols-1 gap-3 md:grid-cols-4">
                  <input type="hidden" name="appointment_id" value={selectedAppointment.id} />
                  <Field label="Outcome">
                    <Select name="status" defaultValue={selectedAppointment.status}>
                      <option value="scheduled">Scheduled</option>
                      <option value="completed">Completed</option>
                      <option value="no_show">No-show</option>
                      <option value="cancelled">Cancelled</option>
                    </Select>
                  </Field>
                  <Field label="Rating">
                    <Select name="outcome_rating" defaultValue={selectedAppointment.outcome_rating ?? ''}>
                      <option value="">Rating</option>
                      <option value="1">1</option>
                      <option value="2">2</option>
                      <option value="3">3</option>
                      <option value="4">4</option>
                      <option value="5">5</option>
                    </Select>
                  </Field>
                  <label className="mt-6 flex items-center gap-2 text-sm">
                    <input type="checkbox" name="meal_provided" defaultChecked={selectedAppointment.meal_provided === true} />
                    Meal provided
                  </label>
                  <div className="md:col-span-4">
                    <Field label="Notes">
                      <Textarea name="outcome" defaultValue={selectedAppointment.outcome ?? ''} rows={3} />
                    </Field>
                  </div>
                  <div className="md:col-span-4">
                    <SubmitButton>Save outcome</SubmitButton>
                  </div>
                </form>
              )}

              {permissions.canEdit && (
                <form action={scorecardAction} className="space-y-3 border-t border-border pt-4">
                  <input type="hidden" name="appointment_id" value={selectedAppointment.id} />
                  <p className="text-xs font-semibold uppercase text-text-muted">Scorecard</p>
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                    {['experience', 'attitude', 'availability'].map(label => (
                      <div key={label} className="space-y-2">
                        <Field label={`${label} rating`}>
                          <Select name={`${label}_rating`} defaultValue="">
                            <option value="">-</option>
                            <option value="1">1</option>
                            <option value="2">2</option>
                            <option value="3">3</option>
                            <option value="4">4</option>
                            <option value="5">5</option>
                          </Select>
                        </Field>
                        <Textarea name={`${label}_notes`} placeholder="Notes" rows={2} />
                      </div>
                    ))}
                  </div>
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    <Field label="Overall rating">
                      <Select name="overall_rating" defaultValue="">
                        <option value="">-</option>
                        <option value="1">1</option>
                        <option value="2">2</option>
                        <option value="3">3</option>
                        <option value="4">4</option>
                        <option value="5">5</option>
                      </Select>
                    </Field>
                    <Field label="Recommendation">
                      <Select name="recommendation" defaultValue="no_decision">
                        <option value="no_decision">No decision</option>
                        <option value="hire">Hire</option>
                        <option value="hold">Hold</option>
                        <option value="reject">Reject</option>
                        <option value="rebook">Rebook</option>
                      </Select>
                    </Field>
                  </div>
                  <Textarea name="comments" placeholder="Scorecard comments" rows={3} />
                  <div className="flex items-center gap-2">
                    <SubmitButton variant="secondary">Save scorecard</SubmitButton>
                    <ActionStateMessage state={scorecardState} />
                  </div>
                </form>
              )}

              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase text-text-muted">Scorecards</p>
                {scorecards.filter((scorecard: any) => scorecard.appointment_id === selectedAppointment.id).map((scorecard: any) => (
                  <div key={scorecard.id} className="rounded border border-border bg-surface-2 p-3 text-sm">
                    <p className="font-medium">{scorecard.recommendation?.replaceAll('_', ' ')} · {scorecard.overall_rating ?? '-'}/5</p>
                    <p className="mt-1 whitespace-pre-wrap text-text-muted">{scorecard.comments || 'No comments'}</p>
                  </div>
                ))}
              </div>

              {permissions.canEdit && (
                <div className="flex flex-wrap gap-2 border-t border-border pt-3">
                  <ActionFeedbackForm action={rescheduleAppointmentFormAction} className="flex flex-wrap gap-2" successMessage="Appointment rescheduled.">
                    <input type="hidden" name="appointment_id" value={selectedAppointment.id} />
                    <Select name="slot_id" className="w-56">
                      {slots.filter((slot: any) => !slot.archived_at && slot.status === 'open' && slot.type === selectedAppointment.type).map((slot: any) => (
                        <option key={slot.id} value={slot.id}>{formatDateTime(slot.starts_at)}</option>
                      ))}
                    </Select>
                    <SubmitButton variant="secondary">Reschedule</SubmitButton>
                  </ActionFeedbackForm>
                  <ActionFeedbackForm
                    action={cancelAppointmentFormAction}
                    className="flex flex-wrap gap-2"
                    confirmTitle="Cancel appointment"
                    confirmMessage="Cancel this appointment and notify the candidate if configured?"
                    successMessage="Appointment cancelled."
                  >
                    <input type="hidden" name="appointment_id" value={selectedAppointment.id} />
                    <Input name="reason" placeholder="Cancel reason" className="w-44" />
                    <SubmitButton variant="secondary">Cancel</SubmitButton>
                  </ActionFeedbackForm>
                  <ActionFeedbackForm
                    action={selectedAppointment.archived_at ? restoreAppointmentFormAction : archiveAppointmentFormAction}
                    confirmTitle={selectedAppointment.archived_at ? 'Restore appointment' : 'Archive appointment'}
                    confirmMessage={selectedAppointment.archived_at ? 'Restore this appointment?' : 'Archive this appointment?'}
                    successMessage={selectedAppointment.archived_at ? 'Appointment restored.' : 'Appointment archived.'}
                  >
                    <input type="hidden" name="appointment_id" value={selectedAppointment.id} />
                    <SubmitButton variant="secondary">{selectedAppointment.archived_at ? 'Restore' : 'Archive'}</SubmitButton>
                  </ActionFeedbackForm>
                </div>
              )}
            </div>
          )}
        </Drawer>

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
                          <button type="button" className="text-left font-medium text-text-strong hover:text-primary hover:underline" onClick={() => openTalentDetail(candidate)}>
                            {candidateName(candidate)}
                          </button>
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
                            {candidate.cv_file_path && ['failed', 'unsupported'].includes(candidate.cv_extraction_status) && permissions.canManage && (
                              <ActionFeedbackForm action={cvRetryFormAction} successMessage="CV retry queued.">
                                <input type="hidden" name="candidate_id" value={candidate.id} />
                                <Button type="submit" size="xs" variant="secondary">
                                  Retry
                                </Button>
                              </ActionFeedbackForm>
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
                            <ActionFeedbackForm action={matchFormAction} className="flex gap-2" successMessage="Candidate matched.">
                              <input type="hidden" name="candidate_id" value={candidate.id} />
                              <Select name="job_posting_id" className="w-36">
                                {postings.map((posting: any) => (
                                  <option key={posting.id} value={posting.id}>{posting.title}</option>
                                ))}
                              </Select>
                              <SubmitButton variant="secondary">Match</SubmitButton>
                            </ActionFeedbackForm>
                          )}
                        </TableCell>
                        <TableCell className="align-top">
                          {permissions.canDelete && !candidate.anonymised_at ? (
                            <ActionFeedbackForm
                              action={erasureFormAction}
                              className="flex gap-2"
                              confirmTitle="Erase candidate"
                              confirmMessage="This permanently anonymises the candidate record. Continue?"
                              successMessage="Candidate erased."
                            >
                              <input type="hidden" name="candidate_id" value={candidate.id} />
                              <Input name="reason" placeholder="Reason" className="w-32" />
                              <SubmitButton variant="danger">Erase</SubmitButton>
                            </ActionFeedbackForm>
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

        <Drawer
          open={talentDrawerOpen && Boolean(selectedTalentCandidate)}
          onClose={() => setTalentDrawerOpen(false)}
          title={selectedTalentCandidate ? candidateName(selectedTalentCandidate) : 'Candidate'}
          width="min(760px, 100vw)"
        >
          {selectedTalentCandidate && (
            <div className="space-y-5">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-3">
                  <div>
                    <p className="text-xs font-semibold uppercase text-text-muted">Candidate</p>
                    <p className="text-base font-semibold text-text-strong">{candidateName(selectedTalentCandidate)}</p>
                    <p className="text-sm text-text-muted">{selectedTalentCandidate.email || 'No email'}</p>
                    <p className="text-sm text-text-muted">{selectedTalentCandidate.phone_e164 || selectedTalentCandidate.phone || 'No phone'}</p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase text-text-muted">CV</p>
                    <p className="text-sm text-text">{selectedTalentCandidate.cv_extraction_status?.replaceAll('_', ' ') ?? 'no cv'}</p>
                    <p className="mt-1 text-sm text-text-muted">{profileSummary(selectedTalentCandidate) ?? 'No AI profile summary.'}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {selectedTalentCandidate.cv_file_path && (
                      <Button type="button" size="sm" variant="secondary" onClick={() => openCv(selectedTalentCandidate.id)}>
                        Open CV
                      </Button>
                    )}
                    {permissions.canManage && selectedTalentCandidate.cv_file_path && (
                      <ActionFeedbackForm action={cvRetryFormAction} successMessage="CV retry queued.">
                        <input type="hidden" name="candidate_id" value={selectedTalentCandidate.id} />
                        <SubmitButton variant="secondary">Retry CV</SubmitButton>
                      </ActionFeedbackForm>
                    )}
                  </div>
                  {permissions.canManage && (
                    <ActionFeedbackForm action={matchFormAction} className="flex flex-wrap gap-2" successMessage="Candidate matched.">
                      <input type="hidden" name="candidate_id" value={selectedTalentCandidate.id} />
                      <Select name="job_posting_id" className="w-56">
                        {postings.map((posting: any) => (
                          <option key={posting.id} value={posting.id}>{posting.title}</option>
                        ))}
                      </Select>
                      <SubmitButton variant="secondary">Match to posting</SubmitButton>
                    </ActionFeedbackForm>
                  )}
                </div>

                <form action={candidateUpdateAction} className="space-y-3">
                  <input type="hidden" name="candidate_id" value={selectedTalentCandidate.id} />
                  <p className="text-xs font-semibold uppercase text-text-muted">Profile</p>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <ProfileField label="First name">
                      <Input name="first_name" defaultValue={selectedTalentCandidate.first_name ?? ''} placeholder="First name" />
                    </ProfileField>
                    <ProfileField label="Last name">
                      <Input name="last_name" defaultValue={selectedTalentCandidate.last_name ?? ''} placeholder="Last name" />
                    </ProfileField>
                  </div>
                  <ProfileField label="Email">
                    <Input name="email" defaultValue={selectedTalentCandidate.email ?? ''} placeholder="Email" />
                  </ProfileField>
                  <ProfileField label="Phone">
                    <Input name="phone" defaultValue={selectedTalentCandidate.phone ?? ''} placeholder="Phone" />
                  </ProfileField>
                  <ProfileField label="Phone E164">
                    <Input name="phone_e164" defaultValue={selectedTalentCandidate.phone_e164 ?? ''} placeholder="Phone E164" />
                  </ProfileField>
                  <ProfileField label="Location">
                    <Input name="location" defaultValue={selectedTalentCandidate.location ?? ''} placeholder="Location" />
                  </ProfileField>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <ProfileField label="Right to work">
                      <Select name="right_to_work_status" defaultValue={selectedTalentCandidate.right_to_work_status ?? 'not_checked'}>
                        <option value="not_checked">Not checked</option>
                        <option value="pending">Pending</option>
                        <option value="verified">Verified</option>
                        <option value="failed">Failed</option>
                      </Select>
                    </ProfileField>
                    <ProfileField label="Document type">
                      <Select name="right_to_work_document_type" defaultValue={selectedTalentCandidate.right_to_work_document_type ?? ''}>
                        <option value="">Not set</option>
                        <option value="Passport">Passport</option>
                        <option value="Biometric Residence Permit">Biometric Residence Permit</option>
                        <option value="Share Code">Share Code</option>
                        <option value="List A">List A</option>
                        <option value="List B">List B</option>
                        <option value="Other">Other</option>
                      </Select>
                    </ProfileField>
                  </div>
                  <ProfileField label="Right to work checked at">
                    <Input name="right_to_work_checked_at" type="datetime-local" defaultValue={todayLocalDateTime(selectedTalentCandidate.right_to_work_checked_at)} />
                  </ProfileField>
                  <ProfileField label="Recruitment notes">
                    <Textarea name="notes" defaultValue={selectedTalentCandidate.notes ?? ''} placeholder="Recruitment notes" rows={3} />
                  </ProfileField>
                  <div className="grid grid-cols-1 gap-2 text-sm text-text sm:grid-cols-2">
                    <label className="flex items-center gap-2">
                      <input type="checkbox" name="sms_consent" defaultChecked={selectedTalentCandidate.sms_consent === true} />
                      SMS consent
                    </label>
                    <label className="flex items-center gap-2">
                      <input type="checkbox" name="future_recruitment_consent" defaultChecked={selectedTalentCandidate.future_recruitment_consent === true} />
                      Future recruitment consent
                    </label>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <SubmitButton>Save candidate</SubmitButton>
                    <ActionStateMessage state={candidateUpdateState} />
                  </div>
                </form>
              </div>

              {permissions.canDelete && !selectedTalentCandidate.anonymised_at && (
                <ActionFeedbackForm
                  action={erasureFormAction}
                  className="flex flex-wrap gap-2 border-t border-border pt-4"
                  confirmTitle="Erase candidate"
                  confirmMessage="This permanently anonymises the candidate record. Continue?"
                  successMessage="Candidate erased."
                >
                  <input type="hidden" name="candidate_id" value={selectedTalentCandidate.id} />
                  <Input name="reason" placeholder="Erasure reason" className="w-64" />
                  <SubmitButton variant="danger">Erase candidate data</SubmitButton>
                </ActionFeedbackForm>
              )}
            </div>
          )}
        </Drawer>

        {activeTab === 'templates' && (
          <section>
            <Card>
              <CardHeader title="Email templates" />
              <CardBody className="space-y-4">
                {templates.length === 0 && (
                  <p className="py-6 text-center text-sm text-text-muted">No templates found.</p>
                )}
                {templates.map((template: any) => (
                  <form key={template.id} action={templateAction} className="rounded-md border border-border bg-surface-2 p-4">
                    <input type="hidden" name="id" value={template.id} />
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
                      <Field label="Type">
                        <Select name="type" defaultValue={template.type}>
                          <option value="interview_invite">Interview invite</option>
                          <option value="trial_invite">Trial invite</option>
                          <option value="rejection">Rejection</option>
                          <option value="already_considered">Already considered</option>
                          <option value="offer">Offer</option>
                          <option value="interview_confirmation">Interview confirmation</option>
                          <option value="trial_confirmation">Trial confirmation</option>
                          <option value="reminder">Reminder</option>
                          <option value="manager_alert">Manager alert</option>
                        </Select>
                      </Field>
                      <Field label="Subject">
                        <Input name="subject" defaultValue={template.subject} className="md:col-span-3" />
                      </Field>
                      <div className="md:col-span-4">
                        <Field label="Body">
                          <Textarea name="body" defaultValue={template.body} rows={6} />
                        </Field>
                      </div>
                      <label className="flex items-center gap-2 text-sm">
                        <input type="checkbox" name="is_active" defaultChecked={template.is_active === true} />
                        Active
                      </label>
                      <input type="hidden" name="is_active" value="false" />
                      <div className="md:col-span-4 flex flex-wrap items-center gap-3">
                        {permissions.canManage && <SubmitButton>Save template</SubmitButton>}
                        <Badge tone={template.is_active ? 'success' : 'neutral'}>{template.is_active ? 'active' : 'inactive'}</Badge>
                        <span className="text-xs text-text-muted">Updated {formatDateTime(template.updated_at)}</span>
                      </div>
                    </div>
                  </form>
                ))}
                <ActionStateMessage state={templateState} />
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
                    {filteredCommunications.map((communication: any) => (
                      <TableRow key={communication.id}>
                        <TableCell>
                          <button type="button" className="text-left font-medium hover:text-primary hover:underline" onClick={() => openCommunicationDetail(communication)}>
                            {communication.type?.replaceAll('_', ' ')}
                          </button>
                        </TableCell>
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
                {filteredCommunications.length === 0 && (
                  <p className="py-6 text-center text-sm text-text-muted">No communications yet.</p>
                )}
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

        <Drawer
          open={communicationDrawerOpen && Boolean(selectedCommunication)}
          onClose={() => setCommunicationDrawerOpen(false)}
          title={selectedCommunication ? selectedCommunication.type?.replaceAll('_', ' ') : 'Communication'}
          width="min(720px, 100vw)"
        >
          {selectedCommunication && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
                <div>
                  <p className="text-xs font-semibold uppercase text-text-muted">Channel</p>
                  <p>{selectedCommunication.channel}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase text-text-muted">Status</p>
                  <p>{selectedCommunication.delivery_status}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase text-text-muted">Provider</p>
                  <p>{selectedCommunication.provider || '-'}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase text-text-muted">When</p>
                  <p>{formatDateTime(selectedCommunication.sent_at || selectedCommunication.created_at)}</p>
                </div>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase text-text-muted">Subject</p>
                <p className="text-sm text-text-strong">{selectedCommunication.subject || '-'}</p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase text-text-muted">Body</p>
                <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap rounded border border-border bg-surface-2 p-3 text-sm text-text">
                  {selectedCommunication.final_body}
                </pre>
              </div>
              {permissions.canSend && (
                <ActionFeedbackForm action={retryCommunicationFormAction} successMessage="Communication retry queued.">
                  <input type="hidden" name="communication_id" value={selectedCommunication.id} />
                  <SubmitButton variant="secondary">Retry / resend</SubmitButton>
                </ActionFeedbackForm>
              )}
            </div>
          )}
        </Drawer>
      </div>
    </main>
  )
}
