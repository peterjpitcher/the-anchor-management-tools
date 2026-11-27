'use client'

import { useState } from 'react'
import { Button, FileButton, toast } from '@/ds'
import { useSupabase } from '@/components/providers/SupabaseProvider'
import { EVENT_IMAGE_BUCKET, EVENT_IMAGE_VARIANTS } from '@/lib/events/imageVariants'
import {
  confirmEventSeriesImageUpload,
  deleteEventSeriesImage,
  requestEventSeriesImageUpload,
} from '@/app/actions/event-series-images'
import type { EventSeriesImages, EventSeriesImageVariant } from '@/lib/events/series-data'
import { acceptAttribute, readImageDimensions, validateEventImageFile } from './eventImageUploadClient'

const TILES: Array<{ variant: EventSeriesImageVariant; key: keyof EventSeriesImages; use: string }> = [
  { variant: 'square', key: 'square', use: 'The poster: What’s On cards and feed posts.' },
  { variant: 'landscape', key: 'landscape', use: 'The hero picture at the top of the website page.' },
  { variant: 'social', key: 'social', use: 'Link previews and the Facebook event cover.' },
  { variant: 'story', key: 'story', use: 'Stories and reels. Not used on the website.' },
  { variant: 'print_poster', key: 'printPoster', use: 'For printing only.' },
]

interface SeriesImagePanelProps {
  /** Null while the repeating event is being created: pictures need a saved record. */
  seriesId: string | null
  images: EventSeriesImages
  /** Called after an upload or removal, so the list reloads. */
  onChanged: () => Promise<void> | void
}

/**
 * Pictures for a repeating event. Each upload saves on its own, straight away, and is never part
 * of the form save, so saving the form cannot blank them.
 */
export function SeriesImagePanel({ seriesId, images, onChanged }: SeriesImagePanelProps) {
  const supabase = useSupabase()
  const [busy, setBusy] = useState<EventSeriesImageVariant | null>(null)
  const [shown, setShown] = useState<EventSeriesImages>(images)

  if (!seriesId) {
    return <p className="text-sm text-text-muted">Create the repeating event first, then add its pictures.</p>
  }

  async function upload(variant: EventSeriesImageVariant, key: keyof EventSeriesImages, file: File | undefined) {
    if (!file || !seriesId) return
    const dimensions = await readImageDimensions(file)
    const problem = validateEventImageFile(variant, file, dimensions)
    if (problem) {
      toast.error(problem)
      return
    }
    setBusy(variant)
    try {
      const signed = await requestEventSeriesImageUpload({
        seriesId, variant, fileName: file.name, mimeType: file.type, sizeBytes: file.size,
        width: dimensions.width, height: dimensions.height,
      })
      if ('error' in signed) {
        toast.error(signed.error)
        return
      }
      const sent = await supabase.storage
        .from(EVENT_IMAGE_BUCKET)
        .uploadToSignedUrl(signed.path, signed.token, file, { upsert: false, contentType: file.type || 'application/octet-stream' })
      if (sent.error) {
        toast.error(sent.error.message || 'The file could not be uploaded.')
        return
      }
      const confirmed = await confirmEventSeriesImageUpload({ seriesId, variant, storagePath: signed.path })
      if (confirmed.error || !confirmed.publicUrl) {
        toast.error(confirmed.error ?? 'The picture could not be saved.')
        return
      }
      setShown((prev) => ({ ...prev, [key]: confirmed.publicUrl ?? null }))
      toast.success(`${EVENT_IMAGE_VARIANTS[variant].label} saved`)
      await onChanged()
    } finally {
      setBusy(null)
    }
  }

  async function remove(variant: EventSeriesImageVariant, key: keyof EventSeriesImages) {
    if (!seriesId) return
    setBusy(variant)
    try {
      const result = await deleteEventSeriesImage({ seriesId, variant })
      if (result.error) {
        toast.error(result.error)
        return
      }
      setShown((prev) => ({ ...prev, [key]: null }))
      toast.success(`${EVENT_IMAGE_VARIANTS[variant].label} removed`)
      await onChanged()
    } finally {
      setBusy(null)
    }
  }

  return (
    <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {TILES.map(({ variant, key, use }) => {
        const config = EVENT_IMAGE_VARIANTS[variant]
        const url = shown[key]
        const isPdf = Boolean(url && /\.pdf($|\?)/i.test(url))
        return (
          <li key={variant} className="space-y-2 rounded-default border border-border p-3">
            <div>
              <p className="text-sm font-medium text-text-strong">{config.label}</p>
              <p className="text-xs text-text-muted">{config.aspectLabel}, {config.targetWidth}x{config.targetHeight}. {use}</p>
            </div>
            {url ? (
              isPdf ? (
                <a href={url} target="_blank" rel="noreferrer" className="text-sm text-primary underline">Open the PDF</a>
              ) : (
                <img src={url} alt="" className="max-h-40 w-auto rounded-default border border-border object-contain" />
              )
            ) : (
              <p className="text-sm text-text-muted">No picture yet.</p>
            )}
            <div className="flex flex-wrap gap-2">
              <FileButton
                accept={acceptAttribute(variant)}
                variant="secondary"
                size="sm"
                loading={busy === variant}
                disabled={busy !== null && busy !== variant}
                onFiles={(files) => void upload(variant, key, files[0])}
              >
                {url ? 'Replace' : 'Add'}
              </FileButton>
              {url && (
                <Button type="button" variant="ghost" size="sm" disabled={busy !== null} onClick={() => void remove(variant, key)}>
                  Remove
                </Button>
              )}
            </div>
          </li>
        )
      })}
    </ul>
  )
}
