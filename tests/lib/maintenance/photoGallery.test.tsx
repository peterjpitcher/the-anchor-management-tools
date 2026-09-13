import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('@/app/actions/maintenance-photos', () => ({
  listMaintenancePhotos: vi.fn(),
  redactMaintenancePhoto: vi.fn(),
  requestMaintenancePhotoUpload: vi.fn(),
  confirmMaintenancePhotoUpload: vi.fn(),
}))

vi.mock('@/app/(authenticated)/maintenance/_components/photoClient', () => ({
  uploadMaintenancePhoto: vi.fn(),
}))

vi.mock('@/lib/supabase/client', () => ({ createClient: vi.fn() }))

import {
  listMaintenancePhotos,
  redactMaintenancePhoto,
} from '@/app/actions/maintenance-photos'
import { uploadMaintenancePhoto } from '@/app/(authenticated)/maintenance/_components/photoClient'
import { MaintenancePhotos } from '@/app/(authenticated)/maintenance/_components/MaintenancePhotos'

const mockedList = listMaintenancePhotos as unknown as Mock
const mockedRedact = redactMaintenancePhoto as unknown as Mock
const mockedUpload = uploadMaintenancePhoto as unknown as Mock

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

  it('shows an error rather than loading for ever when the list call rejects', async () => {
    // A rejected promise, not a returned error: the connection dropped.
    mockedList.mockRejectedValue(new Error('Failed to fetch'))

    render(<MaintenancePhotos itemId={ITEM_ID} />)

    await waitFor(() => {
      expect(screen.getByText('The photos could not be loaded')).toBeInTheDocument()
    })
    expect(
      screen.getByText('The photos could not be loaded. Check your connection and try again.')
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
    // The spinner is gone, so nothing sits on "Loading photos".
    expect(screen.queryByText('Loading photos')).not.toBeInTheDocument()
  })

  it('recovers the picker when the upload rejects, so the same photo can be re-chosen', async () => {
    mockedList.mockResolvedValue({ photos: [] })
    mockedUpload.mockRejectedValue(new Error('Failed to fetch'))

    const { container } = render(<MaintenancePhotos itemId={ITEM_ID} />)
    await screen.findByRole('button', { name: 'Take photo' })

    const library = container.querySelectorAll('input[type="file"]')[1] as HTMLInputElement
    const file = new File([new Uint8Array(8)], 'IMG_0042.JPG', { type: 'image/jpeg' })
    await userEvent.upload(library, file)

    await waitFor(() => {
      expect(screen.getByText('IMG_0042.JPG could not be added')).toBeInTheDocument()
    })
    expect(
      screen.getByText('Could not upload that photo. Check your connection and try again.')
    ).toBeInTheDocument()
    // Nothing is left on a running stage.
    expect(screen.queryByText(/^Preparing/)).not.toBeInTheDocument()
    // The input is cleared, so choosing the same photo again still fires a change.
    expect(library.value).toBe('')
    expect(library.files).toHaveLength(0)
  })

  it('removes a photo only after a reason and an explicit confirmation', async () => {
    mockedList.mockResolvedValue({ photos: [photoView()] })
    mockedRedact.mockResolvedValue({ success: true, photoId: 'photo-1' })

    render(<MaintenancePhotos itemId={ITEM_ID} itemTitle="Leaking cellar tap" />)

    const remove = await screen.findByRole('button', {
      name: 'Remove Maintenance photo 1 of 1 of Leaking cellar tap',
    })
    fireEvent.click(remove)

    // The wording says the file goes and the record stays.
    expect(
      await screen.findByText(/The photo file is deleted permanently and cannot be recovered/)
    ).toBeInTheDocument()

    // An empty reason is refused before anything is sent.
    fireEvent.click(screen.getByRole('button', { name: 'Remove photo' }))
    expect(
      await screen.findByText('Please say briefly why this photo is being removed.')
    ).toBeInTheDocument()
    expect(mockedRedact).not.toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText('Why is it being removed?'), {
      target: { value: 'A payslip is readable on the worktop.' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Remove photo' }))

    await waitFor(() => {
      expect(mockedRedact).toHaveBeenCalledWith('photo-1', 'A payslip is readable on the worktop.')
    })
    await waitFor(() => {
      expect(screen.getByText('No photos yet')).toBeInTheDocument()
    })
  })

  it('keeps the photo and says so when the removal rejects', async () => {
    mockedList.mockResolvedValue({ photos: [photoView()] })
    mockedRedact.mockRejectedValue(new Error('Failed to fetch'))

    render(<MaintenancePhotos itemId={ITEM_ID} itemTitle="Leaking cellar tap" />)

    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Remove Maintenance photo 1 of 1 of Leaking cellar tap',
      })
    )
    fireEvent.change(await screen.findByLabelText('Why is it being removed?'), {
      target: { value: 'A payslip is readable on the worktop.' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Remove photo' }))

    expect(
      await screen.findByText('Could not remove that photo. Check your connection and try again.')
    ).toBeInTheDocument()
    // Nothing is assumed about the file, so the photo stays in the gallery and
    // the button is live again for a retry.
    expect(screen.getByAltText('Maintenance photo 1 of 1 of Leaking cellar tap')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remove photo' })).not.toBeDisabled()
  })

  it('offers no removal control when the caller may not upload', async () => {
    mockedList.mockResolvedValue({ photos: [photoView()] })

    render(<MaintenancePhotos itemId={ITEM_ID} itemTitle="Leaking cellar tap" canUpload={false} />)

    await screen.findByAltText('Maintenance photo 1 of 1 of Leaking cellar tap')
    expect(screen.queryByRole('button', { name: /^Remove/ })).not.toBeInTheDocument()
  })
})
