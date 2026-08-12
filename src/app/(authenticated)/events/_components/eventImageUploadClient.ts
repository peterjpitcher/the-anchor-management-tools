'use client'

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  confirmEventImageUpload,
  requestEventImageUpload,
} from '@/app/actions/event-image-variants'
import {
  EVENT_IMAGE_BUCKET,
  EVENT_IMAGE_VARIANTS,
  aspectRatioMatches,
  describeAspectRatio,
  formatBytes,
  type EventImageVariant,
} from '@/lib/events/imageVariants'

export interface ImageDimensions {
  width: number
  height: number
}

/**
 * Read a bitmap's dimensions without decoding it into the page. Returns zeroes
 * for anything undecodable, including PDFs, which the caller treats as "unknown"
 * rather than as a rejection.
 */
export async function readImageDimensions(file: File): Promise<ImageDimensions> {
  if (!file.type.startsWith('image/')) return { width: 0, height: 0 }

  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file)
      const dimensions = { width: bitmap.width, height: bitmap.height }
      bitmap.close?.()
      return dimensions
    } catch {
      // Fall through to the <img> route below.
    }
  }

  return new Promise((resolve) => {
    const objectUrl = URL.createObjectURL(file)
    const probe = new Image()
    probe.onload = () => {
      resolve({ width: probe.naturalWidth, height: probe.naturalHeight })
      URL.revokeObjectURL(objectUrl)
    }
    probe.onerror = () => {
      resolve({ width: 0, height: 0 })
      URL.revokeObjectURL(objectUrl)
    }
    probe.src = objectUrl
  })
}

/**
 * Client-side gate, so an obviously wrong file never starts an upload. The server
 * re-runs all of this in requestEventImageUpload; this exists for fast feedback,
 * not as the security boundary.
 */
export function validateEventImageFile(
  variant: EventImageVariant,
  file: File,
  dimensions: ImageDimensions
): string | null {
  const config = EVENT_IMAGE_VARIANTS[variant]

  if (!config.acceptedMimeTypes.includes(file.type)) {
    const accepted = config.acceptedMimeTypes
      .map((type) => type.split('/')[1].toUpperCase())
      .filter((label, index, all) => all.indexOf(label) === index)
      .join(', ')
    return `${config.label} accepts ${accepted}.`
  }

  if (file.size > config.maxBytes) {
    return `${config.label} files must be under ${formatBytes(config.maxBytes)}. That one is ${formatBytes(file.size)}.`
  }

  if (file.type !== 'application/pdf' && !aspectRatioMatches(variant, dimensions.width, dimensions.height)) {
    return `${config.label} expects a ${config.aspectLabel} image. That file is ${describeAspectRatio(dimensions.width, dimensions.height)}. Did you mean a different tile?`
  }

  return null
}

/** File input `accept` string for a variant. */
export function acceptAttribute(variant: EventImageVariant): string {
  return EVENT_IMAGE_VARIANTS[variant].acceptedMimeTypes.join(',')
}

interface UploadInput {
  supabase: SupabaseClient
  eventId: string
  variant: EventImageVariant
  file: File
  dimensions: ImageDimensions
}

/**
 * Request a signed URL, upload straight to storage, then confirm. The file never
 * passes through a serverless function, so the platform request body limit does
 * not apply.
 */
export async function uploadEventImageVariant({
  supabase,
  eventId,
  variant,
  file,
  dimensions,
}: UploadInput): Promise<{ publicUrl?: string; error?: string }> {
  const signed = await requestEventImageUpload({
    eventId,
    variant,
    fileName: file.name,
    mimeType: file.type,
    sizeBytes: file.size,
    width: dimensions.width,
    height: dimensions.height,
  })

  if ('error' in signed) {
    return { error: signed.error }
  }

  const upload = await supabase.storage
    .from(EVENT_IMAGE_BUCKET)
    .uploadToSignedUrl(signed.path, signed.token, file, {
      upsert: false,
      contentType: file.type || 'application/octet-stream',
    })

  if (upload.error) {
    return { error: upload.error.message || 'The file could not be uploaded.' }
  }

  const confirmed = await confirmEventImageUpload({
    eventId,
    variant,
    storagePath: signed.path,
    fileName: file.name,
    mimeType: file.type,
    sizeBytes: file.size,
  })

  if (confirmed.error) {
    return { error: confirmed.error }
  }

  return { publicUrl: confirmed.publicUrl }
}
