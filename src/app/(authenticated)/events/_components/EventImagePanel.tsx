'use client'

import { useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { ArrowDownTrayIcon, DocumentIcon, PhotoIcon, TrashIcon } from '@heroicons/react/24/outline'
import toast from 'react-hot-toast'
import { ConfirmDialog } from '@/ds'
import { useSupabase } from '@/components/providers/SupabaseProvider'
import {
  deleteEventImageVariant,
  getEventImageVariants,
  type EventImageVariantState,
} from '@/app/actions/event-image-variants'
import {
  EVENT_IMAGE_VARIANTS,
  EVENT_IMAGE_VARIANT_ORDER,
  formatBytes,
  type EventImageVariant,
} from '@/lib/events/imageVariants'
import {
  acceptAttribute,
  readImageDimensions,
  uploadEventImageVariant,
  validateEventImageFile,
  type ImageDimensions,
} from './eventImageUploadClient'

/** At most two uploads in flight, so five large files queue rather than compete. */
const MAX_CONCURRENT_UPLOADS = 2

type PanelStatus = 'loading' | 'ready' | 'failed'

interface QueuedFile {
  file: File
  dimensions: ImageDimensions
  previewUrl: string
}

interface TileState {
  uploading: boolean
  error: string | null
  queued: QueuedFile | null
}

const EMPTY_TILE: TileState = { uploading: false, error: null, queued: null }

export interface EventImagePanelHandle {
  /** True when files are waiting for the event to be created. */
  hasQueuedFiles: () => boolean
  /**
   * Upload everything queued against a newly created event. Resolves to the
   * number that failed, so the drawer knows whether it may close.
   */
  flushQueue: (eventId: string) => Promise<number>
}

interface EventImagePanelProps {
  /** Null while the event is still being created. */
  eventId: string | null
  ref?: React.Ref<EventImagePanelHandle>
  /** Lets the drawer keep its dirty state in step with queued files. */
  onQueueChange?: (queuedCount: number) => void
  /**
   * The drawer still submits hero/thumbnail/poster with the rest of the form.
   * The update RPC writes any key it is given, so omitting them would blank the
   * artwork on every save.
   */
  onSquareChange?: (url: string | null) => void
}

export function EventImagePanel({ eventId, ref, onQueueChange, onSquareChange }: EventImagePanelProps) {
  const supabase = useSupabase()
  const [status, setStatus] = useState<PanelStatus>(eventId ? 'loading' : 'ready')
  const [variants, setVariants] = useState<EventImageVariantState[]>([])
  const [tiles, setTiles] = useState<Record<string, TileState>>({})
  const [pendingDelete, setPendingDelete] = useState<EventImageVariant | null>(null)
  const [pendingReplace, setPendingReplace] = useState<
    { variant: EventImageVariant; queued: QueuedFile } | null
  >(null)
  const inputRefs = useRef<Partial<Record<EventImageVariant, HTMLInputElement | null>>>({})
  const inFlight = useRef(0)

  const tileFor = (variant: EventImageVariant): TileState => tiles[variant] ?? EMPTY_TILE
  const stateFor = (variant: EventImageVariant): EventImageVariantState | undefined =>
    variants.find((entry) => entry.variant === variant)

  const setTile = useCallback((variant: EventImageVariant, patch: Partial<TileState>) => {
    setTiles((current) => ({
      ...current,
      [variant]: { ...(current[variant] ?? EMPTY_TILE), ...patch },
    }))
  }, [])

  const load = useCallback(async (id: string) => {
    setStatus('loading')
    const result = await getEventImageVariants(id)
    if (result.error || !result.data) {
      setStatus('failed')
      return
    }
    setVariants(result.data)
    setStatus('ready')
  }, [])

  useEffect(() => {
    if (!eventId) {
      setStatus('ready')
      return
    }
    void load(eventId)
  }, [eventId, load])

  // Object URLs for queued previews are revoked when the panel goes away.
  useEffect(() => {
    return () => {
      Object.values(tiles).forEach((tile) => {
        if (tile.queued) URL.revokeObjectURL(tile.queued.previewUrl)
      })
    }
    // Intentionally on unmount only.
  }, [])

  const runUpload = useCallback(
    async (targetEventId: string, variant: EventImageVariant, queued: QueuedFile) => {
      // Simple back-pressure so five tiles do not all upload at once.
      while (inFlight.current >= MAX_CONCURRENT_UPLOADS) {
        await new Promise((resolve) => setTimeout(resolve, 120))
      }
      inFlight.current += 1
      setTile(variant, { uploading: true, error: null })

      try {
        const result = await uploadEventImageVariant({
          supabase,
          eventId: targetEventId,
          variant,
          file: queued.file,
          dimensions: queued.dimensions,
        })

        if (result.error) {
          // The tile falls back to whatever was there before, never to a
          // half-applied state.
          setTile(variant, { uploading: false, error: result.error, queued: null })
          URL.revokeObjectURL(queued.previewUrl)
          return false
        }

        setVariants((current) =>
          current.map((entry) =>
            entry.variant === variant
              ? {
                  ...entry,
                  url: result.publicUrl ?? entry.url,
                  owned: true,
                  categoryName: null,
                  fileName: queued.file.name,
                  sizeBytes: queued.file.size,
                  mimeType: queued.file.type,
                }
              : entry
          )
        )
        setTile(variant, { uploading: false, error: null, queued: null })
        URL.revokeObjectURL(queued.previewUrl)
        toast.success(`${EVENT_IMAGE_VARIANTS[variant].label} uploaded`)
        return true
      } finally {
        inFlight.current -= 1
      }
    },
    [setTile, supabase]
  )

  const startUpload = useCallback(
    async (variant: EventImageVariant, file: File) => {
      const dimensions = await readImageDimensions(file)
      const validationError = validateEventImageFile(variant, file, dimensions)

      // A rejected file must not disturb the tile at all.
      if (validationError) {
        toast.error(validationError)
        const input = inputRefs.current[variant]
        if (input) input.value = ''
        return
      }

      const queued: QueuedFile = {
        file,
        dimensions,
        previewUrl: URL.createObjectURL(file),
      }

      const input = inputRefs.current[variant]
      if (input) input.value = ''

      // Nothing to upload against yet, so hold it until the event exists.
      if (!eventId) {
        setTile(variant, { queued, error: null })
        return
      }

      // Replacing deletes the previous file for good, so it is confirmed even
      // though ordinary uploads are not.
      if (stateFor(variant)?.url) {
        setPendingReplace({ variant, queued })
        return
      }

      await runUpload(eventId, variant, queued)
    },
    [eventId, runUpload, setTile, variants]
  )

  useEffect(() => {
    const queuedCount = Object.values(tiles).filter((tile) => tile.queued).length
    onQueueChange?.(queuedCount)
  }, [tiles, onQueueChange])

  useEffect(() => {
    if (status !== 'ready') return
    onSquareChange?.(variants.find((entry) => entry.variant === 'square')?.url ?? null)
  }, [variants, status, onSquareChange])

  useImperativeHandle(
    ref,
    () => ({
      hasQueuedFiles: () => Object.values(tiles).some((tile) => tile.queued),
      flushQueue: async (newEventId: string) => {
        let failures = 0
        // In display order, so the square lands first.
        for (const variant of EVENT_IMAGE_VARIANT_ORDER) {
          const queued = tiles[variant]?.queued
          if (!queued) continue
          const ok = await runUpload(newEventId, variant, queued)
          if (!ok) failures += 1
        }
        await load(newEventId)
        return failures
      },
    }),
    [tiles, runUpload, load]
  )

  const confirmDelete = async () => {
    if (!pendingDelete || !eventId) return
    const variant = pendingDelete
    setTile(variant, { uploading: true, error: null })
    const result = await deleteEventImageVariant(eventId, variant)
    setTile(variant, { uploading: false })

    if (result.error) {
      toast.error(result.error)
    } else {
      setVariants((current) =>
        current.map((entry) =>
          entry.variant === variant
            ? { ...entry, url: null, owned: false, categoryName: null, fileName: null, sizeBytes: null, mimeType: null }
            : entry
        )
      )
      toast.success(`${EVENT_IMAGE_VARIANTS[variant].label} removed`)
    }
    setPendingDelete(null)
  }

  const confirmReplace = async () => {
    if (!pendingReplace || !eventId) return
    const { variant, queued } = pendingReplace
    setPendingReplace(null)
    await runUpload(eventId, variant, queued)
  }

  const cancelReplace = () => {
    if (pendingReplace) URL.revokeObjectURL(pendingReplace.queued.previewUrl)
    setPendingReplace(null)
  }

  if (status === 'loading') {
    return (
      <div className="space-y-3">
        <PanelHeading />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {EVENT_IMAGE_VARIANT_ORDER.map((variant) => (
            <div
              key={variant}
              className="h-40 animate-pulse rounded-lg bg-gray-100"
              aria-hidden="true"
            />
          ))}
        </div>
        <p className="sr-only" role="status">Loading event images</p>
      </div>
    )
  }

  // A fetch failure must never look like "no images", or someone will upload
  // over artwork that is already there.
  if (status === 'failed') {
    return (
      <div className="space-y-3">
        <PanelHeading />
        <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          <p>The images for this event could not be loaded.</p>
          <button
            type="button"
            onClick={() => eventId && load(eventId)}
            className="mt-2 min-h-[44px] font-medium underline"
          >
            Try again
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <PanelHeading />

      {!eventId && (
        <p className="rounded-md bg-blue-50 p-3 text-sm text-blue-800">
          Pick your artwork now. It uploads automatically when you save the event.
        </p>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {EVENT_IMAGE_VARIANT_ORDER.map((variant) => {
          const config = EVENT_IMAGE_VARIANTS[variant]
          const tile = tileFor(variant)
          const state = stateFor(variant)
          const previewUrl = tile.queued?.previewUrl ?? state?.url ?? null
          const isPdf = !tile.queued && state?.mimeType === 'application/pdf'
          const inputId = `event-image-${variant}`

          return (
            <div
              key={variant}
              className="flex flex-col rounded-lg border border-gray-200 p-3"
            >
              <p className="text-sm font-medium text-gray-900">{config.label}</p>
              <p className="mt-0.5 text-xs text-gray-500">{config.helpText}</p>

              <div
                className="relative mt-2 w-full overflow-hidden rounded-md bg-gray-50"
                style={{ aspectRatio: `${config.targetWidth} / ${config.targetHeight}` }}
              >
                {previewUrl && !isPdf && (
                  <img
                    src={previewUrl}
                    alt={`${config.label} artwork for this event`}
                    className="h-full w-full object-cover"
                  />
                )}
                {isPdf && (
                  <div className="flex h-full w-full flex-col items-center justify-center p-2 text-center">
                    <DocumentIcon className="h-8 w-8 text-gray-400" />
                    <span className="mt-1 break-all text-xs text-gray-600">
                      {state?.fileName ?? 'PDF'}
                    </span>
                  </div>
                )}
                {!previewUrl && !isPdf && (
                  <div className="flex h-full w-full items-center justify-center">
                    <PhotoIcon className="h-8 w-8 text-gray-300" aria-hidden="true" />
                  </div>
                )}
                {tile.uploading && (
                  <div className="absolute inset-0 flex items-center justify-center bg-white/80 text-xs font-medium text-gray-700">
                    Uploading...
                  </div>
                )}
              </div>

              <div className="mt-2 min-h-[1.25rem] text-xs" aria-live="polite">
                {tile.error && <span className="text-red-600">{tile.error}</span>}
                {!tile.error && tile.queued && (
                  <span className="text-blue-700">Uploads when you save</span>
                )}
                {!tile.error && !tile.queued && state && !state.owned && state.url && (
                  <span className="text-gray-500">
                    From category{state.categoryName ? `: ${state.categoryName}` : ''}
                  </span>
                )}
                {!tile.error && !tile.queued && state?.owned && state.sizeBytes && (
                  <span className="text-gray-500">{formatBytes(state.sizeBytes)}</span>
                )}
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-2">
                <label
                  htmlFor={inputId}
                  className="inline-flex min-h-[44px] cursor-pointer items-center rounded-md border border-gray-300 bg-white px-3 text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  {previewUrl ? 'Replace' : 'Add'}
                  <span className="sr-only"> {config.label}</span>
                </label>
                <input
                  id={inputId}
                  ref={(element) => {
                    inputRefs.current[variant] = element
                  }}
                  type="file"
                  accept={acceptAttribute(variant)}
                  className="sr-only"
                  disabled={tile.uploading}
                  onChange={(event) => {
                    const file = event.target.files?.[0]
                    if (file) void startUpload(variant, file)
                  }}
                />

                {state?.url && (
                  <a
                    href={state.url}
                    download={state.fileName ?? undefined}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md border border-gray-300 bg-white px-2 text-gray-700 hover:bg-gray-50"
                  >
                    <ArrowDownTrayIcon className="h-4 w-4" aria-hidden="true" />
                    <span className="sr-only">Download {config.label}</span>
                  </a>
                )}

                {/* Inherited artwork belongs to the category and is shared with
                    every other event in it, so it cannot be deleted from here. */}
                {state?.url && state.owned && (
                  <button
                    type="button"
                    onClick={() => setPendingDelete(variant)}
                    disabled={tile.uploading}
                    className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md border border-gray-300 bg-white px-2 text-red-600 hover:bg-red-50 disabled:opacity-50"
                  >
                    <TrashIcon className="h-4 w-4" aria-hidden="true" />
                    <span className="sr-only">Delete {config.label}</span>
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>

      <p className="text-xs text-gray-500">
        Images upload as soon as you choose them, and are not undone by Cancel.
      </p>

      <ConfirmDialog
        open={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        onConfirm={confirmDelete}
        title="Delete image"
        message={`Remove the ${pendingDelete ? EVENT_IMAGE_VARIANTS[pendingDelete].label.toLowerCase() : ''} artwork? The file is deleted and cannot be recovered here.`}
        confirmLabel="Delete"
        tone="danger"
        closeOnConfirm={false}
      />

      <ConfirmDialog
        open={pendingReplace !== null}
        onClose={cancelReplace}
        onConfirm={confirmReplace}
        title="Replace image"
        message="The current file is deleted and cannot be recovered here. Continue?"
        confirmLabel="Replace"
        tone="danger"
        closeOnConfirm={false}
      />
    </div>
  )
}

function PanelHeading() {
  return (
    <div>
      <p className="text-sm font-medium text-gray-700 sm:text-base">Event artwork</p>
      <p className="text-sm text-gray-500">
        The square, landscape and social images appear on the website. The story and
        A4 poster are kept here for you to download.
      </p>
    </div>
  )
}
