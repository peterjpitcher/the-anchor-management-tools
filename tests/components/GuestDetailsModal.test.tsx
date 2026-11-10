import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GuestDetailsModal } from '@/app/(authenticated)/events/[id]/AddGuestDetailsModal'
import type { EventBookingRow } from '@/app/actions/events'

/*
 * Guests' names, mobiles and answers left the bookings list for this modal (owner request,
 * 9 November 2026). It must still show every answer, still let a manager add details to a booking
 * that has none, and never offer editing to someone who can only view the event.
 */

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('@/app/actions/event-attendees', () => ({ updateEventAttendees: vi.fn() }))

const ALLERGY = { id: 'q-allergy', label: 'Do you have any allergies or dietary requirements? Write none if not.', type: 'text' as const, required: true }

const helen = {
  id: 'booking-helen',
  seats: 2,
  status: 'confirmed',
  attendee_names: null,
  customer: { id: 'c1', first_name: 'Helen', last_name: 'Bhoobun', mobile_number: '+447700900001', email: null },
  attendees: [
    { id: 'g1', name: 'Helen Bhoobun', phone: '+447700900001', ticket_type_id: 't1', answers: [{ question_id: 'q-allergy', label: ALLERGY.label, type: 'text', value: 'Allergy to coconut', options: [], required: true }] },
    { id: 'g2', name: 'Amar Bhoobun', ticket_type_id: 't1', answers: [{ question_id: 'q-allergy', label: ALLERGY.label, type: 'text', value: 'None', options: [], required: true }] },
  ],
} as unknown as EventBookingRow

const leo = {
  id: 'booking-leo',
  seats: 1,
  status: 'pending_payment',
  attendees: [],
  attendee_names: null,
  customer: { id: 'c2', first_name: 'Leo', last_name: '', mobile_number: '+447700900002', email: null },
} as unknown as EventBookingRow

beforeEach(() => vi.clearAllMocks())

describe('GuestDetailsModal', () => {
  it("shows every guest's name, mobile and answers", () => {
    render(<GuestDetailsModal booking={helen} questions={[ALLERGY]} eventTakesGuestDetails canEdit onClose={vi.fn()} onSaved={vi.fn()} />)
    expect(screen.getByRole('heading', { name: 'Guest Details' })).toBeInTheDocument()
    expect(screen.getByText('Booked by Helen Bhoobun. Guests\' answers are confidential.')).toBeInTheDocument()
    expect(screen.getByText('Helen Bhoobun')).toBeInTheDocument()
    expect(screen.getByText('Amar Bhoobun')).toBeInTheDocument()
    expect(screen.getByText('Allergy to coconut')).toBeInTheDocument()
    expect(screen.getByText('Mobile: +447700900001')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Edit Details' })).toBeInTheDocument()
  })

  it('lets someone who can only view read the answers but not edit them', () => {
    render(<GuestDetailsModal booking={helen} questions={[ALLERGY]} eventTakesGuestDetails canEdit={false} onClose={vi.fn()} onSaved={vi.fn()} />)
    expect(screen.getByText('Allergy to coconut')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit Details' })).not.toBeInTheDocument()
  })

  it('opens straight into the form for a manager when a booking has no details yet', () => {
    render(<GuestDetailsModal booking={leo} questions={[ALLERGY]} eventTakesGuestDetails canEdit onClose={vi.fn()} onSaved={vi.fn()} />)
    expect(screen.getByRole('heading', { name: 'Add Guest Details' })).toBeInTheDocument()
    expect(screen.getByLabelText(/Guest 1 name/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save Guest Details' })).toBeInTheDocument()
  })

  it('says there are no details yet to someone who cannot add them', () => {
    render(<GuestDetailsModal booking={leo} questions={[ALLERGY]} eventTakesGuestDetails canEdit={false} onClose={vi.fn()} onSaved={vi.fn()} />)
    expect(screen.getByText('No guest details on this booking yet.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save Guest Details' })).not.toBeInTheDocument()
  })
})
