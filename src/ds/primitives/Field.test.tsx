import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { FormGroup } from '../compat/FormGroup'
import { Input } from './Input'
import { Field } from './Field'

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
})
