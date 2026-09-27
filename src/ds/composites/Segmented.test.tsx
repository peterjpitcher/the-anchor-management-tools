import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { Segmented } from './Segmented'

const options = [
  { id: 'list', label: 'List' },
  { id: 'calendar', label: 'Calendar' },
]

describe('Segmented', () => {
  it('takes its group name from aria-label', () => {
    render(<Segmented options={options} value="list" onChange={() => {}} aria-label="View" />)

    expect(screen.getByRole('radiogroup', { name: 'View' })).toBeInTheDocument()
  })

  it('takes its group name from a visible heading through aria-labelledby', () => {
    render(
      <>
        <h2 id="range-heading">Date Range</h2>
        <Segmented options={options} value="list" onChange={() => {}} aria-labelledby="range-heading" />
      </>,
    )

    expect(screen.getByRole('radiogroup', { name: 'Date Range' })).toBeInTheDocument()
  })

  it('adds no naming attributes when none are given', () => {
    render(<Segmented options={options} value="list" onChange={() => {}} />)

    const group = screen.getByRole('radiogroup')
    expect(group).not.toHaveAttribute('aria-label')
    expect(group).not.toHaveAttribute('aria-labelledby')
  })

  it('still reports the picked option', () => {
    const onChange = vi.fn()
    render(<Segmented options={options} value="list" onChange={onChange} aria-label="View" />)

    fireEvent.click(screen.getByRole('radio', { name: 'Calendar' }))

    expect(onChange).toHaveBeenCalledWith('calendar')
    expect(screen.getByRole('radio', { name: 'List' })).toHaveAttribute('aria-checked', 'true')
  })
})
