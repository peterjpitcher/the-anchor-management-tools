import { NextResponse } from 'next/server'
import { z } from 'zod'
import { withApiAuth } from '@/lib/api/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logger'
import { readRebookLink } from '@/lib/events/rebook-link'

export const dynamic = 'force-dynamic'

/**
 * POST /api/external/event-bookings/rebook: the website swaps a one-tap rebook token for the
 * details the guest typed last time, to fill its booking form in (event checkout spec, Piece 4.2;
 * src/lib/events/rebook-link.ts).
 *
 * The token is sent in the JSON body, `{ "token": "<token>" }`, and never in the address: request
 * paths are kept in api_usage and in the hosting logs, and the token must never be logged.
 *
 * Authenticated with the website's API key and its create:bookings scope, rate limited per key by
 * withApiAuth, like the other website booking routes. Never cached.
 *
 * Answers 200 with `{ state: 'ok', ...details }` or `{ state: 'filled' | 'closed' | 'expired' |
 * 'already_booked' | 'not_found' }`, 400 with `{ state: 'not_found' }` for a body with no token,
 * and 503 with `{ state: 'unavailable' }` when the database cannot be read, with no detail: the
 * website then shows its ordinary empty form.
 */

const RebookRequestSchema = z.object({
  token: z.string().min(1).max(200),
})

const NO_STORE = { 'Cache-Control': 'private, no-store' }

function reply(body: Record<string, unknown>, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: NO_STORE })
}

export async function POST(request: Request): Promise<Response> {
  return withApiAuth(
    async (req) => {
      let body: unknown
      try {
        body = await req.json()
      } catch {
        return reply({ state: 'not_found' }, 400)
      }
      const parsed = RebookRequestSchema.safeParse(body)
      if (!parsed.success) return reply({ state: 'not_found' }, 400)

      try {
        const result = await readRebookLink(createAdminClient(), parsed.data.token)
        return reply(result)
      } catch (error) {
        // Never the token, and never the database's words to the website.
        const err = error as { message?: unknown; code?: unknown; details?: unknown; hint?: unknown } | null
        logger.error('Rebook link could not be read', {
          error: error instanceof Error ? error : new Error(typeof err?.message === 'string' ? err.message : String(error)),
          metadata: {
            code: typeof err?.code === 'string' ? err.code : null,
            details: typeof err?.details === 'string' ? err.details : null,
            hint: typeof err?.hint === 'string' ? err.hint : null,
          },
        })
        return reply({ state: 'unavailable' }, 503)
      }
    },
    ['create:bookings'],
    request,
    { cacheMode: 'private' },
  )
}
