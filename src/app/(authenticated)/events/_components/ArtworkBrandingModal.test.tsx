import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  LOGO_DEFAULT_WIDTH_FRAC,
  logoRect,
  logoRectFree,
  qrMinWidthFrac,
  qrMinWidthPx,
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

  it('will not let the QR size go below the print minimum', () => {
    renderModal()

    const slider = screen.getByLabelText('QR size') as HTMLInputElement
    expect(Number(slider.min) / 100).toBeGreaterThanOrEqual(qrMinWidthFrac())

    fireEvent.change(slider, { target: { value: '5' } })

    const [, , width] = (screen.getByTestId('qr-overlay').getAttribute('data-rect') ?? '')
      .split(',')
      .map(Number)
    expect(width).toBeGreaterThanOrEqual(qrMinWidthPx(POSTER_W))
  })

  it('keeps every reachable QR width inside the bounds the route accepts', async () => {
    const user = userEvent.setup()
    renderModal()

    const slider = screen.getByLabelText('QR size') as HTMLInputElement
    // The route's own schema is z.number().min(0.1905).max(0.4). Sending
    // qrMinWidthFrac() itself (0.190476...) would be refused with a 400, so the
    // control floor has to sit above it, not on it.
    expect(Number(slider.min) / 100).toBeGreaterThanOrEqual(0.1905)
    expect(Number(slider.max) / 100).toBeLessThanOrEqual(0.4)

    // A typed value outside the range is pulled back in rather than posted.
    fireEvent.change(screen.getByLabelText('QR width (%)'), { target: { value: '99' } })
    await user.click(screen.getByRole('button', { name: /Save branding/ }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const body = JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body))
    expect(body.qr.widthFrac).toBeGreaterThanOrEqual(0.1905)
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
    expect(body.qr).toEqual({ centreXFrac: 0.5, centreYFrac: 0.8, widthFrac: 0.22 })
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
