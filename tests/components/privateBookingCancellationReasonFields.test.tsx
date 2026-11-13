import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { CancellationReasonFields } from '@/components/private-bookings/CancellationReasonFields'

describe('CancellationReasonFields', () => {
  it('offers the fixed list, starting with nothing chosen', () => {
    render(<CancellationReasonFields code="" note="" onCodeChange={vi.fn()} onNoteChange={vi.fn()} />)

    const options = screen.getAllByRole('option').map((option) => option.textContent)
    expect(options).toEqual([
      'Choose a reason',
      'Date not available',
      'Price',
      'Group too big for the space',
      'Customer did not reply',
      'Customer chose somewhere else',
      'Duplicate or test enquiry',
      'Other',
    ])
    expect(screen.getByText('Note (optional)')).toBeInTheDocument()
  })

  it('reports the reason chosen and the note typed', () => {
    const onCodeChange = vi.fn()
    const onNoteChange = vi.fn()
    render(<CancellationReasonFields code="" note="" onCodeChange={onCodeChange} onNoteChange={onNoteChange} />)

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'price' } })
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Half the quote' } })

    expect(onCodeChange).toHaveBeenCalledWith('price')
    expect(onNoteChange).toHaveBeenCalledWith('Half the quote')
  })

  it('marks the note as needed for "Other"', () => {
    render(<CancellationReasonFields code="other" note="" onCodeChange={vi.fn()} onNoteChange={vi.fn()} />)

    expect(screen.queryByText('Note (optional)')).not.toBeInTheDocument()
    expect(screen.getByText('Note')).toBeInTheDocument()
  })
})
