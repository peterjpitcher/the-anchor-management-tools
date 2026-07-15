import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { Switch } from './Switch'

describe('Switch', () => {
  it('keeps the visual track compact inside a mobile-safe tap target', () => {
    const onChange = vi.fn()

    render(<Switch label="Active" checked={false} size="sm" onChange={onChange} />)

    const control = screen.getByRole('switch', { name: 'Active' })
    expect(control.className).toContain('max-[820px]:h-11')
    expect(control.className).toContain('max-[820px]:w-11')
    expect(control.querySelector('[aria-hidden="true"]')?.className).toContain('w-7')

    fireEvent.click(control)
    expect(onChange).toHaveBeenCalledWith(true)
  })
})
