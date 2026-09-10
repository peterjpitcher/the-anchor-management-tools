'use client'

import { useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import {
  ArrowDownTrayIcon,
  CheckIcon,
  ClipboardDocumentIcon,
  DocumentIcon,
  PhotoIcon,
  TrashIcon,
} from '@heroicons/react/24/outline'
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
  buildEventImageDownloadUrl,
  buildVariantPrompt,
  formatBytes,
  isBrandedCompositePath,
  storagePathFromPublicUrl,
  type EventImageVariant,
} from '@/lib/events/imageVariants'
import {
  MIN_PRINT_DPI,
  MIN_PRINT_WIDTH_PX,
  tableTalkerSheetLayout,
} from '@/lib/events/artwork/print-sheet'
import { downloadTableTalkerSheet } from '@/components/features/events/tableTalkerSheet'
import {
  acceptAttribute,
  readImageDimensions,
  uploadEventImageVariant,
  validateEventImageFile,
  type ImageDimensions,
} from './eventImageUploadClient'
import { ArtworkBrandingModal } from './ArtworkBrandingModal'

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
  const [dragOver, setDragOver] = useState<EventImageVariant | null>(null)
  const [brandingVariant, setBrandingVariant] = useState<EventImageVariant | null>(null)
  const [sheetBusy, setSheetBusy] = useState(false)
  /**
   * The table talker preview's real pixel size, read when it loads, for the
   * print dpi. Kept with the URL it was read from, so a replacement never shows
   * the previous file's figure while its own is still loading.
   */
  const [talkerPixels, setTalkerPixels] = useState<
    { url: string; width: number; height: number } | null
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

  const load = useCallback(async (id: string, options?: { quiet?: boolean }) => {
    // A quiet load refreshes what is on screen without throwing the panel back
    // to skeletons, which is what a refresh after branding needs: the tiles are
    // already correct and only the saved placement has moved on.
    if (!options?.quiet) setStatus('loading')
    const result = await getEventImageVariants(id)
    if (result.error || !result.data) {
      if (!options?.quiet) setStatus('failed')
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
                  // The file on screen is the raw upload, so it carries no
                  // branding whatever the tile said a moment ago.
                  branding: null,
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
            ? { ...entry, url: null, owned: false, categoryName: null, fileName: null, sizeBytes: null, mimeType: null, branding: null }
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

      <VariantPromptBox />


      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {EVENT_IMAGE_VARIANT_ORDER.map((variant) => {
          const config = EVENT_IMAGE_VARIANTS[variant]
          const tile = tileFor(variant)
          const state = stateFor(variant)
          const previewUrl = tile.queued?.previewUrl ?? state?.url ?? null
          const isPdf =
            (!tile.queued && state?.mimeType === 'application/pdf') ||
            Boolean(state?.url?.split('?')[0]?.toLowerCase().endsWith('.pdf'))
          const inputId = `event-image-${variant}`
          // Branding composites the stored file, so it needs an event to hang
          // off, a file already uploaded, and something an image library can
          // actually open. A queued file has not reached storage yet.
          const canBrand = Boolean(eventId && state?.url && !isPdf && !tile.queued)
          // A queued file has not been composited, so it is never branded
          // whatever is recorded against the file it is about to replace.
          const isBranded = Boolean(state?.branding && !tile.queued)
          // The table talker is printed from a sheet of three, and only once it
          // is branded. Same test as the sheet route: the live file is a
          // composite, which the path alone proves.
          const isTableTalker = variant === 'table_talker'
          const canPrintSheet = Boolean(
            isTableTalker &&
              eventId &&
              state?.url &&
              !tile.queued &&
              isBrandedCompositePath(storagePathFromPublicUrl(state.url))
          )
          const talkerDpi =
            isTableTalker && previewUrl && !isPdf && talkerPixels?.url === previewUrl
              ? tableTalkerSheetLayout(talkerPixels.width, talkerPixels.height).dpi
              : null

          return (
            <div
              key={variant}
              // Drag and drop is an enhancement on top of the file input below,
              // never the only way in, so keyboard users are unaffected.
              onDragOver={(e) => {
                if (tile.uploading) return
                e.preventDefault()
                e.dataTransfer.dropEffect = 'copy'
                setDragOver(variant)
              }}
              onDragLeave={(e) => {
                // Ignore the events fired while crossing the tile's own children.
                if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
                setDragOver((current) => (current === variant ? null : current))
              }}
              onDrop={(e) => {
                e.preventDefault()
                setDragOver(null)
                if (tile.uploading) return
                const file = e.dataTransfer.files?.[0]
                if (file) void startUpload(variant, file)
              }}
              className={`flex h-full flex-col rounded-lg border p-3 transition-colors ${
                dragOver === variant
                  ? 'border-green-500 border-dashed bg-green-50'
                  : 'border-gray-200'
              }`}
            >
              <p className="text-sm font-medium text-gray-900">{config.label}</p>
              <p className="mt-0.5 text-xs text-gray-500">{config.helpText}</p>

              {/* Fixed-height well so every tile lines up, with the preview inside
                  it at the variant's true shape. Seeing that a story is tall and a
                  cover is wide is the point; ragged tile heights are not.
                  The height is deliberately low enough that even the 1.91:1 cover
                  fits the tile without being clamped, otherwise landscape and
                  social render as the same shape and the cue is lost. */}
              <div className="mt-2 flex h-20 w-full items-center justify-center">
              <div
                className="relative h-full max-w-full overflow-hidden rounded-md bg-gray-50"
                style={{ aspectRatio: `${config.targetWidth} / ${config.targetHeight}` }}
              >
                {previewUrl && !isPdf && (
                  <img
                    src={previewUrl}
                    alt={`${config.label} artwork for this event`}
                    className="h-full w-full object-cover"
                    onLoad={
                      isTableTalker
                        ? (event) => {
                            const { naturalWidth, naturalHeight } = event.currentTarget
                            if (naturalWidth > 0 && naturalHeight > 0) {
                              setTalkerPixels({ url: previewUrl, width: naturalWidth, height: naturalHeight })
                            }
                          }
                        : undefined
                    }
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
                  <div className="flex h-full w-full flex-col items-center justify-center gap-1 px-2 text-center">
                    <PhotoIcon className="h-8 w-8 text-gray-300" aria-hidden="true" />
                    <span className="text-xs text-gray-400">Drop a file here</span>
                  </div>
                )}
                {dragOver === variant && (
                  <div className="absolute inset-0 flex items-center justify-center bg-green-50/90 text-xs font-medium text-green-800">
                    Drop
                  </div>
                )}
                {tile.uploading && (
                  <div className="absolute inset-0 flex items-center justify-center bg-white/80 text-xs font-medium text-gray-700">
                    Uploading...
                  </div>
                )}
                {/* So a manager can see at a glance which artwork already
                    carries the logo, without opening the editor on each tile. */}
                {isBranded && (
                  <span
                    data-testid={`branded-badge-${variant}`}
                    className="absolute left-1 top-1 rounded bg-gray-900/70 px-1.5 py-0.5 text-[10px] font-medium leading-none text-white"
                  >
                    Branded
                  </span>
                )}
              </div>
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

              {/* mt-auto keeps the controls on the tile's bottom edge, so they
                  line up across a row whatever shape the preview above is. */}
              <div className="mt-auto flex flex-wrap items-center gap-2 pt-2">
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
                    href={buildEventImageDownloadUrl(state.url, state.fileName)}
                    download={state.fileName ?? undefined}
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

                <button
                  type="button"
                  onClick={() => setBrandingVariant(variant)}
                  disabled={!canBrand || tile.uploading}
                  title={
                    canBrand
                      ? undefined
                      : isPdf
                        ? 'A PDF cannot be branded here. Upload the poster as an image instead.'
                        : 'Upload a file for this size first.'
                  }
                  className="inline-flex min-h-[44px] items-center rounded-md border border-gray-300 bg-white px-3 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                >
                  Branding
                  <span className="sr-only"> for {config.label}</span>
                </button>

                {isTableTalker && eventId && (
                  <button
                    type="button"
                    onClick={async () => {
                      setSheetBusy(true)
                      try {
                        await downloadTableTalkerSheet(eventId)
                      } finally {
                        setSheetBusy(false)
                      }
                    }}
                    disabled={!canPrintSheet || sheetBusy || tile.uploading}
                    title={
                      canPrintSheet
                        ? 'Three to an A4 sheet. Print at actual size (100%), then cut as needed.'
                        : 'Brand the table talker first. Only branded artwork is printed.'
                    }
                    className="inline-flex min-h-[44px] items-center rounded-md border border-gray-300 bg-white px-3 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                  >
                    {sheetBusy ? 'Preparing...' : 'Print sheet'}
                  </button>
                )}
              </div>

              {/* Said on the tile, not only in a tooltip, because a touch
                  screen has no hover to show one. */}
              {isTableTalker && previewUrl && !isPdf && (
                <p className="mt-2 text-xs" data-testid="table-talker-print-note">
                  {talkerDpi !== null && talkerDpi < MIN_PRINT_DPI ? (
                    <span className="text-red-600">
                      Prints at {Math.floor(talkerDpi)} dpi, too soft to print. Upload one at least{' '}
                      {MIN_PRINT_WIDTH_PX} px wide.
                    </span>
                  ) : (
                    <span className="text-gray-500">
                      {talkerDpi !== null ? `Prints at about ${Math.round(talkerDpi)} dpi. ` : ''}
                      {canPrintSheet
                        ? 'Print the sheet at 100%, then cut as needed.'
                        : 'Brand it to print the A4 sheet.'}
                    </span>
                  )}
                </p>
              )}
            </div>
          )
        })}
      </div>

      {/* Only true once the event exists. On a new event the files are held
          until save, which the notice at the top of the panel says, and running
          both lines at once contradicted itself on screen. */}
      {eventId && (
        <p className="text-xs text-gray-500">
          Images upload as soon as you choose them, and are not undone by Cancel.
        </p>
      )}

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

      {/* One editor for the whole panel, opened against whichever tile asked
          for it, so five modals are not mounted at once. */}
      {eventId && brandingVariant && stateFor(brandingVariant)?.url && (
        <ArtworkBrandingModal
          open
          onClose={() => setBrandingVariant(null)}
          eventId={eventId}
          variant={brandingVariant}
          imageUrl={stateFor(brandingVariant)?.url ?? ''}
          branding={stateFor(brandingVariant)?.branding ?? null}
          onApplied={(variant, url) => {
            setVariants((current) =>
              current.map((entry) =>
                entry.variant === variant ? { ...entry, url, owned: true } : entry
              )
            )
            // The new placement lives on the server, so read it back. Without
            // this the next opening of the editor would show the placement from
            // before the save that just happened.
            void load(eventId, { quiet: true })
          }}
        />
      )}
    </div>
  )
}

/**
 * Make the square first, then paste this into an image tool to get the other
 * sizes back, the slim table talker included. The text is generated from the
 * variant config, so the dimensions here are the same ones the upload
 * validates against.
 */
function VariantPromptBox() {
  const [copied, setCopied] = useState(false)
  const prompt = buildVariantPrompt()

  async function copy() {
    try {
      await navigator.clipboard.writeText(prompt)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard access can be refused, so leave the text on screen to copy by hand.
      toast.error('Could not copy. Select the text below and copy it manually.')
    }
  }

  return (
    <div className="rounded-md border border-gray-200 bg-gray-50 p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-gray-800">Prompt for the other sizes</p>
          <p className="text-xs text-gray-500">
            Made the square already? Copy this into your image tool with it attached.
          </p>
        </div>
        <button
          type="button"
          onClick={copy}
          className="inline-flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 text-sm font-medium text-gray-700 hover:bg-gray-100"
        >
          {copied ? (
            <CheckIcon className="h-4 w-4 text-green-600" aria-hidden="true" />
          ) : (
            <ClipboardDocumentIcon className="h-4 w-4" aria-hidden="true" />
          )}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded bg-white p-2 text-xs leading-relaxed text-gray-600">
        {prompt}
      </pre>
      <span aria-live="polite" className="sr-only">
        {copied ? 'Prompt copied to clipboard' : ''}
      </span>
    </div>
  )
}

function PanelHeading() {
  return (
    <div>
      <p className="text-sm font-medium text-gray-700 sm:text-base">Event artwork</p>
      <p className="text-sm text-gray-500">
        Drag a file onto a tile, or click it to browse. The square, landscape and
        social images appear on the website. The story, A4 poster and table talker
        are kept here for you to download.
      </p>
    </div>
  )
}
