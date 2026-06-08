import crypto from 'crypto'
import { NextRequest } from 'next/server'
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
import { sendRecruitmentManagerAlert } from '@/lib/recruitment/communications'
import { createRecruitmentApplication } from '@/services/recruitment'
import type { RecruitmentCvUpload } from '@/types/recruitment'

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

async function resolvePostingId(formData: FormData, supabase: ReturnType<typeof createAdminClient>) {
  const explicitId = formString(formData, 'job_posting_id') || formString(formData, 'posting_id')
  if (explicitId) return explicitId

  const slug = formString(formData, 'job_slug') || formString(formData, 'role_slug')
  if (!slug) return null

  const { data, error } = await supabase
    .from('recruitment_job_postings')
    .select('id')
    .eq('slug', slug)
    .eq('status', 'open')
    .eq('is_public', true)
    .maybeSingle()

  if (error) throw error
  return data?.id ?? null
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
  const postingId = await resolvePostingId(formData, supabase)
  const normalizedEmail = formString(formData, 'email')?.toLowerCase() ?? null
  const cvHash = cvUpload
    ? crypto.createHash('sha256').update(cvUpload.buffer).digest('hex')
    : null

  const applicationInput = {
    candidate: {
      first_name: formString(formData, 'first_name'),
      last_name: formString(formData, 'last_name'),
      email: normalizedEmail,
      phone: formString(formData, 'phone'),
      phone_e164: formString(formData, 'phone_e164'),
      location: formString(formData, 'location'),
      source: 'website' as const,
      provided_details: formString(formData, 'provided_details'),
      consent_source: 'public_website',
      consent_at: new Date().toISOString(),
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
    const result = await createRecruitmentApplication(applicationInput, {
      cvUpload,
      uploadKind: 'public',
    }, supabase)

    await sendRecruitmentManagerAlert({
      applicationId: result.application.id,
      alertType: result.application.ai_recommendation === 'fast_track' ? 'fast-track' : 'new application',
      alertBody: [
        `${result.candidate.first_name ?? ''} ${result.candidate.last_name ?? ''}`.trim() || result.candidate.email || 'A candidate',
        result.application.job_posting?.title ? `applied for ${result.application.job_posting.title}.` : 'joined the recruitment talent pool.',
        result.application.ai_score != null ? `AI score: ${result.application.ai_score}.` : '',
        result.cvExtractionError ? `CV review needed: ${result.cvExtractionError}.` : '',
        result.scoringError ? `Scoring review needed: ${result.scoringError}.` : '',
      ].filter(Boolean).join(' '),
    }, supabase).catch(error => {
      console.error('Recruitment manager alert failed', error)
    })

    const responsePayload = {
      success: true,
      data: {
        application_id: result.application.id,
        candidate_id: result.candidate.id,
        status: result.application.status,
        duplicate_of_application_id: result.duplicateOfApplicationId,
        cv_extraction_error: result.cvExtractionError,
        scoring_error: result.scoringError,
      },
      meta: {
        status_code: 201,
      },
    }

    await persistIdempotencyResponse(supabase, idempotencyKey, requestHash, responsePayload)
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
  const rateLimit = await applyDistributedRateLimit(request, {
    prefix: 'recruitment-public-upload',
    window: '1 h',
    max: 8,
    message: 'Too many recruitment applications from this address. Please try again later.',
  })
  if (rateLimit) return rateLimit

  const hasApiKey = Boolean(request.headers.get('x-api-key') || request.headers.get('authorization'))
  if (hasApiKey) {
    return withApiAuth(
      () => handleRecruitmentApplication(request),
      ['write:recruitment'],
      request
    )
  }

  return handleRecruitmentApplication(request)
}
