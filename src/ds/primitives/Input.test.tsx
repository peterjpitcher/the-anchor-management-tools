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
