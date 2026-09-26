import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Input } from './Input'
import { Select } from './Select'
import { Textarea } from './Textarea'

// The red focus halo must replace the green one, not sit beside it: before cn() learnt the
// token names, both survived and the green one won (audit, 18 Sep 2026).
const DANGER_HALO = 'focus:shadow-[0_0_0_3px_color-mix(in_oklch,var(--color-danger)_20%,transparent)]'

interface ControlProps {
  label: string
  hint?: string
  error?: string
}

const controls = [
  { name: 'Input', renderControl: (props: ControlProps) => <Input {...props} /> },
  { name: 'Select', renderControl: (props: ControlProps) => <Select {...props} /> },
  { name: 'Textarea', renderControl: (props: ControlProps) => <Textarea {...props} /> },
]

describe('Input rightElement', () => {
  it('shows the element inside the field at the right, clear of the typed text', () => {
    render(<Input type="number" label="GP target" rightElement="%" />)

    const input = screen.getByLabelText('GP target')
    const suffix = screen.getByText('%')
    expect(suffix.parentElement).toBe(input.parentElement)
    expect(suffix).toHaveClass('pointer-events-none', 'absolute', 'inset-y-0', 'right-3', 'flex', 'items-center')
    expect(input).toHaveClass('pr-9')
  })

  it('keeps the normal right padding when there is no element', () => {
    render(<Input label="Name" />)

    expect(screen.getByLabelText('Name')).not.toHaveClass('pr-9')
  })
})

describe.each(controls)('$name', ({ renderControl }) => {
  it("uses Field's label look and the readable hint colour", () => {
    render(renderControl({ label: 'Notes', hint: 'Shown to staff only' }))

    expect(screen.getByText('Notes')).toHaveClass('text-xs', 'font-medium', 'uppercase', 'tracking-wider', 'text-text-muted')
    expect(screen.getByText('Shown to staff only')).toHaveClass('text-text-soft')
  })

  it('shows only the danger focus halo in the error state', () => {
    render(renderControl({ label: 'Notes', error: 'Required' }))

    const control = screen.getByLabelText('Notes')
    expect(control).toHaveClass('border-danger', 'focus:border-danger', DANGER_HALO)
    expect(control).not.toHaveClass('focus:shadow-ring')
    expect(control).not.toHaveClass('focus:border-border-focus')
  })
})

const WARNING_HALO = 'focus:shadow-[0_0_0_3px_color-mix(in_oklch,var(--color-warning)_20%,transparent)]'

describe('Input warning', () => {
  it('draws the field in amber with the message under it', () => {
    render(<Input label="Date" warning="This date is in the past" />)

    const input = screen.getByLabelText('Date')
    const message = screen.getByText('This date is in the past')
    expect(input).toHaveClass('border-warning', 'focus:border-warning', WARNING_HALO)
    expect(input).not.toHaveClass('border-border')
    expect(input).not.toHaveClass('focus:shadow-ring')
    expect(input).not.toHaveAttribute('aria-invalid')
    expect(input).toHaveAccessibleDescription('This date is in the past')
    expect(message).toHaveClass('text-warning-fg', 'text-xs', 'mt-1')
    expect(message).not.toHaveAttribute('role')
  })

  it('shows the error instead when both are set', () => {
    render(<Input label="Date" error="Enter a date" warning="This date is in the past" />)

    const input = screen.getByLabelText('Date')
    expect(screen.queryByText('This date is in the past')).not.toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a date')
    expect(input).toHaveClass('border-danger')
    expect(input).not.toHaveClass('border-warning')
    expect(input).toHaveAccessibleDescription('Enter a date')
  })

  it('replaces the hint while it shows, as an error does', () => {
    render(<Input label="Covers" hint="Adults and children" warning="More than the room holds" />)

    expect(screen.queryByText('Adults and children')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Covers')).toHaveAccessibleDescription('More than the room holds')
  })

  it('keeps a description passed in alongside the warning', () => {
    render(
      <>
        <Input label="Covers" warning="More than the room holds" aria-describedby="covers-help" />
        <p id="covers-help">Staff only</p>
      </>,
    )

    expect(screen.getByLabelText('Covers')).toHaveAccessibleDescription('More than the room holds Staff only')
  })
})
