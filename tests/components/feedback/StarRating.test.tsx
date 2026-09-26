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

  it('takes its group name from the question it answers when given aria-labelledby', () => {
    render(
      <>
        <p id="rating-question">How would you rate your visit?</p>
        <StarRating value={0} onChange={vi.fn()} aria-labelledby="rating-question" />
      </>,
    )

    const group = screen.getByRole('group', { name: 'How would you rate your visit?' })
    expect(group).toHaveAttribute('aria-labelledby', 'rating-question')
    expect(group).not.toHaveAttribute('aria-label')
    expect(screen.queryByRole('group', { name: 'Star rating' })).not.toBeInTheDocument()
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
    expect(container.innerHTML).not.toContain('text-text-subtle')
    expect(container.innerHTML).not.toContain('ring-blue-500')
  })

  it('draws staff stars in the staff tokens, with the staff focus pattern', () => {
    const { container } = render(<StarRating value={2} onChange={vi.fn()} tone="staff" />)
    const icons = container.querySelectorAll('svg')

    expect(icons[1]?.getAttribute('class')).toContain('text-warning')
    expect(icons[2]?.getAttribute('class')).toContain('text-text-subtle')
    expect(screen.getByRole('button', { name: '1 star' }).className).toContain('rounded-default')
    expect(screen.getByRole('button', { name: '1 star' }).className).toContain('focus-visible:shadow-ring')
    expect(container.innerHTML).not.toContain('anchor-gold')
    expect(container.innerHTML).not.toContain('guest-')
  })

  it('shows a read-only rating with one accessible name and no buttons when onChange is left out', () => {
    const { container } = render(<StarRating value={3.6} tone="staff" />)

    expect(screen.getByRole('img', { name: '4 out of 5 stars' })).toBeInTheDocument()
    expect(screen.queryAllByRole('button')).toHaveLength(0)
    const icons = container.querySelectorAll('svg')
    expect(icons).toHaveLength(5)
    expect(icons[3]?.getAttribute('class')).toContain('text-warning')
    expect(icons[4]?.getAttribute('class')).toContain('text-text-subtle')
  })
})
