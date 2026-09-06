/**
 * POST /api/events/{id}/artwork/composite
 *
 * Brands one event image variant, or takes the branding off again.
 *
 * The body is a small JSON placement and NEVER image bytes. Vercel's platform
 * body limit is 4.49MB and it is enforced at the proxy before the function is
 * invoked, so no server-side handler would ever see an oversized body and no
 * error message could explain one. Uploads already go browser-direct to storage
 * through a signed URL for the same reason, and this route reads the image it
 * needs out of storage itself.
 *
 * A route rather than a server action because compositing an A4 poster is real
 * CPU work that needs `maxDuration`, and because the placement editor calls it
 * repeatedly while someone drags things around and wants to cancel the responses
 * it has already moved past. Both of those are awkward through a server action.
 *
 * All the work lives in `src/lib/events/artwork/branding-service.ts`. This file
 * is the HTTP edge: permission, parse, dispatch, revalidate.
 */

import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireModulePermission } from '@/lib/api/permissions'
import {
  applyEventImageBranding,
  revertEventImageBranding,
  type BrandingResult,
} from '@/lib/events/artwork/branding-service'
// The placement bounds come from geometry.ts rather than being written out
// again here. They are the same numbers as the CHECK constraints in
// the branding and QR size migrations, and a copy that drifts would either
// reject a legal placement with a 400 or accept one the database then refuses.
import {
  LOGO_MAX_WIDTH_FRAC,
  LOGO_MIN_WIDTH_FRAC,
  QR_MAX_WIDTH_FRAC,
  QR_MIN_WIDTH_FRAC,
} from '@/lib/events/artwork/geometry'
import {
  EVENT_IMAGE_VARIANT_ORDER,
  type EventImageVariant,
} from '@/lib/events/imageVariants'

/** sharp is a native module, so this must never run on the edge runtime. */
export const runtime = 'nodejs'

/**
 * Five minutes. Compositing a full A4 poster is seconds of CPU, but a cold start
 * that has to load sharp on top of a large download has no business failing on
 * the default limit and leaving a half-branded tile behind.
 */
export const maxDuration = 300

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const variantSchema = z.enum(
  EVENT_IMAGE_VARIANT_ORDER as unknown as [EventImageVariant, ...EventImageVariant[]]
)

/**
 * Every bound below matches a CHECK constraint in
 * `the branding and QR size migrations` exactly.
 *
 * Kept in step on purpose: a value that passes here is guaranteed to survive the
 * UPDATE that records it, so the only way to hit a constraint violation is a
 * programming error rather than bad input. Geometry clamps these again when it
 * draws, but a clamp silently changes what the person asked for, and a request
 * outside the range is a broken client rather than a placement to be corrected.
 */
const cornerPlacementSchema = z.object({
  mode: z.literal('corner'),
  corner: z.enum(['top_left', 'top_right', 'bottom_left', 'bottom_right']),
  widthFrac: z.number().min(LOGO_MIN_WIDTH_FRAC).max(LOGO_MAX_WIDTH_FRAC),
})

const freePlacementSchema = z.object({
  mode: z.literal('free'),
  centreXFrac: z.number().min(0).max(1),
  centreYFrac: z.number().min(0).max(1),
  widthFrac: z.number().min(LOGO_MIN_WIDTH_FRAC).max(LOGO_MAX_WIDTH_FRAC),
})

const logoSchema = z.object({
  placement: z.discriminatedUnion('mode', [cornerPlacementSchema, freePlacementSchema]),
  colour: z.enum(['white', 'black']),
})

const qrSchema = z.object({
  centreXFrac: z.number().min(0).max(1),
  centreYFrac: z.number().min(0).max(1),
  // Share the editor's 10% minimum and 40% maximum.
  widthFrac: z.number().min(QR_MIN_WIDTH_FRAC).max(QR_MAX_WIDTH_FRAC),
})

const revertSchema = z.object({
  variant: variantSchema,
  action: z.literal('revert'),
})

const applySchema = z.object({
  variant: variantSchema,
  action: z.literal('apply').optional(),
  // Both are required and explicitly nullable rather than optional: "no logo" is
  // a choice a person makes, and it must not be indistinguishable from a client
  // that forgot to send the field.
  logo: logoSchema.nullable(),
  qr: qrSchema.nullable(),
})

const requestSchema = z.union([revertSchema, applySchema])

/**
 * Failures carry the same sentence twice, as `error` and as `detail`.
 *
 * `error` is what every other route handler in this app returns and what a
 * generic client looks for; `detail` is what the placement editor shows the
 * manager verbatim, because a 422 here explains something they can act on ("the
 * event is still a draft", "the QR is too close to the logo") and paraphrasing
 * it into "something went wrong" throws that away. One of the two can go once
 * both ends are settled.
 */
function errorResponse(message: string, code: string, status: number, reason?: string) {
  return NextResponse.json(
    reason
      ? { error: message, detail: message, code, reason }
      : { error: message, detail: message, code },
    { status }
  )
}

function respond(result: BrandingResult): NextResponse {
  if (!result.ok) {
    return errorResponse(result.error, result.code, result.status, result.reason)
  }

  return NextResponse.json({
    success: true,
    variant: result.variant,
    branded: result.branded,
    // The new live file. Named `url` because that is what the editor swaps its
    // preview to; `publicUrl` matches what `confirmEventImageUpload` returns, so
    // the two paths read the same either way.
    url: result.imageUrl,
    publicUrl: result.imageUrl,
    storagePath: result.storagePath,
    originalStoragePath: result.originalStoragePath,
    width: result.width,
    height: result.height,
    bytes: result.bytes,
    qr: result.qr,
    placementSaved: result.placementSaved,
  })
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id: eventId } = await context.params

  if (!UUID_PATTERN.test(eventId)) {
    return errorResponse('That is not a valid event id.', 'invalid_event_id', 400)
  }

  // Before anything reads storage or the database, and the same permission the
  // upload path checks.
  const permission = await requireModulePermission('events', 'edit')
  if (!permission.ok) {
    return permission.response
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return errorResponse('The request body was not valid JSON.', 'invalid_body', 400)
  }

  const parsed = requestSchema.safeParse(body)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    const where = issue?.path.join('.') || 'request'
    return errorResponse(
      `${where}: ${issue?.message ?? 'Invalid branding request.'}`,
      'invalid_request',
      400
    )
  }

  try {
    if ('action' in parsed.data && parsed.data.action === 'revert') {
      const result = await revertEventImageBranding({
        eventId,
        variant: parsed.data.variant,
        userId: permission.userId,
      })
      if (result.ok) revalidateEvent(eventId)
      return respond(result)
    }

    const result = await applyEventImageBranding({
      eventId,
      variant: parsed.data.variant,
      logo: parsed.data.logo,
      qr: parsed.data.qr,
      userId: permission.userId,
    })
    if (result.ok) revalidateEvent(eventId)
    return respond(result)
  } catch (error) {
    console.error('[events:artwork:composite] unexpected failure', eventId, error)
    return errorResponse(
      'Something went wrong while branding this image. Try again.',
      'unexpected_error',
      500
    )
  }
}

function revalidateEvent(eventId: string): void {
  revalidatePath('/events')
  revalidatePath(`/events/${eventId}`)
}
