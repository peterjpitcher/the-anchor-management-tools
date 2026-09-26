import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

vi.mock('@/app/actions/event-images', () => ({
  uploadEventImage: vi.fn(),
  deleteEventImage: vi.fn(),
  deleteCategoryImage: vi.fn(),
}))

import { uploadEventImage } from '@/app/actions/event-images'
import { SquareImageUpload } from '@/components/features/shared/SquareImageUpload'

function chooseFile(container: HTMLElement, file: File): void {
  const input = container.querySelector('input[type="file"]') as HTMLInputElement
  fireEvent.change(input, { target: { files: [file] } })
}

describe('SquareImageUpload', () => {
  it('names the drop zone with the field label and describes it with the hints', () => {
    render(
      <SquareImageUpload
        entityId="cat-1"
        entityType="category"
        label="Default Event Image"
        helpText="Upload a default square image"
      />,
    )

    const zone = screen.getByRole('button', { name: 'Default Event Image' })
    expect(zone).toHaveAccessibleDescription(/JPEG, PNG or WebP, up to 10MB/)
    expect(zone).toHaveAccessibleDescription(/Upload a default square image/)
  })

  it('asks for a save first instead of offering the drop zone on a new record', () => {
    render(<SquareImageUpload entityId="new" entityType="event" />)

    expect(screen.getByText('Save the event first before uploading images')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Image' })).not.toBeInTheDocument()
  })

  it('keeps the drop zone on screen but disabled while a file uploads', async () => {
    let finish: (value: { type: 'success'; imageUrl: string }) => void = () => {}
    vi.mocked(uploadEventImage).mockImplementation(
      () => new Promise((resolve) => { finish = resolve as typeof finish }),
    )
    const onImageUploaded = vi.fn()
    const { container } = render(
      <SquareImageUpload entityId="evt-1" entityType="event" onImageUploaded={onImageUploaded} />,
    )

    chooseFile(container, new File(['x'], 'hero.png', { type: 'image/png' }))

    const zone = screen.getByRole('button', { name: 'Image' })
    expect(zone).toBeDisabled()
    expect(screen.getByText('Uploading…')).toBeInTheDocument()

    finish({ type: 'success', imageUrl: 'https://example.test/hero.png' })
    expect(await screen.findByText('The image uploads as soon as you choose it.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Image' })).toBeEnabled()
    expect(onImageUploaded).toHaveBeenCalledWith('https://example.test/hero.png')
  })

  it('confirms a delete with the danger button', () => {
    render(<SquareImageUpload entityId="evt-1" entityType="event" currentImageUrl="https://example.test/old.png" />)

    fireEvent.click(screen.getByRole('button', { name: 'Delete image' }))

    expect(screen.getByRole('dialog', { name: 'Delete Image' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete' })).toHaveClass('bg-danger')
  })
})
