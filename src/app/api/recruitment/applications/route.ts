import crypto from 'crypto'
import { NextRequest, after } from 'next/server'
import {
  createApiResponse,
  createErrorResponse,
  withApiAuth,
} from '@/lib/api/auth'
import {
  claimIdempotencyKey,
  computeIdempotencyRequestHash,
  getIdempotencyKey,
  persistIdempotencyResponse,
  releaseIdempotencyClaim,
} from '@/lib/api/idempotency'
import { applyDistributedRateLimit } from '@/lib/distributed-rate-limit'
import { createAdminClient } from '@/lib/supabase/admin'
import { getClientIp, verifyTurnstileToken } from '@/lib/turnstile'
import { getRecruitmentCvMaxBytes, validateRecruitmentCvUpload } from '@/lib/recruitment/files'
import { sendRecruitmentApplicationReceivedEmail, sendRecruitmentManagerAlert } from '@/lib/recruitment/communications'
import { formatPhoneForStorage } from '@/lib/utils'
import { createRecruitmentApplication, processRecruitmentApplicationAi } from '@/services/recruitment'
import type { RecruitmentCvUpload } from '@/types/recruitment'

// The response itself is sent within seconds (DB/storage writes only); the remaining budget
// is for the after() hook, which runs OpenAI extraction/scoring and the manager alert.
export const maxDuration = 120

function formString(formData: FormData, key: string): string | null {
  const value = formData.get(key)
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

function formBool(formData: FormData, key: string): boolean {
  const value = formData.get(key)
  return value === 'true' || value === '1' || value === 'on'
}

function londonDateString(date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)

  const year = parts.find(part => part.type === 'year')?.value
  const month = parts.find(part => part.type === 'month')?.value
  const day = parts.find(part => part.type === 'day')?.value
  return year && month && day ? `${year}-${month}-${day}` : date.toISOString().slice(0, 10)
}

async function readCvUpload(formData: FormData): Promise<RecruitmentCvUpload | null> {
  const file = formData.get('cv')
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

async function resolvePostingId(
  formData: FormData,
  supabase: ReturnType<typeof createAdminClient>,
): Promise<{ postingId: string | null; error?: string }> {
  const explicitId = formString(formData, 'job_posting_id') || formString(formData, 'posting_id')
  const slug = formString(formData, 'job_slug') || formString(formData, 'role_slug')
  if (!explicitId && !slug) return { postingId: null }

  let query = supabase
    .from('recruitment_job_postings')
    .select('id')
    .eq('status', 'open')
    .eq('is_public', true)
    .or(`application_closing_date.is.null,application_closing_date.gte.${londonDateString()}`)

  query = explicitId ? query.eq('id', explicitId) : query.eq('slug', slug)

  const { data, error } = await query.maybeSingle()

  if (error) throw error
  if (!data?.id) {
    return {
      postingId: null,
      error: 'This job posting is no longer accepting applications.',
    }
  }

  return { postingId: data.id }
}

async function handleRecruitmentApplication(request: NextRequest) {
  const idempotencyKey = getIdempotencyKey(request)
  if (!idempotencyKey) {
    return createErrorResponse('Missing Idempotency-Key header', 'IDEMPOTENCY_KEY_REQUIRED', 400)
  }

  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return createErrorResponse('Expected multipart/form-data', 'VALIDATION_ERROR', 400)
  }

  if (!formBool(formData, 'privacy_consent')) {
    return createErrorResponse('Privacy notice consent is required', 'VALIDATION_ERROR', 400)
  }

  const cvUpload = await readCvUpload(formData)
  if (cvUpload) {
    const validationError = validateRecruitmentCvUpload(cvUpload, {
      maxBytes: getRecruitmentCvMaxBytes('public'),
    })
    if (validationError) {
      return createErrorResponse(validationError, 'VALIDATION_ERROR', 400)
    }
  }

  const hasApiKey = Boolean(request.headers.get('x-api-key') || request.headers.get('authorization'))
  if (!hasApiKey) {
    const token = request.headers.get('x-turnstile-token') || formString(formData, 'turnstile_token')
    const turnstile = await verifyTurnstileToken(token, getClientIp(request))
    if (!turnstile.success) {
      return createErrorResponse(
        turnstile.error || 'Bot verification failed',
        'TURNSTILE_FAILED',
        403
      )
    }
  }

  const supabase = createAdminClient()
  const postingResolution = await resolvePostingId(formData, supabase)
  if (postingResolution.error) {
    return createErrorResponse(postingResolution.error, 'RECRUITMENT_POSTING_CLOSED', 400)
  }
  const postingId = postingResolution.postingId
  const normalizedEmail = formString(formData, 'email')?.toLowerCase() ?? null
  const cvHash = cvUpload
    ? crypto.createHash('sha256').update(cvUpload.buffer).digest('hex')
    : null

  const phone = formString(formData, 'phone')
  let phoneE164 = formString(formData, 'phone_e164')
  if (!phoneE164 && phone) {
    try {
      phoneE164 = formatPhoneForStorage(phone)
    } catch {
      phoneE164 = null
    }
  }

  // consent_at is intentionally NOT set here: the service defaults it at processing time.
  // Anything time-derived in this input would change the idempotency request hash between
  // attempts, turning legitimate same-key retries into 409 conflicts instead of replays.
  const applicationInput = {
    candidate: {
      first_name: formString(formData, 'first_name'),
      last_name: formString(formData, 'last_name'),
      email: normalizedEmail,
      phone,
      phone_e164: phoneE164,
      location: formString(formData, 'location'),
      source: 'website' as const,
      provided_details: formString(formData, 'provided_details'),
      consent_source: 'public_website',
      privacy_notice_version: formString(formData, 'privacy_notice_version'),
      sms_consent: formBool(formData, 'sms_consent'),
      future_recruitment_consent: formBool(formData, 'future_recruitment_consent'),
    },
    job_posting_id: postingId,
    source: 'website' as const,
    cover_note: formString(formData, 'cover_note') || formString(formData, 'message'),
    relevant_experience_answer: formString(formData, 'relevant_experience_answer') || formString(formData, 'experience'),
    travel_answer: formString(formData, 'travel_answer') || formString(formData, 'travel'),
    start_availability: formString(formData, 'start_availability') || formString(formData, 'availability'),
    availability: {
      raw: formString(formData, 'availability'),
      preferred_role: formString(formData, 'preferred_role'),
    },
  }

  const requestHash = computeIdempotencyRequestHash({
    ...applicationInput,
    cv: cvUpload
      ? {
          fileName: cvUpload.fileName,
          mimeType: cvUpload.mimeType,
          sizeBytes: cvUpload.sizeBytes,
          sha256: cvHash,
        }
      : null,
  })

  const idempotencyState = await claimIdempotencyKey(supabase, idempotencyKey, requestHash)
  if (idempotencyState.state === 'conflict') {
    return createErrorResponse(
      'Idempotency key already used with a different request payload',
      'IDEMPOTENCY_KEY_CONFLICT',
      409
    )
  }

  if (idempotencyState.state === 'replay') {
    const replayPayload = idempotencyState.response as { meta?: { status_code?: number } }
    return createApiResponse(idempotencyState.response, replayPayload?.meta?.status_code ?? 201, {}, request.method)
  }

  if (idempotencyState.state === 'in_progress') {
    return createErrorResponse(
      'This request is already being processed. Please retry shortly.',
      'IDEMPOTENCY_KEY_IN_PROGRESS',
      409
    )
  }

  try {
    // skipAi keeps the request path to DB/storage writes only, so the submitting site gets
    // its 201 in seconds. AI extraction/scoring and the manager alert run post-response via
    // after(); the recruitment-ai-sweep cron is the safety net if that work dies.
    const result = await createRecruitmentApplication(applicationInput, {
      cvUpload,
      uploadKind: 'public',
      skipAi: true,
    }, supabase)

    const responsePayload = {
      success: true,
      data: {
        application_id: result.application.id,
        candidate_id: result.candidate.id,
        status: result.application.status,
        duplicate_of_application_id: result.duplicateOfApplicationId,
        cv_extraction_error: result.cvExtractionError,
        scoring_error: null,
        ai_processing: result.duplicateOfApplicationId ? 'skipped' : 'deferred',
      },
      meta: {
        status_code: 201,
      },
    }

    await persistIdempotencyResponse(supabase, idempotencyKey, requestHash, responsePayload)

    after(async () => {
      try {
        await sendRecruitmentApplicationReceivedEmail(result.application.id, supabase)
      } catch (error) {
        console.error('Recruitment application received email failed', error)
      }

      let processed: Awaited<ReturnType<typeof processRecruitmentApplicationAi>> | null = null
      try {
        processed = await processRecruitmentApplicationAi(result.application.id, supabase)
      } catch (error) {
        console.error('Deferred recruitment AI processing failed', error)
      }

      const application = processed?.application ?? result.application
      const cvExtractionError = processed?.cvExtractionError ?? result.cvExtractionError
      try {
        await sendRecruitmentManagerAlert({
          applicationId: application.id,
          alertType: application.status === 'talent_pool'
            ? 'talent pool candidate'
            : application.ai_recommendation === 'fast_track'
              ? 'fast-track'
              : 'new application',
          alertBody: [
            `${result.candidate.first_name ?? ''} ${result.candidate.last_name ?? ''}`.trim() || result.candidate.email || 'A candidate',
            application.job_posting?.title ? `applied for ${application.job_posting.title}.` : 'joined the recruitment talent pool.',
            application.ai_score != null ? `AI score: ${application.ai_score}.` : '',
            cvExtractionError ? `CV review needed: ${cvExtractionError}.` : '',
            processed?.scoringError ? `Scoring review needed: ${processed.scoringError}.` : '',
          ].filter(Boolean).join(' '),
        }, supabase)
      } catch (error) {
        console.error('Recruitment manager alert failed', error)
      }
    })

    return createApiResponse(responsePayload, 201, {}, request.method)
  } catch (error) {
    await releaseIdempotencyClaim(supabase, idempotencyKey, requestHash)
    console.error('Recruitment application failed', error)
    return createErrorResponse(
      error instanceof Error ? error.message : 'Failed to create recruitment application',
      'RECRUITMENT_APPLICATION_FAILED',
      500
    )
  }
}

export async function OPTIONS() {
  return createApiResponse({}, 200)
}

export async function POST(request: NextRequest) {
  const hasApiKey = Boolean(request.headers.get('x-api-key') || request.headers.get('authorization'))

  // Authenticated server-to-server callers (the website proxy) funnel every applicant
  // through a handful of Vercel egress IPs, so the strict per-IP ceiling meant for anonymous
  // posts would reject legitimate applicants during a busy spell (e.g. a job-ad burst).
  const rateLimit = await applyDistributedRateLimit(request, hasApiKey
    ? {
        prefix: 'recruitment-api-upload',
        window: '1 h',
        max: 60,
        message: 'Too many recruitment applications from this address. Please try again later.',
      }
    : {
        prefix: 'recruitment-public-upload',
        window: '1 h',
        max: 8,
        message: 'Too many recruitment applications from this address. Please try again later.',
      })
  if (rateLimit) return rateLimit
  if (hasApiKey) {
    return withApiAuth(
      () => handleRecruitmentApplication(request),
      ['write:recruitment'],
      request
    )
  }

  return handleRecruitmentApplication(request)
}
