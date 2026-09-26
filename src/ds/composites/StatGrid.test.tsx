import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { StatGrid } from './StatGrid'
import { Stat } from '@/ds/primitives/Stat'

describe('StatGrid', () => {
  it('frames every stat in its own card and skips empty children', () => {
    const { container } = render(
      <StatGrid columns={3}>
        <Stat label="Bookings" value={12} />
        {null}
        {false}
        <Stat label="Covers" value={48} />
      </StatGrid>,
    )
    const grid = container.firstElementChild as HTMLElement
    expect(grid.className).toContain('grid')
    expect(grid.className).toContain('gap-4')
    expect(grid.className).toContain('lg:grid-cols-3')
    expect(grid.children).toHaveLength(2)
    expect(screen.getByText('Bookings')).toBeTruthy()
    expect(screen.getByText('Covers')).toBeTruthy()
    for (const card of Array.from(grid.children)) {
      expect(card.className).toContain('rounded-lg')
    }
  })
})
