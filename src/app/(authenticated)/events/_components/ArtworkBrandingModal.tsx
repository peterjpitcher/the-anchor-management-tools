'use client'

/**
 * Places the venue logo, and on the A4 poster a booking QR code, onto artwork
 * that has already been uploaded for an event.
 *
 * Four decisions here that later edits must not undo:
 *
 * 1. GEOMETRY IS NEVER RECOMPUTED. Every rectangle on screen comes from
 *    `src/lib/events/artwork/geometry.ts`, which the server compositor also
 *    imports. That shared module is the only reason what a manager drags here
 *    is what the rendered file gets. A percentage worked out by hand in this
 *    file would drift from the poster within a release.
 *
 * 2. NOTHING IS SENT TO THE SERVER WHILE DRAGGING. The preview is drawn
 *    entirely in the browser and the authoritative composite happens exactly
 *    once, when Save is pressed. Do not add a live server preview: it would
 *    need debouncing, cancellation of obsolete responses, and would spend a
 *    function invocation per pointer move for a picture nobody keeps.
 *
 * 3. DRAG IS AN ENHANCEMENT. Arrow keys (1% a press, 5% with shift), the
 *    numeric fields and Reset placement all set the same state, so the editor
 *    is fully usable with no pointer at all. HTML5 drag does not work on
 *    iPadOS Safari, which is why the pointer path uses `@dnd-kit`'s
 *    `PointerSensor` with `touch-action: none` on the draggable.
 *
 * 4. THE UI VALIDATION IS CONVENIENCE, NOT ENFORCEMENT. `validateQrPlacement`
 *    runs here so a manager sees the problem before pressing Save, but the
 *    route re-runs it server side and refuses the composite regardless. Do not
 *    remove the server check on the grounds that the button is disabled.
 *
 * The surface is a full-screen dialog rather than a route or the DS Modal.
 * Navigating away from the event drawer would discard unsaved event edits, and
 * the DS Modal caps at 800px while an A4 preview 600px wide is about 848px
 * tall, so neither fits.
 */

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import {
  DndContext,
  PointerSensor,
  useDraggable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import { Dialog, DialogBackdrop, DialogPanel, DialogTitle } from '@headlessui/react'
import { XMarkIcon } from '@heroicons/react/24/outline'
import toast from 'react-hot-toast'
import { z } from 'zod'
import { Button, ConfirmDialog } from '@/ds'
import { cn } from '@/lib/utils'
import {
  A4_WIDTH_MM,
  LOGO_DEFAULT_WIDTH_FRAC,
  LOGO_MAX_WIDTH_FRAC,
  LOGO_MIN_WIDTH_FRAC,
  QR_MIN_MM,
  logoRectFree,
  qrMinWidthFrac,
  qrRect,
  resolveLogoRect,
  validateQrPlacement,
  type Corner,
  type LogoPlacement,
  type Rect,
} from '@/lib/events/artwork/geometry'
import { EVENT_IMAGE_VARIANTS, type EventImageVariant } from '@/lib/events/imageVariants'
import type { EventImageBrandingState } from '@/app/actions/event-image-variants'
import { EVENT_MARKETING_CHANNEL_MAP, buildShortCode } from '@/lib/event-marketing-links'
import { buildShortLinkUrl } from '@/lib/short-links/base-url'
import { NumberField, OptionButtons, SliderField } from './branding/BrandingControls'

type LogoColour = 'white' | 'black'
type LogoMode = 'none' | 'corner' | 'free'

/** Where a freshly opened editor starts before anyone touches anything. */
const DEFAULT_CORNER: Corner = 'bottom_right'
const DEFAULT_FREE_CENTRE = { x: 0.5, y: 0.85 }
const DEFAULT_QR_CENTRE = { x: 0.5, y: 0.8 }
const DEFAULT_QR_WIDTH_FRAC = 0.22

/**
 * The QR size controls work in whole percent, and these are their bounds.
 *
 * The floor is the first whole percent at or above the 40mm print minimum.
 * `qrMinWidthFrac()` is the enforced floor (0.1905, rounded up from 40/210 so a
 * code can never print under 40mm) and matches both the route's Zod bound and
 * the database CHECK, so the exact minimum is now accepted rather than 400ing.
 */
const MIN_QR_WIDTH_PERCENT = Math.ceil(qrMinWidthFrac() * 100)
const MAX_QR_WIDTH_PERCENT = 40

const CORNER_OPTIONS: readonly { value: Corner; label: string }[] = [
  { value: 'top_left', label: 'Top left' },
  { value: 'top_right', label: 'Top right' },
  { value: 'bottom_left', label: 'Bottom left' },
  { value: 'bottom_right', label: 'Bottom right' },
]

const MODE_OPTIONS: readonly { value: LogoMode; label: string }[] = [
  { value: 'none', label: 'No logo' },
  { value: 'corner', label: 'Corner' },
  { value: 'free', label: 'Free' },
]

const COLOUR_OPTIONS: readonly { value: LogoColour; label: string }[] = [
  { value: 'white', label: 'White logo' },
  { value: 'black', label: 'Black logo' },
]

/**
 * The route answers with the new public URL on success and `{ code, detail }`
 * on a 422. Both are parsed rather than trusted: `detail` is shown to a manager
 * word for word, so it has to actually be a string before it reaches the page.
 */
const compositeSuccessSchema = z.object({
  url: z.string().min(1).optional(),
  publicUrl: z.string().min(1).optional(),
})

const compositeFailureSchema = z.object({
  code: z.string().optional(),
  detail: z.string().min(1).optional(),
})

export interface ArtworkBrandingModalProps {
  open: boolean
  onClose: () => void
  /** The event owning the artwork. Branding is impossible before it exists. */
  eventId: string
  variant: EventImageVariant
  /** Public URL of the file already uploaded for this variant. */
  imageUrl: string
  /**
   * What is already stamped on this image, so the editor opens showing the
   * placement that is on the file rather than the defaults. Null, or omitted,
   * for artwork that has never been branded.
   */
  branding?: EventImageBrandingState | null
  /** Handed the new public URL once the server has composited or reverted. */
  onApplied: (variant: EventImageVariant, url: string) => void
}

function clampFraction(value: number): number {
  if (Number.isNaN(value)) return 0
  return Math.min(Math.max(value, 0), 1)
}

function toPercent(fraction: number): number {
  return Math.round(fraction * 100)
}

/** Hold a requested QR width inside the range the route will actually accept. */
function clampQrWidthPercent(percent: number): number {
  if (Number.isNaN(percent)) return MIN_QR_WIDTH_PERCENT
  return Math.min(Math.max(Math.round(percent), MIN_QR_WIDTH_PERCENT), MAX_QR_WIDTH_PERCENT)
}

/** The centre of a rect, back in fractions of each edge. */
function centreOf(rect: Rect, imageW: number, imageH: number): { x: number; y: number } {
  return { x: (rect.x + rect.width / 2) / imageW, y: (rect.y + rect.height / 2) / imageH }
}

export function ArtworkBrandingModal({
  open,
  onClose,
  eventId,
  variant,
  imageUrl,
  branding = null,
  onApplied,
}: ArtworkBrandingModalProps): React.JSX.Element {
  const fieldId = useId()
  const config = EVENT_IMAGE_VARIANTS[variant]
  const imageW = config.targetWidth
  const imageH = config.targetHeight
  // The QR is a print device: a 40mm minimum only means anything on the poster.
  const isPoster = variant === 'print_poster'

  /**
   * Reopening the editor on artwork that is already branded must show what is
   * on the file, not the defaults. The panel unmounts this dialog when it
   * closes, so these initialisers run once per opening and the controls stay
   * free to move afterwards.
   *
   * A null `branding` is artwork nobody has branded, which keeps today's
   * defaults. A non-null `branding` with a null `logo` is a deliberate "no
   * logo", which is a different answer and is honoured as one.
   */
  const savedLogo = branding?.logo ?? null
  const savedQr = branding?.qr ?? null
  const savedPlacement = savedLogo?.placement ?? null

  const [logoMode, setLogoMode] = useState<LogoMode>(() => {
    if (!branding) return 'corner'
    if (!savedPlacement) return 'none'
    return savedPlacement.mode
  })
  const [corner, setCorner] = useState<Corner>(
    savedPlacement?.mode === 'corner' ? savedPlacement.corner : DEFAULT_CORNER
  )
  const [logoCentre, setLogoCentre] = useState(
    savedPlacement?.mode === 'free'
      ? { x: savedPlacement.centreXFrac, y: savedPlacement.centreYFrac }
      : DEFAULT_FREE_CENTRE
  )
  const [logoWidthFrac, setLogoWidthFrac] = useState(
    savedPlacement?.widthFrac ?? LOGO_DEFAULT_WIDTH_FRAC
  )
  const [colour, setColour] = useState<LogoColour>(savedLogo?.colour ?? 'white')

  const [qrOn, setQrOn] = useState(isPoster && (branding ? savedQr !== null : true))
  const [qrCentre, setQrCentre] = useState(
    savedQr ? { x: savedQr.centreXFrac, y: savedQr.centreYFrac } : DEFAULT_QR_CENTRE
  )
  const [qrWidthFrac, setQrWidthFrac] = useState(savedQr?.widthFrac ?? DEFAULT_QR_WIDTH_FRAC)
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)

  const [busy, setBusy] = useState(false)
  const [apiError, setApiError] = useState<string | null>(null)
  const [confirmRevert, setConfirmRevert] = useState(false)

  const previewRef = useRef<HTMLDivElement | null>(null)

  const sensors = useSensors(
    // A short distance threshold so a tap that was meant as a tap is still a tap.
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } })
  )

  const placement: LogoPlacement | null = useMemo(() => {
    if (logoMode === 'none') return null
    if (logoMode === 'corner') return { mode: 'corner', corner, widthFrac: logoWidthFrac }
    return {
      mode: 'free',
      centreXFrac: logoCentre.x,
      centreYFrac: logoCentre.y,
      widthFrac: logoWidthFrac,
    }
  }, [logoMode, corner, logoCentre, logoWidthFrac])

  const logoBox = useMemo(
    () => (placement ? resolveLogoRect(imageW, imageH, placement) : null),
    [placement, imageW, imageH]
  )

  const qrBox = useMemo(
    () =>
      isPoster && qrOn ? qrRect(imageW, imageH, qrCentre.x, qrCentre.y, qrWidthFrac) : null,
    [isPoster, qrOn, imageW, imageH, qrCentre, qrWidthFrac]
  )

  const qrCheck = useMemo(
    () =>
      qrBox
        ? validateQrPlacement(imageW, imageH, qrBox, logoBox)
        : ({ ok: true } as const),
    [qrBox, imageW, imageH, logoBox]
  )

  const qrMillimetres = qrBox ? (qrBox.width * A4_WIDTH_MM) / imageW : 0

  /**
   * Where the printed code will point. Derived from the event id, not the slug,
   * exactly as the server derives it, so a manager can read the destination
   * before anything reaches a printer. The server resolves and repairs the same
   * link on save and refuses with a 422 if it cannot.
   */
  const posterShortUrl = useMemo(() => {
    const prefix = EVENT_MARKETING_CHANNEL_MAP.get('poster')?.shortCodePrefix ?? 'po'
    return buildShortLinkUrl(buildShortCode(prefix, eventId))
  }, [eventId])

  useEffect(() => {
    if (!open || !isPoster || !qrOn) return
    let cancelled = false
    void (async () => {
      try {
        const QRCode = await import('qrcode')
        const dataUrl = await QRCode.toDataURL(posterShortUrl, { margin: 1, width: 320 })
        if (!cancelled) setQrDataUrl(dataUrl)
      } catch {
        // A missing guide image is cosmetic: the placement box still shows where
        // the code lands, and the server draws the real thing.
        if (!cancelled) setQrDataUrl(null)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, isPoster, qrOn, posterShortUrl])

  const nudgeLogo = useCallback(
    (dx: number, dy: number) => {
      setLogoCentre((current) => {
        // Settle against the geometry module's own clamped result first, so
        // pressing left at the margin ten times does not bank ten presses that
        // have to be undone before the logo moves right again.
        const settled = centreOf(
          logoRectFree(imageW, imageH, current.x, current.y, logoWidthFrac),
          imageW,
          imageH
        )
        return { x: clampFraction(settled.x + dx), y: clampFraction(settled.y + dy) }
      })
    },
    [imageW, imageH, logoWidthFrac]
  )

  const nudgeQr = useCallback(
    (dx: number, dy: number) => {
      setQrCentre((current) => {
        const settled = centreOf(
          qrRect(imageW, imageH, current.x, current.y, qrWidthFrac),
          imageW,
          imageH
        )
        return { x: clampFraction(settled.x + dx), y: clampFraction(settled.y + dy) }
      })
    },
    [imageW, imageH, qrWidthFrac]
  )

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const box = previewRef.current?.getBoundingClientRect()
      // No measurable preview means no reliable conversion from pixels to
      // fractions, so the drag is dropped rather than guessed at.
      if (!box || box.width === 0 || box.height === 0) return
      const dx = event.delta.x / box.width
      const dy = event.delta.y / box.height
      if (event.active.id === 'logo') nudgeLogo(dx, dy)
      if (event.active.id === 'qr') nudgeQr(dx, dy)
    },
    [nudgeLogo, nudgeQr]
  )

  function resetLogoPlacement(): void {
    setCorner(DEFAULT_CORNER)
    setLogoCentre(DEFAULT_FREE_CENTRE)
    setLogoWidthFrac(LOGO_DEFAULT_WIDTH_FRAC)
  }

  function resetQrPlacement(): void {
    setQrCentre(DEFAULT_QR_CENTRE)
    setQrWidthFrac(DEFAULT_QR_WIDTH_FRAC)
  }

  async function post(body: Record<string, unknown>, successMessage: string): Promise<void> {
    setBusy(true)
    setApiError(null)
    try {
      const response = await fetch(`/api/events/${eventId}/artwork/composite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      const payload: unknown = await response.json().catch(() => null)

      if (!response.ok) {
        const failure = compositeFailureSchema.safeParse(payload)
        if (failure.success && failure.data.detail) {
          // Shown verbatim on purpose: the 422 detail is written to be read by
          // a manager, and paraphrasing it loses the reason they need.
          setApiError(failure.data.detail)
        } else if (response.status === 403) {
          setApiError('You do not have permission to brand event artwork.')
        } else {
          setApiError('The artwork could not be updated. Please try again.')
        }
        return
      }

      const success = compositeSuccessSchema.safeParse(payload)
      const nextUrl = success.success ? (success.data.url ?? success.data.publicUrl) : undefined
      if (!nextUrl) {
        setApiError('The artwork was updated but the new file could not be read back.')
        return
      }

      onApplied(variant, nextUrl)
      toast.success(successMessage)
      onClose()
    } catch {
      setApiError('The artwork could not be updated. Check your connection and try again.')
    } finally {
      setBusy(false)
    }
  }

  async function handleSave(): Promise<void> {
    await post(
      {
        variant,
        logo: placement ? { placement, colour } : null,
        qr:
          isPoster && qrOn
            ? { centreXFrac: qrCentre.x, centreYFrac: qrCentre.y, widthFrac: qrWidthFrac }
            : null,
      },
      `${config.label} branding saved`
    )
  }

  async function handleRevert(): Promise<void> {
    setConfirmRevert(false)
    await post({ variant, action: 'revert' }, `${config.label} restored to the original`)
  }

  const canSave = qrCheck.ok && !busy

  return (
    <Dialog open={open} onClose={onClose} className="relative z-50">
      <DialogBackdrop className="fixed inset-0 bg-black/50" />
      <div className="fixed inset-0 flex">
        <DialogPanel className="flex h-full w-full flex-col bg-bg">
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border bg-surface px-4 py-3">
            <div className="min-w-0">
              <DialogTitle className="truncate text-base font-semibold text-text">
                Branding: {config.label}
              </DialogTitle>
              <p className="truncate text-xs text-text-muted">
                {imageW} x {imageH} px. The logo is stamped on the saved file.
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex items-center justify-center rounded-md border border-border-strong bg-surface p-3 text-text hover:bg-surface-hover focus-visible:outline-none focus-visible:shadow-ring"
            >
              <XMarkIcon className="h-5 w-5" aria-hidden="true" />
              <span className="sr-only">Close branding editor</span>
            </button>
          </div>

          <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
            <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
              <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-surface-2 p-4">
                <div
                  ref={previewRef}
                  data-testid="artwork-preview"
                  className="relative h-full max-h-full w-auto max-w-full overflow-hidden rounded-md bg-surface shadow-sm"
                  style={{ aspectRatio: `${imageW} / ${imageH}` }}
                >
                  <img
                    src={imageUrl}
                    alt={`${config.label} artwork for this event`}
                    className="absolute inset-0 h-full w-full object-cover"
                    draggable={false}
                  />

                  {logoBox && (
                    <PlacementOverlay
                      id="logo"
                      testId="logo-overlay"
                      label="Logo position"
                      rect={logoBox}
                      imageW={imageW}
                      imageH={imageH}
                      draggable={logoMode === 'free'}
                      onNudge={nudgeLogo}
                    >
                      <img
                        src={`/guest/anchor-logo-${colour}.png`}
                        alt=""
                        className="pointer-events-none h-full w-full object-contain"
                        draggable={false}
                      />
                    </PlacementOverlay>
                  )}

                  {qrBox && (
                    <PlacementOverlay
                      id="qr"
                      testId="qr-overlay"
                      label="QR code position"
                      rect={qrBox}
                      imageW={imageW}
                      imageH={imageH}
                      draggable
                      invalid={!qrCheck.ok}
                      onNudge={nudgeQr}
                    >
                      {qrDataUrl && (
                        <img
                          src={qrDataUrl}
                          alt=""
                          className="pointer-events-none h-full w-full object-contain"
                          draggable={false}
                        />
                      )}
                      {/* The caption sits ON the code deliberately. It labels the
                          preview as a guide and makes it unscannable, so nobody
                          points a phone at a screen and books from a draft. */}
                      <span className="pointer-events-none absolute inset-x-0 bottom-0 bg-text/75 px-1 py-0.5 text-center text-[10px] font-medium leading-tight text-surface">
                        Guide only
                      </span>
                    </PlacementOverlay>
                  )}
                </div>
              </div>
            </DndContext>

            <div className="w-full shrink-0 space-y-5 overflow-y-auto border-t border-border bg-surface p-4 lg:w-[380px] lg:border-l lg:border-t-0">
              <section aria-labelledby={`${fieldId}-logo-heading`} className="space-y-3">
                <h2 id={`${fieldId}-logo-heading`} className="text-sm font-semibold text-text">
                  Logo
                </h2>
                <p className="text-xs text-text-muted">
                  The logo is applied to every size of this event&apos;s artwork.
                </p>

                <OptionButtons
                  label="Logo placement mode"
                  options={MODE_OPTIONS}
                  value={logoMode}
                  onChange={setLogoMode}
                />

                {logoMode === 'corner' && (
                  <OptionButtons
                    label="Logo corner"
                    options={CORNER_OPTIONS}
                    value={corner}
                    onChange={setCorner}
                    // grid-cols-2 with no breakpoint prefix. A `md:grid-cols-2`
                    // here would be flattened to one column below 820px by the
                    // global rule in globals.css.
                    className="grid w-full grid-cols-2 gap-2"
                  />
                )}

                {logoMode !== 'none' && (
                  <>
                    <OptionButtons
                      label="Logo colour"
                      options={COLOUR_OPTIONS}
                      value={colour}
                      onChange={setColour}
                    />

                    <SliderField
                      id={`${fieldId}-logo-size`}
                      label="Logo size"
                      min={Math.ceil(LOGO_MIN_WIDTH_FRAC * 100)}
                      max={Math.floor(LOGO_MAX_WIDTH_FRAC * 100)}
                      value={toPercent(logoWidthFrac)}
                      valueLabel={`${toPercent(logoWidthFrac)}% of the width`}
                      onChange={(next) => setLogoWidthFrac(next / 100)}
                    />

                    <div className="grid grid-cols-3 gap-2">
                      <NumberField
                        id={`${fieldId}-logo-x`}
                        label="Logo X"
                        suffix="%"
                        min={0}
                        max={100}
                        value={toPercent(logoCentre.x)}
                        disabled={logoMode !== 'free'}
                        onChange={(next) =>
                          setLogoCentre((current) => ({ ...current, x: clampFraction(next / 100) }))
                        }
                      />
                      <NumberField
                        id={`${fieldId}-logo-y`}
                        label="Logo Y"
                        suffix="%"
                        min={0}
                        max={100}
                        value={toPercent(logoCentre.y)}
                        disabled={logoMode !== 'free'}
                        onChange={(next) =>
                          setLogoCentre((current) => ({ ...current, y: clampFraction(next / 100) }))
                        }
                      />
                      <NumberField
                        id={`${fieldId}-logo-width`}
                        label="Logo width"
                        suffix="%"
                        min={Math.ceil(LOGO_MIN_WIDTH_FRAC * 100)}
                        max={Math.floor(LOGO_MAX_WIDTH_FRAC * 100)}
                        value={toPercent(logoWidthFrac)}
                        onChange={(next) => setLogoWidthFrac(next / 100)}
                      />
                    </div>

                    <Button variant="secondary" size="sm" onClick={resetLogoPlacement}>
                      Reset logo placement
                    </Button>
                  </>
                )}
              </section>

              {isPoster && (
                <section aria-labelledby={`${fieldId}-qr-heading`} className="space-y-3 border-t border-border pt-5">
                  <h2 id={`${fieldId}-qr-heading`} className="text-sm font-semibold text-text">
                    Booking QR code
                  </h2>

                  <label className="flex min-h-[44px] items-center gap-2 text-sm text-text">
                    <input
                      type="checkbox"
                      checked={qrOn}
                      onChange={(event) => setQrOn(event.target.checked)}
                      className="h-4 w-4 accent-primary"
                    />
                    Put a QR code on the poster
                  </label>

                  {qrOn && (
                    <>
                      <div className="rounded-md border border-border bg-surface-2 p-3">
                        <p className="text-xs font-medium text-text-muted">The code points to</p>
                        <p className="mt-0.5 break-all text-sm text-text">{posterShortUrl}</p>
                      </div>

                      <SliderField
                        id={`${fieldId}-qr-size`}
                        label="QR size"
                        min={MIN_QR_WIDTH_PERCENT}
                        max={MAX_QR_WIDTH_PERCENT}
                        value={toPercent(qrWidthFrac)}
                        valueLabel={`${toPercent(qrWidthFrac)}% of the width`}
                        hint={`Never smaller than the ${QR_MIN_MM}mm print minimum.`}
                        onChange={(next) => setQrWidthFrac(clampQrWidthPercent(next) / 100)}
                      />

                      <div className="grid grid-cols-3 gap-2">
                        <NumberField
                          id={`${fieldId}-qr-x`}
                          label="QR X"
                          suffix="%"
                          min={0}
                          max={100}
                          value={toPercent(qrCentre.x)}
                          onChange={(next) =>
                            setQrCentre((current) => ({ ...current, x: clampFraction(next / 100) }))
                          }
                        />
                        <NumberField
                          id={`${fieldId}-qr-y`}
                          label="QR Y"
                          suffix="%"
                          min={0}
                          max={100}
                          value={toPercent(qrCentre.y)}
                          onChange={(next) =>
                            setQrCentre((current) => ({ ...current, y: clampFraction(next / 100) }))
                          }
                        />
                        <NumberField
                          id={`${fieldId}-qr-width`}
                          label="QR width"
                          suffix="%"
                          min={MIN_QR_WIDTH_PERCENT}
                          max={MAX_QR_WIDTH_PERCENT}
                          value={toPercent(qrWidthFrac)}
                          onChange={(next) => setQrWidthFrac(clampQrWidthPercent(next) / 100)}
                        />
                      </div>

                      {qrBox && (
                        <p className="text-xs text-text-muted">
                          Printed size: {qrBox.width} px, {qrMillimetres.toFixed(0)} mm on the A4
                          poster.
                        </p>
                      )}

                      <Button variant="secondary" size="sm" onClick={resetQrPlacement}>
                        Reset QR placement
                      </Button>
                    </>
                  )}
                </section>
              )}

              {/* One polite region for placement problems. It only changes when
                  the reason changes, and state is committed at the end of a
                  drag rather than on every pointer move, so a screen reader is
                  not talked over while someone is still moving things. */}
              <p role="status" aria-live="polite" className="min-h-[1.25rem] text-sm text-danger">
                {qrCheck.ok ? '' : qrCheck.reason}
              </p>

              {apiError && (
                <p role="alert" className="rounded-md bg-danger-soft p-3 text-sm text-danger-fg">
                  {apiError}
                </p>
              )}
            </div>
          </div>

          <div className="flex shrink-0 flex-col gap-2 border-t border-border bg-surface px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <Button variant="secondary" onClick={() => setConfirmRevert(true)} disabled={busy}>
              Revert to original
            </Button>
            <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
              <Button variant="secondary" onClick={onClose} disabled={busy}>
                Cancel
              </Button>
              <Button variant="primary" onClick={handleSave} disabled={!canSave}>
                Save branding
              </Button>
            </div>
          </div>
        </DialogPanel>
      </div>

      <ConfirmDialog
        open={confirmRevert}
        onClose={() => setConfirmRevert(false)}
        onConfirm={handleRevert}
        title="Revert to original"
        message="This puts the uploaded file back and removes the logo and QR code from it. Continue?"
        confirmLabel="Revert"
        tone="danger"
        closeOnConfirm={false}
      />
    </Dialog>
  )
}

interface PlacementOverlayProps {
  id: 'logo' | 'qr'
  testId: string
  label: string
  rect: Rect
  imageW: number
  imageH: number
  draggable: boolean
  invalid?: boolean
  onNudge: (dx: number, dy: number) => void
  children: React.ReactNode
}

/**
 * One draggable, nudgeable box over the preview.
 *
 * The rect it is given comes from the geometry module, and the box is expressed
 * as a percentage of that rect over the canvas, so the preview is a true scale
 * drawing of the file the server will produce.
 */
function PlacementOverlay({
  id,
  testId,
  label,
  rect,
  imageW,
  imageH,
  draggable,
  invalid,
  onNudge,
  children,
}: PlacementOverlayProps): React.JSX.Element {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id,
    disabled: !draggable,
  })

  function handleKeyDown(event: React.KeyboardEvent<HTMLButtonElement>): void {
    const step = event.shiftKey ? 0.05 : 0.01
    let dx = 0
    let dy = 0
    if (event.key === 'ArrowLeft') dx = -step
    else if (event.key === 'ArrowRight') dx = step
    else if (event.key === 'ArrowUp') dy = -step
    else if (event.key === 'ArrowDown') dy = step
    else return
    event.preventDefault()
    onNudge(dx, dy)
  }

  return (
    <button
      ref={setNodeRef}
      type="button"
      data-testid={testId}
      // The pixel rect the geometry module resolved, so a test can compare the
      // preview against the same function the server composites with.
      data-rect={`${rect.x},${rect.y},${rect.width},${rect.height}`}
      aria-label={label}
      disabled={!draggable}
      {...listeners}
      {...attributes}
      onKeyDown={handleKeyDown}
      style={{
        position: 'absolute',
        left: `${(rect.x / imageW) * 100}%`,
        top: `${(rect.y / imageH) * 100}%`,
        width: `${(rect.width / imageW) * 100}%`,
        height: `${(rect.height / imageH) * 100}%`,
        // globals.css puts a 44px floor on every button below 820px. That rule
        // is not !important, so this inline style beats it, which it has to:
        // an overlay padded out to 44px would no longer be the true size of the
        // thing being placed and the preview would lie. Drag is an enhancement
        // here, and the arrow keys and numeric fields carry the touch case.
        minWidth: 0,
        minHeight: 0,
        // dnd-kit's PointerSensor needs this on touch devices, or the browser
        // claims the gesture as a scroll and fires pointercancel.
        touchAction: 'none',
        transform: transform
          ? `translate3d(${transform.x}px, ${transform.y}px, 0)`
          : undefined,
      }}
      className={cn(
        'group border-2 border-dashed focus-visible:outline-none focus-visible:shadow-ring',
        draggable ? 'cursor-grab' : 'cursor-default',
        isDragging && 'cursor-grabbing opacity-70',
        invalid ? 'border-danger' : 'border-primary/70'
      )}
    >
      {children}
    </button>
  )
}
