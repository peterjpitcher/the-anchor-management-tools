import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { Stepper } from './Stepper'

const steps = [
  { label: 'Create Account', status: 'done' as const },
  { label: 'Personal Details', status: 'active' as const },
  { label: 'Emergency Contacts', status: 'upcoming' as const },
  { label: 'Bank Details', status: 'upcoming' as const },
  { label: 'Review', status: 'upcoming' as const },
]

describe('Stepper', () => {
  it('shows the full list of steps from the shell breakpoint up', () => {
    render(<Stepper steps={steps} />)

    const list = screen.getByRole('list')
    expect(list).toHaveClass('max-shell:hidden')
    expect(within(list).getAllByRole('listitem')).toHaveLength(5)
    expect(within(list).getByText('Personal Details').closest('li')).toHaveAttribute('aria-current', 'step')
  })

  it('shows one line on a phone: the step count and the current step', () => {
    render(<Stepper steps={steps} />)

    const count = screen.getByText('Step 2 of 5')
    const summary = count.closest('div') as HTMLElement
    expect(summary).toHaveClass('shell:hidden')
    expect(within(summary).getByText('Personal Details')).toHaveClass('break-words')
    // One bar segment per step, shrinking to fit a 375px screen.
    const bar = summary.querySelector('[aria-hidden="true"]') as HTMLElement
    expect(bar.children).toHaveLength(5)
    expect(bar.children[0]).toHaveClass('flex-1', 'min-w-0', 'bg-success')
    expect(bar.children[1]).toHaveClass('bg-primary')
    expect(bar.children[2]).toHaveClass('bg-border-strong')
  })

  it('shows the first step not yet done when none is active', () => {
    render(
      <Stepper
        steps={[
          { label: 'One', status: 'done' },
          { label: 'Two', status: 'upcoming' },
        ]}
      />,
    )

    expect(screen.getByText('Step 2 of 2')).toBeInTheDocument()
  })

  it('shows the last step when every step is done', () => {
    render(
      <Stepper
        steps={[
          { label: 'One', status: 'done' },
          { label: 'Two', status: 'done' },
        ]}
      />,
    )

    expect(screen.getByText('Step 2 of 2')).toBeInTheDocument()
  })

  it('renders an empty list without a phone summary when there are no steps', () => {
    render(<Stepper steps={[]} />)

    expect(screen.queryByText(/Step \d+ of/)).not.toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Progress' })).toBeInTheDocument()
  })
})
