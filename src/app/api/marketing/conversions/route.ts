import { NextRequest } from 'next/server'
import { z } from 'zod'

import { withApiAuth, createApiResponse, createErrorResponse } from '@/lib/api/auth'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Record a marketing conversion that is not a booking.
 *
 * Bookings already reach us through the booking APIs and land in `analytics_events` with
 * their UTM values attached. An enquiry has no booking and no customer, so without this
 * endpoint a campaign whose main call to action is an enquiry form reports clicks and
 * nothing else.
 *
 * The contract is deliberately forgiving. This is analytics: if the caller sends something
 * we cannot resolve, we still record what we can, because the alternative is that the
 * website either loses an enquiry or shows the visitor an error over a reporting problem.
 */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) => (value ? value : undefined))

const ConversionSchema = z.object({
  conversionType: z.enum(['christmas_enquiry', 'private_booking_enquiry', 'contact_form', 'other']),
  occurredAt: z.string().datetime().optional(),

  utmSource: optionalText(160),
  utmMedium: optionalText(160),
  utmCampaign: optionalText(240),
  utmContent: optionalText(240),
  shortCode: optionalText(120),
  landingPath: optionalText(512),
  sourceUrl: optionalText(2048),

  companyName: optionalText(240),
  partySize: z.number().int().positive().max(10000).optional(),

  metadata: z.record(z.any()).optional(),
})

type ConversionInput = z.infer<typeof ConversionSchema>

interface RecipientLink {
  recipient_id: string
  campaign_id: string
  contact_id: string
}

/**
 * Resolve `utm_content` back to the recipient it was stamped on.
 *
 * The marketing renderer puts the recipient id in `utm_content`, so a value that parses as
 * a uuid is worth a lookup. Anything else (a hand-written ad variant name, a forwarded
 * link, nothing at all) is normal traffic rather than an error, and returns null.
 */
async function resolveRecipient(
  supabase: ReturnType<typeof createAdminClient>,
  utmContent: string | undefined,
): Promise<RecipientLink | null> {
  if (!utmContent || !UUID_PATTERN.test(utmContent)) return null

  const { data, error } = await supabase
    .from('marketing_campaign_recipients')
    .select('id, campaign_id, contact_id')
    .eq('id', utmContent)
    .maybeSingle()

  if (error) {
    // A failed lookup must not cost us the conversion row, so this is logged and swallowed.
    console.warn('[Marketing conversions] Failed to resolve utm_content to a recipient', {
      error: error.message,
    })
    return null
  }

  if (!data) return null

  return {
    recipient_id: data.id as string,
    campaign_id: data.campaign_id as string,
    contact_id: data.contact_id as string,
  }
}

function toRow(input: ConversionInput, link: RecipientLink | null) {
  return {
    conversion_type: input.conversionType,
    ...(input.occurredAt ? { occurred_at: input.occurredAt } : {}),
    utm_source: input.utmSource ?? null,
    utm_medium: input.utmMedium ?? null,
    utm_campaign: input.utmCampaign ?? null,
    utm_content: input.utmContent ?? null,
    short_code: input.shortCode ?? null,
    landing_path: input.landingPath ?? null,
    source_url: input.sourceUrl ?? null,
    company_name: input.companyName ?? null,
    party_size: input.partySize ?? null,
    metadata: input.metadata ?? {},
    campaign_id: link?.campaign_id ?? null,
    recipient_id: link?.recipient_id ?? null,
    business_contact_id: link?.contact_id ?? null,
  }
}

export async function POST(request: NextRequest) {
  return withApiAuth(
    async (req) => {
      let body: unknown
      try {
        body = await req.json()
      } catch {
        return createErrorResponse('Invalid JSON body', 'VALIDATION_ERROR', 400)
      }

      const parsed = ConversionSchema.safeParse(body)
      if (!parsed.success) {
        return createErrorResponse(
          parsed.error.issues[0]?.message || 'Invalid request body',
          'VALIDATION_ERROR',
          400,
          { issues: parsed.error.issues },
        )
      }

      const supabase = createAdminClient()
      const link = await resolveRecipient(supabase, parsed.data.utmContent)

      const { data, error } = await supabase
        .from('marketing_conversions')
        .insert(toRow(parsed.data, link))
        .select('id')
        .single()

      if (error) {
        console.error('[Marketing conversions] Failed to record conversion', {
          error: error.message,
          conversionType: parsed.data.conversionType,
        })
        return createErrorResponse('Failed to record conversion', 'DATABASE_ERROR', 500)
      }

      // 202 rather than 201: the caller has already completed the visitor's enquiry and is
      // only telling us about it, so the meaningful answer is "accepted, carry on".
      return createApiResponse(
        {
          id: data.id,
          attributed: link !== null,
        },
        202,
        undefined,
        'POST',
      )
    },
    ['write:marketing_conversions'],
    request,
  )
}

export async function OPTIONS() {
  return createApiResponse({}, 200)
}
