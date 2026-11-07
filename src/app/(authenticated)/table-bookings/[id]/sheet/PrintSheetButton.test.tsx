import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { PrintSheetButton } from './PrintSheetButton'

describe('PrintSheetButton', () => {
  let print: ReturnType<typeof vi.fn>

  beforeEach(() => {
    print = vi.fn()
    vi.stubGlobal('print', print)
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback: FrameRequestCallback) => {
      callback(0)
      return 1
    })
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('opens the print window when pressed', () => {
    render(<PrintSheetButton />)
    expect(print).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Print' }))

    expect(print).toHaveBeenCalledTimes(1)
  })

  it('opens it once by itself for a print link, not again on re-render', () => {
    const { rerender } = render(<PrintSheetButton autoPrint />)
    rerender(<PrintSheetButton autoPrint />)

    expect(print).toHaveBeenCalledTimes(1)
  })
})
