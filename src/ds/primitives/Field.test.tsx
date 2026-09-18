import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { FormGroup } from '../compat/FormGroup'
import { Input } from './Input'
import { Select } from './Select'
import { Textarea } from './Textarea'
import { Field } from './Field'

// Each control sets aria-invalid and aria-describedby from its own error and hint. Field must
// only ever add to those, never replace them (accessibility review, 18 Sep 2026).
const controls = [
  { name: 'Input', role: 'textbox', renderControl: (error: string) => <Input error={error} /> },
  {
    name: 'Select',
    role: 'combobox',
    renderControl: (error: string) => <Select error={error} options={[{ value: 'a', label: 'A' }]} />,
  },
  { name: 'Textarea', role: 'textbox', renderControl: (error: string) => <Textarea error={error} /> },
] as const

describe('Field', () => {
  it('connects the label, hint and error to its control', () => {
    render(
      <Field label="Email" hint="Use the shared inbox" error="Email is required" required>
        <Input />
      </Field>,
    )

    const input = screen.getByLabelText(/Email/)
    expect(input.getAttribute('aria-invalid')).toBe('true')
    expect(input.getAttribute('aria-describedby')).toContain(screen.getByRole('alert').id)
  })

  it('keeps the legacy FormGroup name as the same implementation', () => {
    expect(FormGroup).toBe(Field)
  })

  it.each(controls)("keeps the $name's own error state when the Field has none", ({ role, renderControl }) => {
    render(<Field label="Mobile">{renderControl('Enter a UK mobile number')}</Field>)

    const control = screen.getByRole(role, { name: 'Mobile' })
    expect(control).toHaveAttribute('aria-invalid', 'true')
    expect(control).toHaveAccessibleDescription('Enter a UK mobile number')
  })

  it.each(controls)("adds its hint to the $name without hiding the control's own error", ({ role, renderControl }) => {
    render(
      <Field label="Mobile" hint="Starts with 07">
        {renderControl('Enter a UK mobile number')}
      </Field>,
    )

    const control = screen.getByRole(role, { name: 'Mobile' })
    expect(control).toHaveAttribute('aria-invalid', 'true')
    expect(control).toHaveAccessibleDescription('Enter a UK mobile number Starts with 07')
  })

  it('keeps an aria-invalid and description the page set on the control itself', () => {
    render(
      <>
        <Field label="Preferred name">
          <Input aria-invalid aria-describedby="preferred-help" />
        </Field>
        <p id="preferred-help">What the team should call you</p>
      </>,
    )

    const input = screen.getByRole('textbox', { name: 'Preferred name' })
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(input).toHaveAccessibleDescription('What the team should call you')
  })

  it('leaves a valid control unmarked', () => {
    render(
      <Field label="Name">
        <Input />
      </Field>,
    )

    const input = screen.getByRole('textbox', { name: 'Name' })
    expect(input).not.toHaveAttribute('aria-invalid')
    expect(input).not.toHaveAttribute('aria-describedby')
  })
})
