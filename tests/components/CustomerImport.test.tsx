import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CustomerImport } from '@/components/features/customers/CustomerImport'

// jsdom loads no Tailwind, so give it the two rules that decide whether the file input can
// take keyboard focus: `hidden` removes it from the tab order, `sr-only` keeps it there.
const TAILWIND_RULES =
  '.hidden{display:none}' +
  '.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;' +
  'clip:rect(0,0,0,0);white-space:nowrap;border-width:0}'

let style: HTMLStyleElement

beforeEach(() => {
  style = document.createElement('style')
  style.textContent = TAILWIND_RULES
  document.head.appendChild(style)
})

afterEach(() => {
  style.remove()
})

// The CSV input was display:none inside a label, so only a mouse could open it
// (accessibility review, 18 Sep 2026).
describe('CustomerImport upload', () => {
  it('can be reached with the Tab key', async () => {
    const user = userEvent.setup()
    render(<CustomerImport onImportComplete={vi.fn()} onCancel={vi.fn()} existingCustomers={[]} />)

    const upload = screen.getByLabelText('Upload CSV')
    for (let i = 0; i < 5 && document.activeElement !== upload; i++) {
      await user.tab()
    }

    expect(upload).toHaveFocus()
    expect(upload).toHaveAttribute('type', 'file')
  })
})
