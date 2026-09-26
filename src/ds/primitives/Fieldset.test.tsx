import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Field } from './Field'
import { Fieldset } from './Fieldset'
import { Radio } from './Radio'

const FIELD_LABEL_CLASSES = ['text-xs', 'font-medium', 'uppercase', 'tracking-wider', 'text-text-muted']

describe('Fieldset', () => {
  it('names the group with a legend that looks like a Field label', () => {
    render(
      <>
        <Field label="Email">
          <input />
        </Field>
        <Fieldset legend="Pay Type">
          <Radio name="pay" value="hourly" label="Hourly" />
          <Radio name="pay" value="salary" label="Salary" />
        </Fieldset>
      </>,
    )

    const group = screen.getByRole('group', { name: 'Pay Type' })
    const legend = group.querySelector('legend') as HTMLElement
    expect(group.tagName).toBe('FIELDSET')
    expect(legend).toHaveClass(...FIELD_LABEL_CLASSES)
    expect(screen.getByText('Email').closest('label')).toHaveClass(...FIELD_LABEL_CLASSES)
    expect(screen.getAllByRole('radio')).toHaveLength(2)
  })

  it('accepts label as another name for legend', () => {
    render(
      <Fieldset label="Send By">
        <button type="button">SMS</button>
      </Fieldset>,
    )

    expect(screen.getByRole('group', { name: 'Send By' })).toBeInTheDocument()
  })

  it('shows a required marker like Field', () => {
    render(
      <Fieldset legend="Pay Type" required>
        <span>controls</span>
      </Fieldset>,
    )

    const marker = screen.getByText('*')
    expect(marker).toHaveClass('ml-0.5', 'text-danger')
    expect(marker.closest('legend')).not.toBeNull()
  })

  it('describes the group with its hint and error, styled as in Field', () => {
    render(
      <Fieldset legend="Pay Type" hint="Ask the manager if unsure" error="Choose a pay type">
        <span>controls</span>
      </Fieldset>,
    )

    const group = screen.getByRole('group', { name: 'Pay Type' })
    expect(group).toHaveAccessibleDescription('Ask the manager if unsure Choose a pay type')
    expect(screen.getByText('Ask the manager if unsure')).toHaveClass('text-xs', 'text-text-soft')
    const error = screen.getByRole('alert')
    expect(error).toHaveTextContent('Choose a pay type')
    expect(error).toHaveClass('text-xs', 'text-danger-fg')
  })

  it('keeps a description the page set and passes other fieldset attributes through', () => {
    render(
      <>
        <Fieldset legend="Days" aria-describedby="days-help" disabled className="sm:col-span-2">
          <input aria-label="Monday" type="checkbox" />
        </Fieldset>
        <p id="days-help">Days the kitchen is open</p>
      </>,
    )

    const group = screen.getByRole('group', { name: 'Days' })
    expect(group).toHaveAccessibleDescription('Days the kitchen is open')
    expect(group).toBeDisabled()
    expect(group).toHaveClass('min-w-0', 'sm:col-span-2')
    expect(screen.getByRole('checkbox', { name: 'Monday' })).toBeDisabled()
  })

  it('renders no legend and no description when given none', () => {
    const { container } = render(
      <Fieldset>
        <span>controls</span>
      </Fieldset>,
    )

    const fieldset = container.querySelector('fieldset') as HTMLElement
    expect(fieldset.querySelector('legend')).toBeNull()
    expect(fieldset).not.toHaveAttribute('aria-describedby')
  })
})
