'use client'

/**
 * Places the venue logo, and on the A4 poster a booking QR code, onto artwork
 * that has already been uploaded for an event.
 *
 * Five decisions here that later edits must not undo:
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
 * 5. SNAPPING IS A DRAG AND KEYBOARD AID, NOT A CONSTRAINT. `snapFrac` pulls a
 *    move onto the exact centre when it lands close, draws a guide line while
 *    it holds, and lets go the moment the move passes the threshold. The
 *    numeric fields deliberately bypass it: they are the exact-entry escape
 *    hatch, and silently turning a typed 49% into 50% would be a bug.
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
  type DragMoveEvent,
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
  QR_DEFAULT_WIDTH_FRAC,
  QR_MIN_MM,
  QR_STRIP_LABEL,
  cssDropShadow,
  logoRectFree,
  logoShadowSpec,
  qrBlockRect,
  qrCodeRectWithinCanvas,
  qrMinWidthFrac,
  qrStripRect,
  resolveLogoRect,
  snapFrac,
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

/**
 * Which axes are currently held on a snap target, and where.
 *
 * `x` and `y` carry the target fraction so the guide can be drawn exactly where
 * the snap landed rather than assuming it was the centre.
 */
interface SnapAxes {
  x: number | null
  y: number | null
}

/** One shared "nothing is snapped" value, so clearing the guide twice does not
 *  hand React a new object and force a pointless re-render. */
const NO_SNAP: SnapAxes = { x: null, y: null }

/**
 * The preview width in CSS pixels assumed until the element has been measured.
 *
 * Only the drop shadow uses it, and only for a frame: a `ResizeObserver` takes
 * over as soon as there is a layout. It matters because the shadow is computed
 * from the DISPLAYED logo, so an unmeasured preview must not fall back to the
 * full-resolution canvas and paint a shadow ten times too heavy.
 */
const NOMINAL_PREVIEW_WIDTH_PX = 600

/** How much of the strip's displayed width the label glyphs take. */
const QR_STRIP_FONT_FRAC = 0.6

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

/** A length as a CSS percentage of the box it is being placed inside. */
function percentOf(length: number, total: number): string {
  return `${(length / total) * 100}%`
}

/** Do two snap states describe the same thing? Used to hold object identity so
 *  a pointer move that changes nothing does not re-render the editor. */
function sameSnap(a: SnapAxes, b: SnapAxes): boolean {
  return a.x === b.x && a.y === b.y
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
  const initialLogoCentre =
    savedPlacement?.mode === 'free'
      ? { x: savedPlacement.centreXFrac, y: savedPlacement.centreYFrac }
      : DEFAULT_FREE_CENTRE
  const [logoCentre, setLogoCentre] = useState(initialLogoCentre)
  const [logoWidthFrac, setLogoWidthFrac] = useState(
    savedPlacement?.widthFrac ?? LOGO_DEFAULT_WIDTH_FRAC
  )
  const [colour, setColour] = useState<LogoColour>(savedLogo?.colour ?? 'white')

  const [qrOn, setQrOn] = useState(isPoster && (branding ? savedQr !== null : true))
  const initialQrCentre = savedQr
    ? { x: savedQr.centreXFrac, y: savedQr.centreYFrac }
    : DEFAULT_QR_CENTRE
  const [qrCentre, setQrCentre] = useState(initialQrCentre)
  const [qrWidthFrac, setQrWidthFrac] = useState(savedQr?.widthFrac ?? QR_DEFAULT_WIDTH_FRAC)
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)

  const [busy, setBusy] = useState(false)
  const [apiError, setApiError] = useState<string | null>(null)
  const [confirmRevert, setConfirmRevert] = useState(false)

  /**
   * The guide belongs to whatever is being moved right now, which is why there
   * is one of these and not one per overlay: moving the QR replaces the logo's
   * guide, exactly as a manager expects when their attention has moved on.
   */
  const [snapGuide, setSnapGuide] = useState<SnapAxes>(NO_SNAP)

  /**
   * Where each item really is, before snapping rounded it off.
   *
   * Without this a snap becomes a trap: from dead centre, every 1% arrow press
   * would land back inside the 2% threshold and be pulled straight back, so the
   * logo could never be nudged off the middle at all. Moves accumulate against
   * the true position and the snapped value is only what gets stored and drawn,
   * which is how a second press escapes.
   */
  const rawCentreRef = useRef<Record<'logo' | 'qr', { x: number; y: number }>>({
    logo: initialLogoCentre,
    qr: initialQrCentre,
  })

  const previewRef = useRef<HTMLDivElement | null>(null)
  const [previewWidthPx, setPreviewWidthPx] = useState(NOMINAL_PREVIEW_WIDTH_PX)

  /**
   * Measure the preview so the drop shadow can be drawn at the size it is being
   * looked at. The observer is optional: without one the nominal width above
   * still gives a shadow of roughly the right weight, which beats none at all.
   */
  useEffect(() => {
    const node = previewRef.current
    if (!node) return
    const measure = (): void => {
      const width = node.getBoundingClientRect().width
      if (width > 0) setPreviewWidthPx(width)
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => observer.disconnect()
  }, [open])

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

  /**
   * The scannable square. `qr_width_frac` and the stored centre both describe
   * THIS rect and nothing else, which is what keeps the 40mm print minimum and
   * the database CHECK meaning what they say. `qrCodeRectWithinCanvas` shifts it
   * back when the BOOK NOW strip beside it would otherwise hang off the edge.
   */
  const qrCodeBox = useMemo(
    () =>
      isPoster && qrOn
        ? qrCodeRectWithinCanvas(imageW, imageH, qrCentre.x, qrCentre.y, qrWidthFrac)
        : null,
    [isPoster, qrOn, imageW, imageH, qrCentre, qrWidthFrac]
  )

  /** The strip, and the code plus strip: what actually lands on the artwork, and
   *  therefore what is dragged and outlined. */
  const qrStripBox = useMemo(() => (qrCodeBox ? qrStripRect(qrCodeBox) : null), [qrCodeBox])
  const qrBlockBox = useMemo(() => (qrCodeBox ? qrBlockRect(qrCodeBox) : null), [qrCodeBox])

  /** The label has to fit the strip at the size it is being looked at, so this
   *  comes off the displayed width rather than the poster's pixels. */
  const qrStripFontPx = qrStripBox
    ? Math.max(5, Math.round((qrStripBox.width / imageW) * previewWidthPx * QR_STRIP_FONT_FRAC))
    : 0

  const qrCheck = useMemo(
    () =>
      qrCodeBox
        ? // The CODE goes in, not the block: the validator grows it into the
          // block itself, and handing it a block would measure a block of a
          // block and reject placements the compositor is happy with.
          validateQrPlacement(imageW, imageH, qrCodeBox, logoBox)
        : ({ ok: true } as const),
    [qrCodeBox, imageW, imageH, logoBox]
  )

  // Still the code, deliberately: the printed-size readout is about the thing a
  // phone has to scan, and the strip is not part of that measurement.
  const qrMillimetres = qrCodeBox ? (qrCodeBox.width * A4_WIDTH_MM) / imageW : 0

  /**
   * The composited logo carries a shadow in the opposite colour, so the preview
   * has to as well or someone positions the mark against a picture that is not
   * the file they get.
   *
   * The spec is computed from the DISPLAYED logo, not the full-resolution one.
   * `logoShadowSpec` returns pixels as a fraction of the logo width, and on the
   * 2480px poster that is an 87px blur: correct on the file, and absurd over a
   * preview a quarter of the size. Scaling the rect first keeps the shadow the
   * same relative weight on screen as it is on the artwork.
   */
  const logoShadowFilter = useMemo(() => {
    if (!logoBox) return undefined
    const scale = previewWidthPx / imageW
    return cssDropShadow(
      logoShadowSpec(
        {
          x: logoBox.x * scale,
          y: logoBox.y * scale,
          width: logoBox.width * scale,
          height: logoBox.height * scale,
        },
        colour
      )
    )
  }, [logoBox, previewWidthPx, imageW, colour])

  /**
   * Said once, when an axis catches, and cleared when it lets go. `snapGuide`
   * only changes identity on a real transition, so a drag across the centre
   * announces once instead of on every pointer move.
   */
  const snapMessage = useMemo(() => {
    const axes: string[] = []
    if (snapGuide.x !== null) axes.push('horizontal centre')
    if (snapGuide.y !== null) axes.push('vertical centre')
    return axes.length === 0 ? '' : `Snapped to the ${axes.join(' and ')}.`
  }, [snapGuide])

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

  /**
   * Where a move lands, and which axes the snap caught.
   *
   * The current position is settled against the geometry module's own clamped
   * rect first, so pressing left at the margin ten times does not bank ten
   * presses that have to be undone before the item moves right again. Both the
   * pointer drag and the arrow keys arrive here, which is exactly why keyboard
   * users get the same snapping help as a mouse.
   */
  const resolveMove = useCallback(
    (
      target: 'logo' | 'qr',
      dx: number,
      dy: number
    ): {
      centre: { x: number; y: number }
      raw: { x: number; y: number }
      snap: SnapAxes
    } => {
      const current = rawCentreRef.current[target]
      const settled = centreOf(
        target === 'logo'
          ? logoRectFree(imageW, imageH, current.x, current.y, logoWidthFrac)
          : qrCodeRectWithinCanvas(imageW, imageH, current.x, current.y, qrWidthFrac),
        imageW,
        imageH
      )
      const raw = { x: clampFraction(settled.x + dx), y: clampFraction(settled.y + dy) }
      const x = snapFrac(raw.x)
      const y = snapFrac(raw.y)
      return { centre: { x: x.value, y: y.value }, raw, snap: { x: x.snappedTo, y: y.snappedTo } }
    },
    [imageW, imageH, logoWidthFrac, qrWidthFrac]
  )

  /** Hold the object identity when nothing changed, so a pointer move that is
   *  still inside the same snap does not re-render the editor. */
  const showSnap = useCallback((snap: SnapAxes): void => {
    setSnapGuide((current) => (sameSnap(current, snap) ? current : snap))
  }, [])

  const nudge = useCallback(
    (target: 'logo' | 'qr', dx: number, dy: number): void => {
      const { centre, raw, snap } = resolveMove(target, dx, dy)
      // Only a committed move updates the true position. A drag in progress
      // must not, or the guide flickering past the centre would drag the
      // starting point along with it.
      rawCentreRef.current[target] = raw
      if (target === 'logo') setLogoCentre(centre)
      else setQrCentre(centre)
      showSnap(snap)
    },
    [resolveMove, showSnap]
  )

  /**
   * Set one axis to exactly what was typed, with no snapping at all.
   *
   * Deliberate, and the reason the true position is written here too: a typed
   * 49% has to stay 49% and has to be where the next arrow press starts from.
   */
  const setExactCentre = useCallback(
    (target: 'logo' | 'qr', axis: 'x' | 'y', value: number): void => {
      const next = clampFraction(value)
      rawCentreRef.current[target] = { ...rawCentreRef.current[target], [axis]: next }
      const apply = target === 'logo' ? setLogoCentre : setQrCentre
      apply((current) => ({ ...current, [axis]: next }))
      setSnapGuide(NO_SNAP)
    },
    []
  )

  const nudgeLogo = useCallback((dx: number, dy: number): void => nudge('logo', dx, dy), [nudge])
  const nudgeQr = useCallback((dx: number, dy: number): void => nudge('qr', dx, dy), [nudge])

  const dragMove = useCallback(
    (
      event: DragEndEvent | DragMoveEvent
    ): { target: 'logo' | 'qr'; dx: number; dy: number } | null => {
      const id = event.active.id
      if (id !== 'logo' && id !== 'qr') return null
      const box = previewRef.current?.getBoundingClientRect()
      // No measurable preview means no reliable conversion from pixels to
      // fractions, so the drag is dropped rather than guessed at.
      if (!box || box.width === 0 || box.height === 0) return null
      return { target: id, dx: event.delta.x / box.width, dy: event.delta.y / box.height }
    },
    []
  )

  /**
   * The guide follows the pointer, so the snap is visible before the button is
   * released. Only the guide: the position itself is still committed once, on
   * drop, exactly as decision 2 above requires.
   */
  const handleDragMove = useCallback(
    (event: DragMoveEvent) => {
      const move = dragMove(event)
      if (!move) return
      showSnap(resolveMove(move.target, move.dx, move.dy).snap)
    },
    [dragMove, resolveMove, showSnap]
  )

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const move = dragMove(event)
      if (!move) return
      nudge(move.target, move.dx, move.dy)
    },
    [dragMove, nudge]
  )

  /**
   * A cancelled drag (Escape, or a lost pointer) fires this instead of drag end,
   * so the guide the pointer left behind has to go: nothing moved, and a line
   * still sitting there would claim a snap that was never committed.
   */
  const handleDragCancel = useCallback((): void => {
    setSnapGuide(NO_SNAP)
  }, [])

  function resetLogoPlacement(): void {
    setCorner(DEFAULT_CORNER)
    setLogoCentre(DEFAULT_FREE_CENTRE)
    rawCentreRef.current.logo = DEFAULT_FREE_CENTRE
    setLogoWidthFrac(LOGO_DEFAULT_WIDTH_FRAC)
    setSnapGuide(NO_SNAP)
  }

  function resetQrPlacement(): void {
    setQrCentre(DEFAULT_QR_CENTRE)
    rawCentreRef.current.qr = DEFAULT_QR_CENTRE
    setQrWidthFrac(QR_DEFAULT_WIDTH_FRAC)
    setSnapGuide(NO_SNAP)
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
            <DndContext
              sensors={sensors}
              onDragMove={handleDragMove}
              onDragEnd={handleDragEnd}
              onDragCancel={handleDragCancel}
            >
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
                        data-testid="logo-preview-image"
                        className="pointer-events-none h-full w-full object-contain"
                        draggable={false}
                        style={{ filter: logoShadowFilter }}
                      />
                    </PlacementOverlay>
                  )}

                  {qrBlockBox && qrCodeBox && qrStripBox && (
                    <PlacementOverlay
                      id="qr"
                      testId="qr-overlay"
                      label="QR code position"
                      // The BLOCK is dragged and outlined, because the block is
                      // what lands on the artwork. `codeRect` carries the code
                      // on its own, which is what the stored width still means.
                      rect={qrBlockBox}
                      codeRect={qrCodeBox}
                      imageW={imageW}
                      imageH={imageH}
                      draggable
                      invalid={!qrCheck.ok}
                      onNudge={nudgeQr}
                    >
                      <span
                        data-testid="qr-strip"
                        className="pointer-events-none absolute top-0 flex items-center justify-center overflow-hidden font-semibold leading-none"
                        style={{
                          left: percentOf(qrStripBox.x - qrBlockBox.x, qrBlockBox.width),
                          width: percentOf(qrStripBox.width, qrBlockBox.width),
                          height: '100%',
                          // Deliberately literal black and white rather than
                          // design tokens: this is a picture of what the
                          // compositor prints, and printing it in the app's
                          // theme colours would make the preview a lie.
                          backgroundColor: '#000000',
                          color: '#ffffff',
                          // vertical-rl plus a half turn reads bottom to top,
                          // which is the convention for a spine label.
                          writingMode: 'vertical-rl',
                          transform: 'rotate(180deg)',
                          fontSize: `${qrStripFontPx}px`,
                          letterSpacing: '0.08em',
                        }}
                      >
                        {QR_STRIP_LABEL}
                      </span>

                      <span
                        className="pointer-events-none absolute top-0"
                        style={{
                          left: percentOf(qrCodeBox.x - qrBlockBox.x, qrBlockBox.width),
                          width: percentOf(qrCodeBox.width, qrBlockBox.width),
                          height: '100%',
                        }}
                      >
                        {qrDataUrl && (
                          <img
                            src={qrDataUrl}
                            alt=""
                            className="pointer-events-none h-full w-full object-contain"
                            draggable={false}
                          />
                        )}
                        {/* The caption sits ON the code deliberately. It labels
                            the preview as a guide and makes it unscannable, so
                            nobody points a phone at a screen and books from a
                            draft. */}
                        <span className="pointer-events-none absolute inset-x-0 bottom-0 bg-text/75 px-1 py-0.5 text-center text-[10px] font-medium leading-tight text-surface">
                          Guide only
                        </span>
                      </span>
                    </PlacementOverlay>
                  )}

                  {/* The guides sit above the overlays so a snapped edge is
                      still visible against the artwork, and are decorative:
                      the polite region below says the same thing in words. */}
                  {snapGuide.x !== null && (
                    <div
                      data-testid="snap-guide-x"
                      aria-hidden="true"
                      className="pointer-events-none absolute inset-y-0 w-0.5 -translate-x-1/2 bg-primary ring-1 ring-surface/70"
                      style={{ left: `${snapGuide.x * 100}%` }}
                    />
                  )}
                  {snapGuide.y !== null && (
                    <div
                      data-testid="snap-guide-y"
                      aria-hidden="true"
                      className="pointer-events-none absolute inset-x-0 h-0.5 -translate-y-1/2 bg-primary ring-1 ring-surface/70"
                      style={{ top: `${snapGuide.y * 100}%` }}
                    />
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

                    {/* Typed positions are NOT snapped, on purpose. These fields
                        are the exact-entry escape hatch from the snapping the
                        drag and arrow keys apply, and quietly turning a typed
                        49% into 50% would make the number on screen a lie.
                        Setting one clears the guide for the same reason. */}
                    <div className="grid grid-cols-3 gap-2">
                      <NumberField
                        id={`${fieldId}-logo-x`}
                        label="Logo X"
                        suffix="%"
                        min={0}
                        max={100}
                        value={toPercent(logoCentre.x)}
                        disabled={logoMode !== 'free'}
                        onChange={(next) => setExactCentre('logo', 'x', next / 100)}
                      />
                      <NumberField
                        id={`${fieldId}-logo-y`}
                        label="Logo Y"
                        suffix="%"
                        min={0}
                        max={100}
                        value={toPercent(logoCentre.y)}
                        disabled={logoMode !== 'free'}
                        onChange={(next) => setExactCentre('logo', 'y', next / 100)}
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

                      {/* Exact entry, so these are not snapped either. */}
                      <div className="grid grid-cols-3 gap-2">
                        <NumberField
                          id={`${fieldId}-qr-x`}
                          label="QR X"
                          suffix="%"
                          min={0}
                          max={100}
                          value={toPercent(qrCentre.x)}
                          onChange={(next) => setExactCentre('qr', 'x', next / 100)}
                        />
                        <NumberField
                          id={`${fieldId}-qr-y`}
                          label="QR Y"
                          suffix="%"
                          min={0}
                          max={100}
                          value={toPercent(qrCentre.y)}
                          onChange={(next) => setExactCentre('qr', 'y', next / 100)}
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

                      {qrCodeBox && (
                        <p className="text-xs text-text-muted">
                          Printed size: {qrCodeBox.width} px, {qrMillimetres.toFixed(0)} mm on the
                          A4 poster. The {QR_STRIP_LABEL} strip is printed beside it.
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

              {/* The guide line is the sighted signal; this is the same news for
                  anyone who cannot see it. It changes only when an axis catches
                  or lets go, so a drag across the centre is announced once
                  rather than on every pointer move. */}
              <p role="status" aria-live="polite" className="sr-only">
                {snapMessage}
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
  /** The footprint: what is dragged, outlined and reported as `data-rect`. */
  rect: Rect
  /**
   * For the QR, the scannable square inside that footprint, published as
   * `data-code-rect`. The stored width fraction still describes this rect and
   * not the wider block, so the two are kept separately readable.
   */
  codeRect?: Rect
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
  codeRect,
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
      data-code-rect={
        codeRect
          ? `${codeRect.x},${codeRect.y},${codeRect.width},${codeRect.height}`
          : undefined
      }
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
