import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Field, SearchInput } from '@/ds'

describe('SearchInput', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('keeps typed text visible while debouncing change events', () => {
    vi.useFakeTimers()
    const onChange = vi.fn()

    render(
      <SearchInput
        value=""
        onChange={onChange}
        debounceDelay={350}
        placeholder="Search customers"
      />
    )

    const input = screen.getByPlaceholderText('Search customers')
    fireEvent.change(input, { target: { value: 'eli' } })

    expect(input).toHaveValue('eli')
    expect(onChange).not.toHaveBeenCalled()

    vi.advanceTimersByTime(349)
    expect(onChange).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    expect(onChange).toHaveBeenCalledWith('eli')
  })
})

describe('SearchInput naming', () => {
  it('puts id, aria-label and aria-describedby on the text field', () => {
    render(
      <>
        <SearchInput id="customer-search" aria-label="Search customers" aria-describedby="search-help" value="" onChange={() => {}} />
        <p id="search-help">Name, phone or email</p>
      </>,
    )

    const input = screen.getByRole('textbox', { name: 'Search customers' })
    expect(input).toHaveAttribute('id', 'customer-search')
    expect(input).toHaveAccessibleDescription('Name, phone or email')
  })

  it('can be labelled, described and marked invalid by a Field', () => {
    render(
      <Field label="Find a Customer" hint="Name, phone or email" error="Type at least two letters">
        <SearchInput value="a" onChange={() => {}} />
      </Field>,
    )

    const input = screen.getByRole('textbox', { name: 'Find a Customer' })
    expect(input).toHaveAccessibleDescription('Name, phone or email Type at least two letters')
    expect(input).toHaveAttribute('aria-invalid', 'true')
  })

  it('leaves the field unnamed by extra attributes when none are given', () => {
    render(<SearchInput value="" onChange={() => {}} placeholder="Search staff" />)

    const input = screen.getByPlaceholderText('Search staff')
    expect(input).not.toHaveAttribute('aria-label')
    expect(input).not.toHaveAttribute('aria-describedby')
    expect(input).not.toHaveAttribute('aria-invalid')
  })
})
