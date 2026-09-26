import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Field } from '@/ds'
import CustomerSearchInput from '@/components/features/customers/CustomerSearchInput'

// The picker only reaches Supabase once someone types, so a bare client is enough here. It is
// one shared object, as the browser client is: a new one per render re-runs the picker's
// load effect on every render.
const supabaseClient = vi.hoisted(() => ({}))
vi.mock('@/lib/supabase/client', () => ({ createClient: () => supabaseClient }))

describe('CustomerSearchInput inside a DS Field', () => {
  it('is named by the Field label, so the label is not pointing at nothing', () => {
    render(
      <Field label="Customer" hint="Pick the guest this message belongs to">
        <CustomerSearchInput onCustomerSelect={() => undefined} />
      </Field>,
    )

    const input = screen.getByLabelText('Customer')
    expect(input.tagName).toBe('INPUT')
    expect(input).toHaveAccessibleDescription('Pick the guest this message belongs to')
  })

  it('still renders on its own without a Field', () => {
    render(<CustomerSearchInput onCustomerSelect={() => undefined} placeholder="Search customers..." />)
    expect(screen.getByPlaceholderText('Search customers...')).toBeInTheDocument()
  })
})
