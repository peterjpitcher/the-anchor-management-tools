import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { Switch } from './Switch'

describe('Switch', () => {
  it('keeps the visual track compact inside a mobile-safe tap target', () => {
    const onChange = vi.fn()

    render(<Switch label="Active" checked={false} size="sm" onChange={onChange} />)

    const control = screen.getByRole('switch', { name: 'Active' })
    expect(control.className).toContain('max-shell:h-11')
    expect(control.className).toContain('max-shell:w-11')
    expect(control.querySelector('[aria-hidden="true"]')?.className).toContain('w-7')

    fireEvent.click(control)
    expect(onChange).toHaveBeenCalledWith(true)
  })

  it('takes its name from aria-label when no visible label is rendered with it', () => {
    render(<Switch aria-label="Online Bookings" checked onChange={vi.fn()} />)

    const control = screen.getByRole('switch', { name: 'Online Bookings' })
    expect(control).toHaveAttribute('aria-checked', 'true')
    expect(screen.queryByText('Online Bookings')).not.toBeInTheDocument()
  })
})
