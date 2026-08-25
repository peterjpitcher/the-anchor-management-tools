/**
 * GET /api/events/{idOrSlug}/artwork
 *
 * The designed artwork kit for one event: square, story and landscape.
 *
 * Deliberately a separate route rather than a conditional block on
 * /api/events/{id}. That endpoint is cached with `public, max-age=60` and an
 * ETag, and varies only on Origin. A body that changed shape with the caller's
 * scopes would let a shared cache hand the website's copy to CheersAI, or the
 * reverse, with no way for either to tell. Splitting the route keeps every
 * existing representation single-shaped and lets this one be `private,
 * no-store` throughout.
 *
 * Three outcomes the consumer must be able to tell apart:
 *   403  the key lacks read:events:artwork
 *   404  no such event, or an AMS that predates this route
 *   200  authorised; `variants` always carries all three keys, each a full
 *        object or an explicit null
 *
 * Without that separation, "this event has no artwork" and "artwork import is
 * not wired up" look identical, and the feature can die silently.
 */

import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { withApiAuth, createApiResponse, createErrorResponse } from '@/lib/api/auth'
import {
  buildEventArtworkPayload,
  EVENT_ARTWORK_VARIANTS,
  type EventArtworkEventRow,
  type EventArtworkImageRow,
} from '@/lib/api/eventArtworkFields'

const ARTWORK_SCOPE = 'read:events:artwork'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Every response from this route is caller-dependent, so none may be shared. */
function artworkResponse(data: unknown, status = 200) {
  return createApiResponse(data, status, {}, 'GET', 'private')
}

function artworkError(message: string, code: string, status: number) {
  return createErrorResponse(message, code, status, undefined, 'private')
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  return withApiAuth(
    async (_req, apiKey) => {
      const hasArtworkScope =
        apiKey.permissions.includes(ARTWORK_SCOPE) || apiKey.permissions.includes('*')

      if (!hasArtworkScope) {
        return artworkError(
          `This API key is not permitted to read event artwork. Grant the ${ARTWORK_SCOPE} scope.`,
          'FORBIDDEN',
          403
        )
      }

      const params = await context.params
      const supabase = createAdminClient()

      // Same lookup rule as the detail route: events.id is a uuid column, so a
      // slug value handed to an id lookup raises a type error and would surface
      // a 500 for what is really a missing event.
      const selection = 'id, slug, hero_image_url, story_image_url, landscape_image_url'
      const { data: event, error } = UUID_PATTERN.test(params.id)
        ? await supabase.from('events').select(selection).eq('id', params.id).maybeSingle()
        : await supabase.from('events').select(selection).eq('slug', params.id).maybeSingle()

      if (error) {
        return artworkError('Failed to load event artwork', 'DATABASE_ERROR', 500)
      }

      if (!event) {
        return artworkError('Event not found', 'NOT_FOUND', 404)
      }

      const eventRow = event as EventArtworkEventRow

      const { data: imageRows, error: imagesError } = await supabase
        .from('event_images')
        .select('image_type, file_name, mime_type, file_size_bytes, updated_at, created_at')
        .eq('event_id', eventRow.id)
        .in('image_type', [...EVENT_ARTWORK_VARIANTS])

      // Metadata is descriptive only. Losing it costs the consumer the mime
      // type, size and revision timestamp, which downgrades each variant to
      // `inherited`; it must not cost it the URLs, which come from the event row.
      if (imagesError) {
        console.error('[events:artwork] failed to load event_images', imagesError)
      }

      return artworkResponse(
        buildEventArtworkPayload(
          eventRow,
          Array.isArray(imageRows) ? (imageRows as EventArtworkImageRow[]) : []
        )
      )
    },
    ['read:events'],
    request,
    { cacheMode: 'private' }
  )
}
