import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { Checkbox } from './Checkbox'
import { Radio } from './Radio'

// jsdom has no pointer media query, so these check the classes that switch on for touch
// screens only, and that the compact mouse layout keeps its classes.
const TOUCH_LABEL = 'pointer-coarse:py-[calc((var(--spacing-touch)_-_var(--text-ui--line-height))/2)]'
const TOUCH_BOX_COLUMN = ['pointer-coarse:box-content', 'pointer-coarse:py-[calc((var(--spacing-touch)_-_var(--text-ui--line-height))/2)]']
const TOUCH_BOX_FACE = 'pointer-coarse:inset-y-[calc((var(--spacing-touch)_-_var(--text-ui--line-height))/2)]'

describe.each([
  {
    name: 'Checkbox',
    renderControl: (onChange: (value: unknown) => void) => <Checkbox label="Send a reminder" defaultChecked onChange={onChange} />,
    role: 'checkbox' as const,
  },
  {
    name: 'Radio',
    renderControl: (onChange: (value: unknown) => void) => <Radio label="Send a reminder" name="r" value="yes" checked={false} onChange={onChange} />,
    role: 'radio' as const,
  },
])('$name touch target', ({ renderControl, role }) => {
  it('grows the label to 44px on touch screens only, keeping the mouse layout', () => {
    render(renderControl(() => {}))

    const label = screen.getByText('Send a reminder')
    expect(label.tagName).toBe('LABEL')
    expect(label).toHaveClass('text-ui', 'text-text', 'cursor-pointer', TOUCH_LABEL)
    // No unconditional height or padding change: a mouse sees the same row as before.
    expect(label.className).not.toMatch(/(^|\s)(py|min-h|h)-/)
  })

  it('pads the box column by the same amount so the box stays level with the label', () => {
    render(renderControl(() => {}))

    const control = screen.getByRole(role, { name: 'Send a reminder' })
    const column = control.parentElement as HTMLElement
    expect(column).toHaveClass('relative', 'mt-0.5', 'h-4', 'w-4', 'shrink-0', ...TOUCH_BOX_COLUMN)
    // The real input covers the padded column on touch; the drawn box stays 16px.
    expect(control).toHaveClass('h-4', 'w-4', 'pointer-coarse:h-full')
    expect(column.querySelector('span[aria-hidden="true"]')).toHaveClass('inset-0', TOUCH_BOX_FACE)
  })

  it('still toggles from a tap on the label', () => {
    const onChange = vi.fn()
    render(renderControl(onChange))

    fireEvent.click(screen.getByText('Send a reminder'))

    expect(onChange).toHaveBeenCalled()
  })
})

describe('Checkbox with no visible label', () => {
  it('keeps the compact box, since there is no label to enlarge', () => {
    render(<Checkbox aria-label="Select row" />)

    const control = screen.getByRole('checkbox', { name: 'Select row' })
    const column = control.parentElement as HTMLElement
    expect(column).not.toHaveClass('pointer-coarse:box-content')
    expect(control).not.toHaveClass('pointer-coarse:h-full')
  })

  it('draws the tick at the box, not at the top of the padded column', () => {
    render(<Checkbox label="Vegan" checked onChange={() => {}} />)

    const column = screen.getByRole('checkbox', { name: 'Vegan' }).parentElement as HTMLElement
    expect(column.querySelector('svg')).toHaveClass('inset-0', 'h-4', 'w-4', TOUCH_BOX_FACE)
  })
})
