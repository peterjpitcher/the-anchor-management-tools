import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

vi.mock('@/app/actions/maintenance-photos', () => ({
  listMaintenancePhotos: vi.fn(),
  requestMaintenancePhotoUpload: vi.fn(),
  confirmMaintenancePhotoUpload: vi.fn(),
}))

vi.mock('@/lib/supabase/client', () => ({ createClient: vi.fn() }))

import { listMaintenancePhotos } from '@/app/actions/maintenance-photos'
import { MaintenancePhotos } from '@/app/(authenticated)/maintenance/_components/MaintenancePhotos'

const mockedList = listMaintenancePhotos as unknown as Mock

const ITEM_ID = '11111111-1111-4111-8111-111111111111'

function photoView(overrides: Record<string, unknown> = {}) {
  return {
    id: 'photo-1',
    itemId: ITEM_ID,
    storagePath: `${ITEM_ID}/aaaa.jpg`,
    fileName: 'IMG_0042.JPG',
    mimeType: 'image/jpeg',
    fileSizeBytes: 1024,
    width: 2000,
    height: 1500,
    caption: null,
    takenOn: null,
    state: 'ready',
    uploadedBy: null,
    uploadedByEmail: 'owner@example.com',
    uploadedAt: '2026-09-05T09:00:00.000Z',
    redactedAt: null,
    redactedBy: null,
    redactedByEmail: null,
    redactionReason: null,
    signedUrl: `https://storage.example/sign/${ITEM_ID}/aaaa.jpg?token=abc`,
    signedUrlExpiresAt: '2026-09-05T10:00:00.000Z',
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('MaintenancePhotos', () => {
  it('offers two separate photo controls, only one of which asks for the camera', async () => {
    mockedList.mockResolvedValue({ photos: [] })

    const { container } = render(<MaintenancePhotos itemId={ITEM_ID} itemTitle="Leaking cellar tap" />)

    const take = await screen.findByRole('button', { name: 'Take photo' })
    const choose = screen.getByRole('button', { name: 'Choose existing photo' })

    // Both are real buttons, so both are keyboard operable by default.
    expect(take.tagName).toBe('BUTTON')
    expect(choose.tagName).toBe('BUTTON')
    expect(take).not.toBeDisabled()
    expect(choose).not.toBeDisabled()

    const inputs = Array.from(container.querySelectorAll('input[type="file"]'))
    expect(inputs).toHaveLength(2)

    for (const input of inputs) {
      // HEIC is deliberately excluded, which also stops Safari 17+ writing HEIC.
      expect(input.getAttribute('accept')).toBe('image/jpeg,image/png,image/webp')
    }

    const withCapture = inputs.filter((input) => input.getAttribute('capture') === 'environment')
    expect(withCapture).toHaveLength(1)
    // capture is a hint browsers may ignore, so the other control has none.
    expect(inputs.filter((input) => !input.hasAttribute('capture'))).toHaveLength(1)
  })

  it('announces upload status politely', async () => {
    mockedList.mockResolvedValue({ photos: [] })

    const { container } = render(<MaintenancePhotos itemId={ITEM_ID} />)
    await screen.findByRole('button', { name: 'Take photo' })

    const live = container.querySelector('[aria-live="polite"]')
    expect(live).not.toBeNull()
    expect(live?.getAttribute('role')).toBe('status')
  })

  it('shows a plain img on the signed URL with meaningful alternative text', async () => {
    mockedList.mockResolvedValue({ photos: [photoView()] })

    const { container } = render(<MaintenancePhotos itemId={ITEM_ID} itemTitle="Leaking cellar tap" />)

    const image = await screen.findByAltText('Maintenance photo 1 of 1 of Leaking cellar tap')
    expect(image.tagName).toBe('IMG')
    expect(image.getAttribute('src')).toContain('/sign/')
    expect(image.getAttribute('loading')).toBe('lazy')
    // next/image would have rewritten the src through /_next/image, which the
    // production optimiser rejects for a /sign/ path with a 400.
    expect(image.getAttribute('src')).not.toContain('/_next/image')
    expect(container.querySelectorAll('img')).toHaveLength(1)
  })

  it('prefers the caption for alternative text when there is one', async () => {
    mockedList.mockResolvedValue({ photos: [photoView({ caption: 'Water pooling under the tap' })] })

    render(<MaintenancePhotos itemId={ITEM_ID} itemTitle="Leaking cellar tap" />)

    expect(await screen.findByAltText('Water pooling under the tap')).toBeInTheDocument()
  })

  it('shows a read failure as an explicit error, never as an empty gallery', async () => {
    mockedList.mockResolvedValue({ error: 'The photos could not be loaded. Please try again.' })

    render(<MaintenancePhotos itemId={ITEM_ID} />)

    await waitFor(() => {
      expect(screen.getByText('The photos could not be loaded')).toBeInTheDocument()
    })
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
    expect(screen.queryByText('No photos yet')).not.toBeInTheDocument()
  })

  it('hides the upload controls when the caller may not upload', async () => {
    mockedList.mockResolvedValue({ photos: [] })

    render(<MaintenancePhotos itemId={ITEM_ID} canUpload={false} />)

    await waitFor(() => {
      expect(screen.getByText('No photos yet')).toBeInTheDocument()
    })
    expect(screen.queryByRole('button', { name: 'Take photo' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Choose existing photo' })).not.toBeInTheDocument()
  })
})
