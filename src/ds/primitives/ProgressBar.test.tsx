import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ProgressBar } from './ProgressBar'

describe('ProgressBar', () => {
  it('names the bar for screen readers when given a label', () => {
    render(<ProgressBar value={40} label="Onboarding progress" />)
    const bar = screen.getByRole('progressbar', { name: 'Onboarding progress' })
    expect(bar).toHaveAttribute('aria-valuenow', '40')
  })

  it('keeps the value between 0 and 100', () => {
    render(<ProgressBar value={140} label="Holiday allowance used" />)
    expect(screen.getByRole('progressbar', { name: 'Holiday allowance used' })).toHaveAttribute('aria-valuenow', '100')
  })
})
