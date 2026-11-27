'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { getCurrentUser } from '@/lib/supabase/current-user'
import { checkUserPermission } from '@/app/actions/rbac'
import { logAuditEvent } from '@/app/actions/audit'
import {
  EVENT_IMAGE_BUCKET,
  EVENT_IMAGE_VARIANTS,
  aspectRatioMatches,
  describeAspectRatio,
  formatBytes,
  sanitiseFileName,
  storagePathFromPublicUrl,
} from '@/lib/events/imageVariants'
import { EVENT_SERIES_IMAGE_COLUMNS, type EventSeriesImageVariant } from '@/lib/events/series-data'

/**
 * Pictures for a repeating event: the same files and sizes as a normal event's web and print
 * artwork (square, landscape, social, story, A4 poster), without the branding, QR and table-talker
 * tooling, which belongs to dated events with bookings.
 *
 * The same request, browser upload, confirm flow as event images (event-image-variants.ts), so a
 * 25 MB poster never passes through a serverless function. Files live under
 * event-series/<id>/<variant>/ in the event-images bucket, and the public URL is cached on the
 * event_series row. Only these actions write the image columns; the form save never does.
 */

const variantSchema = z.enum(['square', 'landscape', 'social', 'story', 'print_poster'])

const requestSchema = z.object({
  seriesId: z.string().uuid(),
  variant: variantSchema,
  fileName: z.string().min(1).max(255),
  mimeType: z.string().min(1).max(255),
  sizeBytes: z.number().int().positive(),
  // Zero means "could not be read" (a PDF), which is not grounds for refusal.
  width: z.number().int().min(0).default(0),
  height: z.number().int().min(0).default(0),
})

function folderFor(seriesId: string, variant: EventSeriesImageVariant): string {
  return `event-series/${seriesId}/${variant}/`
}

async function requireEdit(): Promise<{ userId: string; email: string | null } | { error: string }> {
  const { user } = await getCurrentUser()
  if (!user) return { error: 'Unauthorized' }
  if (!(await checkUserPermission('events', 'edit', user.id))) {
    return { error: 'You do not have permission to change repeating event pictures.' }
  }
  return { userId: user.id, email: user.email ?? null }
}

async function seriesExists(seriesId: string): Promise<boolean | null> {
  const { data, error } = await createAdminClient().from('event_series').select('id').eq('id', seriesId).maybeSingle()
  if (error) return null
  return Boolean(data)
}

export async function requestEventSeriesImageUpload(
  input: z.input<typeof requestSchema>
): Promise<{ path: string; token: string } | { error: string }> {
  const actor = await requireEdit()
  if ('error' in actor) return actor

  const parsed = requestSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid upload request.' }
  const { seriesId, variant, fileName, mimeType, sizeBytes, width, height } = parsed.data
  const config = EVENT_IMAGE_VARIANTS[variant]

  if (!config.acceptedMimeTypes.includes(mimeType)) {
    const accepted = config.acceptedMimeTypes
      .map((type) => type.split('/')[1].toUpperCase())
      .filter((label, index, all) => all.indexOf(label) === index)
      .join(', ')
    return { error: `${config.label} accepts ${accepted}. That file is ${mimeType}.` }
  }
  if (sizeBytes > config.maxBytes) {
    return { error: `${config.label} files must be under ${formatBytes(config.maxBytes)}. That one is ${formatBytes(sizeBytes)}.` }
  }
  if (mimeType !== 'application/pdf' && !aspectRatioMatches(variant, width, height)) {
    return {
      error: `${config.label} expects a ${config.aspectLabel} image. That file is ${describeAspectRatio(width, height)}. Did you mean a different tile?`,
    }
  }

  const exists = await seriesExists(seriesId)
  if (exists === null) return { error: 'Could not prepare the upload.' }
  if (!exists) return { error: 'Repeating event not found.' }

  const storagePath = `${folderFor(seriesId, variant)}${Date.now()}_${sanitiseFileName(fileName)}`
  const { data, error } = await createAdminClient()
    .storage.from(EVENT_IMAGE_BUCKET)
    .createSignedUploadUrl(storagePath, { upsert: false })
  if (error || !data?.token) {
    console.error('[event-series-images] signed upload URL failed', { message: error?.message })
    return { error: 'Could not prepare the upload.' }
  }
  return { path: data.path ?? storagePath, token: data.token }
}

const confirmSchema = z.object({
  seriesId: z.string().uuid(),
  variant: variantSchema,
  storagePath: z.string().min(1),
})

/** Records an uploaded file on the repeating event and removes the file it replaced. */
export async function confirmEventSeriesImageUpload(
  input: z.input<typeof confirmSchema>
): Promise<{ success?: true; publicUrl?: string; error?: string }> {
  const actor = await requireEdit()
  if ('error' in actor) return actor

  const parsed = confirmSchema.safeParse(input)
  if (!parsed.success) return { error: 'Invalid upload confirmation.' }
  const { seriesId, variant, storagePath } = parsed.data

  // The path is echoed back by the browser, so it is re-checked rather than trusted.
  if (!storagePath.startsWith(folderFor(seriesId, variant)) || storagePath.includes('..')) {
    return { error: 'That upload does not belong to this repeating event.' }
  }

  const db = createAdminClient()
  const column = EVENT_SERIES_IMAGE_COLUMNS[variant]
  const { data: current, error: readError } = await db.from('event_series').select(column).eq('id', seriesId).maybeSingle()
  if (readError || !current) return { error: readError ? 'The picture could not be saved.' : 'Repeating event not found.' }
  const previousUrl = (current as unknown as Record<string, string | null>)[column] ?? null

  const { data: { publicUrl } } = db.storage.from(EVENT_IMAGE_BUCKET).getPublicUrl(storagePath)
  const { error } = await db.from('event_series').update({ [column]: publicUrl }).eq('id', seriesId)
  if (error) {
    console.error('[event-series-images] confirm failed', { code: error.code, message: error.message })
    await db.storage.from(EVENT_IMAGE_BUCKET).remove([storagePath])
    return { error: 'The picture could not be saved.' }
  }

  // Only ever remove a file from this event's own folder: a URL pasted from elsewhere is left alone.
  const previousPath = storagePathFromPublicUrl(previousUrl)
  if (previousPath && previousPath !== storagePath && previousPath.startsWith(folderFor(seriesId, variant))) {
    const { error: removeError } = await db.storage.from(EVENT_IMAGE_BUCKET).remove([previousPath])
    if (removeError) console.error('[event-series-images] old file not removed', { previousPath, message: removeError.message })
  }

  await logAuditEvent({
    user_id: actor.userId,
    ...(actor.email ? { user_email: actor.email } : {}),
    operation_type: 'upload_image',
    resource_type: 'event_series',
    resource_id: seriesId,
    operation_status: 'success',
    additional_info: { variant, storagePath, replaced: previousPath ?? null },
  })
  revalidatePath('/events')
  return { success: true, publicUrl }
}

/** Takes a picture off the repeating event and deletes its file. */
export async function deleteEventSeriesImage(input: {
  seriesId: string
  variant: EventSeriesImageVariant
}): Promise<{ success?: true; error?: string }> {
  const actor = await requireEdit()
  if ('error' in actor) return actor
  const parsed = z.object({ seriesId: z.string().uuid(), variant: variantSchema }).safeParse(input)
  if (!parsed.success) return { error: 'Invalid request.' }
  const { seriesId, variant } = parsed.data

  const db = createAdminClient()
  const column = EVENT_SERIES_IMAGE_COLUMNS[variant]
  const { data: current, error: readError } = await db.from('event_series').select(column).eq('id', seriesId).maybeSingle()
  if (readError || !current) return { error: readError ? 'The picture could not be removed.' : 'Repeating event not found.' }
  const previousUrl = (current as unknown as Record<string, string | null>)[column] ?? null

  const { error } = await db.from('event_series').update({ [column]: null }).eq('id', seriesId)
  if (error) return { error: 'The picture could not be removed.' }

  const previousPath = storagePathFromPublicUrl(previousUrl)
  if (previousPath && previousPath.startsWith(folderFor(seriesId, variant))) {
    const { error: removeError } = await db.storage.from(EVENT_IMAGE_BUCKET).remove([previousPath])
    if (removeError) console.error('[event-series-images] file not removed', { previousPath, message: removeError.message })
  }

  await logAuditEvent({
    user_id: actor.userId,
    ...(actor.email ? { user_email: actor.email } : {}),
    operation_type: 'delete_image',
    resource_type: 'event_series',
    resource_id: seriesId,
    operation_status: 'success',
    additional_info: { variant, removed: previousPath ?? null },
  })
  revalidatePath('/events')
  return { success: true }
}
