import { NextRequest } from 'next/server'
import {
  createApiResponse,
  withApiAuth,
} from '@/lib/api/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logger'

// Runtime UI flags for the website (review F19 / plan T9). A NEXT_PUBLIC_*
// build-time flag cannot be an instant rollback, so the website reads this
// endpoint server-side (60s cache, default OFF when unreachable) and AMS holds
// the truth in one system_settings row:
//
//   key   'website_ui_flags'
//   value the flags object itself, e.g. {"booking_options_step1": true}
//
// No row exists until a flag is first set (deliberately: no migration, no
// seed). Anything other than a plain JSON object in `value` is treated as no
// flags at all: every flag defaults OFF, on both sides, in every failure mode.

const FLAGS_SETTING_KEY = 'website_ui_flags'

function normalizeFlags(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }
  return value as Record<string, unknown>
}

export async function OPTIONS() {
  return createApiResponse({}, 200)
}

export async function GET(request: NextRequest) {
  return withApiAuth(async (req) => {
    let flags: Record<string, unknown> = {}

    try {
      const supabase = createAdminClient()
      const { data, error } = await supabase
        .from('system_settings')
        .select('value')
        .eq('key', FLAGS_SETTING_KEY)
        .maybeSingle()

      if (error) {
        throw error
      }

      flags = normalizeFlags(data?.value)
    } catch (error) {
      // Fail safe, never fail closed on the whole website: an unreadable row
      // means "no flags on", which is exactly the rollback state.
      logger.error('Failed to load website UI flags; serving none', {
        error: error instanceof Error ? error : new Error(String(error)),
      })
      flags = {}
    }

    return createApiResponse(
      { flags },
      200,
      {
        // A kill switch that a CDN keeps serving stale is not a kill switch.
        'Cache-Control': 'no-store',
      },
      req.method
    )
  }, ['read:table_bookings'], request)
}
