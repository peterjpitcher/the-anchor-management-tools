import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SearchInput } from '@/ds'

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
