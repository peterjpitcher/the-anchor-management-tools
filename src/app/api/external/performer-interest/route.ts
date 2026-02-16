import { NextRequest } from 'next/server'
import { z } from 'zod'

import { withApiAuth, createApiResponse, createErrorResponse } from '@/lib/api/auth'
import {
  claimIdempotencyKey,
  computeIdempotencyRequestHash,
  getIdempotencyKey,
  persistIdempotencyResponse,
  releaseIdempotencyClaim
} from '@/lib/api/idempotency'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendEmail } from '@/lib/email/emailService'
import { logger } from '@/lib/logger'

export const dynamic = 'force-dynamic'

const RATE_LIMIT_MAX_PER_HOUR = 10

const normalizeString = (value: unknown) =>
  typeof value === 'string' ? value.trim() : ''

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

const performerInterestSchema = z.object({
  fullName: z.string().trim().min(1).max(200),
  email: z.string().trim().email(),
  phone: z.string().trim().min(5).max(50),
  bio: z.string().trim().min(1).max(800),
  consentDataStorage: z.literal(true),
  honeypot: z.string().optional().default(''),
})

function extractClientIp(request: NextRequest): string | null {
  const forwardedFor = request.headers.get('x-forwarded-for')
  const realIp = request.headers.get('x-real-ip')
  const value = normalizeString(forwardedFor) || normalizeString(realIp)
  if (!value) return null
  return value.split(',')[0]?.trim() || null
}

function buildPerformerConfirmationEmail(args: {
  fullName: string
}): { subject: string; html: string; text: string } {
  const subject = 'Thanks — Open Mic interest received (The Anchor, Stanwell Moor)'
  const safeName = escapeHtml(args.fullName)

  const text = [
    `Hi ${args.fullName},`,
    '',
    'Thanks — we’ve received your open mic performer interest form.',
    '',
    'This is an expression of interest, not an automatic booking. We’ll be in touch when we’re booking acts.',
    '',
    'Practical details:',
    '- Open mic nights typically start around 8pm',
    '- The Anchor, Horton Road, Stanwell Moor, Surrey, TW19 6AQ',
    '- Free parking (around 20 spaces) and the 442 bus stops outside (Staines ↔ Heathrow)',
    '',
    'Questions? Call/WhatsApp 01753 682707 or email manager@the-anchor.pub',
    '',
    `Name on submission: ${args.fullName}`,
    '',
    '— The Anchor team',
  ].join('\n')

  const html = [
    `<p>Hi ${safeName},</p>`,
    `<p>Thanks — we’ve received your open mic performer interest form.</p>`,
    `<p><strong>Please note:</strong> this is an expression of interest, not an automatic booking. We’ll be in touch when we’re booking acts.</p>`,
    '<p><strong>Practical details</strong></p>',
    '<ul>',
    '<li>Open mic nights typically start around 8pm</li>',
    '<li>The Anchor, Horton Road, Stanwell Moor, Surrey, TW19 6AQ</li>',
    '<li>Free parking (around 20 spaces) and the 442 bus stops outside (Staines ↔ Heathrow)</li>',
    '</ul>',
    '<p>Questions? Call/WhatsApp <a href="tel:+441753682707">01753 682707</a> or email <a href="mailto:manager@the-anchor.pub">manager@the-anchor.pub</a>.</p>',
    `<p><strong>Name on submission:</strong> ${safeName}</p>`,
    '<p>— The Anchor team</p>',
  ].join('\n')

  return { subject, html, text }
}

function buildInternalNotificationEmail(args: {
  id: string
  fullName: string
  email: string
  phone: string
  bio: string
}): { subject: string; html: string; text: string } {
  const subject = `New Open Mic performer interest: ${args.fullName}`
  const adminUrl = `https://management.orangejelly.co.uk/performers/${encodeURIComponent(args.id)}`

  const textLines = [
    'New Open Mic performer interest received',
    '',
    `Full name: ${args.fullName}`,
    `Email: ${args.email}`,
    `Phone: ${args.phone}`,
    '',
    'Description:',
    args.bio,
    '',
    `View in admin: ${adminUrl}`,
  ]

  const safe = {
    fullName: escapeHtml(args.fullName),
    email: escapeHtml(args.email),
    phone: escapeHtml(args.phone),
    bio: escapeHtml(args.bio).replace(/\n/g, '<br/>'),
    adminUrl: escapeHtml(adminUrl),
  }

  const html = [
    '<h2>New Open Mic performer interest received</h2>',
    `<p><strong>Full name:</strong> ${safe.fullName}</p>`,
    `<p><strong>Email:</strong> <a href="mailto:${safe.email}">${safe.email}</a><br/><strong>Phone:</strong> ${safe.phone}</p>`,
    '<h3>Description</h3>',
    `<p>${safe.bio}</p>`,
    `<p><strong>Admin link:</strong> <a href="${safe.adminUrl}">${safe.adminUrl}</a></p>`,
  ].join('\n')

  return { subject, html, text: `${textLines.join('\n')}\n` }
}

export async function OPTIONS() {
  return new Response(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key',
      'Access-Control-Max-Age': '86400',
    },
  })
}

export async function POST(request: NextRequest) {
  return withApiAuth(
    async () => {
      let parsedBody: z.infer<typeof performerInterestSchema>
      try {
        parsedBody = performerInterestSchema.parse(await request.json())
      } catch (error) {
        const message =
          error instanceof z.ZodError
            ? error.errors[0]?.message ?? 'Invalid payload'
            : 'Invalid payload'
        return createErrorResponse(message, 'VALIDATION_ERROR', 400)
      }

      // Honeypot (bots fill hidden fields)
      if (normalizeString(parsedBody.honeypot).length > 0) {
        return createErrorResponse('Submission rejected', 'SPAM_DETECTED', 400)
      }

      const submittedIp = extractClientIp(request)
      const userAgent = normalizeString(request.headers.get('user-agent'))

      const supabase = createAdminClient()

      // Rate limit per IP (in addition to API key limits)
      if (submittedIp) {
        const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()
        const { count, error: rateLimitError } = await supabase
          .from('performer_submissions')
          .select('id', { count: 'exact', head: true })
          .eq('submitted_ip', submittedIp)
          .gte('created_at', oneHourAgo)

        if (rateLimitError) {
          logger.error('Failed to evaluate performer submission rate limit', {
            // Supabase Postgrest errors are already `Error` instances; log them directly.
            error: rateLimitError,
            metadata: { submittedIp },
          })
          return createErrorResponse('Failed to process submission', 'DATABASE_ERROR', 500)
        }

        if ((count || 0) >= RATE_LIMIT_MAX_PER_HOUR) {
          return createErrorResponse(
            'Too many submissions from this address. Please try again later.',
            'RATE_LIMIT_EXCEEDED',
            429,
          )
        }
      }

      const normalizedFullName = parsedBody.fullName.trim()
      const normalizedEmail = parsedBody.email.trim().toLowerCase()
      const normalizedPhone = parsedBody.phone.trim()
      const normalizedBio = parsedBody.bio.trim()
      const requestHash = computeIdempotencyRequestHash({
        full_name: normalizedFullName,
        email: normalizedEmail,
        phone: normalizedPhone,
        bio: normalizedBio,
        source: 'website_open_mic'
      })
      const hourBucket = Math.floor(Date.now() / (60 * 60 * 1000))
      const idempotencyKey = getIdempotencyKey(request)
        || `external_performer_interest:${requestHash.slice(0, 32)}:${hourBucket}`
      const claim = await claimIdempotencyKey(supabase, idempotencyKey, requestHash)

      if (claim.state === 'conflict') {
        return createErrorResponse(
          'Idempotency key already used with a different request payload',
          'IDEMPOTENCY_KEY_CONFLICT',
          409
        )
      }

      if (claim.state === 'replay') {
        return createApiResponse(claim.response)
      }

      if (claim.state === 'in_progress') {
        return createErrorResponse(
          'This request is already being processed. Please retry shortly.',
          'IDEMPOTENCY_KEY_IN_PROGRESS',
          409
        )
      }

      let claimHeld = true
      let mutationCommitted = false
      try {
        const payload = {
          full_name: normalizedFullName,
          email: normalizedEmail,
          phone: normalizedPhone,
          bio: normalizedBio,
          consent_data_storage: true,
          source: 'website_open_mic',
          submitted_ip: submittedIp,
          user_agent: userAgent || null,
        }

        const { data: submission, error: insertError } = await supabase
          .from('performer_submissions')
          .insert([payload])
          .select('id, full_name, email, phone, bio')
          .single()

        if (insertError || !submission) {
          const errorToLog = insertError ?? new Error('Insert failed with no error object')
          logger.error('Failed to create performer submission', {
            // Supabase Postgrest errors are already `Error` instances; log them directly.
            error: errorToLog,
          })
          return createErrorResponse('Failed to save submission', 'DATABASE_ERROR', 500)
        }

        mutationCommitted = true

        // Emails (non-fatal if they fail)
        const performerEmail = buildPerformerConfirmationEmail({
          fullName: submission.full_name,
        })

        const internalEmail = buildInternalNotificationEmail({
          id: submission.id,
          fullName: submission.full_name,
          email: submission.email,
          phone: submission.phone,
          bio: submission.bio,
        })

        const [performerEmailResult, internalEmailResult] = await Promise.all([
          sendEmail({
            to: submission.email,
            subject: performerEmail.subject,
            html: performerEmail.html,
            text: performerEmail.text,
          }),
          sendEmail({
            to: 'manager@the-anchor.pub',
            cc: ['leo.dowling@live.co.uk'],
            subject: internalEmail.subject,
            html: internalEmail.html,
            text: internalEmail.text,
          }),
        ])

        if (!performerEmailResult.success) {
          logger.warn('Failed to send performer confirmation email', {
            metadata: {
              submissionId: submission.id,
              error: performerEmailResult.error,
            },
          })
        }
        if (!internalEmailResult.success) {
          logger.warn('Failed to send internal notification email', {
            metadata: {
              submissionId: submission.id,
              error: internalEmailResult.error,
            },
          })
        }

        const responsePayload = {
          id: submission.id,
          email_sent: {
            performer: performerEmailResult.success,
            internal: internalEmailResult.success,
          },
        }

        try {
          await persistIdempotencyResponse(supabase, idempotencyKey, requestHash, responsePayload)
          claimHeld = false
        } catch (persistError) {
          // Returning 500 causes clients to retry, which can replay the submission insert and
          // re-send emails during DB/idempotency-write degradation.
          logger.error('Performer-interest submission created but failed to persist idempotency response', {
            error: persistError instanceof Error ? persistError : new Error(String(persistError)),
            metadata: {
              idempotencyKey,
              submissionId: submission.id,
            },
          })
          return createApiResponse(responsePayload)
        }

        return createApiResponse(responsePayload)
      } finally {
        if (claimHeld && !mutationCommitted) {
          try {
            await releaseIdempotencyClaim(supabase, idempotencyKey, requestHash)
          } catch (releaseError) {
            logger.error('Failed to release performer-interest idempotency claim', {
              error: releaseError instanceof Error ? releaseError : new Error(String(releaseError)),
              metadata: { idempotencyKey },
            })
          }
        }
      }
    },
    ['write:performers'],
    request,
  )
}
