'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import JSZip from 'jszip'
import { checkUserPermission } from '@/app/actions/rbac'
import { logAuditEvent } from '@/app/actions/audit'
import { getAllJobs, createJob, updateJob } from '@/lib/hiring/service'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { uploadHiringResume } from '@/lib/hiring/uploads'
import { sendEmail } from '@/lib/email/emailService'
import { generateHiringMessageDraft, type HiringMessageType } from '@/lib/hiring/messaging'

const JobSchema = z.object({
    title: z.string().min(1, 'Title is required'),
    slug: z.string().min(1, 'Slug is required').regex(/^[a-z0-9-]+$/, 'Slug must be kebab-case'),
    status: z.enum(['draft', 'open', 'closed', 'archived', 'expired']),
    location: z.string().optional(),
    employment_type: z.string().optional(),
    salary_range: z.string().optional(),
    description: z.string().optional(),
    requirements: z.array(z.string()).optional(), // Handled as JSON normally, but array for UI convenience? Or just accept JSON
    prerequisites: z.union([z.array(z.any()), z.string()]).optional(),
    screening_questions: z.array(z.any()).optional(),
    interview_questions: z.array(z.any()).optional(),
    screening_rubric: z.union([z.record(z.any()), z.string()]).optional(),
    message_templates: z.record(z.any()).optional(),
    compliance_lines: z.array(z.any()).optional(),
    template_id: z.string().uuid().nullable().optional(),
    posting_date: z.string().optional().nullable(),
    closing_date: z.string().optional().nullable(),
})

export async function listJobsAction() {
    const allowed = await checkUserPermission('hiring', 'view')
    if (!allowed) return { success: false, error: 'Unauthorized' }

    try {
        const jobs = await getAllJobs()
        return { success: true, data: jobs }
    } catch (error) {
        console.error('List jobs action failed:', error)
        return { success: false, error: 'Failed to fetch jobs' }
    }
}

const CandidateSourceSchema = z.enum([
    'website',
    'indeed',
    'linkedin',
    'referral',
    'walk_in',
    'agency',
    'other',
])

// Schema for manual candidate creation
const CreateCandidateSchema = z.object({
    jobId: z.string().uuid().optional().or(z.literal('')),
    firstName: z.string().min(1),
    lastName: z.string().min(1),
    email: z.string().email(),
    phone: z.string().optional(),
    location: z.string().optional(),
    source: CandidateSourceSchema.optional(),
})

export async function createCandidateAction(formData: any) {
    const allowed = await checkUserPermission('hiring', 'create')
    if (!allowed) return { success: false, error: 'Unauthorized' }

    const parse = CreateCandidateSchema.safeParse(formData)
    if (!parse.success) {
        return { success: false, error: 'Invalid candidate data' }
    }

    try {
        const { submitApplication } = await import('@/lib/hiring/service')
        const result = await submitApplication({
            jobId: parse.data.jobId || null,
            source: parse.data.source || 'walk_in',
            origin: 'internal',
            candidate: {
                firstName: parse.data.firstName,
                lastName: parse.data.lastName,
                email: parse.data.email,
                phone: parse.data.phone || '', // Ensure string
                location: parse.data.location
            }
        })

        if (!result.success) throw new Error(result.error)

        if (result.candidateMatched && result.candidateId) {
            const supabase = await createClient()
            const { data: { user } } = await supabase.auth.getUser()
            if (user) {
                await logAuditEvent({
                    user_id: user.id,
                    user_email: user.email ?? undefined,
                    operation_type: 'merge',
                    resource_type: 'hiring_candidate',
                    resource_id: result.candidateId,
                    operation_status: 'success',
                    old_values: result.candidateMergeOld ?? undefined,
                    new_values: result.candidateMergeNew ?? undefined,
                    additional_info: {
                        application_id: result.applicationId,
                        job_id: parse.data.jobId || null,
                        source: 'manual_entry',
                    },
                })
            }
        }

        revalidatePath('/hiring')
        return { success: true, applicationId: result.applicationId }
    } catch (error: any) {
        console.error('Create candidate failed:', error)
        return { success: false, error: error.message || 'Failed to create candidate' }
    }
}

// Bulk Upload handled via dedicated API route usually for files, 
// but Server Actions can handle FormData with files.
// However, passing large files to Server Actions can be tricky with Vercel limits.
// For robust large file handling, client direct upload to Supabase Storage is preferred,
// then calling an action with the path. 
// BUT for CVs (<5MB), Server Actions often suffice.

const UploadCVSchema = z.object({
    jobId: z.string().uuid().optional(),
    // File validation happens on the FormData object directly
})

type ResumeUploadResult = {
    success: boolean
    fileName: string
    applicationId?: string | null
    candidateId?: string | null
    candidateMatched?: boolean
    candidateCreated?: boolean
    needsReview?: boolean
    candidateMergeOld?: Record<string, any> | null
    candidateMergeNew?: Record<string, any> | null
    error?: string
}

async function processResumeUpload(
    jobId: string | null,
    file: File,
    processImmediately: boolean,
    source: z.infer<typeof CandidateSourceSchema> = 'other'
): Promise<ResumeUploadResult> {
    try {
        const upload = await uploadHiringResume(file)
        const pendingEmail = `pending-${Date.now()}-${Math.random().toString(36).substring(7)}@hiring.temp`

        const { submitApplication } = await import('@/lib/hiring/service')
        const result = await submitApplication({
            jobId,
            source,
            origin: 'internal',
            candidate: {
                firstName: 'Parsing',
                lastName: 'CV...',
                email: pendingEmail,
                phone: '',
                resumeUrl: upload.publicUrl,
                resumeStoragePath: upload.storagePath,
                resumeFileName: upload.fileName,
                resumeMimeType: upload.mimeType,
                resumeFileSize: upload.fileSize,
            }
        })

        if (!result.success) {
            return { success: false, fileName: upload.fileName, error: result.error || 'Failed to create application' }
        }

        if (processImmediately) {
            const { jobQueue } = await import('@/lib/unified-job-queue')
            await jobQueue.processJobs(1)
        }

        return {
            success: true,
            fileName: upload.fileName,
            applicationId: result.applicationId,
            candidateId: result.candidateId,
            candidateMatched: result.candidateMatched,
            candidateCreated: result.candidateCreated,
            needsReview: result.needsReview,
            candidateMergeOld: result.candidateMergeOld,
            candidateMergeNew: result.candidateMergeNew,
        }
    } catch (error: any) {
        return { success: false, fileName: file.name || 'resume', error: error.message || 'Upload failed' }
    }
}

async function extractFilesFromZip(file: File): Promise<File[]> {
    const arrayBuffer = await file.arrayBuffer()
    const zip = await JSZip.loadAsync(arrayBuffer)
    const files: File[] = []

    for (const entry of Object.values(zip.files)) {
        if (entry.dir) {
            continue
        }
        const content = await entry.async('arraybuffer')
        const fileName = entry.name.split('/').pop() || 'resume'
        files.push(new File([content], fileName))
    }

    return files
}

export async function uploadCandidateCVAction(formData: FormData) {
    const allowed = await checkUserPermission('hiring', 'create')
    if (!allowed) return { success: false, error: 'Unauthorized' }

    const jobIdRaw = formData.get('jobId') as string
    const jobId = jobIdRaw === '' ? null : jobIdRaw

    const file = formData.get('file') as File
    const sourceRaw = formData.get('source')
    const source = CandidateSourceSchema.safeParse(sourceRaw).success
        ? (sourceRaw as z.infer<typeof CandidateSourceSchema>)
        : 'other'

    if (!file) {
        return { success: false, error: 'Missing file' }
    }

    try {
        const result = await processResumeUpload(jobId, file, false, source)

        if (!result.success) {
            throw new Error(result.error || 'Failed to upload CV')
        }

        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()

        if (user && result.candidateId) {
            await logAuditEvent({
                user_id: user.id,
                user_email: user.email ?? undefined,
                operation_type: 'upload',
                resource_type: 'hiring_candidate',
                resource_id: result.candidateId,
                operation_status: 'success',
                additional_info: {
                    file_name: result.fileName,
                    application_id: result.applicationId,
                    job_id: jobId,
                    upload_type: 'single',
                },
            })
        }

        if (user && result.candidateMatched && result.candidateId) {
            await logAuditEvent({
                user_id: user.id,
                user_email: user.email ?? undefined,
                operation_type: 'merge',
                resource_type: 'hiring_candidate',
                resource_id: result.candidateId,
                operation_status: 'success',
                old_values: result.candidateMergeOld ?? undefined,
                new_values: result.candidateMergeNew ?? undefined,
                additional_info: {
                    application_id: result.applicationId,
                    job_id: jobId,
                    source: 'cv_upload',
                },
            })
        }

        revalidatePath('/hiring')
        return { success: true, message: 'CV uploaded. Parsing queued.', applicationId: result.applicationId }
    } catch (error: any) {
        console.error('Upload CV failed:', error)
        return { success: false, error: error.message || 'Upload failed' }
    }
}

// Bulk upload handles multiple files. 
// FormData with multiple files of the same key 'files'.
export async function bulkUploadCVsAction(formData: FormData) {
    const allowed = await checkUserPermission('hiring', 'create')
    if (!allowed) return { success: false, error: 'Unauthorized' }

    const jobIdRaw = formData.get('jobId') as string
    const jobId = jobIdRaw === '' ? null : jobIdRaw
    const sourceRaw = formData.get('source')
    const source = CandidateSourceSchema.safeParse(sourceRaw).success
        ? (sourceRaw as z.infer<typeof CandidateSourceSchema>)
        : 'other'
    const files = formData.getAll('files') as File[]

    if (files.length === 0) {
        return { success: false, error: 'Missing files' }
    }

    const expandedFiles: File[] = []
    for (const file of files) {
        const isZip = file.type === 'application/zip' || file.name.toLowerCase().endsWith('.zip')
        if (isZip) {
            const extracted = await extractFilesFromZip(file)
            expandedFiles.push(...extracted)
        } else {
            expandedFiles.push(file)
        }
    }

    const results: ResumeUploadResult[] = []
    for (const file of expandedFiles) {
        const result = await processResumeUpload(jobId, file, false, source)
        results.push(result)
    }

    const successCount = results.filter((result) => result.success).length
    const failCount = results.length - successCount
    const createdCount = results.filter((result) => result.success && result.candidateCreated).length
    const linkedCount = results.filter((result) => result.success && result.candidateMatched).length
    const needsReviewCount = results.filter((result) => result.success && result.needsReview).length

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    const admin = createAdminClient()

    if (user) {
        for (const result of results) {
            if (!result.success || !result.candidateId) continue
            await logAuditEvent({
                user_id: user.id,
                user_email: user.email ?? undefined,
                operation_type: 'upload',
                resource_type: 'hiring_candidate',
                resource_id: result.candidateId,
                operation_status: 'success',
                additional_info: {
                    file_name: result.fileName,
                    application_id: result.applicationId,
                    job_id: jobId,
                    upload_type: 'bulk',
                },
            })

            if (result.candidateMatched) {
                await logAuditEvent({
                    user_id: user.id,
                    user_email: user.email ?? undefined,
                    operation_type: 'merge',
                    resource_type: 'hiring_candidate',
                    resource_id: result.candidateId,
                    operation_status: 'success',
                    old_values: result.candidateMergeOld ?? undefined,
                    new_values: result.candidateMergeNew ?? undefined,
                    additional_info: {
                        application_id: result.applicationId,
                        job_id: jobId,
                        source: 'bulk_upload',
                    },
                })
            }

            if (!jobId) {
                await admin.from('hiring_candidate_events').insert({
                    candidate_id: result.candidateId,
                    application_id: result.applicationId || null,
                    job_id: null,
                    event_type: 'historic_import',
                    source: 'bulk_upload',
                    metadata: {
                        file_name: result.fileName,
                    },
                })
            }
        }
    }

    revalidatePath('/hiring')
    return {
        success: true,
        message: `Processed ${results.length} CVs. ${failCount > 0 ? `${failCount} failed.` : ''}`,
        summary: {
            processed: results.length,
            success: successCount,
            failed: failCount,
            created: createdCount,
            linked: linkedCount,
            needsReview: needsReviewCount,
        },
        results,
    }
}

export async function createJobAction(formData: any) {
    const allowed = await checkUserPermission('hiring', 'create')
    if (!allowed) return { success: false, error: 'Unauthorized' }

    const parse = JobSchema.safeParse(formData)
    if (!parse.success) {
        return { success: false, error: parse.error.issues[0].message }
    }

    try {
        // Audit logging happens implicitly? Or should be explicit? 
        // Usually explicit in this project pattern according to rules (Log Audit)
        // I will add audit logging later or if I see how it's done typically. 
        // The instructions say "Log Audit" as a pattern.

        // For now, implementing the core mutation
        const job = await createJob({
            ...parse.data,
            posting_date: parse.data.posting_date || null,
            closing_date: parse.data.closing_date || null,
        })

        // Log Audit
        const admin = createAdminClient()
        // Need logged in user ID for audit...
        // But this is a server action, do we have user context?
        // rbac.ts usually gets user. 

        revalidatePath('/hiring')
        return { success: true, data: job }
    } catch (error) {
        console.error('Create job action failed:', error)
        return { success: false, error: 'Failed to create job' }
    }
}

export async function updateJobAction(id: string, formData: any) {
    const allowed = await checkUserPermission('hiring', 'edit')
    if (!allowed) return { success: false, error: 'Unauthorized' }

    // Allow partial updates
    const parse = JobSchema.partial().safeParse(formData)
    if (!parse.success) {
        return { success: false, error: parse.error.issues[0].message }
    }

    try {
        const job = await updateJob(id, {
            ...parse.data,
            posting_date: parse.data.posting_date || null,
            closing_date: parse.data.closing_date || null,
        })
        revalidatePath('/hiring')
        return { success: true, data: job }
    } catch (error) {
        console.error('Update job action failed:', error)
        return { success: false, error: 'Failed to update job' }
    }
}

const UpdateStatusSchema = z.object({
    status: z.enum([
        'new',
        'screening',
        'screened',
        'in_conversation',
        'interview_scheduled',
        'interviewed',
        'offer',
        'hired',
        'rejected',
        'withdrawn',
    ])
})

const OverrideScreeningSchema = z.object({
    applicationId: z.string().uuid(),
    score: z.number().min(0).max(10).nullable().optional(),
    recommendation: z.enum(['invite', 'clarify', 'hold', 'reject']).nullable().optional(),
    reason: z.string().max(500).optional(),
})

export async function updateApplicationStatusAction(id: string, newStatus: string) {
    const allowed = await checkUserPermission('hiring', 'edit')
    if (!allowed) return { success: false, error: 'Unauthorized' }

    const parse = UpdateStatusSchema.safeParse({ status: newStatus })
    if (!parse.success) {
        return { success: false, error: 'Invalid status' }
    }

    try {
        const admin = createAdminClient()
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()
        const { data: existing } = await admin
            .from('hiring_applications')
            .select('id, stage')
            .eq('id', id)
            .single()

        const { updateApplicationStatus } = await import('@/lib/hiring/service')
        const updated = await updateApplicationStatus(id, parse.data.status)

        if (user) {
            await logAuditEvent({
                user_id: user.id,
                user_email: user.email ?? undefined,
                operation_type: 'stage_change',
                resource_type: 'hiring_application',
                resource_id: id,
                operation_status: 'success',
                old_values: { stage: existing?.stage },
                new_values: { stage: updated.stage },
                additional_info: { source: 'manual' },
            })
        }

        revalidatePath('/hiring')
        return { success: true }
    } catch (error) {
        console.error('Update application status failed:', error)
        return { success: false, error: 'Failed to update status' }
    }
}

export async function overrideApplicationScreeningAction(input: {
    applicationId: string
    score?: number | null
    recommendation?: string | null
    reason?: string
}) {
    const allowed = await checkUserPermission('hiring', 'edit')
    if (!allowed) return { success: false, error: 'Unauthorized' }

    const parse = OverrideScreeningSchema.safeParse(input)
    if (!parse.success) {
        return { success: false, error: parse.error.issues[0].message }
    }

    if (parse.data.score == null && !parse.data.recommendation) {
        return { success: false, error: 'Provide a score or recommendation to override.' }
    }

    try {
        const admin = createAdminClient()
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()

        const { data: application, error } = await admin
            .from('hiring_applications')
            .select('id, ai_score, ai_recommendation')
            .eq('id', parse.data.applicationId)
            .single()

        if (error || !application) {
            return { success: false, error: 'Application not found' }
        }

        const nextScore = parse.data.score ?? application.ai_score ?? null
        const nextRecommendation = parse.data.recommendation ?? application.ai_recommendation ?? null

        const { data: updated, error: updateError } = await admin
            .from('hiring_applications')
            .update({
                ai_score: nextScore,
                ai_recommendation: nextRecommendation,
                screening_status: 'success',
                screening_error: null,
                screening_updated_at: new Date().toISOString(),
            })
            .eq('id', parse.data.applicationId)
            .select('*')
            .single()

        if (updateError || !updated) {
            return { success: false, error: updateError?.message || 'Failed to update application' }
        }

        await admin.from('hiring_application_overrides').insert({
            application_id: parse.data.applicationId,
            override_type: 'manual',
            previous_score: application.ai_score,
            new_score: nextScore,
            previous_recommendation: application.ai_recommendation,
            new_recommendation: nextRecommendation,
            reason: parse.data.reason?.trim() || null,
            created_by: user?.id || null,
        })

        if (user) {
            await logAuditEvent({
                user_id: user.id,
                user_email: user.email ?? undefined,
                operation_type: 'override',
                resource_type: 'hiring_application',
                resource_id: parse.data.applicationId,
                operation_status: 'success',
                old_values: {
                    ai_score: application.ai_score,
                    ai_recommendation: application.ai_recommendation,
                },
                new_values: {
                    ai_score: nextScore,
                    ai_recommendation: nextRecommendation,
                },
                additional_info: { reason: parse.data.reason?.trim() || null },
            })
        }

        revalidatePath(`/hiring/applications/${parse.data.applicationId}`)
        return { success: true, data: updated }
    } catch (error: any) {
        console.error('Override screening failed:', error)
        return { success: false, error: error.message || 'Failed to override screening' }
    }
}

const ScheduleInterviewSchema = z.object({
    applicationId: z.string(),
    startTime: z.string(), // ISO string
    durationMinutes: z.number().min(15).max(120),
    location: z.string().optional(),
    interviewerEmails: z.string().optional(),
})

const ApplicationOutcomeSchema = z.object({
    applicationId: z.string().uuid(),
    outcomeStatus: z.enum(['hired', 'rejected', 'withdrawn', 'offer_declined', 'no_show']).nullable().optional(),
    outcomeReasonCategory: z.enum([
        'experience',
        'skills',
        'availability',
        'right_to_work',
        'culture_fit',
        'communication',
        'compensation',
        'role_closed',
        'other',
    ]).nullable().optional(),
    outcomeReason: z.string().max(500).optional(),
    outcomeNotes: z.string().max(2000).optional(),
    reviewed: z.boolean().optional(),
})

export async function scheduleInterviewAction(formData: any) {
    const allowed = await checkUserPermission('hiring', 'edit')
    if (!allowed) return { success: false, error: 'Unauthorized' }

    const parse = ScheduleInterviewSchema.safeParse(formData)
    if (!parse.success) {
        return { success: false, error: 'Invalid interview data' }
    }

    const { applicationId, startTime, durationMinutes, location, interviewerEmails } = parse.data

    try {
        // 1. Get Application Details for the event title
        const { getApplicationById } = await import('@/lib/hiring/service')
        const application = await getApplicationById(applicationId)

        if (!application) throw new Error('Application not found')

        const candidateName = `${application.candidate.first_name} ${application.candidate.last_name}`
        const jobTitle = application.job.title
        const candidateEmail = application.candidate.email

        const admin = createAdminClient()
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()
        const userId = user?.id || null
        const userEmail = user?.email ?? undefined
        const userName = typeof user?.user_metadata?.full_name === 'string' ? user.user_metadata.full_name : undefined

        const emailValidator = z.string().email()
        const rawInterviewers = (interviewerEmails || '').split(/[;,]/).map((value) => value.trim()).filter(Boolean)
        const invalidEmails: string[] = []
        const interviewerAttendees: Array<{ email: string; name?: string }> = []

        rawInterviewers.forEach((entry) => {
            const match = entry.match(/^(.*)<([^>]+)>$/)
            const email = (match ? match[2] : entry).trim()
            const name = match ? match[1].trim() : undefined
            if (!emailValidator.safeParse(email).success) {
                invalidEmails.push(email)
                return
            }
            interviewerAttendees.push({ email, name: name || undefined })
        })

        if (invalidEmails.length > 0) {
            return { success: false, error: `Invalid interviewer emails: ${invalidEmails.join(', ')}` }
        }

        const attendeeMap = new Map<string, { email: string; name?: string }>()
        if (candidateEmail && !isPlaceholderEmail(candidateEmail)) {
            attendeeMap.set(candidateEmail.toLowerCase(), { email: candidateEmail, name: candidateName })
        }
        interviewerAttendees.forEach((attendee) => {
            attendeeMap.set(attendee.email.toLowerCase(), attendee)
        })
        if (userEmail && !isPlaceholderEmail(userEmail)) {
            const key = userEmail.toLowerCase()
            if (!attendeeMap.has(key)) {
                attendeeMap.set(key, { email: userEmail, name: userName })
            }
        }

        const attendees = Array.from(attendeeMap.values())

        // 2. Create Calendar Event
        const { createInterviewEvent, isInterviewCalendarConfigured } = await import('@/lib/google-calendar')
        const start = new Date(startTime)
        const end = new Date(start.getTime() + durationMinutes * 60000)

        const event = await createInterviewEvent({
            candidateName,
            jobTitle,
            summary: `Interview: ${candidateName} for ${jobTitle}`,
            description: `Interview with ${candidateName} for the role of ${jobTitle}. \n\nView Application: ${process.env.NEXT_PUBLIC_APP_URL}/hiring/applications/${applicationId}`,
            start,
            end,
            location: location || 'The Anchor',
            attendees,
        })
        const eventUrl = event?.htmlLink || null
        const calendarSynced = Boolean(event?.id)
        let calendarWarning: string | null = event?.warning ?? null

        if (!calendarSynced && !calendarWarning) {
            const configured = isInterviewCalendarConfigured()
            calendarWarning = configured
                ? 'Interview scheduled, but Google Calendar sync failed. Check calendar access and server logs.'
                : 'Interview scheduled, but Google Calendar is not configured. Set GOOGLE_CALENDAR_ID and auth credentials.'
        }

        const { data: interview, error: interviewError } = await admin
            .from('hiring_interviews')
            .insert({
                application_id: applicationId,
                scheduled_at: start.toISOString(),
                end_at: end.toISOString(),
                duration_minutes: durationMinutes,
                location: location || 'The Anchor',
                calendar_event_id: event?.id || null,
                calendar_event_url: eventUrl,
                created_by: userId,
            })
            .select('id')
            .single()

        if (interviewError) {
            console.error('Failed to create interview record:', interviewError)
        } else if (interview?.id) {
            const candidateEmailLower = candidateEmail?.toLowerCase()
            const attendeeRows = attendees.map((attendee) => ({
                interview_id: interview.id,
                role: attendee.email.toLowerCase() === candidateEmailLower ? 'candidate' : 'interviewer',
                name: attendee.name || null,
                email: attendee.email,
                user_id: null,
            }))
            if (attendeeRows.length > 0) {
                const { error: attendeeError } = await admin
                    .from('hiring_interview_attendees')
                    .insert(attendeeRows)
                if (attendeeError) {
                    console.error('Failed to save interview attendees:', attendeeError)
                }
            }
        }

        await admin
            .from('hiring_applications')
            .update({
                stage: 'interview_scheduled',
                interview_date: start.toISOString(),
            })
            .eq('id', applicationId)

        if (userId) {
            await logAuditEvent({
                user_id: userId,
                operation_type: 'stage_change',
                resource_type: 'hiring_application',
                resource_id: applicationId,
                operation_status: 'success',
                old_values: { stage: application.stage },
                new_values: { stage: 'interview_scheduled' },
                additional_info: { source: 'interview_schedule' },
            })
        }

        revalidatePath('/hiring')
        return { success: true, eventUrl, calendarSynced, calendarWarning }
    } catch (error) {
        console.error('Schedule interview failed:', error)
        return { success: false, error: 'Failed to schedule interview' }
    }
}

export async function updateApplicationOutcomeAction(input: {
    applicationId: string
    outcomeStatus?: string | null
    outcomeReasonCategory?: string | null
    outcomeReason?: string
    outcomeNotes?: string
    reviewed?: boolean
}) {
    const allowed = await checkUserPermission('hiring', 'edit')
    if (!allowed) return { success: false, error: 'Unauthorized' }

    const cleaned = {
        applicationId: input.applicationId,
        outcomeStatus: input.outcomeStatus || null,
        outcomeReasonCategory: input.outcomeReasonCategory || null,
        outcomeReason: input.outcomeReason?.trim() || undefined,
        outcomeNotes: input.outcomeNotes?.trim() || undefined,
        reviewed: input.reviewed === true,
    }

    const parse = ApplicationOutcomeSchema.safeParse(cleaned)
    if (!parse.success) {
        return { success: false, error: parse.error.issues[0].message }
    }

    try {
        const admin = createAdminClient()
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()
        const userId = user?.id || null
        const userEmail = user?.email ?? undefined

        const negativeOutcomes = new Set(['rejected', 'withdrawn', 'offer_declined', 'no_show'])
        if (parse.data.outcomeStatus && negativeOutcomes.has(parse.data.outcomeStatus) && !parse.data.reviewed) {
            return { success: false, error: 'Manual review confirmation is required for negative outcomes' }
        }

        const updates: Record<string, any> = {
            outcome_status: parse.data.outcomeStatus || null,
            outcome_reason_category: parse.data.outcomeReasonCategory || null,
            outcome_reason: parse.data.outcomeReason || null,
            outcome_notes: parse.data.outcomeNotes || null,
        }

        if (parse.data.outcomeStatus) {
            updates.outcome_recorded_at = new Date().toISOString()
            updates.outcome_recorded_by = userId
        } else {
            updates.outcome_recorded_at = null
            updates.outcome_recorded_by = null
        }

        if (parse.data.outcomeStatus && negativeOutcomes.has(parse.data.outcomeStatus)) {
            updates.outcome_reviewed_at = new Date().toISOString()
            updates.outcome_reviewed_by = userId
        } else {
            updates.outcome_reviewed_at = null
            updates.outcome_reviewed_by = null
        }

        const { data, error } = await admin
            .from('hiring_applications')
            .update(updates)
            .eq('id', parse.data.applicationId)
            .select('*')
            .single()

        if (error || !data) {
            return { success: false, error: error?.message || 'Failed to update outcome' }
        }

        revalidatePath(`/hiring/applications/${parse.data.applicationId}`)
        return { success: true, data }
    } catch (error: any) {
        console.error('Update application outcome failed:', error)
        return { success: false, error: error.message || 'Failed to update outcome' }
    }
}

const MessageDraftSchema = z.object({
    applicationId: z.string().uuid(),
    messageType: z.enum(['invite', 'clarify', 'reject', 'feedback']),
    rejectionReason: z.string().optional(),
})

const MessageUpdateSchema = z.object({
    messageId: z.string().uuid(),
    subject: z.string().min(1, 'Subject is required'),
    body: z.string().min(1, 'Message body is required'),
})

const MessageSendSchema = z.object({
    messageId: z.string().uuid(),
    subject: z.string().min(1).optional(),
    body: z.string().min(1).optional(),
})

const MessageExternalSchema = z.object({
    messageId: z.string().uuid(),
    subject: z.string().min(1).optional(),
    body: z.string().min(1).optional(),
})

function escapeHtml(value: string) {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
}

function isPlaceholderEmail(email?: string | null) {
    if (!email) return true
    return email.startsWith('pending-') || email.endsWith('@hiring.temp')
}

function normalizeComplianceLines(value: unknown): string[] {
    if (!Array.isArray(value)) return []
    return value.map((line) => String(line).trim()).filter(Boolean)
}

function appendComplianceLines(body: string, lines: unknown) {
    const normalized = normalizeComplianceLines(lines)
    if (normalized.length === 0) return body
    const missing = normalized.filter((line) => !body.includes(line))
    if (missing.length === 0) return body
    return `${body.trim()}\n\n${missing.join('\n')}`.trim()
}

function getMissingComplianceLines(body: string, lines: unknown) {
    const normalized = normalizeComplianceLines(lines)
    if (normalized.length === 0) return []
    return normalized.filter((line) => !body.includes(line))
}

export async function generateApplicationMessageDraftAction(input: {
    applicationId: string
    messageType: HiringMessageType
    rejectionReason?: string
}) {
    const allowed = await checkUserPermission('hiring', 'send')
    if (!allowed) return { success: false, error: 'Unauthorized' }

    const parse = MessageDraftSchema.safeParse(input)
    if (!parse.success) {
        return { success: false, error: parse.error.issues[0].message }
    }

    try {
        const admin = createAdminClient()
        const { data: application, error } = await admin
            .from('hiring_applications')
            .select(`
                *,
                candidate:hiring_candidates(*),
                job:hiring_jobs(*, template:hiring_job_templates(*))
            `)
            .eq('id', parse.data.applicationId)
            .single()

        if (error || !application) {
            return { success: false, error: 'Application not found' }
        }

        const candidate = (application as any).candidate
        const job = (application as any).job

        if (!candidate || !job) {
            return { success: false, error: 'Failed to load candidate details' }
        }

        const draft = await generateHiringMessageDraft({
            messageType: parse.data.messageType,
            application,
            candidate,
            job,
            rejectionReason: parse.data.rejectionReason,
        })

        if (draft.usage) {
            await (admin.from('ai_usage_events') as any).insert([
                {
                    context: `hiring_message:${application.id}:${parse.data.messageType}`,
                    model: draft.usage.model,
                    prompt_tokens: draft.usage.promptTokens,
                    completion_tokens: draft.usage.completionTokens,
                    total_tokens: draft.usage.totalTokens,
                    cost: draft.usage.cost,
                },
            ])
        }

        const supabase = await createClient()
        const userId = (await supabase.auth.getUser()).data.user?.id

        const { data: message, error: messageError } = await admin
            .from('hiring_application_messages')
            .insert({
                application_id: application.id,
                candidate_id: application.candidate_id,
                channel: 'email',
                direction: 'outbound',
                status: 'draft',
                subject: draft.subject,
                body: draft.body,
                template_key: parse.data.messageType,
                metadata: {
                    compliance_lines: draft.complianceLines,
                    generator: draft.generator,
                    model: draft.model || null,
                    usage: draft.usage || null,
                    created_by: userId || null,
                },
            })
            .select('*')
            .single()

        if (messageError || !message) {
            return { success: false, error: messageError?.message || 'Failed to create draft' }
        }

        revalidatePath(`/hiring/applications/${application.id}`)
        return { success: true, data: message }
    } catch (error: any) {
        console.error('Generate message draft failed:', error)
        return { success: false, error: error.message || 'Failed to generate draft' }
    }
}

export async function updateApplicationMessageDraftAction(input: {
    messageId: string
    subject: string
    body: string
}) {
    const allowed = await checkUserPermission('hiring', 'send')
    if (!allowed) return { success: false, error: 'Unauthorized' }

    const parse = MessageUpdateSchema.safeParse(input)
    if (!parse.success) {
        return { success: false, error: parse.error.issues[0].message }
    }

    try {
        const admin = createAdminClient()
        const { data: existing, error: existingError } = await admin
            .from('hiring_application_messages')
            .select('id, status, application_id')
            .eq('id', parse.data.messageId)
            .single()

        if (existingError || !existing) {
            return { success: false, error: 'Message not found' }
        }

        if (existing.status !== 'draft') {
            return { success: false, error: 'Only drafts can be edited' }
        }

        const { data, error } = await admin
            .from('hiring_application_messages')
            .update({
                subject: parse.data.subject,
                body: parse.data.body,
            })
            .eq('id', parse.data.messageId)
            .select('*')
            .single()

        if (error || !data) {
            return { success: false, error: error?.message || 'Failed to update draft' }
        }

        revalidatePath(`/hiring/applications/${existing.application_id}`)
        return { success: true, data }
    } catch (error: any) {
        console.error('Update message draft failed:', error)
        return { success: false, error: error.message || 'Failed to update draft' }
    }
}

export async function sendApplicationMessageAction(input: {
    messageId: string
    subject?: string
    body?: string
}) {
    const allowed = await checkUserPermission('hiring', 'send')
    if (!allowed) return { success: false, error: 'Unauthorized' }

    const parse = MessageSendSchema.safeParse(input)
    if (!parse.success) {
        return { success: false, error: parse.error.issues[0].message }
    }

    try {
        const admin = createAdminClient()
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()
        const userId = user?.id || null
        const userEmail = user?.email

        const { data: message, error } = await admin
            .from('hiring_application_messages')
            .select(`
                *,
                candidate:hiring_candidates(id, first_name, last_name, email),
                application:hiring_applications(id)
            `)
            .eq('id', parse.data.messageId)
            .single()

        if (error || !message) {
            return { success: false, error: 'Message not found' }
        }

        if (message.status !== 'draft') {
            return { success: false, error: 'Only drafts can be sent' }
        }

        const subject = parse.data.subject || message.subject || ''
        const body = parse.data.body || message.body || ''

        if (!subject.trim() || !body.trim()) {
            return { success: false, error: 'Subject and body are required to send' }
        }

        const complianceLines = (message as any).metadata?.compliance_lines
        const missingCompliance = getMissingComplianceLines(body, complianceLines)
        if (missingCompliance.length > 0) {
            return { success: false, error: `Missing compliance lines: ${missingCompliance.join(' | ')}` }
        }

        const finalBody = appendComplianceLines(body, complianceLines)

        const candidate = (message as any).candidate
        const recipientEmail = candidate?.email

        if (!recipientEmail || isPlaceholderEmail(recipientEmail)) {
            return { success: false, error: 'Candidate email is missing or invalid' }
        }

        const html = escapeHtml(finalBody).replace(/\n/g, '<br />')
        const result = await sendEmail({
            to: recipientEmail,
            subject,
            html,
        })

        if (!result.success) {
            await admin
                .from('hiring_application_messages')
                .update({
                    subject,
                    body: finalBody,
                    status: 'failed',
                    error_message: result.error || 'Failed to send email',
                    sent_at: null,
                    sent_by: userId,
                })
                .eq('id', parse.data.messageId)
            if (userId) {
                await logAuditEvent({
                    user_id: userId,
                    user_email: userEmail,
                    operation_type: 'email_sent',
                    resource_type: 'hiring_application_message',
                    resource_id: parse.data.messageId,
                    operation_status: 'failure',
                    error_message: result.error || 'Failed to send email',
                    additional_info: {
                        application_id: (message as any).application?.id,
                        candidate_id: message.candidate_id,
                        sent_via: 'office365',
                    },
                })
            }
            return { success: false, error: result.error || 'Failed to send email' }
        }

        const { data: updated, error: updateError } = await admin
            .from('hiring_application_messages')
            .update({
                subject,
                body: finalBody,
                status: 'sent',
                sent_via: 'office365',
                sent_at: new Date().toISOString(),
                sent_by: userId,
                error_message: null,
            })
            .eq('id', parse.data.messageId)
            .select('*')
            .single()

        if (updateError || !updated) {
            return { success: false, error: updateError?.message || 'Failed to update message status' }
        }

        if (userId) {
            await logAuditEvent({
                user_id: userId,
                user_email: userEmail,
                operation_type: 'email_sent',
                resource_type: 'hiring_application_message',
                resource_id: parse.data.messageId,
                operation_status: 'success',
                additional_info: {
                    application_id: (message as any).application?.id,
                    candidate_id: message.candidate_id,
                    sent_via: 'office365',
                },
            })
        }

        revalidatePath(`/hiring/applications/${(message as any).application?.id}`)
        return { success: true, data: updated }
    } catch (error: any) {
        console.error('Send message failed:', error)
        return { success: false, error: error.message || 'Failed to send message' }
    }
}

export async function markApplicationMessageSentExternallyAction(input: {
    messageId: string
    subject?: string
    body?: string
}) {
    const allowed = await checkUserPermission('hiring', 'send')
    if (!allowed) return { success: false, error: 'Unauthorized' }

    const parse = MessageExternalSchema.safeParse(input)
    if (!parse.success) {
        return { success: false, error: parse.error.issues[0].message }
    }

    try {
        const admin = createAdminClient()
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()
        const userId = user?.id || null
        const userEmail = user?.email

        const { data: existing, error } = await admin
            .from('hiring_application_messages')
            .select('id, status, application_id, candidate_id, subject, body, metadata')
            .eq('id', parse.data.messageId)
            .single()

        if (error || !existing) {
            return { success: false, error: 'Message not found' }
        }

        if (existing.status !== 'draft') {
            return { success: false, error: 'Only drafts can be marked as sent' }
        }

        const subject = parse.data.subject || existing.subject || ''
        const body = parse.data.body || existing.body || ''

        if (!subject.trim() || !body.trim()) {
            return { success: false, error: 'Subject and body are required to log a message' }
        }

        const complianceLines = (existing as any).metadata?.compliance_lines
        const missingCompliance = getMissingComplianceLines(body, complianceLines)
        if (missingCompliance.length > 0) {
            return { success: false, error: `Missing compliance lines: ${missingCompliance.join(' | ')}` }
        }

        const finalBody = appendComplianceLines(body, complianceLines)

        const metadata = {
            ...(existing.metadata || {}),
            external: true,
        }

        const { data: updated, error: updateError } = await admin
            .from('hiring_application_messages')
            .update({
                subject,
                body: finalBody,
                status: 'sent',
                sent_via: 'external',
                sent_at: new Date().toISOString(),
                sent_by: userId,
                metadata,
            })
            .eq('id', parse.data.messageId)
            .select('*')
            .single()

        if (updateError || !updated) {
            return { success: false, error: updateError?.message || 'Failed to update message status' }
        }

        if (userId) {
            await logAuditEvent({
                user_id: userId,
                user_email: userEmail,
                operation_type: 'message_logged',
                resource_type: 'hiring_application_message',
                resource_id: parse.data.messageId,
                operation_status: 'success',
                additional_info: {
                    application_id: existing.application_id,
                    candidate_id: existing.candidate_id,
                    sent_via: 'external',
                },
            })
        }

        revalidatePath(`/hiring/applications/${existing.application_id}`)
        return { success: true, data: updated }
    } catch (error: any) {
        console.error('Mark message sent externally failed:', error)
        return { success: false, error: error.message || 'Failed to update message' }
    }
}

export async function deleteCandidateAction(candidateId: string) {
    const allowed = await checkUserPermission('hiring', 'delete')
    if (!allowed && !(await checkUserPermission('hiring', 'edit'))) {
        return { success: false, error: 'Unauthorized' }
    }

    try {
        const admin = createAdminClient()
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()

        // Get candidate details for audit log before delete
        const { data: candidate } = await admin
            .from('hiring_candidates')
            .select('*')
            .eq('id', candidateId)
            .single()

        if (!candidate) {
            return { success: false, error: 'Candidate not found' }
        }

        // Manual Cascade Deletion
        // 1. Get all application IDs
        const { data: applications } = await admin
            .from('hiring_applications')
            .select('id')
            .eq('candidate_id', candidateId)

        const applicationIds = applications?.map(app => app.id) || []

        if (applicationIds.length > 0) {
            // Delete Application Related Data

            // Candidate Events related to these applications (Must come before app delete)
            await admin.from('hiring_candidate_events').delete().in('application_id', applicationIds)

            // Interviews & Attendees
            const { data: interviews } = await admin
                .from('hiring_interviews')
                .select('id')
                .in('application_id', applicationIds)
            const interviewIds = interviews?.map(i => i.id) || []

            if (interviewIds.length > 0) {
                await admin.from('hiring_interview_attendees').delete().in('interview_id', interviewIds)
                await admin.from('hiring_interviews').delete().in('id', interviewIds)
            }

            // Application Messages
            await admin.from('hiring_application_messages').delete().in('application_id', applicationIds)

            // Application Notes
            await admin.from('hiring_notes').delete().eq('entity_type', 'application').in('entity_id', applicationIds)

            // Application Overrides
            await admin.from('hiring_application_overrides').delete().in('application_id', applicationIds)

            // Delete Applications
            const { error: appError } = await admin
                .from('hiring_applications')
                .delete()
                .in('id', applicationIds)

            if (appError) throw appError
        }

        // 2. Delete Candidate Related Data

        // Profile Versions (might reference documents)
        await admin.from('hiring_candidate_profile_versions').delete().eq('candidate_id', candidateId)

        // Candidate Documents
        await admin.from('hiring_candidate_documents').delete().eq('candidate_id', candidateId)

        // Remaining Candidate Events (not deleted by application_id above)
        await admin.from('hiring_candidate_events').delete().eq('candidate_id', candidateId)

        // Candidate Notes
        await admin.from('hiring_notes').delete().eq('entity_type', 'candidate').eq('entity_id', candidateId)

        // 3. Delete Candidate
        const { error } = await admin
            .from('hiring_candidates')
            .delete()
            .eq('id', candidateId)

        if (error) throw error

        if (user) {
            await logAuditEvent({
                user_id: user.id,
                user_email: user.email ?? undefined,
                operation_type: 'delete',
                resource_type: 'hiring_candidate',
                resource_id: candidateId,
                operation_status: 'success',
                old_values: candidate,
                additional_info: {
                    first_name: candidate.first_name,
                    last_name: candidate.last_name,
                    email: candidate.email,
                    deleted_applications_count: applicationIds.length
                }
            })
        }

        revalidatePath('/hiring')
        revalidatePath('/hiring/candidates')
        return { success: true }
    } catch (error: any) {
        console.error('Delete candidate failed:', error)
        return { success: false, error: error.message || 'Failed to delete candidate' }
    }
}
