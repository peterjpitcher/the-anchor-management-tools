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
  useRealName: z.boolean().optional().default(false),
  actName: z.string().trim().max(200).optional().nullable(),
  email: z.string().trim().email(),
  phone: z.string().trim().min(5).max(50),
  baseLocation: z.string().trim().min(1).max(200),
  performerTypes: z.array(z.string().trim().min(1).max(80)).min(1).max(25),
  performerTypeOther: z.string().trim().max(200).optional().nullable(),
  bio: z.string().trim().min(1).max(800),
  links: z.record(z.array(z.string().trim().max(500))).optional(),
  socialHandles: z.record(z.string().trim().max(200)).optional(),
  experienceLevel: z.enum(['none', 'some', 'regular']).optional().nullable(),
  pronouns: z.string().trim().max(100).optional().nullable(),
  accessibilityNotes: z.string().trim().max(1000).optional().nullable(),
  availabilityGeneral: z.enum(['weeknights', 'weekends', 'either']),
  canStartAround8pm: z.enum(['yes', 'no', 'depends']),
  availability: z.record(z.any()).optional(),
  setLengthMinutes: z.union([z.literal(5), z.literal(10), z.literal(15), z.literal(20)]).optional(),
  contentRating: z.enum(['family_friendly', 'mild_language', 'adults_only']).optional(),
  musicOriginalsCovers: z.enum(['original', 'covers', 'mix']).optional(),
  genres: z.array(z.string().trim().min(1).max(50)).max(25).optional(),
  techNeeds: z.record(z.any()).optional(),
  techNeedsOther: z.string().trim().max(500).optional().nullable(),
  bringOwnGear: z.enum(['yes', 'no', 'some']).optional(),
  setupTimeMinutes: z.number().int().min(0).max(180).optional(),
  performerCount: z.number().int().min(1).max(50).optional(),
  specialRequirements: z.string().trim().max(1000).optional().nullable(),
  consentDataStorage: z.literal(true),
  consentMarketing: z.boolean().optional().default(false),
  consentMedia: z.boolean().optional().default(false),
  honeypot: z.string().optional().default(''),
})

function extractClientIp(request: NextRequest): string | null {
  const forwardedFor = request.headers.get('x-forwarded-for')
  const realIp = request.headers.get('x-real-ip')
  const value = normalizeString(forwardedFor) || normalizeString(realIp)
  if (!value) return null
  return value.split(',')[0]?.trim() || null
}

function normalizeLinks(input?: Record<string, string[]>): Record<string, string[]> {
  const output: Record<string, string[]> = {}
  if (!input) return output

  for (const [key, values] of Object.entries(input)) {
    const cleaned = (values || [])
      .map((v) => (typeof v === 'string' ? v.trim() : ''))
      .filter(Boolean)
      .slice(0, 10)

    if (cleaned.length > 0) {
      output[key] = cleaned
    }
  }

  return output
}

function summarizeLinks(links: Record<string, string[]>): string[] {
  const lines: string[] = []
  const keys = Object.keys(links).sort((a, b) => a.localeCompare(b))
  for (const key of keys) {
    const urls = links[key] || []
    for (const url of urls) {
      lines.push(`${key}: ${url}`)
    }
  }
  return lines
}

function formatAvailabilityLabel(value: string): string {
  switch (value) {
    case 'weeknights':
      return 'Weeknights'
    case 'weekends':
      return 'Weekends'
    case 'either':
      return 'Either'
    default:
      return value
  }
}

function formatYesNoDepends(value: string): string {
  switch (value) {
    case 'yes':
      return 'Yes'
    case 'no':
      return 'No'
    case 'depends':
      return 'Depends'
    default:
      return value
  }
}

function buildPerformerConfirmationEmail(args: {
  fullName: string
  actName: string
}): { subject: string; html: string; text: string } {
  const subject = 'Thanks — Open Mic interest received (The Anchor, Stanwell Moor)'
  const safeName = escapeHtml(args.fullName)
  const safeAct = escapeHtml(args.actName)

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
    `Act name: ${args.actName}`,
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
    `<p><strong>Name on submission:</strong> ${safeName}<br/><strong>Act name:</strong> ${safeAct}</p>`,
    '<p>— The Anchor team</p>',
  ].join('\n')

  return { subject, html, text }
}

function buildInternalNotificationEmail(args: {
  id: string
  fullName: string
  actName: string
  email: string
  phone: string
  baseLocation: string
  performerTypes: string[]
  bio: string
  availabilityGeneral: string
  canStartAround8pm: string
  links: Record<string, string[]>
  hasLinks: boolean
  experienceLevel?: string | null
}): { subject: string; html: string; text: string } {
  const subject = `New Open Mic performer interest: ${args.actName}`
  const adminUrl = `https://management.orangejelly.co.uk/performers/${encodeURIComponent(args.id)}`

  const linkLines = summarizeLinks(args.links)

  const textLines = [
    'New Open Mic performer interest received',
    '',
    `Act name: ${args.actName}`,
    `Full name: ${args.fullName}`,
    `Email: ${args.email}`,
    `Phone: ${args.phone}`,
    `Base location: ${args.baseLocation}`,
    `Performer types: ${args.performerTypes.join(', ')}`,
    args.experienceLevel ? `Experience: ${args.experienceLevel}` : null,
    '',
    'Availability:',
    `- Generally available: ${formatAvailabilityLabel(args.availabilityGeneral)}`,
    `- Can start around 8pm: ${formatYesNoDepends(args.canStartAround8pm)}`,
    '',
    'Bio:',
    args.bio,
    '',
    args.hasLinks ? 'Links:' : 'Links: (none provided)',
    ...(args.hasLinks ? linkLines : []),
    '',
    `View in admin: ${adminUrl}`,
  ].filter(Boolean) as string[]

  const safe = {
    actName: escapeHtml(args.actName),
    fullName: escapeHtml(args.fullName),
    email: escapeHtml(args.email),
    phone: escapeHtml(args.phone),
    baseLocation: escapeHtml(args.baseLocation),
    bio: escapeHtml(args.bio).replace(/\n/g, '<br/>'),
    adminUrl: escapeHtml(adminUrl),
  }

  const performerTypesHtml = args.performerTypes
    .map((t) => `<span style="display:inline-block;padding:2px 8px;border-radius:999px;background:#f2f2f2;margin:0 6px 6px 0;">${escapeHtml(t)}</span>`)
    .join('')

  const linksHtml = args.hasLinks
    ? `<ul>${linkLines
        .map((line) => {
          const [, url = ''] = line.split(':', 2)
          const href = url.trim()
          const safeHref = escapeHtml(href)
          const safeLine = escapeHtml(line)
          return href ? `<li><a href="${safeHref}" target="_blank" rel="noopener noreferrer">${safeLine}</a></li>` : `<li>${safeLine}</li>`
        })
        .join('')}</ul>`
    : '<p><em>No links provided.</em></p>'

  const html = [
    '<h2>New Open Mic performer interest received</h2>',
    `<p><strong>Act name:</strong> ${safe.actName}<br/><strong>Full name:</strong> ${safe.fullName}</p>`,
    `<p><strong>Email:</strong> <a href="mailto:${safe.email}">${safe.email}</a><br/><strong>Phone:</strong> ${safe.phone}</p>`,
    `<p><strong>Base location:</strong> ${safe.baseLocation}</p>`,
    '<p><strong>Performer types:</strong><br/>' + performerTypesHtml + '</p>',
    args.experienceLevel ? `<p><strong>Experience:</strong> ${escapeHtml(args.experienceLevel)}</p>` : '',
    '<h3>Availability</h3>',
    `<ul><li><strong>Generally available:</strong> ${escapeHtml(formatAvailabilityLabel(args.availabilityGeneral))}</li><li><strong>Can start around 8pm:</strong> ${escapeHtml(formatYesNoDepends(args.canStartAround8pm))}</li></ul>`,
    '<h3>Bio</h3>',
    `<p>${safe.bio}</p>`,
    '<h3>Links</h3>',
    linksHtml,
    `<p><strong>Admin link:</strong> <a href="${safe.adminUrl}">${safe.adminUrl}</a></p>`,
  ]
    .filter(Boolean)
    .join('\n')

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
    async (_req, _apiKey) => {
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

      const fullName = parsedBody.fullName.trim()
      const useRealName = parsedBody.useRealName === true
      const actNameRaw = normalizeString(parsedBody.actName)
      const actName = useRealName ? fullName : actNameRaw

      if (!actName) {
        return createErrorResponse(
          'Please provide an act/stage name (or select “use my real name”).',
          'VALIDATION_ERROR',
          400,
        )
      }

      const performerTypes = parsedBody.performerTypes.map((value) => value.trim()).filter(Boolean)
      const performerTypeOther = normalizeString(parsedBody.performerTypeOther) || null
      const includesOther = performerTypes.some((value) => value.toLowerCase() === 'other')

      if (includesOther && !performerTypeOther) {
        return createErrorResponse('Please describe your performer type.', 'VALIDATION_ERROR', 400)
      }

      const links = normalizeLinks(parsedBody.links)
      const hasLinks = Object.values(links).some((values) => values.length > 0)

      const payload = {
        full_name: fullName,
        use_real_name: useRealName,
        act_name: actName,
        email: parsedBody.email.trim().toLowerCase(),
        phone: parsedBody.phone.trim(),
        base_location: parsedBody.baseLocation.trim(),
        performer_types: performerTypes,
        performer_type_other: performerTypeOther,
        bio: parsedBody.bio.trim(),
        links,
        has_links: hasLinks,
        social_handles: parsedBody.socialHandles || {},
        experience_level: parsedBody.experienceLevel || null,
        pronouns: normalizeString(parsedBody.pronouns) || null,
        accessibility_notes: normalizeString(parsedBody.accessibilityNotes) || null,
        availability_general: parsedBody.availabilityGeneral,
        can_start_around_8pm: parsedBody.canStartAround8pm,
        availability: parsedBody.availability || {},
        set_length_minutes: parsedBody.setLengthMinutes ?? null,
        content_rating: parsedBody.contentRating ?? null,
        music_originals_covers: parsedBody.musicOriginalsCovers ?? null,
        genres: parsedBody.genres || [],
        tech_needs: parsedBody.techNeeds || {},
        tech_needs_other: normalizeString(parsedBody.techNeedsOther) || null,
        bring_own_gear: parsedBody.bringOwnGear ?? null,
        setup_time_minutes: parsedBody.setupTimeMinutes ?? null,
        performer_count: parsedBody.performerCount ?? null,
        special_requirements: normalizeString(parsedBody.specialRequirements) || null,
        consent_data_storage: true,
        consent_marketing: parsedBody.consentMarketing === true,
        consent_media: parsedBody.consentMedia === true,
        source: 'website_open_mic',
        submitted_ip: submittedIp,
        user_agent: userAgent || null,
      }

      const { data: submission, error: insertError } = await supabase
        .from('performer_submissions')
        .insert([payload])
        .select('id, full_name, act_name, email, phone, base_location, performer_types, bio, availability_general, can_start_around_8pm')
        .single()

      if (insertError || !submission) {
        console.error('Failed to create performer submission:', insertError)
        return createErrorResponse('Failed to save submission', 'DATABASE_ERROR', 500)
      }

      // Emails (non-fatal if they fail)
      const performerEmail = buildPerformerConfirmationEmail({
        fullName: submission.full_name,
        actName: submission.act_name,
      })

      const internalEmail = buildInternalNotificationEmail({
        id: submission.id,
        fullName: submission.full_name,
        actName: submission.act_name,
        email: submission.email,
        phone: submission.phone,
        baseLocation: submission.base_location,
        performerTypes: submission.performer_types ?? [],
        bio: submission.bio,
        availabilityGeneral: submission.availability_general,
        canStartAround8pm: submission.can_start_around_8pm,
        links,
        hasLinks,
        experienceLevel: payload.experience_level,
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

