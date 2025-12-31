import 'server-only'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { formatPhoneForStorage } from '@/lib/validation'
import { getHiringStageReminderConfig } from '@/lib/hiring/reminders'
import type { HiringJob, HiringJobTemplate, HiringCandidate, HiringApplication, HiringApplicationStage, Database } from '@/types/database'
import type { HiringApplicationWithCandidateSummary, HiringJobSummary, HiringStageCounts } from '@/types/hiring'

function isPastDate(value?: string | null) {
    if (!value) return false
    const time = new Date(value).getTime()
    return Number.isFinite(time) && time < Date.now()
}

function applyJobExpiry<T extends HiringJob>(job: T): T {
    if (job.status === 'open' && isPastDate(job.closing_date)) {
        return { ...job, status: 'expired' } as T
    }
    return job
}

export async function getOpenJobs() {
    const admin = createAdminClient()
    const nowIso = new Date().toISOString()
    const { data, error } = await admin
        .from('hiring_jobs')
        .select('*')
        .eq('status', 'open')
        .or(`closing_date.is.null,closing_date.gt.${nowIso}`)
        .order('created_at', { ascending: false })

    if (error) {
        console.error('Error fetching open jobs:', error)
        throw new Error('Failed to fetch jobs')
    }

    return data as HiringJob[]
}

export async function getAllJobs() {
    const admin = createAdminClient()
    const { data, error } = await admin
        .from('hiring_jobs')
        .select('*')
        .order('created_at', { ascending: false })

    if (error) {
        console.error('Error fetching all jobs:', error)
        throw new Error('Failed to fetch jobs')
    }

    const jobs = (data || []) as HiringJob[]
    return jobs.map(applyJobExpiry)
}

export async function getJobTemplates() {
    const admin = createAdminClient()
    const { data, error } = await admin
        .from('hiring_job_templates')
        .select('*')
        .order('title', { ascending: true })

    if (error) {
        console.error('Error fetching job templates:', error)
        throw new Error('Failed to fetch job templates')
    }

    return data as HiringJobTemplate[]
}

const STAGE_ORDER: HiringApplicationStage[] = [
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
]

const STAGE_OVERDUE_DAYS: Partial<Record<HiringApplicationStage, number>> = {
    new: 2,
    screening: 2,
    screened: 5,
    in_conversation: 3,
    interview_scheduled: 2,
    interviewed: 5,
    offer: 5,
}

function buildStageCounts(): HiringStageCounts {
    const entries = STAGE_ORDER.map((stage) => [stage, 0])
    return Object.fromEntries(entries) as HiringStageCounts
}

function isFinalStage(stage: HiringApplicationStage) {
    return stage === 'hired' || stage === 'rejected' || stage === 'withdrawn'
}

function isApplicationOverdue(
    application: Pick<HiringApplication, 'stage' | 'updated_at' | 'created_at' | 'interview_date'>,
    thresholds: Partial<Record<HiringApplicationStage, number>>
) {
    if (isFinalStage(application.stage)) return false

    if (application.stage === 'interview_scheduled' && application.interview_date) {
        return new Date(application.interview_date) < new Date()
    }

    const thresholdDays = thresholds[application.stage] ?? STAGE_OVERDUE_DAYS[application.stage]
    if (!thresholdDays) return false

    const reference = application.updated_at || application.created_at
    const referenceDate = reference ? new Date(reference) : new Date()
    const diffMs = Date.now() - referenceDate.getTime()
    return diffMs > thresholdDays * 24 * 60 * 60 * 1000
}

export async function getJobDashboardSummaries(): Promise<HiringJobSummary[]> {
    const admin = createAdminClient()
    const reminderConfig = await getHiringStageReminderConfig()
    const thresholds = reminderConfig.thresholds || STAGE_OVERDUE_DAYS

    const { data: jobRows, error: jobsError } = await admin
        .from('hiring_jobs')
        .select('*')
        .order('created_at', { ascending: false })

    if (jobsError) {
        console.error('Error fetching jobs for dashboard:', jobsError)
        throw new Error('Failed to fetch jobs')
    }

    const jobs = (jobRows || []).map((job) => applyJobExpiry(job as HiringJob))

    const { data: applications, error: applicationsError } = await admin
        .from('hiring_applications')
        .select('id, job_id, stage, created_at, updated_at, interview_date')

    if (applicationsError) {
        console.error('Error fetching applications for dashboard:', applicationsError)
        throw new Error('Failed to fetch applications')
    }

    const summariesByJob = new Map<string, HiringJobSummary>()
    for (const job of jobs || []) {
        summariesByJob.set(job.id, {
            ...(job as HiringJob),
            applicantCount: 0,
            stageCounts: buildStageCounts(),
            overdueCount: 0,
        })
    }

    for (const application of applications || []) {
        const summary = summariesByJob.get(application.job_id)
        if (!summary) continue
        summary.applicantCount += 1
        summary.stageCounts[application.stage as HiringApplicationStage] = (summary.stageCounts[application.stage as HiringApplicationStage] || 0) + 1
        if (isApplicationOverdue(application as HiringApplication, thresholds)) {
            summary.overdueCount += 1
        }
    }

    return Array.from(summariesByJob.values())
}

export async function createJob(jobData: Partial<HiringJob>) {
    const admin = createAdminClient()
    const { data, error } = await admin
        .from('hiring_jobs')
        .insert(jobData as any) // Type assertion needed as Omit logic in DB types might not perfectly match Partial here
        .select()
        .single()

    if (error) {
        console.error('Error creating job:', error)
        throw new Error('Failed to create job')
    }
    return data as HiringJob
}

export async function updateJob(id: string, jobData: Partial<HiringJob>) {
    const admin = createAdminClient()
    const { data, error } = await admin
        .from('hiring_jobs')
        .update(jobData as any)
        .eq('id', id)
        .select()
        .single()

    if (error) {
        console.error('Error updating job:', error)
        throw new Error('Failed to update job')
    }
    return data as HiringJob
}

export async function getJobById(id: string) {
    const admin = createAdminClient()
    const { data, error } = await admin
        .from('hiring_jobs')
        .select('*')
        .eq('id', id)
        .single()

    if (error) {
        console.error('Error fetching job by id:', error)
        return null
    }

    return applyJobExpiry(data as HiringJob)
}

export async function getJobApplications(jobId: string) {
    const admin = createAdminClient()
    const { data, error } = await admin
        .from('hiring_applications')
        .select(`
            *,
            candidate:hiring_candidates(*)
        `)
        .eq('job_id', jobId)
        .order('created_at', { ascending: false })

    if (error) {
        console.error('Error fetching job applications:', error)
        throw new Error('Failed to fetch applications')
    }

    const applications = data as unknown as (HiringApplication & { candidate: HiringCandidate })[]
    const candidateIds = Array.from(new Set(applications.map((app) => app.candidate_id)))

    if (candidateIds.length === 0) {
        return applications as (HiringApplication & { candidate: HiringCandidate })[]
    }

    const { data: candidateApps, error: candidateAppsError } = await admin
        .from('hiring_applications')
        .select('candidate_id, created_at')
        .in('candidate_id', candidateIds)

    if (candidateAppsError) {
        console.error('Error fetching candidate application counts:', candidateAppsError)
        return applications as (HiringApplication & { candidate: HiringCandidate })[]
    }

    const stats = new Map<string, { count: number; lastAppliedAt: string | null }>()
    for (const row of candidateApps || []) {
        const candidateId = row.candidate_id
        const existing = stats.get(candidateId) || { count: 0, lastAppliedAt: null }
        const createdAt = row.created_at
        let lastAppliedAt = existing.lastAppliedAt
        if (createdAt && (!lastAppliedAt || new Date(createdAt) > new Date(lastAppliedAt))) {
            lastAppliedAt = createdAt
        }
        stats.set(candidateId, { count: existing.count + 1, lastAppliedAt })
    }

    return applications.map((app) => {
        const stat = stats.get(app.candidate_id)
        return {
            ...app,
            candidate_application_count: stat?.count || 1,
            candidate_last_applied_at: stat?.lastAppliedAt || app.created_at,
        }
    }) as HiringApplicationWithCandidateSummary[]
}

export async function updateApplicationStatus(id: string, status: HiringApplication['stage']) {
    const admin = createAdminClient()
    const { data, error } = await admin
        .from('hiring_applications')
        .update({ stage: status })
        .eq('id', id)
        .select()
        .single()

    if (error) {
        console.error('Error updating application status:', error)
        throw new Error('Failed to update status')
    }

    return data as HiringApplication
}

export async function getApplicationById(id: string) {
    const admin = createAdminClient()
    const { data, error } = await admin
        .from('hiring_applications')
        .select(`
            *,
            candidate:hiring_candidates(*),
            job:hiring_jobs(*)
        `)
        .eq('id', id)
        .single()

    if (error) {
        console.error('Error fetching application by id:', error)
        return null
    }

    return data as unknown as (HiringApplication & { candidate: HiringCandidate, job: HiringJob })
}

export async function getApplicationMessages(applicationId: string) {
    const admin = createAdminClient()
    const { data, error } = await admin
        .from('hiring_application_messages')
        .select('*')
        .eq('application_id', applicationId)
        .order('created_at', { ascending: false })

    if (error) {
        console.error('Error fetching application messages:', error)
        throw new Error('Failed to fetch application messages')
    }

    return data as Database['public']['Tables']['hiring_application_messages']['Row'][]
}

export async function getAllCandidates() {
    const admin = createAdminClient()
    const { data, error } = await admin
        .from('hiring_candidates')
        .select(`
            *,
            applications:hiring_applications(
                *,
                job:hiring_jobs(*)
            )
        `)
        .order('created_at', { ascending: false })

    if (error) {
        console.error('Error fetching candidates:', error)
        throw new Error('Failed to fetch candidates')
    }

    return data as (HiringCandidate & {
        applications: (HiringApplication & { job: HiringJob })[]
    })[]
}

export async function getCandidateById(id: string) {
    const admin = createAdminClient()
    const { data, error } = await admin
        .from('hiring_candidates')
        .select(`
            *,
            applications:hiring_applications(
                *,
                job:hiring_jobs(*)
            ),
            documents:hiring_candidate_documents(*),
            profile_versions:hiring_candidate_profile_versions!hiring_candidate_profile_versions_candidate_id_fkey(
                *,
                document:hiring_candidate_documents(*)
            )
        `)
        .eq('id', id)
        .single()

    if (error) {
        console.error('Error fetching candidate by id:', error)
        return null
    }

    return data as (HiringCandidate & {
        applications: (HiringApplication & { job: HiringJob })[]
        documents: Database['public']['Tables']['hiring_candidate_documents']['Row'][]
        profile_versions: Array<
            Database['public']['Tables']['hiring_candidate_profile_versions']['Row'] & {
                document?: Database['public']['Tables']['hiring_candidate_documents']['Row'] | null
            }
        >
    })
}

function normalizeEmail(email: string) {
    return email.trim().toLowerCase()
}

function normalizePhone(phone?: string) {
    if (!phone) return null
    try {
        return formatPhoneForStorage(phone)
    } catch {
        return phone.trim()
    }
}

function isPlaceholderEmail(email?: string | null) {
    if (!email) return true
    return email.startsWith('pending-') || email.endsWith('@hiring.temp')
}

function mergeSecondaryEmails(existing: string[] | null | undefined, emails: string[]) {
    const normalized = new Set<string>()
    const existingEmails = Array.isArray(existing) ? existing : []

    for (const entry of [...existingEmails, ...emails]) {
        if (!entry) continue
        normalized.add(normalizeEmail(entry))
    }

    return Array.from(normalized)
}

function extractStoragePathFromUrl(url?: string) {
    if (!url) return null
    if (!url.startsWith('http')) {
        return url
    }
    try {
        const parsed = new URL(url)
        const marker = '/storage/v1/object/public/hiring-docs/'
        const index = parsed.pathname.indexOf(marker)
        if (index >= 0) {
            return parsed.pathname.slice(index + marker.length)
        }
        const parts = parsed.pathname.split('/hiring-docs/')
        if (parts.length === 2) {
            return parts[1]
        }
    } catch {
        return null
    }
    return null
}

function resolveFileName(inputName?: string, storagePath?: string, resumeUrl?: string) {
    if (inputName?.trim()) return inputName.trim()
    if (storagePath) {
        const name = storagePath.split('/').pop()
        if (name) return name
    }
    if (resumeUrl) {
        try {
            const parsed = new URL(resumeUrl)
            const name = parsed.pathname.split('/').pop()
            if (name) return name
        } catch {
            return 'resume'
        }
    }
    return 'resume'
}

export type ApplicationInput = {
    jobId?: string | null
    source?: 'website' | 'indeed' | 'linkedin' | 'referral' | 'walk_in' | 'agency' | 'other'
    candidate: {
        firstName: string
        lastName: string
        email: string
        phone: string
        location?: string
        resumeUrl?: string
        resumeStoragePath?: string
        resumeFileName?: string
        resumeMimeType?: string
        resumeFileSize?: number
        screenerAnswers?: any
    }
}

export async function submitApplication(input: ApplicationInput) {
    const admin = createAdminClient()
    const candidateEmail = normalizeEmail(input.candidate.email)
    const rawPhone = input.candidate.phone?.trim()
    const candidatePhone = normalizePhone(rawPhone)
    const fallbackPhone = rawPhone || null

    let candidateId: string | null = null
    let existingCandidate: HiringCandidate | null = null
    let candidateMatched = false
    let candidateMergeOld: Partial<HiringCandidate> | null = null
    let candidateMergeNew: Partial<HiringCandidate> | null = null
    let needsReview = false

    const emailLookup = await admin
        .from('hiring_candidates')
        .select('id, email, phone, location, secondary_emails, first_name, last_name')
        .eq('email', candidateEmail)
        .maybeSingle()

    if (emailLookup.data) {
        existingCandidate = emailLookup.data as HiringCandidate
    } else {
        const secondaryLookup = await admin
            .from('hiring_candidates')
            .select('id, email, phone, location, secondary_emails, first_name, last_name')
            .contains('secondary_emails', [candidateEmail])
            .maybeSingle()

        if (secondaryLookup.data) {
            existingCandidate = secondaryLookup.data as HiringCandidate
        }
    }

    if (!existingCandidate && candidatePhone) {
        const phoneLookup = await admin
            .from('hiring_candidates')
            .select('id, email, phone, location, secondary_emails, first_name, last_name')
            .eq('phone', candidatePhone)
            .maybeSingle()

        if (phoneLookup.data) {
            existingCandidate = phoneLookup.data as HiringCandidate
        }
    }

    if (!existingCandidate && candidatePhone && input.candidate.phone && candidatePhone !== input.candidate.phone) {
        const rawPhoneLookup = await admin
            .from('hiring_candidates')
            .select('id, email, phone, location, secondary_emails, first_name, last_name')
            .eq('phone', input.candidate.phone)
            .maybeSingle()

        if (rawPhoneLookup.data) {
            existingCandidate = rawPhoneLookup.data as HiringCandidate
        }
    }

    candidateMatched = Boolean(existingCandidate)
    let candidateWasCreated = false

    // 2. Create or Update Candidate
    if (!existingCandidate) {
        const { data: newCandidate, error: createError } = await admin
            .from('hiring_candidates')
            .insert({
                first_name: input.candidate.firstName,
                last_name: input.candidate.lastName,
                email: candidateEmail,
                phone: candidatePhone || fallbackPhone,
                location: input.candidate.location,
                resume_url: input.candidate.resumeUrl,
                parsed_data: {}, // Placeholder for AI parsing later
            })
            .select('id, email, phone, location, secondary_emails, first_name, last_name')
            .single()

        if (createError) {
            console.error('Error creating candidate:', createError)
            throw new Error('Failed to create candidate profile')
        }
        existingCandidate = newCandidate as HiringCandidate
        candidateWasCreated = true
    } else {
        const updates: Partial<HiringCandidate> = {}
        const shouldUpdateEmail = isPlaceholderEmail(existingCandidate.email) && candidateEmail
        const secondaryCandidateEmail = shouldUpdateEmail || candidateEmail === existingCandidate.email ? '' : candidateEmail
        const nextSecondary = mergeSecondaryEmails(existingCandidate.secondary_emails, [
            secondaryCandidateEmail,
        ])

        if (nextSecondary.length !== (existingCandidate.secondary_emails?.length || 0)) {
            updates.secondary_emails = nextSecondary
        }

        if (!existingCandidate.phone && (candidatePhone || fallbackPhone)) {
            updates.phone = candidatePhone || fallbackPhone
        }

        if (!existingCandidate.location && input.candidate.location) {
            updates.location = input.candidate.location
        }

        if (input.candidate.resumeUrl) {
            updates.resume_url = input.candidate.resumeUrl
        }

        if (shouldUpdateEmail) {
            updates.email = candidateEmail
        }

        if (Object.keys(updates).length > 0) {
            candidateMergeOld = {}
            Object.keys(updates).forEach((key) => {
                candidateMergeOld = {
                    ...candidateMergeOld,
                    [key]: (existingCandidate as any)[key],
                }
            })
            candidateMergeNew = { ...updates }
            const { error: updateError } = await admin
                .from('hiring_candidates')
                .update(updates)
                .eq('id', existingCandidate.id)

            if (updateError) {
                console.error('Error updating candidate:', updateError)
            } else {
                existingCandidate = { ...existingCandidate, ...updates }
            }
        }
    }

    candidateId = existingCandidate?.id || null
    if (!candidateId) {
        throw new Error('Failed to resolve candidate profile')
    }

    if (candidateWasCreated) {
        const possibleDuplicates = await admin
            .from('hiring_candidates')
            .select('id, email, phone, first_name, last_name')
            .ilike('first_name', input.candidate.firstName)
            .ilike('last_name', input.candidate.lastName)
            .neq('id', candidateId)
            .limit(3)

        if (possibleDuplicates.data?.length) {
            needsReview = true
            await admin.from('hiring_candidate_events').insert({
                candidate_id: candidateId,
                event_type: 'possible_duplicate',
                source: input.source || 'website',
                metadata: {
                    review_status: 'open',
                    matches: possibleDuplicates.data,
                    incoming_email: candidateEmail,
                    incoming_phone: candidatePhone || fallbackPhone,
                },
            })
        }
    }

    // 3. Create Application (ONLY if jobId is provided)
    let applicationId = null
    if (input.jobId) {
        const { data: application, error: appError } = await admin
            .from('hiring_applications')
            .insert({
                job_id: input.jobId,
                candidate_id: candidateId,
                stage: 'new',
                source: input.source || 'website',
                screener_answers: input.candidate.screenerAnswers ?? {},
            })
            .select('id')
            .single()

        if (appError) {
            // Handle duplicate applications gracefully
            if (appError.code === '23505') {
                // Fetch the existing application ID to return success anyway?
                // Or just return error. The UI can handle "Already applied".
                return { success: false, error: 'Already applied for this role' }
            }
            console.error('Error creating application:', appError)
            throw new Error('Failed to submit application')
        }
        applicationId = application.id
    }

    let documentId: string | null = null
    const resumeStoragePath = input.candidate.resumeStoragePath || extractStoragePathFromUrl(input.candidate.resumeUrl)
    const resumeFileName = resolveFileName(input.candidate.resumeFileName, resumeStoragePath || undefined, input.candidate.resumeUrl)

    if (resumeStoragePath || input.candidate.resumeUrl) {
        const { data: document, error: documentError } = await admin
            .from('hiring_candidate_documents')
            .insert({
                candidate_id: candidateId,
                storage_path: resumeStoragePath || input.candidate.resumeUrl,
                file_name: resumeFileName,
                mime_type: input.candidate.resumeMimeType,
                file_size_bytes: input.candidate.resumeFileSize,
                source: input.source || 'website',
            })
            .select('id')
            .single()

        if (documentError) {
            console.error('Error creating candidate document:', documentError)
        } else {
            documentId = document?.id || null
        }
    }

    if (applicationId) {
        await admin.from('hiring_candidate_events').insert({
            candidate_id: candidateId,
            application_id: applicationId,
            job_id: input.jobId,
            event_type: 'application_submitted',
            source: input.source || 'website',
            metadata: {
                resume_url: input.candidate.resumeUrl,
                storage_path: resumeStoragePath,
            },
        })
    }

    // 4. Enqueue CV Parsing Job if resume provided
    if (input.candidate.resumeUrl || resumeStoragePath) {
        try {
            const { jobQueue } = await import('@/lib/unified-job-queue')
            await jobQueue.enqueue('parse_cv', {
                candidateId,
                resumeUrl: input.candidate.resumeUrl,
                storagePath: resumeStoragePath,
                documentId,
                applicationId,
                jobId: input.jobId,
            })
        } catch (queueError) {
            console.error('Failed to enqueue CV parsing job:', queueError)
        }
    }

    if (applicationId && !(input.candidate.resumeUrl || resumeStoragePath)) {
        try {
            const { jobQueue } = await import('@/lib/unified-job-queue')
            await jobQueue.enqueue(
                'screen_application',
                { applicationId },
                { unique: `screen_application:${applicationId}` }
            )
        } catch (queueError) {
            console.error('Failed to enqueue screening job:', queueError)
        }
    }

    return {
        success: true,
        applicationId,
        candidateId,
        candidateMatched,
        candidateCreated: candidateWasCreated,
        needsReview,
        candidateMergeOld,
        candidateMergeNew,
    }
}
