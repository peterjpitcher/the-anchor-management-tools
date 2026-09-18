import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { Alert } from './Alert'

describe('Alert', () => {
  it('hides itself when dismissed and no onClose is given', () => {
    render(
      <Alert tone="info" closable>
        Saved
      </Alert>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('calls onClose instead, and never submits a surrounding form', () => {
    const onClose = vi.fn()
    const onSubmit = vi.fn((event: React.FormEvent) => event.preventDefault())
    render(
      <form onSubmit={onSubmit}>
        <Alert tone="danger" closable onClose={onClose}>
          Failed
        </Alert>
      </form>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onSubmit).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toBeTruthy()
  })

  it('shows no dismiss button unless closable', () => {
    render(<Alert tone="warning">Heads up</Alert>)
    expect(screen.queryByRole('button', { name: 'Dismiss' })).toBeNull()
  })
})
