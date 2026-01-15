import { NextRequest } from 'next/server'
import { z } from 'zod'

import { withApiAuth, createApiResponse, createErrorResponse } from '@/lib/api/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendEmail } from '@/lib/email/emailService'

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
        const { count } = await supabase
          .from('performer_submissions')
          .select('id', { count: 'exact', head: true })
          .eq('submitted_ip', submittedIp)
          .gte('created_at', oneHourAgo)

        if ((count || 0) >= RATE_LIMIT_MAX_PER_HOUR) {
          return createErrorResponse(
            'Too many submissions from this address. Please try again later.',
            'RATE_LIMIT_EXCEEDED',
            429,
          )
        }
      }

      const payload = {
        full_name: parsedBody.fullName.trim(),
        email: parsedBody.email.trim().toLowerCase(),
        phone: parsedBody.phone.trim(),
        bio: parsedBody.bio.trim(),
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
        console.error('Failed to create performer submission:', insertError)
        return createErrorResponse('Failed to save submission', 'DATABASE_ERROR', 500)
      }

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
        console.error('Failed to send performer confirmation email:', performerEmailResult.error)
      }
      if (!internalEmailResult.success) {
        console.error('Failed to send internal notification email:', internalEmailResult.error)
      }

      return createApiResponse({
        id: submission.id,
        email_sent: {
          performer: performerEmailResult.success,
          internal: internalEmailResult.success,
        },
      })
    },
    ['write:performers'],
    request,
  )
}
