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
            'hero_image_url, landscape_image_url, social_image_url, story_image_url, print_poster_url, category:event_categories(name)'
          )
          .eq('id', eventId)
          .maybeSingle(),
        supabase
          .from('event_images')
          .select('image_type, storage_path, file_name, file_size_bytes, mime_type, updated_at')
          .eq('event_id', eventId),
      ])

    if (eventError || rowsError) {
      console.error('Failed to load event images:', eventError ?? rowsError)
      return { error: 'Could not load the images for this event.' }
    }
    if (!event) {
      return { error: 'Event not found.' }
    }

    const metadataByVariant = new Map(
      (rows ?? []).map((row) => [row.image_type as string, row])
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
      }
    })

    return { data }
  } catch (error) {
    console.error('Unexpected error in getEventImageVariants:', error)
    return { error: 'Could not load the images for this event.' }
  }
}
