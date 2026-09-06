import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  LOGO_DEFAULT_WIDTH_FRAC,
  QR_DEFAULT_WIDTH_FRAC,
  QR_STRIP_LABEL,
  logoRect,
  logoRectFree,
  qrBlockRect,
  qrCodeRectWithinCanvas,
  qrMinWidthFrac,
  qrMinWidthPx,
  qrHardMinWidthPx,
  QR_MIN_WIDTH_FRAC,
  QR_MAX_WIDTH_FRAC,
  qrStripRect,
} from '@/lib/events/artwork/geometry'
import { EVENT_IMAGE_VARIANTS, type EventImageVariant } from '@/lib/events/imageVariants'

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}))

// The preview QR is a placement guide, so the real encoder is not needed and a
// stub keeps the suite off a PNG encoder it does not assert anything about.
vi.mock('qrcode', () => {
  const toDataURL = vi.fn().mockResolvedValue('data:image/png;base64,QUJD')
  return { default: { toDataURL }, toDataURL }
})

/**
 * dnd-kit is swapped for a fake that renders its children and hands the drag
 * callbacks back to the test.
 *
 * Its `PointerSensor` needs real `PointerEvent`s and a laid-out document, and
 * jsdom has neither, so driving the library here would test jsdom rather than
 * this component. What is worth asserting is what the modal does with a drag:
 * snap the axis, show the guide, and commit the position exactly once on drop.
 */
const dnd = vi.hoisted(() => ({
  onDragMove: null as ((event: unknown) => void) | null,
  onDragEnd: null as ((event: unknown) => void) | null,
}))

vi.mock('@dnd-kit/core', async () => {
  const React = await import('react')
  return {
    DndContext: ({
      children,
      onDragMove,
      onDragEnd,
    }: {
      children: React.ReactNode
      onDragMove: (event: unknown) => void
      onDragEnd: (event: unknown) => void
    }) => {
      dnd.onDragMove = onDragMove
      dnd.onDragEnd = onDragEnd
      return React.createElement(React.Fragment, null, children)
    },
    PointerSensor: class PointerSensorStub {},
    useSensor: () => ({}),
    useSensors: (...sensors: unknown[]) => sensors,
    useDraggable: () => ({
      attributes: {},
      listeners: {},
      setNodeRef: () => {},
      transform: null,
      isDragging: false,
    }),
  }
})

// Lightweight stand-ins for the design system so the test does not pull in the
// whole shell. ConfirmDialog keeps its real contract: nothing happens until the
// confirm button is pressed.
vi.mock('@/ds', async () => {
  const React = await import('react')
  return {
    Button: ({
      children,
      onClick,
      disabled,
    }: {
      children: React.ReactNode
      onClick?: () => void
      disabled?: boolean
      variant?: string
      size?: string
    }) =>
      React.createElement('button', { type: 'button', onClick, disabled }, children),
    ConfirmDialog: ({
      open,
      title,
      message,
      confirmLabel,
      onConfirm,
      onClose,
    }: {
      open: boolean
      title: string
      message?: React.ReactNode
      confirmLabel?: string
      onConfirm: () => unknown
      onClose: () => void
    }) =>
      open
        ? React.createElement(
            'div',
            { role: 'dialog', 'aria-label': title },
            React.createElement('p', null, message),
            React.createElement(
              'button',
              { type: 'button', onClick: () => void onConfirm() },
              confirmLabel ?? 'Confirm'
            ),
            React.createElement(
              'button',
              { type: 'button', onClick: onClose },
              'Keep the branding'
            )
          )
        : null,
  }
})

vi.mock('@/components/providers/SupabaseProvider', () => ({
  useSupabase: () => ({}),
}))

vi.mock('@/app/actions/event-image-variants', () => ({
  getEventImageVariants: vi.fn().mockResolvedValue({ data: [] }),
  deleteEventImageVariant: vi.fn(),
}))

import {
  getEventImageVariants,
  type EventImageVariantState,
} from '@/app/actions/event-image-variants'
import { ArtworkBrandingModal } from './ArtworkBrandingModal'
import { EventImagePanel } from './EventImagePanel'

const EVENT_ID = '3f2a1b4c-5d6e-4f70-8901-234567890abc'
const POSTER = EVENT_IMAGE_VARIANTS.print_poster
const POSTER_W = POSTER.targetWidth
const POSTER_H = POSTER.targetHeight

function rectString(rect: { x: number; y: number; width: number; height: number }): string {
  return `${rect.x},${rect.y},${rect.width},${rect.height}`
}

/** The preview the drag maths is done against. Any size works: the handler
 *  converts pixels to fractions of it, so only the ratio matters. */
const PREVIEW_W = 600
const PREVIEW_H = 848

function stubPreviewSize(): void {
  const preview = screen.getByTestId('artwork-preview')
  vi.spyOn(preview, 'getBoundingClientRect').mockReturnValue({
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: PREVIEW_W,
    bottom: PREVIEW_H,
    width: PREVIEW_W,
    height: PREVIEW_H,
    toJSON: () => ({}),
  } as DOMRect)
}

/** One drag, as fractions of the preview: a move and then a drop, which is the
 *  order dnd-kit fires them in. */
function drag(target: 'logo' | 'qr', dxFrac: number, dyFrac: number): void {
  const event = {
    active: { id: target },
    delta: { x: dxFrac * PREVIEW_W, y: dyFrac * PREVIEW_H },
  }
  act(() => {
    dnd.onDragMove?.(event)
    dnd.onDragEnd?.(event)
  })
}

function qrXPercent(): string {
  return (screen.getByLabelText('QR X (%)') as HTMLInputElement).value
}

function renderModal(
  overrides: Partial<React.ComponentProps<typeof ArtworkBrandingModal>> = {}
) {
  const onClose = vi.fn()
  const onApplied = vi.fn()
  render(
    <ArtworkBrandingModal
      open
      onClose={onClose}
      eventId={EVENT_ID}
      variant="print_poster"
      imageUrl="https://storage.test/event-images/poster.png"
      onApplied={onApplied}
      {...overrides}
    />
  )
  return { onClose, onApplied }
}

function okResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  } as unknown as Response
}

function errorResponse(status: number, body: unknown): Response {
  return {
    ok: false,
    status,
    json: async () => body,
  } as unknown as Response
}

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchMock = vi.fn().mockResolvedValue(okResponse({ url: 'https://storage.test/branded.png' }))
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('ArtworkBrandingModal, logo placement', () => {
  it('sets the placement from the corner picker and previews the geometry rect', async () => {
    const user = userEvent.setup()
    renderModal()

    await user.click(screen.getByRole('radio', { name: 'Top left' }))

    const expected = logoRect(POSTER_W, POSTER_H, 'top_left', LOGO_DEFAULT_WIDTH_FRAC)
    expect(screen.getByTestId('logo-overlay')).toHaveAttribute('data-rect', rectString(expected))
  })

  it('moves the logo by 1% on an arrow key and 5% with shift', async () => {
    const user = userEvent.setup()
    renderModal()

    await user.click(screen.getByRole('radio', { name: 'Free' }))
    // Away from the middle on purpose: the default free placement sits on the
    // centre, which is a snap target, and this test is about the step size
    // rather than about snapping. The snap behaviour has its own tests.
    fireEvent.change(screen.getByLabelText('Logo X (%)'), { target: { value: '30' } })
    const overlay = screen.getByTestId('logo-overlay')
    const xField = screen.getByLabelText('Logo X (%)') as HTMLInputElement

    const startX = Number(xField.value)

    overlay.focus()
    fireEvent.keyDown(overlay, { key: 'ArrowRight' })
    expect(Number((screen.getByLabelText('Logo X (%)') as HTMLInputElement).value)).toBe(startX + 1)

    fireEvent.keyDown(screen.getByTestId('logo-overlay'), { key: 'ArrowRight', shiftKey: true })
    expect(Number((screen.getByLabelText('Logo X (%)') as HTMLInputElement).value)).toBe(startX + 6)
  })

  it('sets the logo position exactly from the numeric fields', async () => {
    const user = userEvent.setup()
    renderModal()

    await user.click(screen.getByRole('radio', { name: 'Free' }))
    fireEvent.change(screen.getByLabelText('Logo X (%)'), { target: { value: '25' } })
    fireEvent.change(screen.getByLabelText('Logo Y (%)'), { target: { value: '40' } })

    const expected = logoRectFree(POSTER_W, POSTER_H, 0.25, 0.4, LOGO_DEFAULT_WIDTH_FRAC)
    expect(screen.getByTestId('logo-overlay')).toHaveAttribute('data-rect', rectString(expected))
  })

  it('keeps the colour and size when switching corner to free and back', async () => {
    const user = userEvent.setup()
    renderModal()

    await user.click(screen.getByRole('radio', { name: 'Black logo' }))
    fireEvent.change(screen.getByLabelText('Logo size'), { target: { value: '30' } })

    await user.click(screen.getByRole('radio', { name: 'Free' }))
    await user.click(screen.getByRole('radio', { name: 'Corner' }))

    expect(screen.getByRole('radio', { name: 'Black logo' })).toHaveAttribute(
      'aria-checked',
      'true'
    )
    expect((screen.getByLabelText('Logo size') as HTMLInputElement).value).toBe('30')
    expect(screen.getByTestId('logo-overlay')).toHaveAttribute(
      'data-rect',
      rectString(logoRect(POSTER_W, POSTER_H, 'bottom_right', 0.3))
    )
  })

  it('makes the corner picker reachable and operable by keyboard alone', async () => {
    const user = userEvent.setup()
    renderModal()

    const topRight = screen.getByRole('radio', { name: 'Top right' })
    expect(topRight.tagName).toBe('BUTTON')

    topRight.focus()
    expect(topRight).toHaveFocus()

    await user.keyboard('{Enter}')

    expect(screen.getByRole('radio', { name: 'Top right' })).toHaveAttribute(
      'aria-checked',
      'true'
    )
    expect(screen.getByTestId('logo-overlay')).toHaveAttribute(
      'data-rect',
      rectString(logoRect(POSTER_W, POSTER_H, 'top_right', LOGO_DEFAULT_WIDTH_FRAC))
    )
  })
})

describe('ArtworkBrandingModal, QR code', () => {
  it('does not render the QR controls for a variant that is not the poster', () => {
    renderModal({ variant: 'square', imageUrl: 'https://storage.test/square.png' })

    expect(screen.queryByRole('checkbox', { name: /QR code/i })).toBeNull()
    expect(screen.queryByLabelText('QR size')).toBeNull()
    expect(screen.queryByTestId('qr-overlay')).toBeNull()
  })

  it('will not let the QR size go below the hard minimum', () => {
    renderModal()

    const slider = screen.getByLabelText('QR size') as HTMLInputElement
    expect(Number(slider.min) / 100).toBeGreaterThanOrEqual(qrMinWidthFrac())

    fireEvent.change(slider, { target: { value: '5' } })

    // data-code-rect, not data-rect: the footprint that is dragged and outlined
    // is the code plus its BOOK NOW strip, and the 40mm minimum is about the
    // scannable square alone.
    const [, , width] = (screen.getByTestId('qr-overlay').getAttribute('data-code-rect') ?? '')
      .split(',')
      .map(Number)
    // The HARD floor now, not the 40mm guidance. 40mm is advisory and the
    // slider is allowed to go under it, which is the point of the change.
    expect(width).toBeGreaterThanOrEqual(qrHardMinWidthPx(POSTER_W))
  })

  it('starts a new QR at the shared default width', () => {
    renderModal()

    expect((screen.getByLabelText('QR size') as HTMLInputElement).value).toBe(
      String(Math.round(QR_DEFAULT_WIDTH_FRAC * 100))
    )
    expect(screen.getByTestId('qr-overlay')).toHaveAttribute(
      'data-code-rect',
      rectString(qrCodeRectWithinCanvas(POSTER_W, POSTER_H, 0.5, 0.8, QR_DEFAULT_WIDTH_FRAC))
    )
  })

  it('keeps every reachable QR width inside the bounds the route accepts', async () => {
    const user = userEvent.setup()
    renderModal()

    const slider = screen.getByLabelText('QR size') as HTMLInputElement
    // The route's schema imports the same bounds from geometry. Sending
    // qrMinWidthFrac() itself (0.190476...) would be refused with a 400, so the
    // control floor has to sit above it, not on it.
    expect(Number(slider.min) / 100).toBeGreaterThanOrEqual(QR_MIN_WIDTH_FRAC)
    expect(Number(slider.max) / 100).toBeLessThanOrEqual(QR_MAX_WIDTH_FRAC)
    expect(Number(slider.max) / 100).toBeLessThanOrEqual(0.4)

    // A typed value outside the range is pulled back in rather than posted.
    fireEvent.change(screen.getByLabelText('QR width (%)'), { target: { value: '99' } })
    await user.click(screen.getByRole('button', { name: /Save branding/ }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const body = JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body))
    expect(body.qr.widthFrac).toBeGreaterThanOrEqual(QR_MIN_WIDTH_FRAC)
    expect(body.qr.widthFrac).toBeLessThanOrEqual(0.4)
  })

  it('shows the destination the printed code will point at', () => {
    renderModal()
    // Derived from the event id, so it survives a rename, which is why a printed
    // poster can be repaired in place rather than reprinted.
    expect(screen.getByText('https://l.the-anchor.pub/po3f2a1b')).toBeInTheDocument()
  })

  it('shows the printed millimetre size so 40mm can be checked by eye', () => {
    renderModal()
    expect(screen.getByText(/mm on the A4 poster/)).toBeInTheDocument()
  })

  it('disables Save and gives the reason when the QR overlaps the logo', () => {
    renderModal()

    fireEvent.change(screen.getByLabelText('QR X (%)'), { target: { value: '90' } })
    fireEvent.change(screen.getByLabelText('QR Y (%)'), { target: { value: '95' } })

    expect(screen.getByRole('button', { name: /Save branding/ })).toBeDisabled()
    expect(screen.getByText('The QR code is too close to the logo.')).toBeInTheDocument()
  })
})

describe('ArtworkBrandingModal, snapping to the centre', () => {
  it('snaps a drag that lands near the centre onto it exactly, and shows the guide', () => {
    renderModal()
    stubPreviewSize()

    // 40% across, set exactly, so the drag starts well clear of the centre.
    fireEvent.change(screen.getByLabelText('QR X (%)'), { target: { value: '40' } })
    expect(screen.queryByTestId('snap-guide-x')).toBeNull()

    // Nine percent to the right lands on 49%, inside the two percent threshold.
    drag('qr', 0.09, 0)

    expect(qrXPercent()).toBe('50')
    expect(screen.getByTestId('snap-guide-x')).toBeInTheDocument()
    expect(screen.getByTestId('qr-overlay')).toHaveAttribute(
      'data-code-rect',
      rectString(qrCodeRectWithinCanvas(POSTER_W, POSTER_H, 0.5, 0.8, QR_DEFAULT_WIDTH_FRAC))
    )
    // The vertical position was never near the centre, so only one guide shows.
    expect(screen.queryByTestId('snap-guide-y')).toBeNull()
  })

  it('lets the snap go once the drag carries on past the threshold', () => {
    renderModal()
    stubPreviewSize()

    fireEvent.change(screen.getByLabelText('QR X (%)'), { target: { value: '40' } })
    drag('qr', 0.09, 0)
    expect(qrXPercent()).toBe('50')

    drag('qr', 0.05, 0)

    // 54, not 55: the pointer had really reached 49% when the snap showed 50%,
    // so another five percent of travel lands on 54%. The snap moves what is
    // stored and drawn, never where the next move is measured from, which is
    // what stops it becoming a trap around the centre.
    expect(qrXPercent()).toBe('54')
    expect(screen.queryByTestId('snap-guide-x')).toBeNull()
  })

  it('snaps an arrow-key nudge the same way, so a keyboard gets the same help', () => {
    renderModal()

    fireEvent.change(screen.getByLabelText('QR X (%)'), { target: { value: '48' } })
    expect(screen.queryByTestId('snap-guide-x')).toBeNull()

    // One press is a single percent, which would land on 49 without snapping.
    fireEvent.keyDown(screen.getByTestId('qr-overlay'), { key: 'ArrowRight' })

    expect(qrXPercent()).toBe('50')
    expect(screen.getByTestId('snap-guide-x')).toBeInTheDocument()
  })

  it('never snaps a typed position, because the field is the exact-entry route', () => {
    renderModal()

    fireEvent.change(screen.getByLabelText('QR X (%)'), { target: { value: '49' } })

    expect(qrXPercent()).toBe('49')
    expect(screen.queryByTestId('snap-guide-x')).toBeNull()
    expect(screen.getByTestId('qr-overlay')).toHaveAttribute(
      'data-code-rect',
      rectString(qrCodeRectWithinCanvas(POSTER_W, POSTER_H, 0.49, 0.8, QR_DEFAULT_WIDTH_FRAC))
    )
  })

  it('snaps the logo as well when it is placed freely', () => {
    renderModal()
    stubPreviewSize()

    fireEvent.click(screen.getByRole('radio', { name: 'Free' }))
    fireEvent.change(screen.getByLabelText('Logo X (%)'), { target: { value: '40' } })

    drag('logo', 0.09, 0)

    expect((screen.getByLabelText('Logo X (%)') as HTMLInputElement).value).toBe('50')
    expect(screen.getByTestId('snap-guide-x')).toBeInTheDocument()
  })
})

describe('ArtworkBrandingModal, what the preview shows', () => {
  it('gives the preview logo the shadow the compositor will print', async () => {
    const user = userEvent.setup()
    renderModal()

    // The shadow is always the opposite of the mark, which is what makes a
    // white logo readable on pale artwork and a black one on dark artwork.
    expect(screen.getByTestId('logo-preview-image').getAttribute('style')).toContain('rgba(0, 0, 0')

    await user.click(screen.getByRole('radio', { name: 'Black logo' }))

    expect(screen.getByTestId('logo-preview-image').getAttribute('style')).toContain(
      'rgba(255, 255, 255'
    )
  })

  it('draws the BOOK NOW strip beside the poster code', () => {
    renderModal()

    const strip = screen.getByTestId('qr-strip')
    expect(strip).toHaveTextContent(QR_STRIP_LABEL)

    // Laid out from the geometry module, so the strip sits where the compositor
    // will actually print it rather than wherever a percentage guessed here
    // happens to land.
    const code = qrCodeRectWithinCanvas(POSTER_W, POSTER_H, 0.5, 0.8, QR_DEFAULT_WIDTH_FRAC)
    const block = qrBlockRect(code)
    const stripRect = qrStripRect(code)
    expect(strip.style.left).toBe(`${((stripRect.x - block.x) / block.width) * 100}%`)
    expect(strip.style.width).toBe(`${(stripRect.width / block.width) * 100}%`)

    // The whole block is the drag footprint; the stored width still means the
    // code, which is what the 40mm print minimum is measured against.
    const overlay = screen.getByTestId('qr-overlay')
    expect(overlay).toHaveAttribute('data-rect', rectString(block))
    expect(overlay).toHaveAttribute('data-code-rect', rectString(code))
  })

  it('draws no strip on a variant that carries no QR code', () => {
    renderModal({ variant: 'square', imageUrl: 'https://storage.test/square.png' })

    expect(screen.queryByTestId('qr-strip')).toBeNull()
  })
})

describe('ArtworkBrandingModal, saving', () => {
  it('posts exactly the documented body shape', async () => {
    const user = userEvent.setup()
    const { onApplied, onClose } = renderModal()

    await user.click(screen.getByRole('button', { name: /Save branding/ }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`/api/events/${EVENT_ID}/artwork/composite`)
    expect(init.method).toBe('POST')
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' })

    const body = JSON.parse(String(init.body)) as Record<string, unknown>
    expect(body.variant).toBe('print_poster')
    expect(body.logo).toEqual({
      placement: { mode: 'corner', corner: 'bottom_right', widthFrac: LOGO_DEFAULT_WIDTH_FRAC },
      colour: 'white',
    })
    // Exactly three keys: the BOOK NOW strip is a rendering concern the server
    // derives from the code, so nothing about it may appear in the payload.
    expect(body.qr).toEqual({
      centreXFrac: 0.5,
      centreYFrac: 0.8,
      widthFrac: QR_DEFAULT_WIDTH_FRAC,
    })
    expect(body.action).toBeUndefined()

    await waitFor(() =>
      expect(onApplied).toHaveBeenCalledWith('print_poster', 'https://storage.test/branded.png')
    )
    expect(onClose).toHaveBeenCalled()
  })

  it('sends a free placement and a null QR when the QR is switched off', async () => {
    const user = userEvent.setup()
    renderModal()

    await user.click(screen.getByRole('radio', { name: 'Free' }))
    fireEvent.change(screen.getByLabelText('Logo X (%)'), { target: { value: '30' } })
    fireEvent.change(screen.getByLabelText('Logo Y (%)'), { target: { value: '60' } })
    await user.click(screen.getByRole('checkbox', { name: /Put a QR code on the poster/ }))

    await user.click(screen.getByRole('button', { name: /Save branding/ }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const body = JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body))
    expect(body.qr).toBeNull()
    expect(body.logo.placement).toEqual({
      mode: 'free',
      centreXFrac: 0.3,
      centreYFrac: 0.6,
      widthFrac: LOGO_DEFAULT_WIDTH_FRAC,
    })
  })

  it('sends a null logo when No logo is chosen', async () => {
    const user = userEvent.setup()
    renderModal()

    await user.click(screen.getByRole('radio', { name: 'No logo' }))
    await user.click(screen.getByRole('button', { name: /Save branding/ }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const body = JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body))
    expect(body.logo).toBeNull()
    expect(screen.queryByTestId('logo-overlay')).toBeNull()
  })

  it('renders a 422 detail word for word', async () => {
    const user = userEvent.setup()
    const detail =
      'This event has no slug yet, so the QR code has nowhere to point. Publish the event first.'
    fetchMock.mockResolvedValue(errorResponse(422, { code: 'poster_link_blocked', detail }))

    const { onClose } = renderModal()
    await user.click(screen.getByRole('button', { name: /Save branding/ }))

    expect(await screen.findByRole('alert')).toHaveTextContent(detail)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('explains a permission failure', async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValue(errorResponse(403, {}))

    renderModal()
    await user.click(screen.getByRole('button', { name: /Save branding/ }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'You do not have permission to brand event artwork.'
    )
  })
})

describe('ArtworkBrandingModal, revert', () => {
  it('asks for confirmation first, then posts the revert body', async () => {
    const user = userEvent.setup()
    renderModal()

    await user.click(screen.getByRole('button', { name: 'Revert to original' }))
    expect(fetchMock).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog', { name: 'Revert to original' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Revert' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const body = JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body))
    expect(body).toEqual({ variant: 'print_poster', action: 'revert' })
  })
})

describe('EventImagePanel upload copy', () => {
  it('says artwork uploads on save, and not that it uploads immediately, for a new event', async () => {
    render(<EventImagePanel eventId={null} />)

    expect(
      await screen.findByText(/It uploads automatically when you save the event\./)
    ).toBeInTheDocument()
    expect(screen.queryByText(/Images upload as soon as you choose them/)).toBeNull()
  })
})

describe('ArtworkBrandingModal, reopening on branded artwork', () => {
  it('opens at the saved corner, colour and size', () => {
    renderModal({
      branding: {
        originalStoragePath: 'events/x/print_poster/0_original.png',
        logo: {
          placement: { mode: 'corner', corner: 'top_left', widthFrac: 0.3 },
          colour: 'black',
        },
        qr: null,
      },
    })

    expect(screen.getByRole('radio', { name: 'Corner' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('radio', { name: 'Top left' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('radio', { name: 'Black logo' })).toHaveAttribute('aria-checked', 'true')
    expect((screen.getByLabelText('Logo size') as HTMLInputElement).value).toBe('30')
    expect(screen.getByTestId('logo-overlay')).toHaveAttribute(
      'data-rect',
      rectString(logoRect(POSTER_W, POSTER_H, 'top_left', 0.3))
    )
  })

  it('opens at the saved free placement', () => {
    renderModal({
      branding: {
        originalStoragePath: 'events/x/print_poster/0_original.png',
        logo: {
          placement: { mode: 'free', centreXFrac: 0.25, centreYFrac: 0.6, widthFrac: 0.18 },
          colour: 'white',
        },
        qr: null,
      },
    })

    expect(screen.getByRole('radio', { name: 'Free' })).toHaveAttribute('aria-checked', 'true')
    expect((screen.getByLabelText('Logo X (%)') as HTMLInputElement).value).toBe('25')
    expect((screen.getByLabelText('Logo Y (%)') as HTMLInputElement).value).toBe('60')
    expect(screen.getByTestId('logo-overlay')).toHaveAttribute(
      'data-rect',
      rectString(logoRectFree(POSTER_W, POSTER_H, 0.25, 0.6, 0.18))
    )
  })

  it('reopens on a deliberate no-logo poster with No logo still selected', () => {
    // Branded with no logo is an answer somebody gave, not an empty editor.
    renderModal({
      branding: {
        originalStoragePath: 'events/x/print_poster/0_original.png',
        logo: null,
        qr: null,
      },
    })

    expect(screen.getByRole('radio', { name: 'No logo' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.queryByTestId('logo-overlay')).toBeNull()
    expect(screen.getByRole('checkbox', { name: /Put a QR code on the poster/ })).not.toBeChecked()
    expect(screen.queryByTestId('qr-overlay')).toBeNull()
  })

  it('opens at the saved QR placement', () => {
    renderModal({
      branding: {
        originalStoragePath: 'events/x/print_poster/0_original.png',
        logo: null,
        qr: { centreXFrac: 0.5, centreYFrac: 0.82, widthFrac: 0.24, shortLinkId: null },
      },
    })

    expect(screen.getByRole('checkbox', { name: /Put a QR code on the poster/ })).toBeChecked()
    expect((screen.getByLabelText('QR X (%)') as HTMLInputElement).value).toBe('50')
    expect((screen.getByLabelText('QR Y (%)') as HTMLInputElement).value).toBe('82')
    expect((screen.getByLabelText('QR size') as HTMLInputElement).value).toBe('24')
  })

  it('still opens at the defaults when the artwork has never been branded', () => {
    renderModal({ branding: null })

    expect(screen.getByRole('radio', { name: 'Corner' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('radio', { name: 'White logo' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('checkbox', { name: /Put a QR code on the poster/ })).toBeChecked()
    expect(screen.getByTestId('logo-overlay')).toHaveAttribute(
      'data-rect',
      rectString(logoRect(POSTER_W, POSTER_H, 'bottom_right', LOGO_DEFAULT_WIDTH_FRAC))
    )
  })

  it('posts the saved placement back unchanged when nothing is touched', async () => {
    const user = userEvent.setup()
    renderModal({
      branding: {
        originalStoragePath: 'events/x/print_poster/0_original.png',
        logo: {
          placement: { mode: 'corner', corner: 'top_left', widthFrac: 0.3 },
          colour: 'black',
        },
        qr: { centreXFrac: 0.4, centreYFrac: 0.7, widthFrac: 0.25, shortLinkId: null },
      },
    })

    await user.click(screen.getByRole('button', { name: /Save branding/ }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const body = JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body))
    expect(body.logo).toEqual({
      placement: { mode: 'corner', corner: 'top_left', widthFrac: 0.3 },
      colour: 'black',
    })
    expect(body.qr).toEqual({ centreXFrac: 0.4, centreYFrac: 0.7, widthFrac: 0.25 })
  })
})

describe('EventImagePanel branded indicator', () => {
  function variantState(
    overrides: Partial<EventImageVariantState> & { variant: EventImageVariant }
  ): EventImageVariantState {
    return {
      url: `https://storage.test/${overrides.variant}.png`,
      owned: true,
      categoryName: null,
      fileName: 'a.png',
      sizeBytes: 1000,
      mimeType: 'image/png',
      updatedAt: null,
      branding: null,
      ...overrides,
    }
  }

  it('marks only the tile whose artwork carries branding', async () => {
    vi.mocked(getEventImageVariants).mockResolvedValue({
      data: [
        variantState({
          variant: 'square',
          branding: {
            originalStoragePath: 'events/x/square/0_original.png',
            logo: {
              placement: { mode: 'corner', corner: 'bottom_right', widthFrac: 0.22 },
              colour: 'white',
            },
            qr: null,
          },
        }),
        variantState({ variant: 'landscape' }),
        variantState({ variant: 'social' }),
        variantState({ variant: 'story' }),
        variantState({ variant: 'print_poster' }),
      ],
    })

    render(<EventImagePanel eventId={EVENT_ID} />)

    expect(await screen.findByTestId('branded-badge-square')).toHaveTextContent('Branded')
    expect(screen.getAllByText('Branded')).toHaveLength(1)
    expect(screen.queryByTestId('branded-badge-print_poster')).toBeNull()
  })

  it('shows no indicator at all when nothing is branded', async () => {
    vi.mocked(getEventImageVariants).mockResolvedValue({
      data: [variantState({ variant: 'square' })],
    })

    render(<EventImagePanel eventId={EVENT_ID} />)

    expect(await screen.findByText('Event artwork')).toBeInTheDocument()
    expect(screen.queryByText('Branded')).toBeNull()
  })
})
