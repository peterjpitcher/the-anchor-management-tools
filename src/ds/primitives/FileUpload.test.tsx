import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { Field } from './Field'
import { FileUpload } from './FileUpload'

function fileInput(container: HTMLElement): HTMLInputElement {
  const input = container.querySelector('input[type="file"]')
  if (!(input instanceof HTMLInputElement)) throw new Error('no file input')
  return input
}

describe('FileUpload', () => {
  it('is a real button named by its own text when nothing labels it', () => {
    render(<FileUpload onFiles={() => {}} hint="CSV files only" />)

    const zone = screen.getByRole('button', { name: /Drag files here or click to browse/ })
    expect(zone.tagName).toBe('BUTTON')
    expect(zone).toHaveAttribute('type', 'button')
    expect(zone).not.toHaveAttribute('aria-describedby')
  })

  it('opens the hidden file input when the zone is pressed', () => {
    const { container } = render(<FileUpload onFiles={() => {}} />)
    const input = fileInput(container)
    const click = vi.spyOn(input, 'click')

    fireEvent.click(screen.getByRole('button'))

    expect(click).toHaveBeenCalledTimes(1)
    expect(input).toHaveClass('hidden')
    expect(input).toHaveAttribute('tabindex', '-1')
  })

  it('passes picked files on, dropping any over the size limit', () => {
    const onFiles = vi.fn()
    const { container } = render(<FileUpload onFiles={onFiles} maxSize={5} />)
    const small = new File(['abc'], 'small.csv', { type: 'text/csv' })
    const large = new File(['abcdefghij'], 'large.csv', { type: 'text/csv' })

    fireEvent.change(fileInput(container), { target: { files: [small, large] } })

    expect(onFiles).toHaveBeenCalledWith([small])
  })

  it('is named, described and marked by a surrounding Field', () => {
    render(
      <Field label="Upload Signed Waiver" hint="Scan both pages">
        <FileUpload onFiles={() => {}} hint="PDF or image, max 10 MB." />
      </Field>,
    )

    const zone = screen.getByRole('button', { name: 'Upload Signed Waiver' })
    expect(zone).toHaveAccessibleDescription('PDF or image, max 10 MB. Scan both pages')
  })

  it('takes an id and aria-describedby directly', () => {
    render(
      <>
        <label htmlFor="receipt-upload">Receipt</label>
        <FileUpload id="receipt-upload" aria-describedby="receipt-help" onFiles={() => {}} />
        <p id="receipt-help">A photo is fine</p>
      </>,
    )

    const zone = screen.getByRole('button', { name: 'Receipt' })
    expect(zone).toHaveAttribute('id', 'receipt-upload')
    expect(zone).toHaveAccessibleDescription('A photo is fine')
  })

  it('does nothing while disabled', () => {
    const onFiles = vi.fn()
    const { container } = render(<FileUpload onFiles={onFiles} disabled />)
    const zone = screen.getByRole('button')
    const input = fileInput(container)
    const click = vi.spyOn(input, 'click')

    expect(zone).toBeDisabled()
    expect(zone).toHaveClass('opacity-50', 'cursor-not-allowed')
    expect(input).toBeDisabled()

    fireEvent.click(zone)
    fireEvent.drop(zone, { dataTransfer: { files: [new File(['a'], 'a.csv')] } })

    expect(click).not.toHaveBeenCalled()
    expect(onFiles).not.toHaveBeenCalled()
  })

  it('accepts dropped files when enabled', () => {
    const onFiles = vi.fn()
    render(<FileUpload onFiles={onFiles} />)
    const file = new File(['a'], 'a.csv')

    fireEvent.drop(screen.getByRole('button'), { dataTransfer: { files: [file] } })

    expect(onFiles).toHaveBeenCalledWith([file])
  })
})
