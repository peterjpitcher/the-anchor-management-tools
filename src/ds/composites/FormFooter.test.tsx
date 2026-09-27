import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { FormFooter } from './FormFooter'

describe('FormFooter', () => {
  it('keeps the buttons in source order so the primary sits right on desktop and on top on phones', () => {
    render(
      <FormFooter>
        <button type="button">Cancel</button>
        <button type="submit">Save</button>
      </FormFooter>,
    )
    const buttons = screen.getAllByRole('button')
    expect(buttons.map((b) => b.textContent)).toEqual(['Cancel', 'Save'])
    const row = buttons[0].parentElement as HTMLElement
    expect(row.className).toContain('flex-col-reverse')
    expect(row.className).toContain('sm:flex-row')
    expect(row.parentElement?.className).toContain('sm:justify-end')
  })

  it('spreads the row when there is leading text', () => {
    render(
      <FormFooter start="Total £40.00">
        <button type="submit">Save</button>
      </FormFooter>,
    )
    expect(screen.getByText('Total £40.00')).toBeTruthy()
    const outer = screen.getByText('Total £40.00').parentElement as HTMLElement
    expect(outer.className).toContain('sm:justify-between')
  })
})
