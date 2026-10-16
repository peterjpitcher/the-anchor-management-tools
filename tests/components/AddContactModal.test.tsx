import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const createBusinessContact = vi.fn()

vi.mock('@/app/actions/marketing-contacts', () => ({
  createBusinessContact: (...args: unknown[]) => createBusinessContact(...args),
}))

import { AddContactModal } from '@/app/(authenticated)/marketing/contacts/AddContactModal'

function renderModal() {
  const onClose = vi.fn()
  const onAdded = vi.fn()
  render(<AddContactModal onClose={onClose} onAdded={onAdded} />)
  return { onClose, onAdded }
}

function fill(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(new RegExp(`^${label}`)), { target: { value } })
}

function submit() {
  fireEvent.click(screen.getByRole('button', { name: 'Add Contact' }))
}

beforeEach(() => {
  createBusinessContact.mockReset()
})

afterEach(cleanup)

describe('AddContactModal', () => {
  it('adds a business contact with the details entered', async () => {
    createBusinessContact.mockResolvedValue({
      success: true,
      data: { id: 'c1', email: 'jo@acme.co.uk' },
    })
    const { onAdded } = renderModal()

    fill('Email address', '  jo@acme.co.uk ')
    fill('Contact name', 'Jo Bloggs')
    fill('Company name', 'Acme Ltd')
    fill('Tags', 'local, office ,')
    submit()

    await waitFor(() => expect(onAdded).toHaveBeenCalledTimes(1))
    expect(createBusinessContact).toHaveBeenCalledWith({
      email: 'jo@acme.co.uk',
      contactName: 'Jo Bloggs',
      companyName: 'Acme Ltd',
      jobTitle: null,
      tags: ['local', 'office'],
      notes: null,
    })
  })

  it('shows the failure and stays open when the contact cannot be saved', async () => {
    createBusinessContact.mockResolvedValue({ error: 'jo@acme.co.uk is already in your contacts' })
    const { onAdded, onClose } = renderModal()

    fill('Email address', 'jo@acme.co.uk')
    submit()

    expect(await screen.findByText('jo@acme.co.uk is already in your contacts')).toBeInTheDocument()
    expect(screen.getByText('Contact not added')).toBeInTheDocument()
    expect(onAdded).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('shows a failure when the server cannot be reached', async () => {
    createBusinessContact.mockRejectedValue(new Error('network down'))
    const { onAdded } = renderModal()

    fill('Email address', 'jo@acme.co.uk')
    submit()

    expect(await screen.findByText(/Could not reach the server/)).toBeInTheDocument()
    expect(onAdded).not.toHaveBeenCalled()
  })

  it('does not send an address that is missing or malformed', () => {
    renderModal()

    submit()
    expect(screen.getByText('Enter an email address.')).toBeInTheDocument()

    fill('Email address', 'not-an-email')
    submit()
    expect(screen.getByText(/Enter a valid email address/)).toBeInTheDocument()

    expect(createBusinessContact).not.toHaveBeenCalled()
  })

  it('warns, without blocking, when the address looks personal', () => {
    renderModal()

    fill('Email address', 'jo@gmail.com')

    expect(screen.getByText(/looks like a personal address/)).toBeInTheDocument()
  })
})
