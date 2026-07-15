'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { parseLondonDateTimeLocalToIso } from '@/lib/dateUtils'
import { checkUserPermission } from '@/app/actions/rbac'
import { logAuditEvent } from '@/app/actions/audit'
import { inviteEmployee } from '@/app/actions/employeeInvite'
import {
  addRecruitmentCandidateNote,
  getRecruitmentCandidateTrail,
  decideRecruitmentApplication,
  buildRecruitmentPrintableKit,
  bulkUpdateRecruitmentApplications,
  cancelRecruitmentAppointmentByStaff,
  cancelRecruitmentAppointmentSlot,
  completeRecruitmentHireHandoff,
  createRecruitmentApplication,
  createRecruitmentAppointmentSlots,
  createRecruitmentInterviewScorecard,
  createRecruitmentJobPosting,
  duplicateRecruitmentJobPosting,
  eraseRecruitmentCandidate,
  formatRecruitmentAppointmentTime,
  getRecruitmentApplicationsForCsv,
  getRecruitmentDashboard,
  getRecruitmentCandidatesPage,
  getRecruitmentCvSignedUrl,
  issueRecruitmentBookingLink,
  listRecruitmentAdminData,
  type RecruitmentCandidatesPage,
  type RecruitmentCandidatesPageParams,
  matchRecruitmentCandidateToPosting,
  reprocessRecruitmentCandidateCv,
  reprocessRecruitmentManualReviewCvs,
  recordRecruitmentAppointmentOutcome,
  rescheduleRecruitmentAppointmentByStaff,
  rescoreRecruitmentApplication,
  restoreRecruitmentAppointmentSlot,
  runRecruitmentRetentionCleanup,
  saveRecruitmentEmailTemplate,
  scheduleRecruitmentAppointmentByStaff,
  setRecruitmentArchiveState,
  transitionRecruitmentApplicationStatus,
  updateRecruitmentCandidateProfile,
  updateRecruitmentAppointmentSlot,
  updateRecruitmentJobPosting,
} from '@/services/recruitment'
import {
  generateRecruitmentAppointmentIcs,
  loadRecruitmentAppointment,
  syncRecruitmentAppointmentCalendar,
} from '@/lib/recruitment/calendar'
import {
  draftRecruitmentEmailForApplication,
  previewRecruitmentDecisionEmail,
  retryRecruitmentCommunication,
  sendRecruitmentApplicationReceivedEmail,
  sendRecruitmentManagerAlert,
  sendRecruitmentTemplateEmail,
} from '@/lib/recruitment/communications'
import type { RecruitmentAppointmentType, RecruitmentTemplateType } from '@/types/recruitment'
import type { ActionType } from '@/types/rbac'

type ActionResult<T = unknown> =
  | { success: true; data?: T; message?: string }
  | { success: false; error: string }

const EMAIL_STATUS_TRANSITIONS: Partial<Record<RecruitmentTemplateType, {
  status: string
  note: string
}>> = {
  interview_invite: {
    status: 'interview_invited',
    note: 'Interview invite email sent',
  },
  trial_invite: {
    status: 'trial_offered',
    note: 'Trial invite email sent',
  },
  offer: {
    status: 'offered',
    note: 'Offer email sent',
  },
  rejection: {
    status: 'rejected',
    note: 'Rejection email sent',
  },
  already_considered: {
    status: 'declined_duplicate',
    note: 'Already considered email sent',
  },
}

async function currentUser() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return user
}

async function userHasRole(userId: string, roleName: string) {
  const admin = createAdminClient()
  const { data, error } = await admin.rpc('get_user_roles', { p_user_id: userId })
  if (error) throw error
  return (data ?? []).some((role: any) => role.role_name === roleName)
}

async function requireRecruitmentPermission(action: ActionType) {
  const user = await currentUser()
  if (!user) {
    throw new Error('Not authenticated')
  }

  const allowed = await checkUserPermission('recruitment', action, user.id)
  if (!allowed) {
    throw new Error('You do not have permission to do this.')
  }

  return user
}

async function requireSuperAdmin() {
  const user = await requireRecruitmentPermission('delete')
  const hasSuperAdmin = await userHasRole(user.id, 'super_admin')
  if (!hasSuperAdmin) {
    throw new Error('This is restricted to super admins.')
  }
  return user
}

async function getRecruitmentPermissionFlags(userId: string) {
  const [canCreate, canEdit, canManage, canSend, canDelete, canExport] = await Promise.all([
    checkUserPermission('recruitment', 'create', userId),
    checkUserPermission('recruitment', 'edit', userId),
    checkUserPermission('recruitment', 'manage', userId),
    checkUserPermission('recruitment', 'send', userId),
    checkUserPermission('recruitment', 'delete', userId),
    checkUserPermission('recruitment', 'export', userId),
  ])

  return { canCreate, canEdit, canManage, canSend, canDelete, canExport }
}

async function auditRecruitmentMutation(input: {
  user?: Awaited<ReturnType<typeof currentUser>> | null
  operation: string
  resource: string
  resourceId?: string | null
  status: 'success' | 'failure'
  oldValues?: Record<string, unknown>
  newValues?: Record<string, unknown>
  error?: unknown
}) {
  try {
    await logAuditEvent({
      user_id: input.user?.id,
      user_email: input.user?.email ?? undefined,
      operation_type: input.operation,
      resource_type: input.resource,
      resource_id: input.resourceId ?? undefined,
      operation_status: input.status,
      old_values: input.oldValues,
      new_values: input.newValues,
      error_message: input.error instanceof Error ? input.error.message : input.error ? String(input.error) : undefined,
    })
  } catch (auditError) {
    console.error('Recruitment audit failed', auditError)
  }
}

function formString(formData: FormData, key: string): string | null {
  const value = formData.get(key)
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

function formBool(formData: FormData, key: string): boolean {
  const value = formData.get(key)
  return value === 'on' || value === 'true' || value === '1'
}

function formBoolDefault(formData: FormData, key: string, defaultValue: boolean): boolean {
  if (!formData.has(key)) return defaultValue
  return formBool(formData, key)
}

async function formCvUpload(formData: FormData, key = 'cv') {
  const file = formData.get(key)
  if (!(file instanceof File) || file.size === 0) {
    return null
  }

  return {
    buffer: Buffer.from(await file.arrayBuffer()),
    fileName: file.name,
    mimeType: file.type || 'application/octet-stream',
    sizeBytes: file.size,
  }
}

function parseDateTimeLocal(value: string | null): string | null {
  return parseLondonDateTimeLocalToIso(value)
}

async function notifyRecruitmentManager(input: {
  applicationId?: string | null
  candidateId?: string | null
  alertType: string
  alertBody: string
  currentUserId?: string | null
}) {
  try {
    await sendRecruitmentManagerAlert(input)
  } catch (error) {
    console.error('Recruitment manager alert failed', error)
  }
}

function parseJobPostingForm(formData: FormData) {
  return {
    title: formString(formData, 'title'),
    slug: formString(formData, 'slug'),
    role_type: formString(formData, 'role_type'),
    description: formString(formData, 'description'),
    requirements: formString(formData, 'requirements'),
    ai_scoring_notes: formString(formData, 'ai_scoring_notes'),
    employment_type: formString(formData, 'employment_type'),
    positions_available: formString(formData, 'positions_available') ?? '1',
    status: formString(formData, 'status') ?? 'draft',
    is_public: formBool(formData, 'is_public'),
    application_closing_date: formString(formData, 'application_closing_date'),
  }
}

function formIds(formData: FormData, key = 'ids'): string[] {
  return formData
    .getAll(key)
    .flatMap(value => typeof value === 'string' ? value.split(',') : [])
    .map(value => value.trim())
    .filter(Boolean)
}

function csvCell(value: unknown): string {
  const text = value == null ? '' : String(value)
  return `"${text.replace(/"/g, '""')}"`
}

function applicationsToCsv(applications: any[]) {
  const headers = ['candidate', 'email', 'phone', 'role', 'score', 'recommendation', 'status', 'applied_at']
  const rows = applications.map(application => [
    [application.candidate?.first_name, application.candidate?.last_name].filter(Boolean).join(' '),
    application.candidate?.email,
    application.candidate?.phone_e164 || application.candidate?.phone,
    application.job_posting?.title,
    application.ai_score,
    application.ai_recommendation,
    application.status,
    application.created_at,
  ])

  return [
    headers.map(csvCell).join(','),
    ...rows.map(row => row.map(csvCell).join(',')),
  ].join('\n')
}

export async function getRecruitmentPageData(): Promise<ActionResult> {
  try {
    const user = await requireRecruitmentPermission('view')
    const supabase = createAdminClient()
    const [dashboard, adminData, permissions] = await Promise.all([
      getRecruitmentDashboard(supabase),
      listRecruitmentAdminData(supabase),
      getRecruitmentPermissionFlags(user.id),
    ])

    return { success: true, data: { dashboard, ...adminData, permissions } }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to load recruitment data.' }
  }
}

export async function getRecruitmentCandidates(
  params: RecruitmentCandidatesPageParams,
): Promise<ActionResult<RecruitmentCandidatesPage>> {
  try {
    await requireRecruitmentPermission('view')
    const supabase = createAdminClient()
    const data = await getRecruitmentCandidatesPage(supabase, params)
    return { success: true, data }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to load candidates.' }
  }
}

export async function createRecruitmentPostingAction(_prevState: unknown, formData: FormData): Promise<ActionResult> {
  try {
    const user = await requireRecruitmentPermission('create')
    const posting = await createRecruitmentJobPosting(parseJobPostingForm(formData), user.id)
    await logAuditEvent({
      user_id: user.id,
      user_email: user.email ?? undefined,
      operation_type: 'create',
      resource_type: 'recruitment_job_posting',
      resource_id: posting.id,
      operation_status: 'success',
      new_values: { title: posting.title, status: posting.status },
    })
    revalidatePath('/recruitment')
    return { success: true, data: posting, message: 'Recruitment posting created.' }
  } catch (error) {
    await auditRecruitmentMutation({
      operation: 'create',
      resource: 'recruitment_job_posting',
      status: 'failure',
      error,
    })
    return { success: false, error: error instanceof Error ? error.message : 'Failed to create posting.' }
  }
}

export async function updateRecruitmentPostingAction(_prevState: unknown, formData: FormData): Promise<ActionResult> {
  try {
    const user = await requireRecruitmentPermission('edit')
    const id = formString(formData, 'id')
    if (!id) throw new Error('Posting ID is required.')
    const posting = await updateRecruitmentJobPosting(id, parseJobPostingForm(formData), user.id)
    await auditRecruitmentMutation({
      user,
      operation: 'update',
      resource: 'recruitment_job_posting',
      resourceId: posting.id ?? id,
      status: 'success',
      newValues: {
        status: posting.status,
        is_public: posting.is_public,
        positions_available: posting.positions_available,
      },
    })
    revalidatePath('/recruitment')
    return { success: true, data: posting, message: 'Recruitment posting updated.' }
  } catch (error) {
    await auditRecruitmentMutation({
      operation: 'update',
      resource: 'recruitment_job_posting',
      resourceId: formString(formData, 'id'),
      status: 'failure',
      error,
    })
    return { success: false, error: error instanceof Error ? error.message : 'Failed to update posting.' }
  }
}

const RECRUITMENT_DECISION_TEMPLATE: Partial<Record<string, RecruitmentTemplateType>> = {
  reject: 'rejection',
  offer: 'offer',
  decline_duplicate: 'already_considered',
}

const RECRUITMENT_DECISION_PERMISSION: Record<string, ActionType> = {
  reject: 'edit',
  withdraw: 'edit',
  hold: 'edit',
  offer: 'manage',
  decline_duplicate: 'manage',
}

export async function previewRecruitmentDecisionEmailAction(
  applicationId: string,
  type: RecruitmentTemplateType,
): Promise<ActionResult<{ subject: string; body: string }>> {
  try {
    await requireRecruitmentPermission('view')
    if (!applicationId) throw new Error('Application is required.')
    const preview = await previewRecruitmentDecisionEmail(applicationId, type)
    return { success: true, data: preview }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to preview email.' }
  }
}

export async function decideRecruitmentApplicationAction(_prevState: unknown, formData: FormData): Promise<ActionResult> {
  const decision = (formString(formData, 'decision') ?? '') as 'reject' | 'offer' | 'decline_duplicate' | 'withdraw' | 'hold'
  try {
    if (!(decision in RECRUITMENT_DECISION_PERMISSION)) throw new Error('Unknown decision.')
    const user = await requireRecruitmentPermission(RECRUITMENT_DECISION_PERMISSION[decision])
    const applicationId = formString(formData, 'application_id')
    if (!applicationId) throw new Error('Application is required.')
    const reason = formString(formData, 'reason')
    const sendEmail = formBool(formData, 'send_email')

    await decideRecruitmentApplication({ applicationId, decision, reason, user: { id: user.id, email: user.email ?? null } })

    let emailError: string | null = null
    const templateType = RECRUITMENT_DECISION_TEMPLATE[decision]
    if (sendEmail && templateType) {
      try {
        await sendRecruitmentTemplateEmail(applicationId, templateType, {
          currentUserId: user.id,
          subjectOverride: formString(formData, 'email_subject'),
          bodyOverride: formString(formData, 'email_body'),
        })
      } catch (error) {
        emailError = error instanceof Error ? error.message : 'Failed to send email.'
      }
    }

    await auditRecruitmentMutation({
      user,
      operation: 'decide',
      resource: 'recruitment_application',
      resourceId: applicationId,
      status: 'success',
      newValues: { decision, email_sent: Boolean(sendEmail && templateType && !emailError) },
    })
    revalidatePath('/recruitment')
    if (emailError) {
      return { success: true, message: `Decision saved, but the email did not send: ${emailError}` }
    }
    return { success: true, message: 'Decision recorded.' }
  } catch (error) {
    await auditRecruitmentMutation({
      operation: 'decide',
      resource: 'recruitment_application',
      resourceId: formString(formData, 'application_id'),
      status: 'failure',
      error,
    })
    return { success: false, error: error instanceof Error ? error.message : 'Failed to record decision.' }
  }
}

export async function addRecruitmentCandidateNoteAction(_prevState: unknown, formData: FormData): Promise<ActionResult> {
  try {
    const user = await requireRecruitmentPermission('edit')
    const candidateId = formString(formData, 'candidate_id')
    const content = formString(formData, 'content')
    if (!candidateId) throw new Error('Candidate is required.')
    if (!content) throw new Error('Write a note before saving.')
    const note = await addRecruitmentCandidateNote({
      candidateId,
      applicationId: formString(formData, 'application_id'),
      content,
      kind: 'note',
      userId: user.id,
      userEmail: user.email ?? null,
    })
    await auditRecruitmentMutation({
      user,
      operation: 'create_note',
      resource: 'recruitment_candidate_note',
      resourceId: (note as { id?: string } | null)?.id ?? candidateId,
      status: 'success',
    })
    revalidatePath('/recruitment')
    return { success: true, data: note, message: 'Note added.' }
  } catch (error) {
    await auditRecruitmentMutation({
      operation: 'create_note',
      resource: 'recruitment_candidate_note',
      resourceId: formString(formData, 'candidate_id'),
      status: 'failure',
      error,
    })
    return { success: false, error: error instanceof Error ? error.message : 'Failed to add note.' }
  }
}

export async function getRecruitmentCandidateTrailAction(
  candidateId: string
): Promise<ActionResult<{ notes: unknown[]; systemChanges: unknown[] }>> {
  try {
    await requireRecruitmentPermission('view')
    if (!candidateId) throw new Error('Candidate is required.')
    const trail = await getRecruitmentCandidateTrail(candidateId)
    return { success: true, data: trail }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to load trail.' }
  }
}

export async function duplicateRecruitmentPostingAction(_prevState: unknown, formData: FormData): Promise<ActionResult> {
  try {
    const user = await requireRecruitmentPermission('create')
    const id = formString(formData, 'id')
    if (!id) throw new Error('Posting ID is required.')
    const posting = await duplicateRecruitmentJobPosting(id, user.id)
    await logAuditEvent({
      user_id: user.id,
      user_email: user.email ?? undefined,
      operation_type: 'create',
      resource_type: 'recruitment_job_posting',
      resource_id: posting.id,
      operation_status: 'success',
      new_values: { title: posting.title, status: posting.status, duplicated_from: id },
    })
    revalidatePath('/recruitment')
    return { success: true, data: posting, message: 'Posting duplicated as a draft.' }
  } catch (error) {
    await auditRecruitmentMutation({
      operation: 'create',
      resource: 'recruitment_job_posting',
      resourceId: formString(formData, 'id'),
      status: 'failure',
      error,
    })
    return { success: false, error: error instanceof Error ? error.message : 'Failed to duplicate posting.' }
  }
}

export async function createManualRecruitmentApplicationAction(_prevState: unknown, formData: FormData): Promise<ActionResult> {
  try {
    const user = await requireRecruitmentPermission('create')
    const cvUpload = await formCvUpload(formData)
    const result = await createRecruitmentApplication({
      candidate: {
        first_name: formString(formData, 'first_name'),
        last_name: formString(formData, 'last_name'),
        email: formString(formData, 'email'),
        phone: formString(formData, 'phone'),
        source: 'manual_upload',
        provided_details: formString(formData, 'provided_details'),
        sms_consent: formBoolDefault(formData, 'sms_consent', true),
        future_recruitment_consent: formBoolDefault(formData, 'future_recruitment_consent', true),
        consent_source: 'management_manual_upload',
        consent_at: new Date().toISOString(),
      },
      job_posting_id: formString(formData, 'job_posting_id'),
      source: 'manual_upload',
      cover_note: formString(formData, 'cover_note'),
      relevant_experience_answer: formString(formData, 'relevant_experience_answer'),
      travel_answer: formString(formData, 'travel_answer'),
      start_availability: formString(formData, 'start_availability'),
    }, {
      cvUpload,
      uploadKind: 'admin',
      currentUserId: user.id,
    })

    try {
      await sendRecruitmentApplicationReceivedEmail(result.application.id)
    } catch (error) {
      console.error('Recruitment application received email failed', error)
    }

    await notifyRecruitmentManager({
      applicationId: result.application.id,
      alertType: result.application.status === 'talent_pool'
        ? 'talent pool candidate'
        : result.application.ai_recommendation === 'fast_track'
          ? 'fast-track'
          : 'new application',
      alertBody: [
        `${result.candidate.first_name ?? ''} ${result.candidate.last_name ?? ''}`.trim() || result.candidate.email || 'A candidate',
        result.application.job_posting?.title ? `applied for ${result.application.job_posting.title}.` : 'was added to the talent pool.',
        result.application.ai_score != null ? `AI score: ${result.application.ai_score}.` : '',
        result.cvExtractionError ? `CV review needed: ${result.cvExtractionError}.` : '',
        result.scoringError ? `Scoring review needed: ${result.scoringError}.` : '',
      ].filter(Boolean).join(' '),
      currentUserId: user.id,
    })

    await auditRecruitmentMutation({
      user,
      operation: 'create',
      resource: 'recruitment_application',
      resourceId: result.application.id,
      status: 'success',
      newValues: {
        candidate_id: result.candidate.id,
        job_posting_id: result.application.job_posting_id,
        status: result.application.status,
        source: result.application.source,
        duplicate_of_application_id: result.duplicateOfApplicationId ?? null,
      },
    })
    revalidatePath('/recruitment')
    return {
      success: true,
      data: result,
      message: result.duplicateOfApplicationId ? 'Duplicate application recorded.' : 'Application created.',
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to create application.' }
  }
}

export async function updateRecruitmentCandidateAction(_prevState: unknown, formData: FormData): Promise<ActionResult> {
  try {
    const user = await requireRecruitmentPermission('edit')
    const candidateId = formString(formData, 'candidate_id')
    if (!candidateId) throw new Error('Candidate ID is required.')

    const candidate = await updateRecruitmentCandidateProfile(candidateId, {
      first_name: formString(formData, 'first_name'),
      last_name: formString(formData, 'last_name'),
      email: formString(formData, 'email'),
      phone: formString(formData, 'phone'),
      phone_e164: formString(formData, 'phone_e164'),
      location: formString(formData, 'location'),
      notes: formString(formData, 'notes'),
      sms_consent: formBool(formData, 'sms_consent'),
      future_recruitment_consent: formBool(formData, 'future_recruitment_consent'),
      right_to_work_status: formString(formData, 'right_to_work_status') as any || undefined,
      right_to_work_document_type: formString(formData, 'right_to_work_document_type') as any,
      right_to_work_checked_at: parseDateTimeLocal(formString(formData, 'right_to_work_checked_at')),
    }, user.id)

    await auditRecruitmentMutation({
      user,
      operation: 'update',
      resource: 'recruitment_candidate',
      resourceId: candidateId,
      status: 'success',
      newValues: {
        changed_fields: [
          'first_name',
          'last_name',
          'email',
          'phone',
          'phone_e164',
          'location',
          'notes',
          'sms_consent',
          'future_recruitment_consent',
          'right_to_work_status',
          'right_to_work_document_type',
          'right_to_work_checked_at',
        ].filter((field) => formData.has(field)),
        right_to_work_status: (candidate as any).right_to_work_status ?? null,
        sms_consent: (candidate as any).sms_consent ?? null,
        future_recruitment_consent: (candidate as any).future_recruitment_consent ?? null,
      },
    })
    revalidatePath('/recruitment')
    return { success: true, data: candidate, message: 'Candidate updated.' }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to update candidate.' }
  }
}

export async function transitionRecruitmentStatusAction(formData: FormData): Promise<ActionResult> {
  try {
    const user = await requireRecruitmentPermission('edit')
    const applicationId = formString(formData, 'application_id')
    const status = formString(formData, 'status')
    if (!applicationId || !status) throw new Error('Application and status are required.')
    const application = await transitionRecruitmentApplicationStatus(applicationId, status, {
      note: formString(formData, 'note'),
      actorUserId: user.id,
    })
    await auditRecruitmentMutation({
      user,
      operation: 'update_status',
      resource: 'recruitment_application',
      resourceId: applicationId,
      status: 'success',
      newValues: { status: (application as any).status ?? status },
    })
    revalidatePath('/recruitment')
    return { success: true, data: application, message: 'Application status updated.' }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to update status.' }
  }
}

export async function rescoreRecruitmentApplicationAction(formData: FormData): Promise<ActionResult> {
  try {
    const user = await requireRecruitmentPermission('manage')
    const applicationId = formString(formData, 'application_id')
    if (!applicationId) throw new Error('Application ID is required.')

    const result = await rescoreRecruitmentApplication(applicationId, user.id)
    await auditRecruitmentMutation({
      user,
      operation: 'rescore',
      resource: 'recruitment_application',
      resourceId: applicationId,
      status: 'success',
      newValues: {
        scoring_warning: Boolean(result.scoringError),
      },
    })
    revalidatePath('/recruitment')
    return {
      success: true,
      data: result,
      message: result.scoringError ? `Re-score recorded with warning: ${result.scoringError}` : 'Application re-scored.',
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to re-score application.' }
  }
}

export async function retryRecruitmentCvExtractionAction(_prevState: unknown, formData: FormData): Promise<ActionResult> {
  try {
    const user = await requireRecruitmentPermission('manage')
    const candidateId = formString(formData, 'candidate_id')
    if (!candidateId) throw new Error('Candidate ID is required.')

    const result = await reprocessRecruitmentCandidateCv(candidateId, user.id)
    await auditRecruitmentMutation({
      user,
      operation: 'reprocess_cv',
      resource: 'recruitment_candidate',
      resourceId: candidateId,
      status: 'success',
      newValues: {
        cv_warning: Boolean(result.cvExtractionError),
        rescored_applications: result.rescoredApplications.length,
      },
    })
    revalidatePath('/recruitment')
    return {
      success: true,
      data: result,
      message: result.cvExtractionError
        ? `CV still needs review: ${result.cvExtractionError}`
        : `CV extraction retried. Re-scored ${result.rescoredApplications.length} application(s).`,
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to retry CV extraction.' }
  }
}

export async function retryManualReviewCvsAction(_prevState: unknown, formData: FormData): Promise<ActionResult> {
  try {
    const user = await requireRecruitmentPermission('manage')
    const limit = Number.parseInt(formString(formData, 'limit') ?? '10', 10)
    const result = await reprocessRecruitmentManualReviewCvs(Number.isFinite(limit) ? limit : 10, user.id)
    await auditRecruitmentMutation({
      user,
      operation: 'reprocess_cv',
      resource: 'recruitment_candidate',
      status: 'success',
      newValues: {
        processed: result.processed.length,
        failures: result.failures.length,
      },
    })
    revalidatePath('/recruitment')
    return {
      success: true,
      data: result,
      message: `Retried ${result.processed.length} CV(s). ${result.failures.length} failed.`,
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to retry CV reviews.' }
  }
}

export async function matchRecruitmentCandidateAction(formData: FormData): Promise<ActionResult> {
  try {
    const user = await requireRecruitmentPermission('manage')
    const candidateId = formString(formData, 'candidate_id')
    const postingId = formString(formData, 'job_posting_id')
    if (!candidateId || !postingId) throw new Error('Candidate and posting are required.')

    const result = await matchRecruitmentCandidateToPosting(candidateId, postingId, user.id)
    await auditRecruitmentMutation({
      user,
      operation: 'create',
      resource: 'recruitment_application',
      resourceId: result.application.id,
      status: 'success',
      newValues: {
        candidate_id: candidateId,
        job_posting_id: postingId,
        duplicate_of_application_id: result.duplicateOfApplicationId ?? null,
      },
    })
    revalidatePath('/recruitment')
    return {
      success: true,
      data: result,
      message: result.duplicateOfApplicationId ? 'Duplicate application recorded.' : 'Candidate matched to posting.',
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to match candidate.' }
  }
}

export async function saveRecruitmentEmailTemplateAction(_prevState: unknown, formData: FormData): Promise<ActionResult> {
  try {
    const user = await requireRecruitmentPermission('manage')
    const template = await saveRecruitmentEmailTemplate({
      id: formString(formData, 'id'),
      type: formString(formData, 'type') as RecruitmentTemplateType,
      subject: formString(formData, 'subject') ?? '',
      body: formString(formData, 'body') ?? '',
      isActive: formBool(formData, 'is_active'),
    }, user.id)

    await auditRecruitmentMutation({
      user,
      operation: 'update',
      resource: 'recruitment_email_template',
      resourceId: template.id,
      status: 'success',
      newValues: { type: template.type, is_active: template.is_active },
    })
    revalidatePath('/recruitment')
    return { success: true, data: template, message: 'Template saved.' }
  } catch (error) {
    await auditRecruitmentMutation({
      operation: 'update',
      resource: 'recruitment_email_template',
      resourceId: formString(formData, 'id'),
      status: 'failure',
      error,
    })
    return { success: false, error: error instanceof Error ? error.message : 'Failed to save template.' }
  }
}

export async function createRecruitmentSlotAction(_prevState: unknown, formData: FormData): Promise<ActionResult> {
  try {
    const user = await requireRecruitmentPermission('create')
    const startsAt = parseDateTimeLocal(formString(formData, 'starts_at'))
    const endsAt = parseDateTimeLocal(formString(formData, 'ends_at'))
    const slots = await createRecruitmentAppointmentSlots({
      type: formString(formData, 'type'),
      starts_at: startsAt,
      ends_at: endsAt,
      timezone: formString(formData, 'timezone') ?? 'Europe/London',
      location: formString(formData, 'location') ?? 'The Anchor',
      interviewer_user_id: null,
      supervisor_staff_id: formString(formData, 'supervisor_staff_id'),
    }, user.id)
    const firstSlot = slots[0]
    await auditRecruitmentMutation({
      user,
      operation: 'create',
      resource: 'recruitment_appointment_slot',
      resourceId: firstSlot?.id,
      status: 'success',
      newValues: {
        count: slots.length,
        slot_ids: slots.map(slot => (slot as any).id),
        type: (firstSlot as any)?.type,
        starts_at: (firstSlot as any)?.starts_at,
        ends_at: (slots.at(-1) as any)?.ends_at,
        status: (firstSlot as any)?.status,
      },
    })
    revalidatePath('/recruitment')
    return {
      success: true,
      data: slots,
      message: slots.length === 1 ? 'Appointment slot created.' : `${slots.length} appointment slots created.`,
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to create appointment slot.' }
  }
}

export async function updateRecruitmentSlotAction(_prevState: unknown, formData: FormData): Promise<ActionResult> {
  try {
    const user = await requireRecruitmentPermission('edit')
    const slotId = formString(formData, 'slot_id')
    if (!slotId) throw new Error('Slot ID is required.')
    const startsAt = parseDateTimeLocal(formString(formData, 'starts_at'))
    const endsAt = parseDateTimeLocal(formString(formData, 'ends_at'))
    const slot = await updateRecruitmentAppointmentSlot(slotId, {
      type: formString(formData, 'type'),
      starts_at: startsAt,
      ends_at: endsAt,
      timezone: formString(formData, 'timezone') ?? 'Europe/London',
      location: formString(formData, 'location') ?? 'The Anchor',
      interviewer_user_id: null,
      supervisor_staff_id: formString(formData, 'supervisor_staff_id'),
    })
    await auditRecruitmentMutation({
      user,
      operation: 'update',
      resource: 'recruitment_appointment_slot',
      resourceId: slotId,
      status: 'success',
      newValues: { starts_at: (slot as any).starts_at, status: (slot as any).status },
    })
    revalidatePath('/recruitment')
    return { success: true, data: slot, message: 'Slot updated.' }
  } catch (error) {
    await auditRecruitmentMutation({
      operation: 'update',
      resource: 'recruitment_appointment_slot',
      resourceId: formString(formData, 'slot_id'),
      status: 'failure',
      error,
    })
    return { success: false, error: error instanceof Error ? error.message : 'Failed to update slot.' }
  }
}

export async function cancelRecruitmentSlotAction(formData: FormData): Promise<ActionResult> {
  try {
    const user = await requireRecruitmentPermission('edit')
    const slotId = formString(formData, 'slot_id')
    if (!slotId) throw new Error('Slot ID is required.')
    const slot = await cancelRecruitmentAppointmentSlot(slotId, user.id)
    await auditRecruitmentMutation({
      user,
      operation: 'cancel',
      resource: 'recruitment_appointment_slot',
      resourceId: slotId,
      status: 'success',
      newValues: { status: (slot as any).status ?? 'cancelled' },
    })
    revalidatePath('/recruitment')
    return { success: true, data: slot, message: 'Slot deleted.' }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to delete slot.' }
  }
}

export async function archiveRecruitmentApplicationAction(formData: FormData): Promise<ActionResult> {
  try {
    const user = await requireRecruitmentPermission('edit')
    const applicationId = formString(formData, 'application_id')
    if (!applicationId) throw new Error('Application ID is required.')
    const application = await setRecruitmentArchiveState('recruitment_applications', applicationId, true, user.id)
    await auditRecruitmentMutation({
      user,
      operation: 'archive',
      resource: 'recruitment_application',
      resourceId: applicationId,
      status: 'success',
      newValues: { archived: true, status: (application as any).status ?? null },
    })
    revalidatePath('/recruitment')
    return { success: true, data: application, message: 'Application archived.' }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to archive application.' }
  }
}

export async function restoreRecruitmentApplicationAction(formData: FormData): Promise<ActionResult> {
  try {
    const user = await requireRecruitmentPermission('edit')
    const applicationId = formString(formData, 'application_id')
    if (!applicationId) throw new Error('Application ID is required.')
    const application = await setRecruitmentArchiveState('recruitment_applications', applicationId, false, user.id)
    await auditRecruitmentMutation({
      user,
      operation: 'restore',
      resource: 'recruitment_application',
      resourceId: applicationId,
      status: 'success',
      newValues: { archived: false, status: (application as any).status ?? null },
    })
    revalidatePath('/recruitment')
    return { success: true, data: application, message: 'Application restored.' }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to restore application.' }
  }
}

export async function archiveRecruitmentSlotAction(formData: FormData): Promise<ActionResult> {
  try {
    const user = await requireRecruitmentPermission('edit')
    const slotId = formString(formData, 'slot_id')
    if (!slotId) throw new Error('Slot ID is required.')
    const slot = await setRecruitmentArchiveState('recruitment_appointment_slots', slotId, true, user.id)
    await auditRecruitmentMutation({
      user,
      operation: 'archive',
      resource: 'recruitment_appointment_slot',
      resourceId: slotId,
      status: 'success',
      newValues: { archived: true, status: (slot as any).status ?? null },
    })
    revalidatePath('/recruitment')
    return { success: true, data: slot, message: 'Slot archived.' }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to archive slot.' }
  }
}

export async function restoreRecruitmentSlotAction(formData: FormData): Promise<ActionResult> {
  try {
    const user = await requireRecruitmentPermission('edit')
    const slotId = formString(formData, 'slot_id')
    if (!slotId) throw new Error('Slot ID is required.')
    const slot = await restoreRecruitmentAppointmentSlot(slotId)
    await auditRecruitmentMutation({
      user,
      operation: 'restore',
      resource: 'recruitment_appointment_slot',
      resourceId: slotId,
      status: 'success',
      newValues: { archived: false, status: (slot as any).status ?? null },
    })
    revalidatePath('/recruitment')
    return { success: true, data: slot, message: 'Slot restored.' }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to restore slot.' }
  }
}

export async function recordRecruitmentAppointmentOutcomeAction(formData: FormData): Promise<ActionResult> {
  try {
    const user = await requireRecruitmentPermission('edit')
    const appointmentId = formString(formData, 'appointment_id')
    if (!appointmentId) throw new Error('Appointment ID is required.')

    const result = await recordRecruitmentAppointmentOutcome(appointmentId, {
      status: formString(formData, 'status') as any,
      outcome: formString(formData, 'outcome'),
      outcome_rating: formString(formData, 'outcome_rating') as any,
      meal_provided: formBool(formData, 'meal_provided'),
    }, user.id)

    if ((result as any).status === 'no_show') {
      await notifyRecruitmentManager({
        applicationId: (result as any).application_id,
        candidateId: (result as any).candidate_id,
        alertType: 'no-show action needed',
        alertBody: 'A recruitment appointment was marked as no-show. Review the application and decide whether to rebook or close it.',
        currentUserId: user.id,
      })
    }

    await auditRecruitmentMutation({
      user,
      operation: 'record_outcome',
      resource: 'recruitment_appointment',
      resourceId: appointmentId,
      status: 'success',
      newValues: {
        status: (result as any).status,
        outcome: (result as any).outcome ?? null,
        outcome_rating: (result as any).outcome_rating ?? null,
        meal_provided: (result as any).meal_provided ?? null,
      },
    })
    revalidatePath('/recruitment')
    return { success: true, data: result, message: 'Appointment outcome recorded.' }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to record appointment outcome.' }
  }
}

export async function cancelRecruitmentAppointmentAction(formData: FormData): Promise<ActionResult> {
  try {
    const user = await requireRecruitmentPermission('edit')
    const appointmentId = formString(formData, 'appointment_id')
    if (!appointmentId) throw new Error('Appointment ID is required.')
    const appointment = await cancelRecruitmentAppointmentByStaff(appointmentId, formString(formData, 'reason'), user.id)
    await auditRecruitmentMutation({
      user,
      operation: 'cancel',
      resource: 'recruitment_appointment',
      resourceId: appointmentId,
      status: 'success',
      newValues: { status: (appointment as any).status ?? 'cancelled' },
    })
    await notifyRecruitmentManager({
      applicationId: (appointment as any).application_id,
      candidateId: (appointment as any).candidate_id,
      alertType: 'appointment cancelled',
      alertBody: 'A recruitment appointment was cancelled by staff. The application is on hold — review and rebook or close it.',
      currentUserId: user.id,
    })
    revalidatePath('/recruitment')
    return { success: true, data: appointment, message: 'Appointment cancelled.' }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to cancel appointment.' }
  }
}

export async function rescheduleRecruitmentAppointmentAction(formData: FormData): Promise<ActionResult> {
  try {
    const user = await requireRecruitmentPermission('edit')
    const appointmentId = formString(formData, 'appointment_id')
    const slotId = formString(formData, 'slot_id')
    if (!appointmentId || !slotId) throw new Error('Appointment and new slot are required.')
    const appointment = await rescheduleRecruitmentAppointmentByStaff(appointmentId, slotId, user.id)
    await auditRecruitmentMutation({
      user,
      operation: 'reschedule',
      resource: 'recruitment_appointment',
      resourceId: appointmentId,
      status: 'success',
      newValues: {
        slot_id: (appointment as any).slot_id ?? slotId,
        scheduled_start: (appointment as any).scheduled_start ?? null,
        scheduled_end: (appointment as any).scheduled_end ?? null,
      },
    })
    revalidatePath('/recruitment')
    return { success: true, data: appointment, message: 'Appointment rescheduled.' }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to reschedule appointment.' }
  }
}

async function scheduleRecruitmentAppointmentForCandidate(
  formData: FormData,
  appointmentType: RecruitmentAppointmentType,
): Promise<ActionResult> {
  const typeLabel = appointmentType === 'trial_shift' ? 'trial shift' : 'interview'
  const titleLabel = appointmentType === 'trial_shift' ? 'Trial shift' : 'Interview'
  const templateType: RecruitmentTemplateType = appointmentType === 'trial_shift'
    ? 'trial_confirmation'
    : 'interview_confirmation'
  try {
    const user = await requireRecruitmentPermission('edit')
    const applicationId = formString(formData, 'application_id')
    const slotId = formString(formData, 'slot_id')
    if (!applicationId || !slotId) throw new Error(`Application and ${typeLabel} slot are required.`)

    const appointmentId = await scheduleRecruitmentAppointmentByStaff({
      applicationId,
      slotId,
      appointmentType,
      actorUserId: user.id,
    })
    const appointment = await loadRecruitmentAppointment(appointmentId)
    const ics = generateRecruitmentAppointmentIcs(appointment)

    const candidateName = [appointment.candidate?.first_name, appointment.candidate?.last_name]
      .filter(Boolean)
      .join(' ') || appointment.candidate?.email || 'A candidate'
    const roleTitle = appointment.application?.job_posting?.title
    const whenLabel = formatRecruitmentAppointmentTime(appointment)

    const [calendarResult, emailResult, managerEmailResult] = await Promise.allSettled([
      syncRecruitmentAppointmentCalendar(appointmentId),
      sendRecruitmentTemplateEmail(applicationId, templateType, {
        currentUserId: user.id,
        appointmentId,
        attachments: [{
          name: 'the-anchor-recruitment.ics',
          content: Buffer.from(ics),
          contentType: 'text/calendar; charset=utf-8; method=REQUEST',
        }],
      }),
      sendRecruitmentManagerAlert({
        applicationId,
        candidateId: appointment.candidate_id,
        alertType: appointmentType === 'trial_shift' ? 'trial scheduled' : 'interview scheduled',
        alertBody: `${candidateName}${roleTitle ? ` (${roleTitle})` : ''} — ${typeLabel} booked for ${whenLabel} at ${appointment.location}. Scheduled manually by a manager.`,
        currentUserId: user.id,
      }),
    ])

    if (calendarResult.status === 'rejected') {
      console.error('Recruitment staff schedule calendar sync failed', calendarResult.reason)
    }
    if (managerEmailResult.status === 'rejected') {
      console.error('Recruitment staff schedule manager alert failed', managerEmailResult.reason)
    }

    await auditRecruitmentMutation({
      user,
      operation: 'schedule',
      resource: 'recruitment_appointment',
      resourceId: appointmentId,
      status: 'success',
      newValues: {
        application_id: applicationId,
        slot_id: slotId,
        type: appointmentType,
        scheduled_start: appointment.scheduled_start,
        calendar_status: calendarResult.status === 'fulfilled' ? calendarResult.value.status : 'failed',
        confirmation_email_sent: emailResult.status === 'fulfilled',
        manager_email_sent: managerEmailResult.status === 'fulfilled',
      },
    })
    revalidatePath('/recruitment')
    return {
      success: true,
      data: { appointmentId },
      message: emailResult.status === 'fulfilled'
        ? `${titleLabel} scheduled and confirmation sent.`
        : `${titleLabel} scheduled, but the confirmation email failed to send — resend it from the candidate's Comms tab.`,
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : `Failed to schedule ${typeLabel}.` }
  }
}

export async function scheduleRecruitmentInterviewForCandidateAction(formData: FormData): Promise<ActionResult> {
  return scheduleRecruitmentAppointmentForCandidate(formData, 'interview')
}

export async function scheduleRecruitmentTrialForCandidateAction(formData: FormData): Promise<ActionResult> {
  return scheduleRecruitmentAppointmentForCandidate(formData, 'trial_shift')
}

export async function archiveRecruitmentAppointmentAction(formData: FormData): Promise<ActionResult> {
  try {
    const user = await requireRecruitmentPermission('edit')
    const appointmentId = formString(formData, 'appointment_id')
    if (!appointmentId) throw new Error('Appointment ID is required.')
    const appointment = await setRecruitmentArchiveState('recruitment_candidate_appointments', appointmentId, true, user.id)
    await auditRecruitmentMutation({
      user,
      operation: 'archive',
      resource: 'recruitment_appointment',
      resourceId: appointmentId,
      status: 'success',
      newValues: { archived: true, status: (appointment as any).status ?? null },
    })
    revalidatePath('/recruitment')
    return { success: true, data: appointment, message: 'Appointment archived.' }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to archive appointment.' }
  }
}

export async function restoreRecruitmentAppointmentAction(formData: FormData): Promise<ActionResult> {
  try {
    const user = await requireRecruitmentPermission('edit')
    const appointmentId = formString(formData, 'appointment_id')
    if (!appointmentId) throw new Error('Appointment ID is required.')
    const appointment = await setRecruitmentArchiveState('recruitment_candidate_appointments', appointmentId, false, user.id)
    await auditRecruitmentMutation({
      user,
      operation: 'restore',
      resource: 'recruitment_appointment',
      resourceId: appointmentId,
      status: 'success',
      newValues: { archived: false, status: (appointment as any).status ?? null },
    })
    revalidatePath('/recruitment')
    return { success: true, data: appointment, message: 'Appointment restored.' }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to restore appointment.' }
  }
}

export async function recordRecruitmentScorecardAction(_prevState: unknown, formData: FormData): Promise<ActionResult> {
  try {
    const user = await requireRecruitmentPermission('edit')
    const appointmentId = formString(formData, 'appointment_id')
    if (!appointmentId) throw new Error('Appointment ID is required.')
    const criteria = [
      { label: 'Experience', rating: formString(formData, 'experience_rating'), notes: formString(formData, 'experience_notes') },
      { label: 'Attitude', rating: formString(formData, 'attitude_rating'), notes: formString(formData, 'attitude_notes') },
      { label: 'Availability and travel', rating: formString(formData, 'availability_rating'), notes: formString(formData, 'availability_notes') },
    ]
    const scorecard = await createRecruitmentInterviewScorecard({
      appointment_id: appointmentId,
      overall_rating: formString(formData, 'overall_rating') as any,
      recommendation: formString(formData, 'recommendation') as any || 'no_decision',
      comments: formString(formData, 'comments'),
      criteria: criteria as any,
    }, user.id)
    await auditRecruitmentMutation({
      user,
      operation: 'create',
      resource: 'recruitment_interview_scorecard',
      resourceId: scorecard.id,
      status: 'success',
      newValues: {
        appointment_id: appointmentId,
        overall_rating: (scorecard as any).overall_rating,
        recommendation: (scorecard as any).recommendation,
      },
    })
    revalidatePath('/recruitment')
    return { success: true, data: scorecard, message: 'Scorecard saved.' }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to save scorecard.' }
  }
}

export async function retryRecruitmentCommunicationAction(formData: FormData): Promise<ActionResult> {
  try {
    const user = await requireRecruitmentPermission('send')
    const communicationId = formString(formData, 'communication_id')
    if (!communicationId) throw new Error('Communication ID is required.')
    const result = await retryRecruitmentCommunication(communicationId, user.id)
    await auditRecruitmentMutation({
      user,
      operation: 'retry',
      resource: 'recruitment_communication',
      resourceId: communicationId,
      status: 'success',
      newValues: { status: (result as any).status ?? null },
    })
    revalidatePath('/recruitment')
    return { success: true, data: result, message: 'Communication retried.' }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to retry communication.' }
  }
}

export async function bulkRecruitmentApplicationsAction(formData: FormData): Promise<ActionResult> {
  try {
    const user = await requireRecruitmentPermission('edit')
    const ids = formIds(formData)
    const action = formString(formData, 'bulk_action') as 'status' | 'reject' | 'archive' | 'restore' | null
    if (!action) throw new Error('Bulk action is required.')
    const result = await bulkUpdateRecruitmentApplications(ids, {
      action,
      status: formString(formData, 'status'),
      note: formString(formData, 'note'),
    }, user.id)
    await auditRecruitmentMutation({
      user,
      operation: 'bulk_update',
      resource: 'recruitment_application',
      status: 'success',
      newValues: {
        action,
        requested: ids.length,
        updated: result.updated,
        failures: result.failures.length,
        status: formString(formData, 'status'),
      },
    })
    revalidatePath('/recruitment')
    return {
      success: true,
      data: result,
      message: result.failures.length ? `${result.updated} updated, ${result.failures.length} failed.` : `${result.updated} updated.`,
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to run bulk action.' }
  }
}

export async function exportRecruitmentApplicationsCsvAction(formData: FormData): Promise<ActionResult<{ csv: string }>> {
  try {
    await requireRecruitmentPermission('export')
    const ids = formIds(formData)
    const applications = await getRecruitmentApplicationsForCsv(ids.length ? ids : null)
    return { success: true, data: { csv: applicationsToCsv(applications) } }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to export applications.' }
  }
}

export async function issueRecruitmentBookingInviteAction(formData: FormData): Promise<ActionResult> {
  try {
    const user = await requireRecruitmentPermission('send')
    const applicationId = formString(formData, 'application_id')
    const type = formString(formData, 'type') as RecruitmentAppointmentType | null
    if (!applicationId || !type) throw new Error('Application and appointment type are required.')

    const booking = await issueRecruitmentBookingLink(applicationId, type, { actorUserId: user.id })
    await sendRecruitmentTemplateEmail(applicationId, type === 'trial_shift' ? 'trial_invite' : 'interview_invite', {
      currentUserId: user.id,
      bookingLink: booking.bookingUrl,
    })
    await auditRecruitmentMutation({
      user,
      operation: 'send_invite',
      resource: 'recruitment_application',
      resourceId: applicationId,
      status: 'success',
      newValues: {
        appointment_type: type,
        expires_at: booking.expiresAt,
      },
    })
    revalidatePath('/recruitment')
    return { success: true, data: booking, message: 'Booking invite sent.' }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to send booking invite.' }
  }
}

export async function draftRecruitmentEmailAction(formData: FormData): Promise<ActionResult> {
  try {
    await requireRecruitmentPermission('send')
    const applicationId = formString(formData, 'application_id')
    const type = formString(formData, 'type') as RecruitmentTemplateType | null
    if (!applicationId || !type) throw new Error('Application and email type are required.')

    const draft = await draftRecruitmentEmailForApplication(applicationId, type, {
      bookingLink: formString(formData, 'booking_link'),
      offerTerms: formString(formData, 'offer_terms'),
    })
    return { success: true, data: draft }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to draft recruitment email.' }
  }
}

export async function sendRecruitmentDecisionEmailAction(formData: FormData): Promise<ActionResult> {
  try {
    const user = await requireRecruitmentPermission('send')
    const applicationId = formString(formData, 'application_id')
    const type = formString(formData, 'type') as RecruitmentTemplateType | null
    const aiRunId = formString(formData, 'ai_run_id')
    if (!applicationId || !type) throw new Error('Application and email type are required.')

    const result = await sendRecruitmentTemplateEmail(applicationId, type, {
      currentUserId: user.id,
      subjectOverride: formString(formData, 'subject'),
      bodyOverride: formString(formData, 'body'),
      offerTerms: formString(formData, 'offer_terms'),
      aiRunId,
      wasAiAssisted: Boolean(aiRunId),
    })
    const statusTransition = EMAIL_STATUS_TRANSITIONS[type]
    let statusUpdateError: string | null = null

    if (statusTransition) {
      try {
        await transitionRecruitmentApplicationStatus(applicationId, statusTransition.status, {
          note: statusTransition.note,
          metadata: {
            template_type: type,
            communication_id: result.communicationId,
          },
          actorUserId: user.id,
        })
      } catch (error) {
        statusUpdateError = error instanceof Error ? error.message : 'Failed to update application status.'
      }
    }

    await auditRecruitmentMutation({
      user,
      operation: 'send_email',
      resource: 'recruitment_application',
      resourceId: applicationId,
      status: 'success',
      newValues: {
        template_type: type,
        communication_id: result.communicationId,
        status_transition: statusTransition?.status ?? null,
        status_update_error: statusUpdateError,
      },
    })
    revalidatePath('/recruitment')
    return {
      success: true,
      data: result,
      message: statusUpdateError
        ? `Recruitment email sent, but status was not updated: ${statusUpdateError}`
        : 'Recruitment email sent.',
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to send recruitment email.' }
  }
}

export async function getRecruitmentCvUrlAction(candidateId: string): Promise<ActionResult<{ url: string | null }>> {
  try {
    await requireRecruitmentPermission('view')
    const url = await getRecruitmentCvSignedUrl(candidateId)
    return { success: true, data: { url } }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to create CV link.' }
  }
}

export async function inviteRecruitmentCandidateAsEmployeeAction(formData: FormData): Promise<ActionResult> {
  try {
    const user = await requireRecruitmentPermission('manage')
    const canCreateEmployee = await checkUserPermission('employees', 'create', user.id)
    if (!canCreateEmployee) {
      throw new Error('You do not have permission to create employee invites.')
    }

    const applicationId = formString(formData, 'application_id')
    const jobTitle = formString(formData, 'job_title')
    if (!applicationId || !jobTitle) throw new Error('Application and job title are required.')

    const admin = createAdminClient()
    const { data: application, error } = await admin
      .from('recruitment_applications')
      .select('*, candidate:recruitment_candidates(*)')
      .eq('id', applicationId)
      .maybeSingle()

    if (error) throw error
    if (!application?.candidate?.email) throw new Error('Candidate email is required.')

    const { data: duplicateEmployee, error: duplicateError } = await admin
      .from('employees')
      .select('employee_id, status')
      .eq('email_address', application.candidate.email)
      .neq('status', 'Former')
      .limit(1)
      .maybeSingle()

    if (duplicateError) throw duplicateError
    if (duplicateEmployee) {
      throw new Error('An active employee with this email address already exists.')
    }

    const inviteForm = new FormData()
    inviteForm.set('email', application.candidate.email)
    inviteForm.set('job_title', jobTitle)
    const invite = await inviteEmployee(null, inviteForm)
    if (invite.type !== 'success' || !invite.employeeId) {
      throw new Error(invite.message || 'Employee invite failed.')
    }

    await admin
      .from('employees')
      .update({
        first_name: application.candidate.first_name || undefined,
        last_name: application.candidate.last_name || undefined,
        phone_number: application.candidate.phone_e164 || application.candidate.phone || undefined,
      })
      .eq('employee_id', invite.employeeId)

    await completeRecruitmentHireHandoff(applicationId, invite.employeeId, user.id, admin)
    await auditRecruitmentMutation({
      user,
      operation: 'hire_handoff',
      resource: 'recruitment_application',
      resourceId: applicationId,
      status: 'success',
      newValues: {
        employee_id: invite.employeeId,
        job_title: jobTitle,
      },
    })
    await notifyRecruitmentManager({
      applicationId,
      candidateId: application.candidate_id,
      alertType: 'candidate hired',
      alertBody: `${application.candidate.first_name ?? 'A candidate'} has been hired and an employee invite was sent (${jobTitle}).`,
      currentUserId: user.id,
    })
    revalidatePath('/recruitment')
    revalidatePath('/employees')
    return { success: true, data: { employeeId: invite.employeeId }, message: 'Candidate invite sent and hire handoff completed.' }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to hire candidate.' }
  }
}

export async function runRecruitmentRetentionAction(_prevState?: unknown): Promise<ActionResult> {
  try {
    const user = await requireRecruitmentPermission('manage')
    const result = await runRecruitmentRetentionCleanup()
    await auditRecruitmentMutation({
      user,
      operation: 'retention_cleanup',
      resource: 'recruitment_candidate',
      status: 'success',
      newValues: {
        anonymised: result.anonymised,
        cv_deleted: result.cvDeleted,
      },
    })
    revalidatePath('/recruitment')
    return { success: true, data: result, message: 'Recruitment retention cleanup completed.' }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to run retention cleanup.' }
  }
}

export async function eraseRecruitmentCandidateAction(formData: FormData): Promise<ActionResult> {
  try {
    const user = await requireSuperAdmin()
    const candidateId = formString(formData, 'candidate_id')
    const reason = formString(formData, 'reason') ?? 'GDPR erasure request'
    if (!candidateId) throw new Error('Candidate ID is required.')
    const result = await eraseRecruitmentCandidate(candidateId, reason)
    await auditRecruitmentMutation({
      user,
      operation: 'erase',
      resource: 'recruitment_candidate',
      resourceId: candidateId,
      status: 'success',
      newValues: {
        pii_erased: true,
        cancelled_appointments: result.cancelledAppointments,
        reason_recorded: Boolean(reason),
      },
    })
    revalidatePath('/recruitment')
    return { success: true, data: result, message: 'Candidate PII erased.' }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to erase candidate.' }
  }
}

export async function getRecruitmentPrintableKitAction(formData: FormData): Promise<ActionResult<{
  text: string
  application: any
  appointment: any | null
  cvUrl: string | null
  kind: 'interview' | 'trial'
}>> {
  try {
    await requireRecruitmentPermission('view')
    const applicationId = formString(formData, 'application_id')
    const kind = formString(formData, 'kind') === 'trial' ? 'trial' : 'interview'
    if (!applicationId) throw new Error('Application ID is required.')

    const admin = createAdminClient()
    const { data: application, error } = await admin
      .from('recruitment_applications')
      .select('*, candidate:recruitment_candidates(*), job_posting:recruitment_job_postings(*)')
      .eq('id', applicationId)
      .maybeSingle()
    if (error) throw error
    if (!application) throw new Error('Application not found.')

    const { data: appointment } = await admin
      .from('recruitment_candidate_appointments')
      .select('*')
      .eq('application_id', applicationId)
      .order('scheduled_start', { ascending: false })
      .limit(1)
      .maybeSingle()

    let cvUrl: string | null = null
    try {
      cvUrl = await getRecruitmentCvSignedUrl(application.candidate_id, admin)
    } catch (cvError) {
      console.warn('Failed to create recruitment CV link for printable kit', cvError)
    }

    return {
      success: true,
      data: {
        text: buildRecruitmentPrintableKit({ application, appointment, kind }),
        application,
        appointment: appointment ?? null,
        cvUrl,
        kind,
      },
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to build printable kit.' }
  }
}
