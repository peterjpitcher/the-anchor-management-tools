// The 10 second Undo that follows Seated, Left and No-show (owner decision, 22 November 2026).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { UndoBar, type UndoOffer } from './UndoBar'

const OFFER: UndoOffer = {
  id: 1,
  bookingId: 'booking-1',
  label: 'Jo Bloggs marked as left',
  ticket: { action: 'left', stamp: '2026-11-21T19:30:00.000Z' },
}

const tick = (ms: number) => act(() => { vi.advanceTimersByTime(ms) })

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('UndoBar', () => {
  it('says what happened and counts down from ten', () => {
    render(<UndoBar offer={OFFER} onUndo={vi.fn()} onExpire={vi.fn()} />)

    expect(screen.getByRole('status')).toHaveTextContent('Jo Bloggs marked as left')
    expect(screen.getByRole('button', { name: 'Undo (10)' })).toBeInTheDocument()

    tick(1000)
    expect(screen.getByRole('button', { name: 'Undo (9)' })).toBeInTheDocument()

    tick(4000)
    expect(screen.getByRole('button', { name: 'Undo (5)' })).toBeInTheDocument()
  })

  it('takes itself away after ten seconds, and not before', () => {
    const onExpire = vi.fn()
    render(<UndoBar offer={OFFER} onUndo={vi.fn()} onExpire={onExpire} />)

    tick(9000)
    expect(onExpire).not.toHaveBeenCalled()

    tick(1000)
    expect(onExpire).toHaveBeenCalledTimes(1)
  })

  it('undoes on a tap', () => {
    const onUndo = vi.fn()
    render(<UndoBar offer={OFFER} onUndo={onUndo} onExpire={vi.fn()} />)

    tick(3000)
    fireEvent.click(screen.getByRole('button', { name: 'Undo (7)' }))

    expect(onUndo).toHaveBeenCalledTimes(1)
  })

  it('does not expire while the undo is being sent', () => {
    const onExpire = vi.fn()
    const { rerender } = render(<UndoBar offer={OFFER} onUndo={vi.fn()} onExpire={onExpire} />)

    tick(8000)
    rerender(<UndoBar offer={OFFER} busy onUndo={vi.fn()} onExpire={onExpire} />)
    tick(5000)

    expect(onExpire).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Undoing...' })).toBeDisabled()
  })

  it('is not restarted by the screen re-rendering around it', () => {
    const { rerender } = render(<UndoBar offer={OFFER} onUndo={vi.fn()} onExpire={vi.fn()} />)

    tick(2500)
    // A new callback identity on every render must not reset the second in progress.
    rerender(<UndoBar offer={OFFER} onUndo={vi.fn()} onExpire={vi.fn()} />)
    tick(500)

    expect(screen.getByRole('button', { name: 'Undo (7)' })).toBeInTheDocument()
  })
})
