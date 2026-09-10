import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { EventTicketSettings } from './EventTicketSettings'
import { EventTicketTypesCard } from './EventTicketTypesCard'

const mocks = vi.hoisted(() => ({ save: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn(), refresh: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }))
vi.mock('@/app/actions/event-ticket-settings', () => ({ saveEventTicketSettings: mocks.save }))
vi.mock('@/app/actions/eventTicketTypes', () => ({ createEventTicketType: mocks.create, updateEventTicketType: mocks.update, deleteEventTicketType: mocks.remove }))

const event = { id: 'event', payment_mode: 'prepaid', online_discount_type: 'fixed', online_discount_value: 5, online_discount_ends_at: null }
const type = { id: 'standard', event_id: 'event', name: 'Standard', description: null, base_price: 45, capacity: null, sort_order: 0, is_active: true }

describe('Ticket setup', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.save.mockResolvedValue({ success: true }) })
  it('saves a London deadline and a required question for each guest', async () => {
    render(<EventTicketSettings event={event} canManage />)
    fireEvent.change(screen.getByLabelText('Discount ends (London time)'), { target: { value: '2026-09-20T18:00' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add allergy question' }))
    fireEvent.click(screen.getByLabelText('Answer required'))
    fireEvent.click(screen.getByRole('button', { name: 'Save ticket settings' }))
    await waitFor(() => expect(mocks.save).toHaveBeenCalledWith('event', expect.objectContaining({
      online_discount_ends_at: '2026-09-20T17:00:00.000Z',
      booking_questions: [expect.objectContaining({ label: 'Do you have any allergies or dietary requirements?', required: true })],
    })))
  })
  it('sends explicit nulls when removing an online discount', async () => {
    render(<EventTicketSettings event={event} canManage />)
    fireEvent.change(screen.getByLabelText('Discount'), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save ticket settings' }))
    await waitFor(() => expect(mocks.save).toHaveBeenCalledWith('event', expect.objectContaining({ online_discount_type: null, online_discount_value: null, online_discount_ends_at: null })))
  })
  it('shows the server failure and retains entered guest questions', async () => {
    mocks.save.mockResolvedValue({ error: 'Ticket settings could not be saved' })
    render(<EventTicketSettings event={event} canManage />)
    fireEvent.click(screen.getByRole('button', { name: 'Add accessibility question' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save ticket settings' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Ticket settings could not be saved')
    expect(screen.getByLabelText('Question 1')).toHaveValue('Do you have any accessibility needs we should be aware of?')
  })
  it('keeps free event settings simple', () => {
    render(<EventTicketSettings event={{ id: 'free', payment_mode: 'free' }} canManage />)
    expect(screen.queryByRole('button', { name: 'Add a question' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Discount')).not.toBeInTheDocument()
  })
  it('shows full and discounted prices and rejects an empty paid price', async () => {
    render(<EventTicketTypesCard eventId="event" initialTicketTypes={[type]} canManage event={event} />)
    expect(screen.getByText('£45.00')).toBeInTheDocument()
    expect(screen.getByText('£40.00')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Edit Standard' }))
    fireEvent.change(screen.getByLabelText('Full ticket price (£)'), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save ticket' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Enter a ticket price above £0, or choose Free ticket')
    expect(mocks.update).not.toHaveBeenCalled()
  })
  it('requires an explicit free-ticket selection to save zero', async () => {
    mocks.update.mockResolvedValue({ success: true, data: { ...type, base_price: 0 } })
    render(<EventTicketTypesCard eventId="event" initialTicketTypes={[type]} canManage event={event} />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit Standard' }))
    fireEvent.click(screen.getByLabelText('Free ticket'))
    fireEvent.click(screen.getByRole('button', { name: 'Save ticket' }))
    await waitFor(() => expect(mocks.update).toHaveBeenCalledWith('standard', expect.objectContaining({ base_price: 0, is_free_ticket: true })))
  })
})
