'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { checkUserPermission } from './rbac'
import { logAuditEvent } from '@/app/actions/audit'
import {
  EVENT_IMAGE_BUCKET,
  EVENT_IMAGE_VARIANTS,
  EVENT_IMAGE_VARIANT_ORDER,
  aspectRatioMatches,
  buildEventImageStoragePath,
  describeAspectRatio,
  formatBytes,
  isOwnedByEvent,
  storagePathFromPublicUrl,
  type EventImageVariant,
} from '@/lib/events/imageVariants'
import type { Corner, LogoPlacement } from '@/lib/events/artwork/geometry'

/**
 * Uploads go browser-direct to storage via a signed URL rather than through a
 * server action. AMS is deployed on Vercel, whose serverless request body limit
 * sits well below the 25 MB an A4 print poster needs, and a server action cannot
 * raise it. This also keeps large files out of function memory entirely.
 *
 * The flow is request -> browser upload -> confirm. If the browser never
 * confirms, the object is left referenced by nothing and is picked up by the
 * reconciliation report rather than corrupting anything.
 */

const variantSchema = z.enum(
  EVENT_IMAGE_VARIANT_ORDER as unknown as [EventImageVariant, ...EventImageVariant[]]
)

const requestSchema = z.object({
  eventId: z.string().uuid(),
  variant: variantSchema,
  fileName: z.string().min(1).max(255),
  mimeType: z.string().min(1).max(255),
  sizeBytes: z.number().int().positive(),
  // Zero means "could not be read", which is not grounds for refusal.
  width: z.number().int().min(0).default(0),
  height: z.number().int().min(0).default(0),
})

export type RequestUploadInput = z.input<typeof requestSchema>

export type RequestUploadResult =
  | { error: string }
  | { path: string; token: string }

export async function requestEventImageUpload(
  input: RequestUploadInput
): Promise<RequestUploadResult> {
  try {
    if (!(await checkUserPermission('events', 'edit'))) {
      return { error: 'You do not have permission to upload event images.' }
    }

    const parsed = requestSchema.safeParse(input)
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? 'Invalid upload request.' }
    }

    const { eventId, variant, fileName, mimeType, sizeBytes, width, height } = parsed.data
    const config = EVENT_IMAGE_VARIANTS[variant]

    if (!config.acceptedMimeTypes.includes(mimeType)) {
      const accepted = config.acceptedMimeTypes
        .map((type) => type.split('/')[1].toUpperCase())
        .filter((label, index, all) => all.indexOf(label) === index)
        .join(', ')
      return { error: `${config.label} accepts ${accepted}. That file is ${mimeType}.` }
    }

    if (sizeBytes > config.maxBytes) {
      return {
        error: `${config.label} files must be under ${formatBytes(config.maxBytes)}. That one is ${formatBytes(sizeBytes)}.`,
      }
    }

    // PDFs have no readable geometry in the browser, so they are size-checked only.
    if (mimeType !== 'application/pdf' && !aspectRatioMatches(variant, width, height)) {
      return {
        error: `${config.label} expects a ${config.aspectLabel} image. That file is ${describeAspectRatio(width, height)}. Did you mean a different tile?`,
      }
    }

    const supabase = createAdminClient()

    const { data: event, error: eventError } = await supabase
      .from('events')
      .select('id')
      .eq('id', eventId)
      .maybeSingle()

    if (eventError) {
      console.error('Failed to load event for image upload:', eventError)
      return { error: 'Could not prepare the upload.' }
    }
    if (!event) {
      return { error: 'Event not found.' }
    }

    const storagePath = buildEventImageStoragePath(eventId, variant, fileName, Date.now())

    const { data, error } = await supabase.storage
      .from(EVENT_IMAGE_BUCKET)
      .createSignedUploadUrl(storagePath, { upsert: false })

    if (error || !data?.token) {
      console.error('Failed to create signed upload URL for event image:', error)
      return { error: 'Could not prepare the upload.' }
    }

    return { path: data.path ?? storagePath, token: data.token }
  } catch (error) {
    console.error('Unexpected error in requestEventImageUpload:', error)
    return { error: 'Could not prepare the upload.' }
  }
}

/**
 * Wipe the branding recorded against a variant after a fresh file is uploaded
 * over it, and remove the original that branding referred to.
 *
 * Deliberately best effort. The upload itself has already succeeded and the new
 * image is live and correct, so a failure here must never be reported to the
 * person uploading as a failed upload. The worst case is a stale badge and an
 * orphaned object, both cosmetic, and the compositor independently re-adopts a
 * newer upload as its original if it ever sees the mismatch.
 */
async function clearBrandingForFreshUpload(
  supabase: ReturnType<typeof createAdminClient>,
  eventId: string,
  variant: EventImageVariant
): Promise<void> {
  const { data: row, error: readError } = await supabase
    .from('event_images')
    .select('original_storage_path')
    .eq('event_id', eventId)
    .eq('image_type', variant)
    .maybeSingle()

  if (readError) {
    console.error('Could not read the previous branding to clear it:', readError)
    return
  }

  const staleOriginal = (row as { original_storage_path?: string | null } | null)
    ?.original_storage_path ?? null

  const { error: updateError } = await supabase
    .from('event_images')
    .update({
      original_storage_path: null,
      logo_corner: null,
      logo_centre_x_frac: null,
      logo_centre_y_frac: null,
      logo_colour: null,
      logo_width_frac: null,
      qr_centre_x_frac: null,
      qr_centre_y_frac: null,
      qr_width_frac: null,
      qr_short_link_id: null,
    })
    .eq('event_id', eventId)
    .eq('image_type', variant)

  if (updateError) {
    console.error('Could not clear branding after a replacement upload:', updateError)
    return
  }

  // Only after the row no longer references it, so a failed delete leaves an
  // orphan rather than a row pointing at a file that is gone.
  if (staleOriginal && isOwnedByEvent(staleOriginal, eventId)) {
    const { error: removeError } = await supabase.storage
      .from(EVENT_IMAGE_BUCKET)
      .remove([staleOriginal])
    if (removeError) {
      console.error('Could not remove the superseded original:', removeError)
    }
  }
}

const confirmSchema = z.object({
  eventId: z.string().uuid(),
  variant: variantSchema,
  storagePath: z.string().min(1),
  fileName: z.string().min(1).max(255),
  mimeType: z.string().min(1).max(255),
  sizeBytes: z.number().int().positive(),
})

export type ConfirmUploadInput = z.infer<typeof confirmSchema>

export async function confirmEventImageUpload(
  input: ConfirmUploadInput
): Promise<{ success?: true; publicUrl?: string; error?: string }> {
  try {
    if (!(await checkUserPermission('events', 'edit'))) {
      return { error: 'You do not have permission to upload event images.' }
    }

    const parsed = confirmSchema.safeParse(input)
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? 'Invalid upload confirmation.' }
    }

    const { eventId, variant, storagePath, fileName, mimeType, sizeBytes } = parsed.data

    // The path is echoed back by the browser, so it is re-checked here rather
    // than trusted. An event may only ever record a file inside its own folder.
    if (!storagePath.startsWith(`events/${eventId}/${variant}/`)) {
      return { error: 'That upload does not belong to this event.' }
    }

    const authClient = await createClient()
    const supabase = createAdminClient()
    const { data: { user } } = await authClient.auth.getUser()

    const { data: { publicUrl } } = supabase.storage
      .from(EVENT_IMAGE_BUCKET)
      .getPublicUrl(storagePath)

    // One transaction for the metadata row and the cache column, so the two can
    // never disagree. Returns whatever object this upload replaced.
    const { data: previousPath, error: rpcError } = await supabase.rpc(
      'upsert_event_image_variant',
      {
        p_event_id: eventId,
        p_variant: variant,
        p_storage_path: storagePath,
        p_public_url: publicUrl,
        p_file_name: fileName,
        p_mime_type: mimeType,
        p_file_size_bytes: sizeBytes,
        p_uploaded_by: user?.id ?? null,
      }
    )

    if (rpcError) {
      console.error('Failed to record event image variant:', rpcError)
      // Nothing is referencing the new object, so take it back out. Leaving it
      // would only create an orphan, never a broken image.
      const { error: cleanupError } = await supabase.storage
        .from(EVENT_IMAGE_BUCKET)
        .remove([storagePath])
      if (cleanupError) {
        console.error('Failed to clean up unrecorded event image:', cleanupError)
      }
      return { error: 'Could not save the image.' }
    }

    // The replacement is already live and correct. A failure here leaves an
    // unreachable file behind, which must never be reported as a failed upload.
    if (previousPath && previousPath !== storagePath && isOwnedByEvent(previousPath, eventId)) {
      const { error: removeError } = await supabase.storage
        .from(EVENT_IMAGE_BUCKET)
        .remove([previousPath])
      if (removeError) {
        console.error('Failed to remove replaced event image:', removeError)
      }
    }

    // A fresh upload is unbranded by definition, so any branding recorded
    // against the previous file has to go with it.
    //
    // The RPC above replaces storage_path and deletes the object it replaced,
    // but it knows nothing about the branding columns. Left alone they would
    // describe artwork that no longer exists: the tile would show a "Branded"
    // badge over a plainly unbranded picture, and original_storage_path would
    // still point at the ORIGINAL of the previous upload. That old original is
    // not the object the RPC returned, so nothing else deletes it either.
    //
    // Its own try/catch, not the outer one. The upload has already committed and
    // the new image is live, so nothing this does may turn a successful upload
    // into a reported failure.
    try {
      await clearBrandingForFreshUpload(supabase, eventId, variant)
    } catch (brandingError) {
      console.error('Could not clear branding after a replacement upload:', brandingError)
    }

    if (user) {
      await logAuditEvent({
        user_id: user.id,
        user_email: user.email!,
        operation_type: 'upload',
        resource_type: 'event',
        resource_id: eventId,
        operation_status: 'success',
        new_values: { variant, fileName, sizeBytes, mimeType },
        additional_info: { storagePath, replacedStoragePath: previousPath ?? null },
      })
    }

    revalidatePath('/events')
    revalidatePath(`/events/${eventId}`)

    return { success: true, publicUrl }
  } catch (error) {
    console.error('Unexpected error in confirmEventImageUpload:', error)
    return { error: 'Could not save the image.' }
  }
}

export async function deleteEventImageVariant(
  eventId: string,
  variant: EventImageVariant
): Promise<{ success?: true; error?: string }> {
  try {
    if (!(await checkUserPermission('events', 'edit'))) {
      return { error: 'You do not have permission to delete event images.' }
    }

    const parsed = z
      .object({ eventId: z.string().uuid(), variant: variantSchema })
      .safeParse({ eventId, variant })
    if (!parsed.success) {
      return { error: 'Invalid delete request.' }
    }

    const authClient = await createClient()
    const supabase = createAdminClient()

    // Clears the reference and the metadata together, and hands back the object
    // to remove. Null when the event owns no file for that variant, which is the
    // case for artwork inherited from the category.
    const { data: storagePath, error: rpcError } = await supabase.rpc(
      'delete_event_image_variant',
      { p_event_id: eventId, p_variant: variant }
    )

    if (rpcError) {
      console.error('Failed to clear event image variant:', rpcError)
      return { error: 'Could not remove the image.' }
    }

    // Only ever remove a file this event owns. An inherited category image is
    // shared with the category and with every other event in it.
    if (storagePath && isOwnedByEvent(storagePath, eventId)) {
      const { error: removeError } = await supabase.storage
        .from(EVENT_IMAGE_BUCKET)
        .remove([storagePath])
      // The reference is already gone, so the delete has succeeded regardless.
      if (removeError) {
        console.error('Failed to remove event image from storage:', removeError)
      }
    }

    const { data: { user } } = await authClient.auth.getUser()
    if (user) {
      await logAuditEvent({
        user_id: user.id,
        user_email: user.email!,
        operation_type: 'delete',
        resource_type: 'event',
        resource_id: eventId,
        operation_status: 'success',
        old_values: { variant },
        additional_info: {
          storagePath: storagePath ?? null,
          storageObjectRemoved: Boolean(storagePath && isOwnedByEvent(storagePath, eventId)),
        },
      })
    }

    revalidatePath('/events')
    revalidatePath(`/events/${eventId}`)

    return { success: true }
  } catch (error) {
    console.error('Unexpected error in deleteEventImageVariant:', error)
    return { error: 'Could not remove the image.' }
  }
}

export type EventImageLogoColour = 'white' | 'black'

/**
 * What is already stamped on an image, read back so the branding editor opens
 * showing the placement that is actually on the file.
 *
 * `logo` and `qr` are independently nullable, and the whole object is null when
 * the image has never been branded. That is the distinction the editor needs:
 * "never branded" opens at the defaults, "branded with no logo" opens with No
 * logo selected, and the two are not the same thing.
 */
export interface EventImageBrandingState {
  /**
   * The untouched upload kept behind the composite, so a re-brand is always
   * composited from the original. Null on an image that has never been branded.
   */
  originalStoragePath: string | null
  logo: { placement: LogoPlacement; colour: EventImageLogoColour } | null
  qr: {
    centreXFrac: number
    centreYFrac: number
    widthFrac: number
    shortLinkId: string | null
  } | null
}

export interface EventImageVariantState {
  variant: EventImageVariant
  url: string | null
  /** False when the artwork came from the category and is shared with other events. */
  owned: boolean
  categoryName: string | null
  fileName: string | null
  sizeBytes: number | null
  mimeType: string | null
  updatedAt: string | null
  /** Null when this image carries no branding at all. */
  branding: EventImageBrandingState | null
}

/**
 * The `event_images` columns this action reads, hand written.
 *
 * Migration `20260906095746_event_image_branding.sql` adds the ten branding
 * columns and has not been applied to any database, so
 * `src/types/database.generated.ts` does not carry them and the generated row
 * type cannot describe this select. `snake_case` to `camelCase` is mapped by
 * hand below, as everywhere else in this repo. Do not regenerate the types to
 * make this go away: that would claim the migration is applied when it is not.
 */
interface EventImageMetadataRow {
  image_type: string | null
  storage_path: string | null
  file_name: string | null
  file_size_bytes: number | null
  mime_type: string | null
  updated_at: string | null
  original_storage_path: string | null
  logo_corner: string | null
  logo_centre_x_frac: number | null
  logo_centre_y_frac: number | null
  logo_colour: string | null
  logo_width_frac: number | null
  qr_centre_x_frac: number | null
  qr_centre_y_frac: number | null
  qr_width_frac: number | null
  qr_short_link_id: string | null
}

const EVENT_IMAGE_SELECT =
  'image_type, storage_path, file_name, file_size_bytes, mime_type, updated_at, original_storage_path, logo_corner, logo_centre_x_frac, logo_centre_y_frac, logo_colour, logo_width_frac, qr_centre_x_frac, qr_centre_y_frac, qr_width_frac, qr_short_link_id'

const LOGO_CORNERS: readonly Corner[] = [
  'top_left',
  'top_right',
  'bottom_left',
  'bottom_right',
]

function isFraction(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/**
 * Rebuild the logo placement union from the columns.
 *
 * The database stores a corner XOR a centre pair, held apart by
 * `event_images_logo_placement_exclusive`, and requires a colour and a width
 * alongside either. Anything else can only come from a write that went round
 * the constraint, so it is reported as unplaced and warned about rather than
 * guessed at: inventing a placement would silently move a logo the next time
 * someone pressed Save.
 */
function readLogo(
  row: EventImageMetadataRow,
  eventId: string,
  variant: EventImageVariant
): { placement: LogoPlacement; colour: EventImageLogoColour } | null {
  const corner = row.logo_corner
  const hasCorner = typeof corner === 'string' && corner.length > 0
  const hasCentreX = isFraction(row.logo_centre_x_frac)
  const hasCentreY = isFraction(row.logo_centre_y_frac)

  if (!hasCorner && !hasCentreX && !hasCentreY) return null

  const colour =
    row.logo_colour === 'white' || row.logo_colour === 'black' ? row.logo_colour : null
  const widthFrac = isFraction(row.logo_width_frac) ? row.logo_width_frac : null
  const contradictory = (hasCorner && (hasCentreX || hasCentreY)) || hasCentreX !== hasCentreY
  const cornerKnown = hasCorner && LOGO_CORNERS.includes(corner as Corner)

  if (contradictory || colour === null || widthFrac === null || (hasCorner && !cornerKnown)) {
    console.warn('Unusable logo branding on an event image, treating the logo as unplaced.', {
      eventId,
      variant,
      logoCorner: corner,
      hasCentreX,
      hasCentreY,
      hasColour: colour !== null,
      hasWidth: widthFrac !== null,
    })
    return null
  }

  if (hasCorner) {
    return { placement: { mode: 'corner', corner: corner as Corner, widthFrac }, colour }
  }

  return {
    placement: {
      mode: 'free',
      centreXFrac: row.logo_centre_x_frac as number,
      centreYFrac: row.logo_centre_y_frac as number,
      widthFrac,
    },
    colour,
  }
}

/** The three QR columns are written together or not at all, so read them that way. */
function readQr(
  row: EventImageMetadataRow,
  eventId: string,
  variant: EventImageVariant
): EventImageBrandingState['qr'] {
  const hasCentreX = isFraction(row.qr_centre_x_frac)
  const hasCentreY = isFraction(row.qr_centre_y_frac)
  const hasWidth = isFraction(row.qr_width_frac)

  if (!hasCentreX && !hasCentreY && !hasWidth) return null

  if (!hasCentreX || !hasCentreY || !hasWidth) {
    console.warn('Incomplete QR branding on an event image, treating the code as unplaced.', {
      eventId,
      variant,
      hasCentreX,
      hasCentreY,
      hasWidth,
    })
    return null
  }

  return {
    centreXFrac: row.qr_centre_x_frac as number,
    centreYFrac: row.qr_centre_y_frac as number,
    widthFrac: row.qr_width_frac as number,
    shortLinkId: row.qr_short_link_id ?? null,
  }
}

function readBranding(
  row: EventImageMetadataRow | undefined,
  eventId: string,
  variant: EventImageVariant
): EventImageBrandingState | null {
  if (!row) return null

  // Any branding column carrying a value means this image has been through the
  // editor, even when the answer was "no logo and no QR code".
  const branded = [
    row.original_storage_path,
    row.logo_corner,
    row.logo_centre_x_frac,
    row.logo_centre_y_frac,
    row.logo_colour,
    row.logo_width_frac,
    row.qr_centre_x_frac,
    row.qr_centre_y_frac,
    row.qr_width_frac,
    row.qr_short_link_id,
  ].some((value) => value !== null && value !== undefined)

  if (!branded) return null

  return {
    originalStoragePath: row.original_storage_path ?? null,
    logo: readLogo(row, eventId, variant),
    qr: readQr(row, eventId, variant),
  }
}

export async function getEventImageVariants(
  eventId: string
): Promise<{ data?: EventImageVariantState[]; error?: string }> {
  try {
    if (!(await checkUserPermission('events', 'edit'))) {
      return { error: 'You do not have permission to view event images.' }
    }

    const supabase = createAdminClient()

    const [{ data: event, error: eventError }, { data: rows, error: rowsError }] =
      await Promise.all([
        supabase
          .from('events')
          .select(
            'hero_image_url, landscape_image_url, social_image_url, story_image_url, print_poster_url, table_talker_url, category:event_categories(name)'
          )
          .eq('id', eventId)
          .maybeSingle(),
        supabase.from('event_images').select(EVENT_IMAGE_SELECT).eq('event_id', eventId),
      ])

    if (eventError || rowsError) {
      console.error('Failed to load event images:', eventError ?? rowsError)
      return { error: 'Could not load the images for this event.' }
    }
    if (!event) {
      return { error: 'Event not found.' }
    }

    const metadataRows = (rows ?? []) as unknown as EventImageMetadataRow[]
    const metadataByVariant = new Map(
      metadataRows.map((row) => [row.image_type as string, row])
    )

    // `events` is authoritative for which file an event is using: 51 events have a
    // live image but only 36 have a metadata row, so reading event_images alone
    // would show an empty tile for artwork the website is happily rendering.
    const eventRow = event as unknown as Record<string, unknown>
    // PostgREST returns an embedded to-one relation as an array in some shapes.
    const rawCategory = eventRow.category
    const categoryName =
      (Array.isArray(rawCategory)
        ? (rawCategory[0] as { name?: string } | undefined)?.name
        : (rawCategory as { name?: string } | null)?.name) ?? null

    const data = EVENT_IMAGE_VARIANT_ORDER.map<EventImageVariantState>((variant) => {
      const rawUrl = eventRow[EVENT_IMAGE_VARIANTS[variant].cacheColumn]
      const url = typeof rawUrl === 'string' && rawUrl.length > 0 ? rawUrl : null
      const metadata = metadataByVariant.get(variant)
      const storagePath = metadata?.storage_path ?? storagePathFromPublicUrl(url)
      const owned = Boolean(url) && isOwnedByEvent(storagePath, eventId)

      return {
        variant,
        url,
        owned,
        categoryName: url && !owned ? categoryName : null,
        fileName: metadata?.file_name ?? null,
        sizeBytes: metadata?.file_size_bytes ?? null,
        mimeType: metadata?.mime_type ?? null,
        updatedAt: metadata?.updated_at ?? null,
        branding: readBranding(metadata, eventId, variant),
      }
    })

    return { data }
  } catch (error) {
    console.error('Unexpected error in getEventImageVariants:', error)
    return { error: 'Could not load the images for this event.' }
  }
}
