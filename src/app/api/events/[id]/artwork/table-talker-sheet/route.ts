/**
 * GET /api/events/{id}/artwork/table-talker-sheet
 *
 * The event's branded table talker, three to an A4 landscape sheet, as a PDF
 * ready for the office printer. Nothing is stored: the sheet is drawn from the
 * live table talker on every request, so it can never fall out of step with
 * the branding.
 *
 * Refuses rather than prints in three cases, each with a sentence a manager
 * can act on:
 *
 *   409  there is no table talker yet, or it has not been branded. The owner's
 *        rule is that nothing is printed before the logo and QR code are on it,
 *        and the test is the storage path: composites live in the `branded/`
 *        folder and nothing else ever does, the same rule the branding service
 *        uses to tell a composite from an original.
 *   422  the file would print below 150dpi, which looks soft on the table.
 *   502  storage could not hand the file over.
 *
 * `/api` is public at the middleware level, so the permission check here is
 * the only gate. Viewing events is enough, as for the guest list PDF.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireModulePermission } from '@/lib/api/permissions'
import { MIN_PRINT_DPI, MIN_PRINT_WIDTH_PX } from '@/lib/events/artwork/print-sheet'
import { buildTableTalkerSheetPdf, sniffSheetImageFormat } from '@/lib/events/artwork/table-talker-pdf'
import {
  EVENT_IMAGE_BUCKET,
  buildTableTalkerSheetFileName,
  isBrandedCompositePath,
  storagePathFromPublicUrl,
} from '@/lib/events/imageVariants'

/** pdf-lib and a storage download: Node only. */
export const runtime = 'nodejs'

/** Seconds. Drawing the sheet takes milliseconds; the download is most of it. */
export const maxDuration = 60

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Nothing about this route may be cached: it depends on who asks and on live artwork. */
const NO_STORE = { 'Cache-Control': 'private, no-store' }

function refuse(message: string, code: string, status: number): NextResponse {
  return NextResponse.json({ error: message, code }, { status, headers: NO_STORE })
}

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id: eventId } = await context.params

  if (!UUID_PATTERN.test(eventId)) {
    return refuse('That is not a valid event id.', 'invalid_event_id', 400)
  }

  const permission = await requireModulePermission('events', 'view')
  if (!permission.ok) {
    return permission.response
  }
  const supabase = permission.supabase

  try {
    const { data: event, error: eventError } = await supabase
      .from('events')
      .select('id, name, table_talker_url')
      .eq('id', eventId)
      .maybeSingle()

    if (eventError) {
      console.error('[artwork:table-talker-sheet] failed to load the event', eventId, eventError)
      return refuse('Could not load this event. Try again in a moment.', 'event_load_failed', 500)
    }
    if (!event) {
      return refuse('Event not found.', 'event_not_found', 404)
    }

    const storagePath = storagePathFromPublicUrl(event.table_talker_url)
    if (!storagePath) {
      return refuse(
        'There is no table talker on this event yet. Upload one in the event artwork first.',
        'table_talker_missing',
        409
      )
    }

    // This event's own table talker, and a composite: anything else is either
    // someone else's file or artwork nobody has branded yet.
    // `event.id`, not the request's id: the database's canonical lower case is
    // what storage paths are built from.
    if (!storagePath.startsWith(`events/${event.id}/table_talker/`) || !isBrandedCompositePath(storagePath)) {
      return refuse(
        'Brand the table talker before printing it: open Branding on the table talker, place the logo and QR code, and save.',
        'table_talker_unbranded',
        409
      )
    }

    const { data: file, error: downloadError } = await supabase.storage
      .from(EVENT_IMAGE_BUCKET)
      .download(storagePath)

    if (downloadError || !file) {
      console.error('[artwork:table-talker-sheet] failed to download the table talker', storagePath, downloadError)
      return refuse('Could not read the table talker from storage. Try again in a moment.', 'storage_failed', 502)
    }

    const image = Buffer.from(await file.arrayBuffer())
    const format = sniffSheetImageFormat(image)
    if (!format) {
      return refuse(
        'The branded table talker is not a PNG or JPEG, so it cannot be printed. Brand it again.',
        'image_unsupported',
        422
      )
    }

    const { bytes, layout } = await buildTableTalkerSheetPdf({ image, format, eventName: event.name })

    if (layout.dpi < MIN_PRINT_DPI) {
      return refuse(
        `This table talker would print at ${Math.floor(layout.dpi)} dpi, which looks soft. Upload one at least ${MIN_PRINT_WIDTH_PX} px wide (1169 x 2480 is ideal), brand it, then print.`,
        'resolution_too_low',
        422
      )
    }

    return new NextResponse(new Blob([Buffer.from(bytes)], { type: 'application/pdf' }), {
      status: 200,
      headers: {
        ...NO_STORE,
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${buildTableTalkerSheetFileName(event.name)}"`,
      },
    })
  } catch (error) {
    console.error('[artwork:table-talker-sheet] failed to build the sheet', eventId, error)
    return refuse('Could not build the table talker sheet. Try again in a moment.', 'sheet_failed', 500)
  }
}
