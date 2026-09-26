import { createRef } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { Field } from './Field'
import { FileButton } from './FileButton'

function fileInput(container: HTMLElement): HTMLInputElement {
  const input = container.querySelector('input[type="file"]')
  if (!(input instanceof HTMLInputElement)) throw new Error('no file input')
  return input
}

/** jsdom will not let a test set a file input's value to a path, so record resets instead. */
function trackValueResets(input: HTMLInputElement): string[] {
  const writes: string[] = []
  Object.defineProperty(input, 'value', {
    configurable: true,
    get: () => '',
    set: (next: string) => {
      writes.push(next)
    },
  })
  return writes
}

describe('FileButton', () => {
  it('is a DS button that opens a hidden, unfocusable file input', () => {
    const { container } = render(<FileButton onFiles={() => {}}>Upload Receipt</FileButton>)
    const button = screen.getByRole('button', { name: 'Upload Receipt' })
    const input = fileInput(container)
    const click = vi.spyOn(input, 'click')

    expect(button).toHaveAttribute('type', 'button')
    expect(input).toHaveClass('hidden')
    expect(input).toHaveAttribute('tabindex', '-1')
    expect(input).toHaveAttribute('aria-hidden', 'true')

    fireEvent.click(button)
    expect(click).toHaveBeenCalledTimes(1)
  })

  it('passes accept, multiple and capture to the input', () => {
    const { container } = render(
      <FileButton onFiles={() => {}} accept="image/*" multiple capture="environment">
        Take Photo
      </FileButton>,
    )
    const input = fileInput(container)

    expect(input).toHaveAttribute('accept', 'image/*')
    expect(input.multiple).toBe(true)
    expect(input).toHaveAttribute('capture', 'environment')
  })

  it('hands over the picked files and clears the input so the same file can be picked again', () => {
    const onFiles = vi.fn()
    const { container } = render(<FileButton onFiles={onFiles}>Upload</FileButton>)
    const input = fileInput(container)
    const resets = trackValueResets(input)
    const file = new File(['x'], 'receipt.jpg', { type: 'image/jpeg' })

    fireEvent.change(input, { target: { files: [file] } })

    expect(onFiles).toHaveBeenCalledWith([file])
    expect(resets).toEqual([''])
  })

  it('keeps the pick when named, so it submits with the form', () => {
    const onFiles = vi.fn()
    const { container } = render(
      <FileButton onFiles={onFiles} name="receipt">
        Upload
      </FileButton>,
    )
    const input = fileInput(container)
    const resets = trackValueResets(input)
    const file = new File(['x'], 'receipt.jpg', { type: 'image/jpeg' })

    fireEvent.change(input, { target: { files: [file] } })

    expect(input).toHaveAttribute('name', 'receipt')
    expect(onFiles).toHaveBeenCalledWith([file])
    expect(resets).toEqual([])
  })

  it('does not call onFiles when the picker is cancelled', () => {
    const onFiles = vi.fn()
    const { container } = render(<FileButton onFiles={onFiles}>Upload</FileButton>)

    fireEvent.change(fileInput(container), { target: { files: [] } })

    expect(onFiles).not.toHaveBeenCalled()
  })

  it('blocks picking while disabled or loading', () => {
    const { container, rerender } = render(
      <FileButton onFiles={() => {}} disabled>
        Upload
      </FileButton>,
    )
    expect(screen.getByRole('button', { name: 'Upload' })).toBeDisabled()
    expect(fileInput(container)).toBeDisabled()

    rerender(
      <FileButton onFiles={() => {}} loading>
        Upload
      </FileButton>,
    )
    expect(screen.getByRole('button', { name: 'Upload' })).toBeDisabled()
    expect(fileInput(container)).toBeDisabled()
  })

  it('passes variant, size, icon, id and aria-label to the Button', () => {
    render(
      <FileButton
        onFiles={() => {}}
        variant="primary"
        size="sm"
        id="photo-button"
        aria-label="Add a photo of the receipt"
        icon={<svg data-testid="camera-icon" />}
      />,
    )
    const button = screen.getByRole('button', { name: 'Add a photo of the receipt' })

    expect(button).toHaveAttribute('id', 'photo-button')
    expect(button).toHaveClass('bg-primary', 'h-btn-h-sm')
    expect(screen.getByTestId('camera-icon')).toBeInTheDocument()
  })

  it('exposes the input through inputRef so a caller can clear it', () => {
    const ref = createRef<HTMLInputElement>()
    const { container } = render(
      <FileButton onFiles={() => {}} inputRef={ref} name="upload">
        Upload
      </FileButton>,
    )

    expect(ref.current).toBe(fileInput(container))
  })

  it('can be labelled and described by a Field', () => {
    render(
      <Field label="Proof of Address" hint="A bill from the last three months">
        <FileButton onFiles={() => {}}>Choose File</FileButton>
      </Field>,
    )

    const button = screen.getByRole('button', { name: 'Proof of Address' })
    expect(button).toHaveAccessibleDescription('A bill from the last three months')
  })
})
