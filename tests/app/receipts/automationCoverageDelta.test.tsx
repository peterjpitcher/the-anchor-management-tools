// Automation coverage is itself a percentage, so the monthly overview shows its change in
// percentage points ("+5.2 pts"), never as "5.2%", with the Stat's usual direction colour and words.

import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Stat } from '@/ds'
import { automationCoverageDeltaLabel } from '@/app/(authenticated)/receipts/_shared/status-ui'

describe('automationCoverageDeltaLabel', () => {
  it.each([
    [5.2, '+5.2 pts'],
    [-3, '-3 pts'],
    [0, '0 pts'],
    [0.04, '0 pts'],
    [12.345, '+12.3 pts'],
  ])('writes a change of %s points as %s', (points, label) => {
    expect(automationCoverageDeltaLabel(points)).toBe(label)
  })

  it('shows points, not a percentage, in the coverage Stat', () => {
    render(
      <Stat
        label="Automation coverage"
        value="72%"
        delta={5.2}
        deltaLabel={automationCoverageDeltaLabel(5.2)}
      />
    )

    const delta = screen.getByText('+5.2 pts')
    expect(delta).toHaveClass('text-success-fg')
    expect(delta).toHaveTextContent('up')
    expect(screen.queryByText('5.2%', { exact: false })).not.toBeInTheDocument()
  })
})
