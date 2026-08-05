import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { StarRating } from '@/components/features/feedback/StarRating'

/**
 * The star restyle changed the icon and the classes only. These assertions pin
 * the accessible surface that must survive it, plus the two colour tokens the
 * design depends on.
 */
describe('StarRating', () => {
  it('keeps its group role, label and per-star accessible names', () => {
    render(<StarRating value={0} onChange={vi.fn()} />)

    expect(screen.getByRole('group', { name: 'Star rating' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '1 star' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '5 stars' })).toBeInTheDocument()
    expect(screen.getAllByRole('button')).toHaveLength(5)
  })

  it('marks only the selected star as pressed', () => {
    render(<StarRating value={3} onChange={vi.fn()} />)

    expect(screen.getByRole('button', { name: '3 stars' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: '2 stars' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('still moves the rating with the arrow keys', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<StarRating value={3} onChange={onChange} />)

    const third = screen.getByRole('button', { name: '3 stars' })
    third.focus()

    await user.keyboard('{ArrowRight}')
    expect(onChange).toHaveBeenLastCalledWith(4)

    await user.keyboard('{ArrowLeft}')
    expect(onChange).toHaveBeenLastCalledWith(2)
  })

  it('clamps arrow-key movement to the ends of the scale', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<StarRating value={5} onChange={onChange} />)

    screen.getByRole('button', { name: '5 stars' }).focus()
    await user.keyboard('{ArrowUp}')
    expect(onChange).toHaveBeenLastCalledWith(5)

    screen.getByRole('button', { name: '1 star' }).focus()
    await user.keyboard('{ArrowDown}')
    expect(onChange).toHaveBeenLastCalledWith(1)
  })

  it('colours filled stars gold and empty stars in the muted border token', () => {
    const { container } = render(<StarRating value={2} onChange={vi.fn()} />)
    const icons = container.querySelectorAll('svg')

    expect(icons).toHaveLength(5)
    expect(icons[1]?.getAttribute('class')).toContain('text-anchor-gold')
    expect(icons[2]?.getAttribute('class')).toContain('text-guest-border-strong')
    // The old palette and the old blue focus ring must be gone.
    expect(container.innerHTML).not.toContain('text-yellow-400')
    expect(container.innerHTML).not.toContain('text-gray-300')
    expect(container.innerHTML).not.toContain('ring-blue-500')
  })
})
