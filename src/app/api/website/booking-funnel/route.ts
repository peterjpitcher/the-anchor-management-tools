import { NextRequest } from 'next/server'
import { z } from 'zod'

import { createApiResponse, createErrorResponse, withApiAuth } from '@/lib/api/auth'
import {
  BOOKING_FORM_REASONS,
  BOOKING_FORM_STEPS,
  BOOKING_FORMS,
  FUNNEL_CODE_PATTERN,
  FUNNEL_PAGE_PATTERN,
  recordFunnelEvent,
} from '@/lib/booking-funnel/events'
import { applyDistributedRateLimit } from '@/lib/distributed-rate-limit'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * The website tells us a guest was turned away, or what a booking form did (BK-101, BK-191;
 * customer bookings review of 24 October 2026).
 *
 * Website refusals (a detail to correct, outside online hours, a failed or missing security
 * check, a "no" from this app) and failures used to reach one log line on the website and
 * nowhere else, so nobody could count them. Each one now becomes a row in
 * booking_funnel_events, which the daily website refusals summary (one email to the manager
 * inbox, owner decision D17) and the table bookings funnel read. The event booking form also
 * reports opened, submit pressed, blocked and sent, so a form nobody can submit shows up.
 *
 * Codes only, checked against fixed shapes, and the field list is closed: no name, phone number,
 * email address, booking reference or free text can be stored, and nothing is echoed back.
 * Same API key scope as the payment failure alert, which the website's key already holds.
 */

const code = z.string().regex(FUNNEL_CODE_PATTERN)
const page = z.string().max(120).regex(FUNNEL_PAGE_PATTERN)

const RefusalSchema = z
  .object({
    type: z.literal('refusal'),
    route: z.string().regex(/^[A-Za-z0-9/_.:[\]-]{1,80}$/),
    kind: z.enum(['refused', 'failed']),
    status: z.number().int().min(100).max(599).nullable().optional(),
    reason: code,
    upstream_code: code.nullable().optional(),
    page: page.nullable().optional(),
  })
  .strict()

const FormSchema = z
  .object({
    type: z.literal('form'),
    form: z.enum(BOOKING_FORMS),
    step: z.enum(BOOKING_FORM_STEPS),
    reason: z.enum(BOOKING_FORM_REASONS).nullable().optional(),
    page: page.nullable().optional(),
  })
  .strict()

const BodySchema = z.discriminatedUnion('type', [RefusalSchema, FormSchema])

// A flood of bot submissions on the website must not become a flood of rows here.
const HOURLY_LIMIT = 1200

export async function POST(request: NextRequest): Promise<Response> {
  return withApiAuth(
    async (req, apiKey) => {
      let body: unknown
      try {
        body = await req.json()
      } catch {
        return createErrorResponse('Invalid JSON body', 'VALIDATION_ERROR', 400)
      }

      const parsed = BodySchema.safeParse(body)
      if (!parsed.success) {
        // The field names only. Echoing a rejected value would put caller text in a response.
        return createErrorResponse('Invalid request body', 'VALIDATION_ERROR', 400, {
          fields: parsed.error.issues.map((issue) => issue.path.join('.') || 'body'),
        })
      }

      const limited = await applyDistributedRateLimit(request, {
        prefix: 'website-booking-funnel',
        identifier: apiKey?.id ?? 'unknown',
        window: '1 h',
        max: HOURLY_LIMIT,
        localWindowMs: 60 * 60 * 1000,
      })
      if (limited) {
        return createErrorResponse('Too many booking funnel reports this hour', 'RATE_LIMIT_EXCEEDED', 429)
      }

      const event = parsed.data
      const recorded = await recordFunnelEvent(
        createAdminClient(),
        event.type === 'refusal'
          ? {
              source: 'website',
              stage: event.kind,
              route: event.route.replace(/^\/+/, ''),
              reason_code: event.reason,
              upstream_code: event.upstream_code ?? null,
              http_status: event.status ?? null,
              page_path: event.page ?? null,
              api_key_id: apiKey?.id ?? null,
            }
          : {
              source: 'website',
              stage: 'form',
              route: event.form,
              reason_code: event.step,
              upstream_code: event.step === 'blocked' ? event.reason ?? null : null,
              page_path: event.page ?? null,
              api_key_id: apiKey?.id ?? null,
            },
      )

      if (!recorded) {
        return createErrorResponse('The report could not be recorded', 'RECORD_FAILED', 503)
      }
      return createApiResponse({ success: true, data: { recorded: true } }, 202, {}, 'POST')
    },
    ['write:ops_alerts'],
    request,
  )
}
