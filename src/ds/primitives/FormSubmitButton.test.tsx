import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { FormSubmitButton } from './FormSubmitButton'

describe('FormSubmitButton', () => {
  it('renders as a submit button', () => {
    render(<FormSubmitButton>Save</FormSubmitButton>)

    const button = screen.getByRole('button', { name: 'Save' })
    expect(button.getAttribute('type')).toBe('submit')
    expect(button.hasAttribute('disabled')).toBe(false)
  })

  it('disables the button and shows the pending label while submitting', () => {
    render(
      <FormSubmitButton pending pendingLabel="Saving…">
        Save
      </FormSubmitButton>,
    )

    const button = screen.getByRole('button')
    expect(button.hasAttribute('disabled')).toBe(true)
    expect(button.textContent).toContain('Saving…')
  })
})
